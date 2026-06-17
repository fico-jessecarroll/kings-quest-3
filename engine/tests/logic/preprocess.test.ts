import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preprocessFile, preprocessSource, PreprocessError } from '../../src/logic/preprocess';
import { repoPath } from '../helpers/assets';

const SRC = repoPath('SRC');

describe('preprocess: real headers', () => {
  it('resolves %define/%flag/%var/%view/%object symbols from RM-NAMES.H', () => {
    const result = preprocessFile(join(SRC, 'RM-NAMES.H'));
    expect(result.symbols['rm.tower']).toEqual({ kind: 'define', value: 1 });
    expect(result.symbols['rm.hallway']).toEqual({ kind: 'define', value: 3 });
    // rm.restart is defined in terms of rm.entry and should resolve transitively.
    expect(result.symbols['rm.restart']).toEqual({ kind: 'define', value: 7 });
  });

  it('resolves flags and vars declared in GAMEDEFS.H, including its nested sysdefs/sysdefs.al includes', () => {
    const result = preprocessFile(join(SRC, 'GAMEDEFS.H'));
    expect(result.symbols['force.a.test']).toEqual({ kind: 'flag', value: 30 });
    expect(result.symbols['lf0']).toEqual({ kind: 'flag', value: 220 });
    expect(result.symbols['wiz.y']).toEqual({ kind: 'var', value: 31 });
    // beenIn49 is itself a %define pointing at the beenIn11 flag.
    expect(result.symbols['beenIn49']).toEqual({ kind: 'define', value: 54 });
  });

  it('resolves view declarations from VIEWS.H', () => {
    const result = preprocessFile(join(SRC, 'VIEWS.H'));
    expect(result.symbols['v.ego']).toEqual({ kind: 'view', value: 0 });
    expect(result.symbols['v.fly']).toEqual({ kind: 'view', value: 207 });
  });

  it('resolves DEFINES.AL object/var declarations and nested local defines', () => {
    const result = preprocessFile(join(SRC, 'DEFINES.AL'));
    expect(result.symbols['a.cat']).toEqual({ kind: 'object', value: 13 });
    expect(result.symbols['snail.step.time']).toEqual({ kind: 'define', value: 12 });
    // poof.out is a %define nested under the %var start.a.poof declaration.
    expect(result.symbols['poof.out']).toEqual({ kind: 'define', value: 1 });
  });
});

describe('preprocess: a real room (RM1.CG / RM1.MSG)', () => {
  it('builds a per-room message table matching RM1.MSG text', () => {
    const result = preprocessFile(join(SRC, 'RM1.CG'));

    expect(result.messages[1]).toBe(
      "You have entered the musty tower of the old wizard's" +
        ' house. A polished brass telescope is directed out a window. From' +
        ' here, Manannan spies upon the poor occupants of Llewdor.'
    );
    expect(result.messages[2]).toBe('You see nothing on the dusty floor but a dead fly.');
    // Message 7 contains escaped quotes that should be unescaped.
    expect(result.messages[7]).toBe(
      'You pick up the dead fly and drop it into' +
        ' your hand. Disgustedly, you look at it. "I' +
        ' don\'t want to carry around a dead fly," you think. Picking off' +
        ' its wings, you throw the rest away.'
    );
    // Empty messages are legal.
    expect(result.messages[11]).toBe('');
  });

  it('resolves rm.tower via the transitively included RM-NAMES.H', () => {
    const result = preprocessFile(join(SRC, 'RM1.CG'));
    expect(result.symbols['rm.tower']).toEqual({ kind: 'define', value: 1 });
  });

  it('produces a flat source with comments, includes and declarations stripped', () => {
    const result = preprocessFile(join(SRC, 'RM1.CG'));
    expect(result.source).toContain('if (init.log)');
    expect(result.source).not.toContain('%include');
    expect(result.source).not.toContain('%define');
    expect(result.source).not.toMatch(/\[.*comments/);
  });

  it('substitutes %define macros (e.g. wiz.at.scope -> lf0) in the flat source', () => {
    const result = preprocessFile(join(SRC, 'RM1.CG'));
    // The standalone macro "wiz.at.scope" is gone, but the unrelated view name
    // "v.wiz.at.scope" (a distinct, longer identifier) must be left untouched.
    expect(result.source).not.toMatch(/(?<![\w.'$])wiz\.at\.scope(?![\w.'$])/);
    expect(result.source).toContain('v.wiz.at.scope');
    expect(result.source).toContain('lf0');
  });
});

describe('preprocess: comments and macros on synthetic source', () => {
  it('strips whole-line and trailing "[" comments', () => {
    const result = preprocessSource(
      '[ this whole line is a comment\n' + 'foo = 1; [ trailing comment\n',
      SRC
    );
    expect(result.source.trim()).toBe('foo = 1;');
  });

  it('expands %define macros textually, including chains', () => {
    const result = preprocessSource(
      '%define a b\n' + '%define b 5\n' + 'x = a;\n',
      SRC
    );
    expect(result.symbols['a']).toEqual({ kind: 'define', value: 5 });
    expect(result.source.trim()).toBe('x = 5;');
  });

  it('keeps %flag/%var/%view/%object declarations out of the flat source but in the symbol table', () => {
    const result = preprocessSource(
      '%flag near.mud 90\n' + '%var work 36\n' + '%view v.ego 0\n' + '%object a.cat 13\n' + 'set( near.mud);\n',
      SRC
    );
    expect(result.source.trim()).toBe('set( near.mud);');
    expect(result.symbols['near.mud']).toEqual({ kind: 'flag', value: 90 });
    expect(result.symbols['work']).toEqual({ kind: 'var', value: 36 });
    expect(result.symbols['v.ego']).toEqual({ kind: 'view', value: 0 });
    expect(result.symbols['a.cat']).toEqual({ kind: 'object', value: 13 });
  });

  it('parses multi-line %message strings with escaped quotes', () => {
    const result = preprocessSource(
      '%message 1\n' + '"line one\n' + ' line two, \\"quoted\\"."\n',
      SRC
    );
    expect(result.messages[1]).toBe('line one line two, "quoted".');
  });

  it('discards a disabled "#message" and its multi-line quoted body (RM25.MSG-style)', () => {
    const result = preprocessSource(
      '%message 1 "kept"\n' +
        '#message 2\n' +
        '"this whole multi-line string\n' +
        ' must not leak into the code stream"\n' +
        'set( near.mud);\n',
      SRC
    );
    expect(result.messages).toEqual({ 1: 'kept' });
    expect(result.source.trim()).toBe('set( near.mud);');
  });

  it('discards a disabled "#message" whose quoted body is on the same line (RM96.CG-style)', () => {
    const result = preprocessSource('#message 1 "increment"\n' + 'set( near.mud);\n', SRC);
    expect(result.messages).toEqual({});
    expect(result.source.trim()).toBe('set( near.mud);');
  });
});

describe('preprocess: negative cases', () => {
  it('throws when %include points at a file that does not exist in the include dir', () => {
    expect(() => preprocessSource('%include "does-not-exist.h"\n', SRC)).toThrow(PreprocessError);
  });

  it('throws on an unknown directive', () => {
    expect(() => preprocessSource('%bogus foo 1\n', SRC)).toThrow(PreprocessError);
  });

  it('resolves %include case-insensitively against the SRC directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-preprocess-'));
    writeFileSync(join(dir, 'CHILD.H'), '%define z 9\n');
    const result = preprocessSource('%include "child.h"\n', dir);
    expect(result.symbols['z']).toEqual({ kind: 'define', value: 9 });
  });
});
