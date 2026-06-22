import { readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileAllLogic, type CompileResult } from '../../tools/compile-logic';
import { preprocessFile } from '../../src/logic/preprocess';
import { repoPath } from '../helpers/assets';

const SRC = repoPath('SRC');

function expectedRoomNumbers(): number[] {
  return readdirSync(SRC)
    .map((file) => /^RM(\d+)\.CG$/i.exec(file))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => parseInt(match[1], 10))
    .sort((a, b) => a - b);
}

describe('compile-logic: bundles every SRC/RM*.CG', () => {
  let result: CompileResult;

  beforeAll(() => {
    result = compileAllLogic(SRC);
  });

  it('compiles all 124 .CG files without error', () => {
    const failureSummary = result.report.failures.map((f) => `${f.file}: ${f.error}`).join('\n');
    expect(result.report.failures, failureSummary).toEqual([]);
    expect(result.report.totalFiles).toBe(124);
    expect(result.report.succeeded).toBe(124);
  });

  it('contains exactly the expected set of room logics', () => {
    const actual = result.bundle.rooms.map((r) => r.room).sort((a, b) => a - b);
    expect(actual).toEqual(expectedRoomNumbers());
  });

  it('attaches known room names from RM-NAMES.H', () => {
    const byRoom = new Map(result.bundle.rooms.map((r) => [r.room, r]));
    expect(byRoom.get(1)?.name).toBe('rm.tower');
    expect(byRoom.get(3)?.name).toBe('rm.hallway');
  });

  it('builds non-empty global symbol tables for flags, vars, views, objects and room names', () => {
    const { symbols } = result;
    expect(Object.keys(symbols.flags).length).toBeGreaterThan(0);
    expect(Object.keys(symbols.vars).length).toBeGreaterThan(0);
    expect(Object.keys(symbols.views).length).toBeGreaterThan(0);
    expect(Object.keys(symbols.objects).length).toBeGreaterThan(0);
    expect(symbols.roomNames['rm.tower']).toBe(1);
  });

  it('carries non-rm.* %define constants into the global defines table', () => {
    const { symbols } = result;
    // machine.type/monitor.type values, from SYSDEFS, reached through GAMEDEFS.AL -> GAMEDEFS.H -> SYSDEFS.
    expect(symbols.defines.PC).toBe(0);
    expect(symbols.defines.TANDY).toBe(2);
    expect(symbols.defines.AMIGA).toBe(5);
    expect(symbols.defines.ST).toBe(4);
    expect(symbols.vars['monitor.type']).toBe(26);

    // beenIn49 is a %define alias for the beenIn11 flag (GAMEDEFS.H), so it
    // must resolve through to that flag's value rather than being dropped.
    expect(symbols.defines.beenIn49).toBe(symbols.flags.beenIn11);

    // rm.* defines still go to roomNames, not defines.
    expect(symbols.defines['rm.tower']).toBeUndefined();
    expect(symbols.roomNames['rm.tower']).toBe(1);
  });

  it('resolves the residual per-room #define-alias family (B2) to their owning GAMEDEFS.H register', () => {
    // Each of these is a room-local "%define name lvN/lfN" alias (not a
    // shared-header symbol), so it's correctly absent from the global
    // tables and instead lives in that room's own localSymbols, with its
    // value already resolved through to the lvN/lfN register GAMEDEFS.H
    // declares - confirmed here by grepping SRC/ for each definition site.
    // (Macro substitution then inlines the alias to that register name in
    // the room's preprocessed source, so the interpreter never needs to
    // resolve the alias name itself at runtime - it resolves "lv0"/"lf2"
    // etc. through the global vars/flags tables instead.)
    const byRoom = new Map(result.bundle.rooms.map((r) => [r.room, r]));
    const cases: { room: number; name: string; register: string; kind: 'flag' | 'var' }[] = [
      { room: 42, name: 'snore.timer', register: 'lv10', kind: 'var' },
      { room: 57, name: 'first.pass', register: 'lf16', kind: 'flag' },
      { room: 83, name: 'egoLoc', register: 'lv0', kind: 'var' },
      { room: 83, name: 'can.chase', register: 'lf6', kind: 'flag' },
      { room: 87, name: 'leave.room', register: 'lf2', kind: 'flag' },
    ];

    for (const { room, name, register, kind } of cases) {
      const local = byRoom.get(room)?.localSymbols[name];
      const globalTable = kind === 'flag' ? result.symbols.flags : result.symbols.vars;
      expect(local, `room ${room}'s localSymbols.${name}`).toEqual({ kind: 'define', value: globalTable[register] });
    }

    // flyLine (RM112.CG) aliases straight to a numeric literal, not a register.
    expect(byRoom.get(112)?.localSymbols['flyLine']).toEqual({ kind: 'define', value: 35 });
  });

  it.each([1, 25, 89])(
    "room %i's bundled message count matches its standalone .MSG file",
    (room) => {
      const msgFile = `RM${room}.MSG`;
      const standalone = preprocessFile(`${SRC}/${msgFile}`, SRC);
      const bundled = result.messages[room];
      expect(Object.keys(bundled).length).toBe(Object.keys(standalone.messages).length);
      expect(bundled).toEqual(standalone.messages);
    }
  );
});
