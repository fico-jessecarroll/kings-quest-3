import { tokenize, type Token } from './lexer';
import type { BoolExpr, CallNode, IfStatement, Literal, Logic, Statement } from './ir';

export class ParseError extends Error {}

function describe(token: Token | undefined): string {
  return token ? `"${token.value}" at line ${token.line}, column ${token.column}` : 'end of input';
}

/**
 * Recursive-descent parser over a preprocessed (comment/include/macro-free)
 * AGI logic source. Grammar (informally):
 *
 *   logic      := statement*
 *   statement  := label | goto | return | if | incdec | call | assign
 *   label      := ":" identifier
 *   goto       := "goto" identifier ";"?
 *   return     := "return" "(" ")" ";"?
 *   if         := "if" "(" boolExpr ")" block ("else" (block | if))?
 *   block      := "{" statement* "}"
 *   incdec     := ("++" | "--") identifier ";"?
 *   call       := identifier "(" (literal ("," literal)*)? ")" ";"?
 *   assign     := identifier ("=" | "+=" | "-=") literal ";"?
 *   literal    := number | string | identifier
 *
 *   boolExpr   := orExpr
 *   orExpr     := andExpr ("||" andExpr)*
 *   andExpr    := unary ("&&" unary)*
 *   unary      := "!" unary | primaryBool
 *   primaryBool:= "(" boolExpr ")" | call | comparison | flagTest
 *   comparison := identifier ("==" | "!=" | "<" | ">") literal
 *   flagTest   := identifier
 *
 * Trailing ";" after statements is consumed when present but not required:
 * real CG source (e.g. RM0.CG's menu-building block) sometimes omits it.
 */
