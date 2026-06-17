import { describe, expect, it } from 'vitest';
import { tokenize, LexError, type Token } from '../../src/logic/lexer';

function simplify(tokens: Token[]): [string, string][] {
  return tokens.map((t) => [t.type, t.value]);
}

describe('tokenize: representative lines from RM0.CG / RM1.CG', () => {
  it('lexes an if/said condition (RM1.CG: "if (said( look, telescope))")', () => {
    expect(simplify(tokenize('if (said( look, telescope))'))).toEqual([
      ['keyword', 'if'],
      ['punctuation', '('],
      ['identifier', 'said'],
      ['punctuation', '('],
      ['identifier', 'look'],
      ['punctuation', ','],
      ['identifier', 'telescope'],
      ['punctuation', ')'],
      ['punctuation', ')'],
    ]);
  });

  it('lexes a print call with a number argument (RM0.CG: "print( 87);")', () => {
    expect(simplify(tokenize('print( 87);'))).toEqual([
      ['identifier', 'print'],
      ['punctuation', '('],
      ['number', '87'],
      ['punctuation', ')'],
      ['punctuation', ';'],
    ]);
  });

  it('lexes an assignment (RM0.CG: "current.status = normal.ego;")', () => {
    expect(simplify(tokenize('current.status = normal.ego;'))).toEqual([
      ['identifier', 'current.status'],
      ['operator', '='],
      ['identifier', 'normal.ego'],
      ['punctuation', ';'],
    ]);
  });

  it('lexes arithmetic (RM0.CG: "work += animation.interval;")', () => {
    // "+=" isn't a token of its own in this language's operator set, so it
    // lexes as the two operators "+" and "=".
    expect(simplify(tokenize('work += animation.interval;'))).toEqual([
      ['identifier', 'work'],
      ['operator', '+'],
      ['operator', '='],
      ['identifier', 'animation.interval'],
      ['punctuation', ';'],
    ]);
  });

  it('lexes prefix increment/decrement (RM1.CG: "++wiz.temper;", "--ego.timer;")', () => {
    expect(simplify(tokenize('++wiz.temper;'))).toEqual([
      ['operator', '+'],
      ['operator', '+'],
      ['identifier', 'wiz.temper'],
      ['punctuation', ';'],
    ]);
    expect(simplify(tokenize('--ego.timer;'))).toEqual([
      ['operator', '-'],
      ['operator', '-'],
      ['identifier', 'ego.timer'],
      ['punctuation', ';'],
    ]);
  });

  it('lexes a multi-clause boolean condition with comparisons (RM0.CG machine.type check)', () => {
    const source = 'if (machine.type == PC &&\n\tmonitor.type != mono &&\n\tmonitor.type != ega)';
    expect(simplify(tokenize(source))).toEqual([
      ['keyword', 'if'],
      ['punctuation', '('],
      ['identifier', 'machine.type'],
      ['operator', '=='],
      ['identifier', 'PC'],
      ['operator', '&&'],
      ['identifier', 'monitor.type'],
      ['operator', '!='],
      ['identifier', 'mono'],
      ['operator', '&&'],
      ['identifier', 'monitor.type'],
      ['operator', '!='],
      ['identifier', 'ega'],
      ['punctuation', ')'],
    ]);
  });

  it('lexes negation and apostrophe identifiers (RM1.CG: "if (wiz.on.screen && wiz.at.scope && !PO\'d.wiz.init\'d)")', () => {
    expect(simplify(tokenize("if (wiz.on.screen && wiz.at.scope && !PO'd.wiz.init'd)"))).toEqual([
      ['keyword', 'if'],
      ['punctuation', '('],
      ['identifier', 'wiz.on.screen'],
      ['operator', '&&'],
      ['identifier', 'wiz.at.scope'],
      ['operator', '&&'],
      ['operator', '!'],
      ['identifier', "PO'd.wiz.init'd"],
      ['punctuation', ')'],
    ]);
  });

  it('lexes dollar-sign word-group identifiers (RM0.CG: "said( dirty$word, rol)")', () => {
    expect(simplify(tokenize('said( dirty$word, rol)'))).toEqual([
      ['identifier', 'said'],
      ['punctuation', '('],
      ['identifier', 'dirty$word'],
      ['punctuation', ','],
      ['identifier', 'rol'],
      ['punctuation', ')'],
    ]);
  });

  it('lexes braced single-line statements (RM0.CG: "if (controller( c.menu)) {menu.input( );}")', () => {
    expect(simplify(tokenize('if (controller( c.menu)) {menu.input( );}'))).toEqual([
      ['keyword', 'if'],
      ['punctuation', '('],
      ['identifier', 'controller'],
      ['punctuation', '('],
      ['identifier', 'c.menu'],
      ['punctuation', ')'],
      ['punctuation', ')'],
      ['punctuation', '{'],
      ['identifier', 'menu.input'],
      ['punctuation', '('],
      ['punctuation', ')'],
      ['punctuation', ';'],
      ['punctuation', '}'],
    ]);
  });

  it('lexes goto and a label declaration (RM0.CG: "goto no.input;" / ":no.input")', () => {
    expect(simplify(tokenize('goto no.input;'))).toEqual([
      ['keyword', 'goto'],
      ['identifier', 'no.input'],
      ['punctuation', ';'],
    ]);
    expect(simplify(tokenize(':no.input'))).toEqual([
      ['punctuation', ':'],
      ['identifier', 'no.input'],
    ]);
  });

  it('lexes a bare return statement (RM0.CG: "return();")', () => {
    expect(simplify(tokenize('return();'))).toEqual([
      ['keyword', 'return'],
      ['punctuation', '('],
      ['punctuation', ')'],
      ['punctuation', ';'],
    ]);
  });

  it('lexes if/else (RM0.CG machine.type == ST branch)', () => {
    const source = 'if (machine.type == ST)\n\t{\n\tset.menu.item( 111, c.init.joy);\n\t}\nelse\n\t{\n\tset.menu.item( 136, c.init.joy);\n\t}';
    const types = tokenize(source).map((t) => t.type);
    expect(types).toContain('keyword');
    expect(tokenize(source).filter((t) => t.value === 'else')).toHaveLength(1);
    expect(tokenize(source).filter((t) => t.value === 'if')).toHaveLength(1);
  });
});

