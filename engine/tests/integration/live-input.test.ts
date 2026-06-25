// Integration test for A5: the wiring src/main.ts assembles from the A2
// engine (createEngine) and the input layer under src/input/* - real
// keyboard events driving ego's direction, a typed line feeding the parser's
// said(), and the menu bar dispatching a controller - without any DOM. Each
// `dispatchKeyDown` call below mirrors exactly the routing main.ts's own
// `window.addEventListener('keydown', ...)` handler does (menu-open nav keys
// intercepted first, otherwise handed to `KeyboardInput`), so a passing test
// here is a guarantee that a real key sequence through main.ts's listeners
// produces the same state changes.
import { describe, expect, it } from 'vitest';
import { applyEgoDirectionFromInput, createEngine } from '../../src/game/engine';
import type { GameResources } from '../../src/game/resources';
import { Direction, KeyboardInput } from '../../src/input/keyboard';
import { MenuUi } from '../../src/input/menu-ui';
import { ParserUi } from '../../src/input/parser-ui';
import type { AssignStatement, BoolExpr, Statement } from '../../src/logic/ir';
import { readWordsTok } from '../helpers/assets';
import { EGO_OBJECT } from '../../src/vm/objects';
import { ReservedVar } from '../../src/vm/state';

function assign(target: string, value: number): AssignStatement {
  return { type: 'assign', target, op: '=', value: { kind: 'number', value } };
}

function ifTest(test: BoolExpr, thenValue: number, elseValue: number, target: string): Statement {
  return { type: 'if', test, then: [assign(target, thenValue)], else: [assign(target, elseValue)] };
}

const SAID_MARKER_VAR = 200;
const CONTROLLER_MARKER_VAR = 201;
const TEST_CONTROLLER = 50;
const MENU_TITLE_MESSAGE = 900;
const MENU_ITEM_MESSAGE = 901;

// Every cycle, logic 0 re-evaluates said()/controller() against whatever the
// player most recently did and records the result into a plain var, so tests
// can assert on `state.getVar(...)` the same way real room logic would
// branch on these tests.
const ROOM0_STATEMENTS: Statement[] = [
  ifTest({ type: 'call', name: 'said', args: [{ kind: 'string', value: 'look' }] }, 1, 0, 'said.marker'),
  ifTest(
    { type: 'call', name: 'controller', args: [{ kind: 'number', value: TEST_CONTROLLER }] },
    1,
    0,
    'controller.marker',
  ),
];

function buildResources(): GameResources {
  return {
    bundle: { rooms: [{ room: 0, file: 'RM0.CG', statements: ROOM0_STATEMENTS, localSymbols: {} }] },
    symbols: {
      flags: {},
      vars: { 'said.marker': SAID_MARKER_VAR, 'controller.marker': CONTROLLER_MARKER_VAR },
      views: {},
      objects: {},
      roomNames: {},
      defines: {},
    },
    messages: {},
    objectBytes: new Uint8Array(),
    wordsBytes: readWordsTok(),
    pictures: new Map(),
  };
}

/** Assembles the same input layer main.ts wires onto a live engine - KeyboardInput, MenuUi, ParserUi - and a `dispatchKeyDown` helper that reproduces main.ts's window-level keydown routing (menu-nav interception, then KeyboardInput) without any DOM. */
function wireInput(engine: ReturnType<typeof createEngine>) {
  const menuUi = new MenuUi({ state: engine.state, resolveMessage: engine.resolveMessage });
  const parserUi = new ParserUi({ state: engine.state, parser: engine.parser });
  const keyboard = new KeyboardInput({ state: engine.state, onMenu: () => menuUi.toggle() });

  const MENU_NAV_KEYS: Record<string, () => void> = {
    ArrowLeft: () => menuUi.moveMenu(-1),
    ArrowRight: () => menuUi.moveMenu(1),
    ArrowUp: () => menuUi.moveItem(-1),
    ArrowDown: () => menuUi.moveItem(1),
    Enter: () => menuUi.selectCurrent(),
    Escape: () => menuUi.close(),
  };

  function dispatchKeyDown(key: string): void {
    if (menuUi.isOpen() && key in MENU_NAV_KEYS) {
      MENU_NAV_KEYS[key]();
      return;
    }
    keyboard.handleKeyDown(key);
  }

  return { menuUi, parserUi, keyboard, dispatchKeyDown };
}

describe('A5 live input integration: main.ts wiring over the A2 engine', () => {
  it("a typed line reaches the room logic's said() through ParserUi/InputParser", () => {
    const engine = createEngine(buildResources());
    const { parserUi } = wireInput(engine);

    engine.interpreter.runCycle();
    expect(engine.state.getVar(SAID_MARKER_VAR)).toBe(0);

    parserUi.submit('look');
    engine.interpreter.runCycle();

    expect(engine.state.getVar(SAID_MARKER_VAR)).toBe(1);
  });

  it("a menu selection reaches the room logic's controller() through MenuUi", () => {
    const engine = createEngine(buildResources());
    engine.state.addMenu(MENU_TITLE_MESSAGE);
    engine.state.addMenuItem(MENU_ITEM_MESSAGE, TEST_CONTROLLER);
    engine.state.submitMenu();
    const { menuUi, dispatchKeyDown } = wireInput(engine);

    engine.interpreter.runCycle();
    expect(engine.state.getVar(CONTROLLER_MARKER_VAR)).toBe(0);

    dispatchKeyDown('F10'); // opens the menu bar (KeyboardInput's onMenu -> menuUi.toggle())
    expect(menuUi.isOpen()).toBe(true);
    dispatchKeyDown('Enter'); // selects the highlighted item, dispatching its controller
    expect(menuUi.isOpen()).toBe(false);

    engine.interpreter.runCycle();

    expect(engine.state.getVar(CONTROLLER_MARKER_VAR)).toBe(1);
  });

  it('holding an arrow key drives ego.dir, which applyEgoDirectionFromInput feeds into normal motion', () => {
    const engine = createEngine(buildResources());
    const { keyboard, dispatchKeyDown } = wireInput(engine);
    engine.state.setPosition(EGO_OBJECT, 50, 100); // below the horizon, so vertical clamping doesn't interfere
    const before = engine.state.getPosition(EGO_OBJECT);

    dispatchKeyDown('ArrowRight');
    expect(engine.state.getVar(ReservedVar.EgoDirection)).toBe(Direction.Right);

    applyEgoDirectionFromInput(engine.state, engine.objectTable);
    expect(engine.objectTable.getObject(EGO_OBJECT).direction).toBe(Direction.Right);
    engine.objectTable.update();

    const after = engine.state.getPosition(EGO_OBJECT);
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBe(before.y);

    keyboard.handleKeyUp('ArrowRight');
    expect(engine.state.getVar(ReservedVar.EgoDirection)).toBe(Direction.Stopped);
  });

  it('prevent.input (accept.input gating) blocks new direction keys and parser submissions alike', () => {
    const engine = createEngine(buildResources());
    const { parserUi, dispatchKeyDown } = wireInput(engine);
    engine.state.setInputEnabled(false);

    dispatchKeyDown('ArrowUp');
    expect(engine.state.getVar(ReservedVar.EgoDirection)).toBe(Direction.Stopped);

    parserUi.submit('look');
    engine.interpreter.runCycle();
    expect(engine.state.getVar(SAID_MARKER_VAR)).toBe(0);
  });
});
