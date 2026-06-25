// Headless integration test (A6): assembles the full conductor exactly as
// src/main.ts does - A1's resource loading, A2's createEngine, A3's
// new.room transition handling, A4's fixed-step game loop, and A5's input
// wiring (keyboard/menu/parser) - against the real compiled SRC/*.CG logic
// and real PIC/OBJECT/WORDS.TOK resources, with a fake animation-frame
// clock standing in for the browser. Boots at room 0, runs it through the
// real, unconditional `new.room(45)` transition RM0.CG's startup logic
// fires on first entry (no restart/test.room override - see SRC/RM0.CG),
// and keeps cycling for a while inside the destination room. This is the
// same regression class all-rooms.test.ts guards per-room in isolation,
// but exercised here through the live multi-room conductor a real play
// session actually drives.
import { describe, expect, it } from 'vitest';
import { compileAllLogic } from '../../tools/compile-logic';
import { createGameLoop, type FrameCallback } from '../../src/game/loop';
import { applyEgoDirectionFromInput, createEngine } from '../../src/game/engine';
import type { GameMessages, GameResources } from '../../src/game/resources';
import { KeyboardInput } from '../../src/input/keyboard';
import { MenuUi } from '../../src/input/menu-ui';
import { ParserUi } from '../../src/input/parser-ui';
import { listPicFiles, readObject, readPic, readWordsTok } from '../helpers/assets';

const UNRESOLVED_SYMBOL_PATTERN = /unresolved symbol|cannot resolve ".*" as a (flag or var|var)/;
const STARTUP_ROOM = 0;
const ENTRY_ROOM = 45; // SRC/RM0.CG: `if (!current.room) { ... new.room(45); }` on first boot
const BASE_TICK_MS = 50;
// lgc.startup (RM101.CG, called from RM0.CG) sets the real "normal" speed,
// which aliases ReservedVar.TimeDelay - so the loop settles at one cycle per
// 100ms (half the nominal ~20/sec base rate) rather than one per tick.
// Simulating 4 real seconds comfortably clears MIN_CYCLES regardless of
// that scaling.
const SIMULATED_MS = 4000;
const TICKS = SIMULATED_MS / BASE_TICK_MS;
const MIN_CYCLES = 20;

function loadRealResources(): GameResources {
  const compiled = compileAllLogic();
  expect(compiled.report.failures).toEqual([]);

  const pictures = new Map<number, Uint8Array>();
  for (const file of listPicFiles()) {
    const match = /^PIC\.(\d+)$/.exec(file);
    if (match) {
      pictures.set(Number(match[1]), readPic(file));
    }
  }

  return {
    bundle: compiled.bundle,
    symbols: compiled.symbols,
    messages: compiled.messages as unknown as GameMessages,
    objectBytes: readObject(),
    wordsBytes: readWordsTok(),
    pictures,
  };
}

/** Stand-in for requestAnimationFrame (same shape as loop.test.ts's fake clock): records the latest scheduled frame and lets the test fire it with a hand-picked timestamp, so the A4 game loop can be driven deterministically in Node. */
function createFakeClock() {
  let pending: FrameCallback | null = null;
  return {
    scheduleFrame: (callback: FrameCallback) => {
      pending = callback;
    },
    tick(timestampMs: number): void {
      const callback = pending;
      pending = null;
      callback?.(timestampMs);
    },
  };
}

describe('A6 headless conductor integration: A1-A5 assembled against real game data', () => {
  it(`runs at least ${MIN_CYCLES} cycles through the real room ${STARTUP_ROOM}->${ENTRY_ROOM} transition without throwing or logging unresolved-symbol errors`, () => {
    const messages: string[] = [];
    const engine = createEngine(loadRealResources(), { logger: (m) => messages.push(m) });

    // A5: the same input layer src/main.ts wires onto the engine's shared VmState.
    const menuUi = new MenuUi({ state: engine.state, resolveMessage: engine.resolveMessage });
    const parserUi = new ParserUi({ state: engine.state, parser: engine.parser });
    const keyboard = new KeyboardInput({ state: engine.state, onMenu: () => menuUi.toggle() });

    let cycles = 0;
    const clock = createFakeClock();
    // A4: the real fixed-step accumulator loop, driven by a fake clock instead of requestAnimationFrame.
    const loop = createGameLoop({
      state: engine.state,
      runCycle: () => {
        applyEgoDirectionFromInput(engine.state, engine.objectTable);
        engine.interpreter.runCycle();
        cycles++;
      },
      updateObjects: () => engine.objectTable.update(),
      render: () => {},
      baseTickMs: BASE_TICK_MS,
      scheduleFrame: clock.scheduleFrame,
    });

    expect(engine.state.getCurrentRoom()).toBe(STARTUP_ROOM);

    let thrown: unknown;
    try {
      loop.start();
      clock.tick(0); // establishes the starting timestamp; runs no cycle yet
      for (let i = 1; i <= TICKS; i++) {
        clock.tick(i * BASE_TICK_MS);
      }

      // Exercise A5 input wiring mid-run, the same as a real keypress/typed
      // line reaching the engine through main.ts's listeners.
      keyboard.handleKeyDown('ArrowRight');
      applyEgoDirectionFromInput(engine.state, engine.objectTable);
      keyboard.handleKeyUp('ArrowRight');
      parserUi.submit('look');
      engine.interpreter.runCycle();
      cycles++;
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeUndefined();
    expect(cycles).toBeGreaterThanOrEqual(MIN_CYCLES);

    // A3: a real room-to-room transition actually happened, and the engine
    // kept running inside the destination room afterward.
    expect(engine.state.getCurrentRoom()).toBe(ENTRY_ROOM);

    const offenders = messages.filter((m) => UNRESOLVED_SYMBOL_PATTERN.test(m));
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
