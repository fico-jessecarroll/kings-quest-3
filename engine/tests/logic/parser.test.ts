import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { parseLogic, ParseError } from '../../src/logic/parser';
import { preprocessFile } from '../../src/logic/preprocess';
import { repoPath } from '../helpers/assets';
import type { CallNode, IfStatement } from '../../src/logic/ir';

const SRC = repoPath('SRC');

describe('parseLogic: synthetic statements', () => {
  it('parses a command call with mixed argument types', () => {
    const logic = parseLogic('print( 87);');
    expect(logic.statements).toEqual([
      { type: 'call', name: 'print', args: [{ kind: 'number', value: 87 }] },
    ]);
  });

  it('parses a call with a string argument', () => {
    const logic = parseLogic('set.string( 1, "hello world");');
    expect(logic.statements).toEqual([
      {
        type: 'call',
        name: 'set.string',
        args: [
          { kind: 'number', value: 1 },
          { kind: 'string', value: 'hello world' },
        ],
      },
    ]);
  });

  it('parses an assignment to an identifier value', () => {
    const logic = parseLogic('current.status = normal.ego;');
    expect(logic.statements).toEqual([
      { type: 'assign', target: 'current.status', op: '=', value: { kind: 'symbol', name: 'normal.ego' } },
    ]);
  });

  it('parses an assignment to a number value', () => {
    const logic = parseLogic('gameSeconds = 0;');
    expect(logic.statements).toEqual([
      { type: 'assign', target: 'gameSeconds', op: '=', value: { kind: 'number', value: 0 } },
    ]);
  });

  it('parses compound +=/-= assignments', () => {
    const logic = parseLogic('work += animation.interval;\nx -= 4;');
    expect(logic.statements).toEqual([
      { type: 'assign', target: 'work', op: '+=', value: { kind: 'symbol', name: 'animation.interval' } },
      { type: 'assign', target: 'x', op: '-=', value: { kind: 'number', value: 4 } },
    ]);
  });

  it('parses prefix increment/decrement', () => {
    const logic = parseLogic('++wiz.temper;\n--ego.timer;');
    expect(logic.statements).toEqual([
      { type: 'incdec', target: 'wiz.temper', op: '++' },
      { type: 'incdec', target: 'ego.timer', op: '--' },
    ]);
  });

  it('parses goto and a label declaration (no trailing semicolon on a label)', () => {
    const logic = parseLogic('goto no.input;\n:no.input\nprint( 1);');
    expect(logic.statements).toEqual([
      { type: 'goto', label: 'no.input' },
      { type: 'label', name: 'no.input' },
      { type: 'call', name: 'print', args: [{ kind: 'number', value: 1 }] },
    ]);
  });

  it('parses a bare return statement', () => {
    const logic = parseLogic('return();');
    expect(logic.statements).toEqual([{ type: 'return' }]);
  });

  it('parses a said() test with word arguments preserved as symbols', () => {
    const logic = parseLogic('if (said( look, telescope))\n\t{\n\tprint( 3);\n\t}');
    const ifStmt = logic.statements[0] as IfStatement;
    expect(ifStmt.type).toBe('if');
    expect(ifStmt.test).toEqual({
      type: 'call',
      name: 'said',
      args: [
        { kind: 'symbol', name: 'look' },
        { kind: 'symbol', name: 'telescope' },
      ],
    });
    expect(ifStmt.then).toEqual([{ type: 'call', name: 'print', args: [{ kind: 'number', value: 3 }] }]);
    expect(ifStmt.else).toBeUndefined();
  });

  it('parses a bare flag test and its negation', () => {
    const logic = parseLogic('if (error.number) {call( lgc.error);}\nif (!current.room) {new.room( 45);}');
    const [first, second] = logic.statements as IfStatement[];
    expect(first.test).toEqual({ type: 'flagTest', name: 'error.number' });
    expect(second.test).toEqual({ type: 'not', expr: { type: 'flagTest', name: 'current.room' } });
  });

  it('parses a comparison test against an identifier and against a number', () => {
    const logic = parseLogic(
      'if (current.status == deferred.entry) {return();}\nif (wait.1 == 1) {return();}'
    );
    const [first, second] = logic.statements as IfStatement[];
    expect(first.test).toEqual({
      type: 'comparison',
      op: '==',
      left: { kind: 'symbol', name: 'current.status' },
      right: { kind: 'symbol', name: 'deferred.entry' },
    });
    expect(second.test).toEqual({
      type: 'comparison',
      op: '==',
      left: { kind: 'symbol', name: 'wait.1' },
      right: { kind: 'number', value: 1 },
    });
  });

  it('parses && / || boolean combinations with correct precedence (&& binds tighter than ||)', () => {
    const logic = parseLogic('if (a && b || c) {return();}');
    const ifStmt = logic.statements[0] as IfStatement;
    expect(ifStmt.test).toEqual({
      type: 'or',
      left: {
        type: 'and',
        left: { type: 'flagTest', name: 'a' },
        right: { type: 'flagTest', name: 'b' },
      },
      right: { type: 'flagTest', name: 'c' },
    });
  });

  it('parses a parenthesized boolean group nested inside &&', () => {
    const logic = parseLogic('if (clock.on && (update.clock || init.log)) {return();}');
    const ifStmt = logic.statements[0] as IfStatement;
    expect(ifStmt.test).toEqual({
      type: 'and',
      left: { type: 'flagTest', name: 'clock.on' },
      right: {
        type: 'or',
        left: { type: 'flagTest', name: 'update.clock' },
        right: { type: 'flagTest', name: 'init.log' },
      },
    });
  });

  it('parses nested if/else with a print command in each branch', () => {
    const source =
      'if (gameDays)\n' +
      '\t{\n' +
      '\tprint( 87);\n' +
      '\t}\n' +
      'else\n' +
      '\t{\n' +
      '\tif (gameHours)\n' +
      '\t\t{\n' +
      '\t\tprint( 88);\n' +
      '\t\t}\n' +
      '\telse\n' +
      '\t\t{\n' +
      '\t\tprint( 89);\n' +
      '\t\t}\n' +
      '\t}';
    const logic = parseLogic(source);
    const outer = logic.statements[0] as IfStatement;
    expect(outer.type).toBe('if');
    expect(outer.test).toEqual({ type: 'flagTest', name: 'gameDays' });
    expect(outer.then).toEqual([{ type: 'call', name: 'print', args: [{ kind: 'number', value: 87 }] }]);
    expect(outer.else).toHaveLength(1);

    const inner = outer.else![0] as IfStatement;
    expect(inner.type).toBe('if');
    expect(inner.test).toEqual({ type: 'flagTest', name: 'gameHours' });
    expect(inner.then).toEqual([{ type: 'call', name: 'print', args: [{ kind: 'number', value: 88 }] }]);
    expect(inner.else).toEqual([{ type: 'call', name: 'print', args: [{ kind: 'number', value: 89 }] }]);
  });

  it('parses a one-line braced statement after an if (no internal newlines)', () => {
    const logic = parseLogic('if (controller( c.menu))				{menu.input( );}');
    const ifStmt = logic.statements[0] as IfStatement;
    expect(ifStmt.test).toEqual({ type: 'call', name: 'controller', args: [{ kind: 'symbol', name: 'c.menu' }] });
    expect(ifStmt.then).toEqual([{ type: 'call', name: 'menu.input', args: [] }]);
  });

  it('tolerates a missing trailing semicolon on a call statement', () => {
    const logic = parseLogic('set.menu.item( 125, c.save)\nset.menu.item( 126, c.restore);');
    expect(logic.statements).toEqual([
      {
        type: 'call',
        name: 'set.menu.item',
        args: [
          { kind: 'number', value: 125 },
          { kind: 'symbol', name: 'c.save' },
        ],
      },
      {
        type: 'call',
        name: 'set.menu.item',
        args: [
          { kind: 'number', value: 126 },
          { kind: 'symbol', name: 'c.restore' },
        ],
      },
    ]);
  });
});

