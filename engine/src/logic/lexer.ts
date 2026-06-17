export class LexError extends Error {}

export type TokenType = 'identifier' | 'number' | 'string' | 'keyword' | 'operator' | 'punctuation';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

const KEYWORDS = new Set(['if', 'else', 'goto', 'return']);

// ":" isn't in the operator/punctuation list from the spec, but real CG
// source (e.g. RM0.CG's ":no.input", ":exit") uses a leading colon to mark
// goto targets, so the lexer needs to emit it as its own token.
const PUNCTUATION = new Set(['(', ')', '{', '}', ',', ';', ':']);

const TWO_CHAR_OPERATORS = new Set(['==', '!=', '&&', '||']);
// "@" isn't a real AGI operator - it's a typo for "=" that shows up twice in
// the source (RM99.CG's "debug.1 =@ debug.0", RM100.CG's "work @= 0"), but
// the lexer just needs to tokenize it; the parser decides what "@=" / "=@"
// mean. "/" is deliberately not an operator here: the language has no
// division syntax, and VIEWS.H's "v.ego.sleeping.l/r" view name relies on
// "/" being part of an identifier rather than splitting it in two.
const ONE_CHAR_OPERATORS = new Set(['<', '>', '!', '=', '+', '-', '*', '@']);

// AGI identifiers are dot-namespaced (current.status, lgc.error), and a few
// use "'" (PO'd.wiz.init'd) or "$" (dirty$word) as word-grouping markers, a
// trailing "?" (RM2.CG's ":where.are.we?" label, never actually goto'd), or
// "/" (VIEWS.H's "v.ego.sleeping.l/r").
const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_CHAR = /[A-Za-z0-9_.'$?/]/;
const DIGIT = /[0-9]/;

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let column = 1;

  function advance(count = 1): void {
    for (let n = 0; n < count; n++) {
      if (source[i] === '\n') {
        line++;
        column = 1;
      } else {
        column++;
      }
      i++;
    }
  }

  while (i < source.length) {
    const ch = source[i];

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      advance();
      continue;
    }

    // The preprocessor already strips "[" comments, but skip any that
    // survive when lexing a snippet directly (e.g. in tests).
    if (ch === '[') {
      while (i < source.length && source[i] !== '\n') {
        advance();
      }
      continue;
    }

    const startLine = line;
    const startColumn = column;

    if (ch === '"') {
      let value = '';
      advance();
      for (;;) {
        if (i >= source.length || source[i] === '\n') {
          throw new LexError(`unterminated string literal at line ${startLine}, column ${startColumn}`);
        }
        if (source[i] === '\\' && source[i + 1] === '"') {
          value += '"';
          advance(2);
          continue;
        }
        if (source[i] === '"') {
          advance();
          break;
        }
        value += source[i];
        advance();
      }
      tokens.push({ type: 'string', value, line: startLine, column: startColumn });
      continue;
    }

    if (DIGIT.test(ch)) {
      let value = '';
      while (i < source.length && DIGIT.test(source[i])) {
        value += source[i];
        advance();
      }
      tokens.push({ type: 'number', value, line: startLine, column: startColumn });
      continue;
    }

    if (IDENTIFIER_START.test(ch)) {
      let value = '';
      while (i < source.length && IDENTIFIER_CHAR.test(source[i])) {
        value += source[i];
        advance();
      }
      tokens.push({
        type: KEYWORDS.has(value) ? 'keyword' : 'identifier',
        value,
        line: startLine,
        column: startColumn,
      });
      continue;
    }

    const two = source.slice(i, i + 2);
    if (TWO_CHAR_OPERATORS.has(two)) {
      tokens.push({ type: 'operator', value: two, line: startLine, column: startColumn });
      advance(2);
      continue;
    }

    if (ONE_CHAR_OPERATORS.has(ch)) {
      tokens.push({ type: 'operator', value: ch, line: startLine, column: startColumn });
      advance();
      continue;
    }

    if (PUNCTUATION.has(ch)) {
      tokens.push({ type: 'punctuation', value: ch, line: startLine, column: startColumn });
      advance();
      continue;
    }

    throw new LexError(`unexpected character "${ch}" at line ${startLine}, column ${startColumn}`);
  }

  return tokens;
}