describe('tokenize: whitespace and stray comments', () => {
  it('strips leftover "[" comments and surrounding whitespace', () => {
    expect(simplify(tokenize('  work = 3;   [ trailing comment\n\tcycle.time( ego, work);\n'))).toEqual([
      ['identifier', 'work'],
      ['operator', '='],
      ['number', '3'],
      ['punctuation', ';'],
      ['identifier', 'cycle.time'],
      ['punctuation', '('],
      ['identifier', 'ego'],
      ['punctuation', ','],
      ['identifier', 'work'],
      ['punctuation', ')'],
      ['punctuation', ';'],
    ]);
  });

  it('tracks line and column numbers across newlines', () => {
    const tokens = tokenize('if (x)\n\tprint( 1);');
    expect(tokens[0]).toMatchObject({ type: 'keyword', value: 'if', line: 1, column: 1 });
    const printToken = tokens.find((t) => t.value === 'print');
    expect(printToken).toMatchObject({ line: 2, column: 2 });
  });
});

describe('tokenize: string literals', () => {
  it('lexes a simple double-quoted string', () => {
    expect(simplify(tokenize('set.string( 1, "hello world");'))).toEqual([
      ['identifier', 'set.string'],
      ['punctuation', '('],
      ['number', '1'],
      ['punctuation', ','],
      ['string', 'hello world'],
      ['punctuation', ')'],
      ['punctuation', ';'],
    ]);
  });

  it('unescapes \\" within a string literal', () => {
    expect(simplify(tokenize('set.string( 1, "she said \\"hi\\"");'))).toEqual([
      ['identifier', 'set.string'],
      ['punctuation', '('],
      ['number', '1'],
      ['punctuation', ','],
      ['string', 'she said "hi"'],
      ['punctuation', ')'],
      ['punctuation', ';'],
    ]);
  });
});

describe('tokenize: negative cases', () => {
  it('throws LexError on a string with no closing quote before end of input', () => {
    expect(() => tokenize('set.string( 1, "unterminated);')).toThrow(LexError);
  });

  it('throws LexError on a string with no closing quote before a newline', () => {
    expect(() => tokenize('set.string( 1, "unterminated\n);')).toThrow(LexError);
  });

  it('throws LexError on an unexpected character', () => {
    expect(() => tokenize('work = 3 # 4;')).toThrow(LexError);
  });
});