describe('parseLogic: negative cases', () => {
  it('throws ParseError on a missing closing brace', () => {
    expect(() => parseLogic('if (foo) {\n\tbar();\n')).toThrow(ParseError);
  });

  it('throws ParseError on an unmatched closing brace', () => {
    expect(() => parseLogic('foo();\n}\n')).toThrow(ParseError);
  });

  it('throws ParseError on an unmatched opening paren in a test', () => {
    expect(() => parseLogic('if (said( look, telescope) {print( 1);}')).toThrow(ParseError);
  });
});

describe('parseLogic: real logic files (preprocessed)', () => {
  it('parses RM0.CG end-to-end and finds the expected structures', () => {
    const { source } = preprocessFile(join(SRC, 'RM0.CG'));
    const logic = parseLogic(source);
    expect(logic.statements.length).toBeGreaterThan(10);

    function* walk(statements: typeof logic.statements): Generator<typeof logic.statements[number]> {
      for (const stmt of statements) {
        yield stmt;
        if (stmt.type === 'if') {
          yield* walk(stmt.then);
          if (stmt.else) yield* walk(stmt.else);
        }
      }
    }

    const all = [...walk(logic.statements)];

    // A nested if/else: the "c.about" handler prints different messages
    // depending on gameDays/gameHours, with an else-branch containing
    // another if/else.
    const nestedIfElse = all.find(
      (s): s is IfStatement =>
        s.type === 'if' && s.test.type === 'flagTest' && s.test.name === 'gameDays' && !!s.else
    );
    expect(nestedIfElse).toBeDefined();
    expect(nestedIfElse!.else!.some((s) => s.type === 'if')).toBe(true);

    // A said() test with word arguments preserved as symbols.
    const saidTest = all.find(
      (s): s is IfStatement => s.type === 'if' && s.test.type === 'call' && s.test.name === 'said'
    );
    expect(saidTest).toBeDefined();
    const saidCall = saidTest!.test as CallNode;
    expect(saidCall.args[0]).toEqual({ kind: 'symbol', name: expect.any(String) });
    expect(typeof (saidCall.args[0] as { kind: 'symbol'; name: string }).name).toBe('string');

    // A print command.
    const printCall = all.find((s): s is CallNode => s.type === 'call' && s.name === 'print');
    expect(printCall).toBeDefined();

    // An assignment.
    const assign = all.find((s) => s.type === 'assign');
    expect(assign).toBeDefined();

    // Labels referenced by goto are present as label statements.
    expect(all.some((s) => s.type === 'label' && s.name === 'no.input')).toBe(true);
    expect(all.some((s) => s.type === 'goto' && s.label === 'no.input')).toBe(true);
  });

  it('parses RM1.CG end-to-end and finds the expected structures', () => {
    const { source } = preprocessFile(join(SRC, 'RM1.CG'));
    const logic = parseLogic(source);
    expect(logic.statements.length).toBeGreaterThan(5);

    function* walk(statements: typeof logic.statements): Generator<typeof logic.statements[number]> {
      for (const stmt of statements) {
        yield stmt;
        if (stmt.type === 'if') {
          yield* walk(stmt.then);
          if (stmt.else) yield* walk(stmt.else);
        }
      }
    }

    const all = [...walk(logic.statements)];

    // said( look, telescope) with word args preserved as symbols.
    const lookTelescope = all.find(
      (s): s is IfStatement =>
        s.type === 'if' &&
        s.test.type === 'call' &&
        s.test.name === 'said' &&
        s.test.args.length === 2 &&
        s.test.args[0].kind === 'symbol' &&
        (s.test.args[0] as { kind: 'symbol'; name: string }).name === 'look' &&
        s.test.args[1].kind === 'symbol' &&
        (s.test.args[1] as { kind: 'symbol'; name: string }).name === 'telescope'
    );
    expect(lookTelescope).toBeDefined();
    expect(lookTelescope!.then.some((s) => s.type === 'if')).toBe(true);

    // A print command somewhere in the file.
    expect(all.some((s) => s.type === 'call' && s.name === 'print')).toBe(true);

    // An assignment somewhere in the file (e.g. map.area = map.wiz.house;).
    expect(all.some((s) => s.type === 'assign')).toBe(true);

    // Labels declared with ":" are present.
    expect(all.some((s) => s.type === 'label' && s.name === 'no.input')).toBe(true);
    expect(all.some((s) => s.type === 'label' && s.name === 'exit')).toBe(true);
  });
});

