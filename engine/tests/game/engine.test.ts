import { describe, expect, it, vi } from 'vitest';
import { createEngine } from '../../src/game/engine';
import type { GameResources } from '../../src/game/resources';
import { readWordsTok } from '../helpers/assets';
import type { AssignStatement, CallNode, Statement } from '../../src/logic/ir';
import { ReservedFlag, ReservedVar } from '../../src/vm/state';
import { DEFAULT_HORIZON } from '../../src/vm/objects';

function assign(target: string, value: number): AssignStatement {
  return { type: 'assign', target, op: '=', value: { kind: 'number', value } };
}

function call(name: string, ...args: number[]): CallNode {
  return { type: 'call', name, args: args.map((value) => ({ kind: 'number', value })) };
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

describe('new.room sequencing (A3)', () => {
  const OLD_ROOM = 12;
  const NEW_ROOM = 9;

  function buildTransitionResources(): GameResources {
    return buildResources({
      bundle: {
        rooms: [
          { room: 0, file: 'RM0.CG', statements: LOGIC0_STATEMENTS, localSymbols: {} },
          { room: OLD_ROOM, file: `RM${OLD_ROOM}.CG`, statements: [call('new.room', NEW_ROOM)], localSymbols: {} },
          {
            room: NEW_ROOM,
            file: `RM${NEW_ROOM}.CG`,
            statements: ROOM5_STATEMENTS,
            localSymbols: { 'room.marker': { kind: 'var', value: ROOM_MARKER_VAR } },
          },
        ],
      },
    });
  }

  it('runs the documented housekeeping synchronously and defers the new room\'s first cycle', () => {
    const stopSound = vi.fn();
    const engine = createEngine(buildTransitionResources(), { stopSound });

    // "before" state that new.room is documented to clear/reset:
    engine.objectTable.animate(3);
    engine.objectTable.setHorizon(80);
    engine.objectTable.setBlock(50, 50, 60, 60);
    engine.state.setPosition(0, 45, 55);
    engine.objectTable.setDirection(0, 3); // east, straight into the block
    engine.objectTable.setStepSize(0, 10);
    engine.state.setControllerActive(7, true);
    engine.state.setVar(ReservedVar.EgoBorderTouched, 4);
    engine.state.setVar(ReservedVar.ObjectBorderTouched, 1);
    engine.state.setVar(ReservedVar.ObjectBorderCode, 2);
    engine.state.setCurrentRoom(OLD_ROOM);

    engine.interpreter.runCycle();

    // vars set
    expect(engine.state.getCurrentRoom()).toBe(NEW_ROOM);
    expect(engine.state.getVar(ReservedVar.PreviousRoom)).toBe(OLD_ROOM);
    expect(engine.state.getVar(ReservedVar.EgoBorderTouched)).toBe(0);
    expect(engine.state.getVar(ReservedVar.ObjectBorderTouched)).toBe(0);
    expect(engine.state.getVar(ReservedVar.ObjectBorderCode)).toBe(0);

    // flag raised
    expect(engine.state.getFlag(ReservedFlag.InitLogs)).toBe(true);

    // sound cleared
    expect(stopSound).toHaveBeenCalledTimes(1);

    // animated objects cleared (ego survives, object 3 does not)
    expect(engine.objectTable.getAnimatedObjectNumbers()).toEqual([0]);

    // blocks/horizon reset: ego now moves freely through the old block rect
    expect(engine.objectTable.getHorizon()).toBe(DEFAULT_HORIZON);
    engine.objectTable.update();
    expect(engine.state.getPosition(0)).toEqual({ x: 55, y: 55 });

    // controllers reset
    expect(engine.state.isControllerActive(7)).toBe(false);

    // new room's logic hasn't run yet - that's deferred to the next cycle
    expect(engine.state.getVar(ROOM_MARKER_VAR)).toBe(0);

    engine.interpreter.runCycle();

    expect(engine.state.getVar(ROOM_MARKER_VAR)).toBe(99);
    expect(engine.state.getFlag(ReservedFlag.InitLogs)).toBe(false);
  });

  it('new.room.f resolves the target room from a var and runs the same sequence', () => {
    const ROOM_VAR = 210;
    const stopSound = vi.fn();
    const engine = createEngine(
      buildResources({
        bundle: {
          rooms: [
            { room: 0, file: 'RM0.CG', statements: LOGIC0_STATEMENTS, localSymbols: {} },
            {
              room: OLD_ROOM,
              file: `RM${OLD_ROOM}.CG`,
              statements: [{ type: 'call', name: 'new.room.f', args: [{ kind: 'number', value: ROOM_VAR }] }],
              localSymbols: {},
            },
          ],
        },
      }),
      { stopSound },
    );
    engine.state.setVar(ROOM_VAR, NEW_ROOM);
    engine.objectTable.animate(4);
    engine.state.setCurrentRoom(OLD_ROOM);

    engine.interpreter.runCycle();

    expect(stopSound).toHaveBeenCalledTimes(1);
    expect(engine.state.getCurrentRoom()).toBe(NEW_ROOM);
    expect(engine.state.getVar(ReservedVar.PreviousRoom)).toBe(OLD_ROOM);
    expect(engine.objectTable.getAnimatedObjectNumbers()).toEqual([0]);
  });

  it('ignores new.room with a non-numeric room argument, performing no housekeeping', () => {
    const stopSound = vi.fn();
    const engine = createEngine(
      buildResources({
        bundle: {
          rooms: [
            { room: 0, file: 'RM0.CG', statements: LOGIC0_STATEMENTS, localSymbols: {} },
            {
              room: OLD_ROOM,
              file: `RM${OLD_ROOM}.CG`,
              statements: [{ type: 'call', name: 'new.room', args: [{ kind: 'string', value: 'oops' }] }],
              localSymbols: {},
            },
          ],
        },
      }),
      { stopSound },
    );
    engine.state.setCurrentRoom(OLD_ROOM);

    engine.interpreter.runCycle();

    expect(stopSound).not.toHaveBeenCalled();
    expect(engine.state.getCurrentRoom()).toBe(OLD_ROOM);
  });
});
