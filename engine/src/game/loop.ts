/**
 * The real-time driver: a requestAnimationFrame loop with a fixed-step
 * accumulator, so `runCycle()`/`updateObjects()` advance the VM at a steady
 * rate independent of the browser's actual frame rate, while still honoring
 * {@link ReservedVar.TimeDelay} (v10, state.ts:32) - AGI's own `set.speed`
 * throttle - by stretching the cycle interval to `(TimeDelay + 1) *
 * baseTickMs`. `baseTickMs` defaults to 50ms to match this repo's documented
 * base rate (engine/README.md "Cycle timing", `main.ts`'s `CYCLE_MS`), so a
 * freshly-booted `VmState` (TimeDelay defaults to 0) reproduces that same
 * ~20 cycles/sec with no slowdown.
 *
 * `requestAnimationFrame` can't be driven deterministically in a Node test
 * (no real frame timing, and asserting on rendered pixels is out of scope
 * here anyway - see frame.ts's own tests for that), so the scheduler is
 * injected via `scheduleFrame` and defaults to the real
 * `requestAnimationFrame` only when nothing is supplied. Tests instead
 * inject a fake clock: a stub that records the callback and lets the test
 * invoke it with hand-picked timestamps.
 */

import { ReservedVar, type VmState } from '../vm/state';

export type FrameCallback = (timestampMs: number) => void;

export interface GameLoopOptions {
  /** Read once per frame to look up the live {@link ReservedVar.TimeDelay} value. */
  state: VmState;
  /** Advances the interpreter one cycle (`Interpreter.runCycle()`). */
  runCycle: () => void;
  /** Advances animated objects one cycle (`ObjectTable.update()`). */
  updateObjects: () => void;
  /** Draws the current state (`renderFrame()` against a canvas context). Called once per animation frame that ran at least one cycle - never for a frame where the accumulator hadn't yet reached the next cycle boundary. */
  render: () => void;
  /** Real milliseconds per cycle at `TimeDelay = 0`. Defaults to 50 (this repo's documented base AGI rate, ~20 cycles/sec). */
  baseTickMs?: number;
  /** Caps how many cycles a single frame may run to catch up, so a long pause (backgrounded tab, slow frame) can't trigger an unbounded burst of cycles. Defaults to 4. */
  maxCyclesPerFrame?: number;
  /** Schedules `callback` to run on the next animation frame; defaults to `requestAnimationFrame`. Tests inject a fake clock here. */
  scheduleFrame?: (callback: FrameCallback) => unknown;
}

export interface GameLoop {
  /** Starts (or restarts) the loop: resets the accumulator and schedules the first frame. No-op if already running. */
  start(): void;
  /** Stops the loop after its current frame finishes; no further frame is scheduled. */
  stop(): void;
  /** Whether the loop is currently running. */
  isRunning(): boolean;
}

const DEFAULT_BASE_TICK_MS = 50;
const DEFAULT_MAX_CYCLES_PER_FRAME = 4;

/** Builds a {@link GameLoop} that drives `runCycle`/`updateObjects`/`render` on a `TimeDelay`-throttled fixed-step accumulator. */
export function createGameLoop(options: GameLoopOptions): GameLoop {
  const { state, runCycle, updateObjects, render } = options;
  const baseTickMs = options.baseTickMs ?? DEFAULT_BASE_TICK_MS;
  const maxCyclesPerFrame = options.maxCyclesPerFrame ?? DEFAULT_MAX_CYCLES_PER_FRAME;
  const scheduleFrame = options.scheduleFrame ?? ((callback: FrameCallback) => requestAnimationFrame(callback));

  let running = false;
  let lastTimestampMs: number | null = null;
  let accumulatorMs = 0;

  function frame(timestampMs: number): void {
    if (!running) return;

    if (lastTimestampMs !== null) {
      accumulatorMs += timestampMs - lastTimestampMs;
    }
    lastTimestampMs = timestampMs;

    const cycleMs = baseTickMs * (state.getVar(ReservedVar.TimeDelay) + 1);
    let cyclesRun = 0;
    while (accumulatorMs >= cycleMs && cyclesRun < maxCyclesPerFrame) {
      runCycle();
      updateObjects();
      accumulatorMs -= cycleMs;
      cyclesRun++;
    }
    if (cyclesRun === maxCyclesPerFrame) {
      // Too far behind to catch up honestly (e.g. a backgrounded tab) -
      // drop the backlog instead of spending the next several frames
      // bursting through it.
      accumulatorMs = 0;
    }
    if (cyclesRun > 0) {
      render();
    }

    scheduleFrame(frame);
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      lastTimestampMs = null;
      accumulatorMs = 0;
      scheduleFrame(frame);
    },
    stop(): void {
      running = false;
    },
    isRunning(): boolean {
      return running;
    },
  };
}