export function parseLogic(source: string): Logic {
  const tokens = tokenize(source);
  let pos = 0;

  function peek(offset = 0): Token | undefined {
    return tokens[pos + offset];
  }

  function advance(): Token {
    const token = tokens[pos];
    if (!token) {
      throw new ParseError('unexpected end of input');
    }
    pos++;
    return token;
  }

  function atEnd(): boolean {
    return pos >= tokens.length;
  }

  function isPunct(value: string): boolean {
    const token = peek();
    return !!token && token.type === 'punctuation' && token.value === value;
  }

  function isOperator(value: string): boolean {
    const token = peek();
    return !!token && token.type === 'operator' && token.value === value;
  }

  function isKeyword(value: string): boolean {
    const token = peek();
    return !!token && token.type === 'keyword' && token.value === value;
  }

  function expectPunct(value: string): Token {
    if (!isPunct(value)) {
      throw new ParseError(`expected "${value}" but got ${describe(peek())}`);
    }
    return advance();
  }

  function expectOperator(value: string): Token {
    if (!isOperator(value)) {
      throw new ParseError(`expected operator "${value}" but got ${describe(peek())}`);
    }
    return advance();
  }

  function expectKeyword(value: string): Token {
    if (!isKeyword(value)) {
      throw new ParseError(`expected keyword "${value}" but got ${describe(peek())}`);
    }
    return advance();
  }

  function expectIdentifier(context: string): Token {
    const token = peek();
    if (!token || token.type !== 'identifier') {
      throw new ParseError(`expected identifier ${context} but got ${describe(token)}`);
    }
    return advance();
  }

  function consumeOptionalSemicolon(): void {
    if (isPunct(';')) {
      advance();
    }
  }

  function parseLiteral(): Literal {
    const token = peek();
    if (!token) {
      throw new ParseError('unexpected end of input while parsing a value');
    }
    if (token.type === 'operator' && token.value === '-' && peek(1)?.type === 'number') {
      advance();
      const numberToken = advance();
      return { kind: 'number', value: -parseInt(numberToken.value, 10) };
    }
    if (token.type === 'number') {
      advance();
      return { kind: 'number', value: parseInt(token.value, 10) };
    }
    if (token.type === 'string') {
      advance();
      return { kind: 'string', value: token.value };
    }
    // A reserved word (e.g. "return") can still appear as an ordinary
    // said() word argument - RM0.CG has `said( ..., return)` - so accept
    // keyword tokens here too, as a symbol.
    if (token.type === 'identifier' || token.type === 'keyword') {
      advance();
      return { kind: 'symbol', name: token.value };
    }
    throw new ParseError(`expected a number, string or identifier but got ${describe(token)}`);
  }

  function parseArgs(): Literal[] {
    expectPunct('(');
    const args: Literal[] = [];
    while (!isPunct(')')) {
      args.push(parseLiteral());
      if (isPunct(',')) {
        advance();
        continue;
      }
      break;
    }
    expectPunct(')');
    return args;
  }

  /** Parses `name(args)`, used both as a statement (command call) and as a BoolExpr (test call). */
  function parseCall(): CallNode {
    const nameToken = advance();
    const args = parseArgs();
    return { type: 'call', name: nameToken.value, args };
  }

  function parsePrimaryBool(): BoolExpr {
    if (isPunct('(')) {
      advance();
      const expr = parseBoolExpr();
      expectPunct(')');
      return expr;
    }

    const token = peek();
    if (!token || token.type !== 'identifier') {
      throw new ParseError(`expected a boolean test expression but got ${describe(token)}`);
    }

    const next = peek(1);
    if (next && next.type === 'punctuation' && next.value === '(') {
      return parseCall();
    }

    advance();
    if (isOperator('==') || isOperator('!=') || isOperator('<') || isOperator('>')) {
      const opToken = advance();
      const right = parseLiteral();
      return {
        type: 'comparison',
        op: opToken.value as '==' | '!=' | '<' | '>',
        left: { kind: 'symbol', name: token.value },
        right,
      };
    }
    return { type: 'flagTest', name: token.value };
  }

  function parseUnary(): BoolExpr {
    if (isOperator('!')) {
      advance();
      return { type: 'not', expr: parseUnary() };
    }
    return parsePrimaryBool();
  }

  function parseAnd(): BoolExpr {
    let left = parseUnary();
    while (isOperator('&&')) {
      advance();
      left = { type: 'and', left, right: parseUnary() };
    }
    return left;
  }

  function parseOr(): BoolExpr {
    let left = parseAnd();
    while (isOperator('||')) {
      advance();
      left = { type: 'or', left, right: parseAnd() };
    }
    return left;
  }

  function parseBoolExpr(): BoolExpr {
    return parseOr();
  }

  function parseBlock(): Statement[] {
    expectPunct('{');
    const statements = parseStatementsUntil(() => isPunct('}'));
    expectPunct('}');
    return statements;
  }

  function parseIf(): IfStatement {
    expectKeyword('if');
    expectPunct('(');
    const test = parseBoolExpr();
    expectPunct(')');
    const thenBranch = parseBlock();

    let elseBranch: Statement[] | undefined;
    if (isKeyword('else')) {
      advance();
      if (isPunct('{')) {
        elseBranch = parseBlock();
      } else if (isKeyword('if')) {
        elseBranch = [parseIf()];
      } else {
        throw new ParseError(`expected "{" or "if" after "else" but got ${describe(peek())}`);
      }
    }

    return { type: 'if', test, then: thenBranch, else: elseBranch };
  }

  function parseIncDec(): Statement {
    const opToken = advance();
    if (!isOperator(opToken.value)) {
      throw new ParseError(`expected "${opToken.value}${opToken.value}" but got ${describe(peek())}`);
    }
    advance();
    const target = expectIdentifier(`after "${opToken.value}${opToken.value}"`);
    consumeOptionalSemicolon();
    return { type: 'incdec', target: target.value, op: (opToken.value + opToken.value) as '++' | '--' };
  }

  function parseCallOrAssign(): Statement {
    const nameToken = peek()!;
    const next = peek(1);
    if (next && next.type === 'punctuation' && next.value === '(') {
      const call = parseCall();
      consumeOptionalSemicolon();
      return call;
    }

    advance();
    let op: '=' | '+=' | '-=' = '=';
    if (isOperator('+')) {
      advance();
      expectOperator('=');
      op = '+=';
    } else if (isOperator('-')) {
      advance();
      expectOperator('=');
      op = '-=';
    } else if (isOperator('@')) {
      // RM100.CG's "work @= 0" - a typo'd "=", spelled "@=" instead.
      advance();
      expectOperator('=');
      op = '=';
    } else {
      expectOperator('=');
      if (isOperator('@')) {
        // RM99.CG's "debug.1 =@ debug.0" - the same typo, spelled "=@".
        advance();
      }
    }
    const value = parseLiteral();
    consumeOptionalSemicolon();
    return { type: 'assign', target: nameToken.value, op, value };
  }

  function parseStatement(): Statement {
    const token = peek();
    if (!token) {
      throw new ParseError('unexpected end of input');
    }

    if (token.type === 'punctuation' && token.value === ':') {
      advance();
      const name = expectIdentifier('after ":"');
      // RM85.CG's ":takeHisShit;" and RM105.CG's ":pick.a.chore;" both
      // trail a label with a stray ";", unlike every other label in the
      // corpus; tolerate it like the other "optional semicolon" statements.
      consumeOptionalSemicolon();
      return { type: 'label', name: name.value };
    }

    if (token.type === 'keyword' && token.value === 'goto') {
      advance();
      const label = expectIdentifier('after "goto"');
      consumeOptionalSemicolon();
      return { type: 'goto', label: label.value };
    }

    if (token.type === 'keyword' && token.value === 'return') {
      advance();
      expectPunct('(');
      expectPunct(')');
      consumeOptionalSemicolon();
      return { type: 'return' };
    }

    if (token.type === 'keyword' && token.value === 'if') {
      return parseIf();
    }

    if (token.type === 'operator' && (token.value === '+' || token.value === '-')) {
      return parseIncDec();
    }

    if (token.type === 'identifier') {
      return parseCallOrAssign();
    }

    throw new ParseError(`unexpected token ${describe(token)}`);
  }

  function parseStatementsUntil(stop: () => boolean): Statement[] {
    const statements: Statement[] = [];
    while (!atEnd() && !stop()) {
      // A bare "{" with no preceding "if"/"else" is a stray extra brace with
      // no matching extra "}" (RM56.CG doubles its if-block's opening brace
      // but only closes once; RM67.CG has one right after a call statement:
      // "set(beenIn67){", again closed only once). Skip it as noise rather
      // than treating it as a nested block, which would consume the "}"
      // meant for the enclosing block and leave it unterminated.
      if (isPunct('{')) {
        advance();
        continue;
      }

      // A bare ")" with no preceding unclosed "(" is a stray trailing
      // typo - the same one repeated three times verbatim: RM36.CG's
      // "script.timer = msg.delay);", RM48.CG's and RM49.CG's "work = 5);".
      // Skip it as noise, same reasoning as the stray "{" above. Once it's
      // skipped, the ";" that trailed it (now orphaned, with no statement
      // left to terminate) is harmless and also just skipped.
      if (isPunct(')') || isPunct(';')) {
        advance();
        continue;
      }
      statements.push(parseStatement());
    }
    return statements;
  }

  const statements = parseStatementsUntil(() => false);
  if (!atEnd()) {
    throw new ParseError(`unexpected trailing token ${describe(peek())}`);
  }
  return { statements };
}
