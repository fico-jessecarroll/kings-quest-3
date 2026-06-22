import { describe, expect, it } from 'vitest';
import { createEngine } from '../../src/game/engine';
import type { GameResources } from '../../src/game/resources';
import { readWordsTok } from '../helpers/assets';
import type { AssignStatement, Statement } from '../../src/logic/ir';

function assign(target: string, value: number): AssignStatement {
  return { type: 'assign', target, op: '=', value: { kind: 'number', value } };
}

const BOOT_MARKER_VAR = 201;
const ROOM_MARKER_VAR = 200;

const LOGIC0_STATEMENTS: Statement[] = [assign('boot.marker', 7)];
const ROOM5_STATEMENTS: Statement[] = [assign('room.marker', 99)];

function buildResources(overrides: Partial<GameResources> = {}): GameResources {
  return {
    bundle: {
      rooms: [
        { room: 0, file: 'RM0.CG', statements: LOGIC0_STATEMENTS, localSymbols: {} },
        {
          room: 5,
          file: 'RM5.CG',
          statements: ROOM5_STATEMENTS,
          localSymbols: { 'room.marker': { kind: 'var', value: ROOM_MARKER_VAR } },
        },
      ],
    },
    symbols: {
      flags: {},
      vars: { 'boot.marker': BOOT_MARKER_VAR },
      views: {},
      objects: {},
      roomNames: {},
      defines: {},
    },
    messages: {
      '0': { '1': 'hello from logic 0' },
      '5': { '2': 'hello from room 5' },
    },
    objectBytes: new Uint8Array(),
    wordsBytes: readWordsTok(),
    pictures: new Map(),
    ...overrides,
  };
}

describe('createEngine', () => {
  it('runs logic 0 every cycle', () => {
    const engine = createEngine(buildResources());

    engine.interpreter.runCycle();

    expect(engine.state.getVar(BOOT_MARKER_VAR)).toBe(7);
  });

  it("loads a known room's logic on demand via the logicLoader, merging its localSymbols", () => {
    const engine = createEngine(buildResources());

    engine.state.setCurrentRoom(5);
    engine.interpreter.runCycle();

    expect(engine.state.getVar(ROOM_MARKER_VAR)).toBe(99);
  });

  it('also supports explicitly preloading a logic via Interpreter.loadLogic()', () => {
    const engine = createEngine(buildResources());

    engine.interpreter.loadLogic(6, { statements: [assign('boot.marker', 55)] });
    engine.state.setCurrentRoom(6);
    engine.interpreter.runCycle();

    expect(engine.state.getVar(BOOT_MARKER_VAR)).toBe(55);
  });

  it('resolves a per-room message, falling back to logic 0 when the current room has none of its own', () => {
    const engine = createEngine(buildResources());

    engine.state.setCurrentRoom(5);
    expect(engine.resolveMessage(2)).toBe('hello from room 5');

    engine.state.setCurrentRoom(42);
    expect(engine.resolveMessage(1)).toBe('hello from logic 0');

    expect(engine.resolveMessage(999)).toBeUndefined();
  });

  it('wires object commands to the shared ObjectTable', () => {
    const engine = createEngine(
      buildResources({
        bundle: {
          rooms: [
            { room: 0, file: 'RM0.CG', statements: LOGIC0_STATEMENTS, localSymbols: {} },
            {
              room: 7,
              file: 'RM7.CG',
              statements: [{ type: 'call', name: 'animate.obj', args: [{ kind: 'number', value: 3 }] }],
              localSymbols: {},
            },
          ],
        },
      }),
    );

    engine.state.setCurrentRoom(7);
    engine.interpreter.runCycle();

    expect(engine.objectTable.getAnimatedObjectNumbers()).toContain(3);
  });

  it("wires the input parser's said() test", () => {
    const engine = createEngine(
      buildResources({
        bundle: {
          rooms: [
            { room: 0, file: 'RM0.CG', statements: LOGIC0_STATEMENTS, localSymbols: {} },
            {
              room: 8,
              file: 'RM8.CG',
              statements: [
                {
                  type: 'if',
                  test: { type: 'call', name: 'said', args: [{ kind: 'string', value: 'look' }] },
                  then: [assign('boot.marker', 1)],
                  else: [assign('boot.marker', 2)],
                },
              ],
              localSymbols: {},
            },
          ],
        },
      }),
    );

    engine.parser.acceptInput(engine.state, 'look');
    engine.state.setCurrentRoom(8);
    engine.interpreter.runCycle();

    expect(engine.state.getVar(BOOT_MARKER_VAR)).toBe(1);
  });

  it('throws a descriptive error when logic 0 is missing from the bundle', () => {
    expect(() => createEngine(buildResources({ bundle: { rooms: [] } }))).toThrow(/logic 0/);
  });
});