describe('parseLogic: legacy source quirks', () => {
  it('tolerates a label trailed by a stray ";" (RM85.CG, RM105.CG)', () => {
    const logic = parseLogic(':pick.a.chore;\nprint(1);');
    expect(logic.statements).toEqual([
      { type: 'label', name: 'pick.a.chore' },
      { type: 'call', name: 'print', args: [{ kind: 'number', value: 1 }] },
    ]);
  });

  it('parses "@=" and "=@" as AGI\'s indirect-addressing assignments (RM99.CG, RM100.CG)', () => {
    // "work @= 0" (RM100.CG): lindirectn - vars[work] = 0.
    expect(parseLogic('work @= 0;').statements).toEqual([
      { type: 'assign', target: 'work', op: '@=', value: { kind: 'number', value: 0 } },
    ]);
    // "debug.1 =@ debug.0" (RM99.CG "show var"): rindirect - debug.1 = vars[debug.0].
    expect(parseLogic('debug.1 =@ debug.0;').statements).toEqual([
      { type: 'assign', target: 'debug.1', op: '=@', value: { kind: 'symbol', name: 'debug.0' } },
    ]);
    // "debug.0 @= debug.1" (RM99.CG "set var"): lindirectv - vars[debug.0] = debug.1.
    expect(parseLogic('debug.0 @= debug.1;').statements).toEqual([
      { type: 'assign', target: 'debug.0', op: '@=', value: { kind: 'symbol', name: 'debug.1' } },
    ]);
  });

  it('skips a stray extra "{" with no matching extra "}" (RM56.CG, RM67.CG)', () => {
    const logic = parseLogic('if (flag){\n\t{\n\tprint(1);\n\t}\nprint(2);');
    expect(logic.statements).toEqual([
      {
        type: 'if',
        test: { type: 'flagTest', name: 'flag' },
        then: [{ type: 'call', name: 'print', args: [{ kind: 'number', value: 1 }] }],
      },
      { type: 'call', name: 'print', args: [{ kind: 'number', value: 2 }] },
    ]);
  });

  it('skips a stray trailing ")" and its now-orphaned ";" (RM36.CG, RM48.CG, RM49.CG)', () => {
    const logic = parseLogic('work = 5);\nprint(1);');
    expect(logic.statements).toEqual([
      { type: 'assign', target: 'work', op: '=', value: { kind: 'number', value: 5 } },
      { type: 'call', name: 'print', args: [{ kind: 'number', value: 1 }] },
    ]);
  });
});
