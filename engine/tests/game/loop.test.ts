import { describe, expect, it } from 'vitest';
import { createGameLoop, type FrameCallback } from '../../src/game/loop';
import { ReservedVar, VmState } from '../../src/vm/state';

/** A controllable stand-in for requestAnimationFrame: records the latest callback and lets the test fire it with a hand-picked timestamp, instead of relying on real frame timing. */
function createFakeClock() {
  let pending: FrameCallback | null = null;
  return {
    scheduleFrame: (callback: FrameCallback) => {
      pending = callback;
    },
    /** Fires the most recently scheduled frame, if one is pending. */
    tick(timestampMs: number): void {
      const callback = pending;
      pending = null;
      callback?.(timestampMs);
    },
    hasPendingFrame(): boolean {
      return pending !== null;
    },
  };
}

describe('createGameLoop', () => {
  it('schedules the first frame on start() without running a cycle yet', () => {
    const state = new VmState();
    let cycles = 0;
    const clock = createFakeClock();
    const loop = createGameLoop({
      state,
      runCycle: () => cycles++,
      updateObjects: () => {},
      render: () => {},
      scheduleFrame: clock.scheduleFrame,
    });

    loop.start();

    expect(clock.hasPendingFrame()).toBe(true);
    expect(cycles).toBe(0);
  });

  it('runs no cycle on the very first frame callback (it only establishes the starting timestamp)', () => {
    const state = new VmState();
    let cycles = 0;
    const clock = createFakeClock();
    const loop = createGameLoop({
      state,
      runCycle: () => cycles++,
      updateObjects: () => {},
      render: () => {},
      scheduleFrame: clock.scheduleFrame,
    });

    loop.start();
    clock.tick(0);

    expect(cycles).toBe(0);
    expect(clock.hasPendingFrame()).toBe(true);
  });

  it('runs exactly one cycle once baseTickMs has elapsed, at the default TimeDelay of 0', () => {
    const state = new VmState();
    let cycles = 0;
    let updates = 0;
    let renders = 0;
    const clock = createFakeClock();
    const loop = createGameLoop({
      state,
      runCycle: () => cycles++,
      updateObjects: () => updates++,
      render: () => renders++,
      baseTickMs: 50,
      scheduleFrame: clock.scheduleFrame,
    });

    loop.start();
    clock.tick(0);
    clock.tick(50);

    expect(cycles).toBe(1);
    expect(updates).toBe(1);
    expect(renders).toBe(1);
  });

  it('does not run a cycle (or render) before baseTickMs has elapsed', () => {
    const state = new VmState();
    let cycles = 0;
    let renders = 0;
    const clock = createFakeClock();
    const loop = createGameLoop({
      state,
      runCycle: () => cycles++,
      updateObjects: () => {},
      render: () => renders++,
      baseTickMs: 50,
      scheduleFrame: clock.scheduleFrame,
    });

    loop.start();
    clock.tick(0);
    clock.tick(30);

    expect(cycles).toBe(0);
    expect(renders).toBe(0);
    expect(clock.hasPendingFrame()).toBe(true);
  });

  it('carries leftover time into the next frame instead of dropping it', () => {
    const state = new VmState();
    let cycles = 0;
    const clock = createFakeClock();
    const loop = createGameLoop({
      state,
      runCycle: () => cycles++,
      updateObjects: () => {},
      render: () => {},
      baseTickMs: 50,
      scheduleFrame: clock.scheduleFrame,
    });

    loop.start();
    clock.tick(0);
    clock.tick(30); // 30ms accumulated, under the 50ms threshold
    expect(cycles).toBe(0);
    clock.tick(60); // +30ms = 60ms accumulated, now over threshold
    expect(cycles).toBe(1);
  });

  it('runs multiple cycles in one frame to catch up after a long delta', () => {
    const state = new VmState();
    let cycles = 0;
    let renders = 0;
    const clock = createFakeClock();
    const loop = createGameLoop({
      state,
      runCycle: () => cycles++,
      updateObjects: () => {},
      render: () => renders++,
      baseTickMs: 50,
      scheduleFrame: clock.scheduleFrame,
    });

    loop.start();
    clock.tick(0);
    clock.tick(170); // 3 full 50ms cycles + 20ms left over

    expect(cycles).toBe(3);
    expect(renders).toBe(1); // one render per frame, however many cycles it covered
  });

  it('caps catch-up cycles per frame and drops the remaining backlog instead of bursting forever', () => {
    const state = new VmState();
    let cycles = 0;
    const clock = createFakeClock();
    const loop = createGameLoop({
      state,
      runCycle: () => cycles++,
      updateObjects: () => {},
      render: () => {},
      baseTickMs: 50,
      maxCyclesPerFrame: 4,
      scheduleFrame: clock.scheduleFrame,
    });

    loop.start();
    clock.tick(0);
    clock.tick(10_000); // way more than 4 * 50ms worth of backlog

    expect(cycles).toBe(4);

    // The backlog was dropped (not carried forward), so the next frame
    // starts fresh rather than immediately bursting through another 4.
    clock.tick(10_010);
    expect(cycles).toBe(4);
  });

  it('stretches the cycle interval by (TimeDelay + 1) per ReservedVar.TimeDelay (v10)', () => {
    const state = new VmState();
    state.setVar(ReservedVar.TimeDelay, 1); // double the interval: 1 cycle per 100ms instead of 50ms
    let cycles = 0;
    const clock = createFakeClock();
    const loop = createGameLoop({
      state,
      runCycle: () => cycles++,
      updateObjects: () => {},
      render: () => {},
      baseTickMs: 50,
      scheduleFrame: clock.scheduleFrame,
    });

    loop.start();
    clock.tick(0);
    clock.tick(50);
    expect(cycles).toBe(0); // not yet - TimeDelay=1 needs 100ms

    clock.tick(100);
    expect(cycles).toBe(1);
  });

  it('re-reads TimeDelay every frame, so a mid-game set.speed takes effect immediately', () => {
    const state = new VmState();
    let cycles = 0;
    const clock = createFakeClock();
    const loop = createGameLoop({
      state,
      runCycle: () => cycles++,
      updateObjects: () => {},
      render: () => {},
      baseTickMs: 50,
      scheduleFrame: clock.scheduleFrame,
    });

    loop.start();
    clock.tick(0);
    clock.tick(50);
    expect(cycles).toBe(1); // fast: TimeDelay=0

    state.setVar(ReservedVar.TimeDelay, 1);
    clock.tick(100);
    expect(cycles).toBe(1); // only +50ms accumulated, now needs 100ms

    clock.tick(150);
    expect(cycles).toBe(2);
  });

  it('calls runCycle before updateObjects on each cycle', () => {
    const state = new VmState();
    const order: string[] = [];
    const clock = createFakeClock();
    const loop = createGameLoop({
      state,
      runCycle: () => order.push('runCycle'),
      updateObjects: () => order.push('updateObjects'),
      render: () => order.push('render'),
      baseTickMs: 50,
      scheduleFrame: clock.scheduleFrame,
    });

    loop.start();
    clock.tick(0);
    clock.tick(50);

    expect(order).toEqual(['runCycle', 'updateObjects', 'render']);
  });

  it('stop() prevents the next frame from running any further cycles', () => {
    const state = new VmState();
    let cycles = 0;
    const clock = createFakeClock();
    const loop = createGameLoop({
      state,
      runCycle: () => cycles++,
      updateObjects: () => {},
      render: () => {},
      baseTickMs: 50,
      scheduleFrame: clock.scheduleFrame,
    });

    loop.start();
    clock.tick(0);
    clock.tick(50);
    expect(cycles).toBe(1);

    loop.stop();
    expect(loop.isRunning()).toBe(false);
    clock.tick(100);

    expect(cycles).toBe(1); // the pending frame from before stop() still no-ops
    expect(clock.hasPendingFrame()).toBe(false); // and it didn't reschedule another
  });

  it('start() is a no-op while already running (does not reset progress toward the next cycle)', () => {
    const state = new VmState();
    let cycles = 0;
    const clock = createFakeClock();
    const loop = createGameLoop({
      state,
      runCycle: () => cycles++,
      updateObjects: () => {},
      render: () => {},
      baseTickMs: 50,
      scheduleFrame: clock.scheduleFrame,
    });

    loop.start();
    clock.tick(0);
    clock.tick(30); // 30ms accumulated

    loop.start(); // should be ignored - loop is already running
    clock.tick(60); // would be +30ms = 60ms if accumulator wasn't reset

    expect(cycles).toBe(1);
  });

  it('restarting after stop() resets the accumulator and timestamp baseline', () => {
    const state = new VmState();
    let cycles = 0;
    const clock = createFakeClock();
    const loop = createGameLoop({
      state,
      runCycle: () => cycles++,
      updateObjects: () => {},
      render: () => {},
      baseTickMs: 50,
      scheduleFrame: clock.scheduleFrame,
    });

    loop.start();
    clock.tick(0);
    clock.tick(30); // 30ms accumulated, no cycle yet
    loop.stop();

    loop.start();
    clock.tick(1_000); // first tick after restart only sets the new baseline
    clock.tick(1_030); // +30ms - if the old accumulator leaked through this would tick over 50ms

    expect(cycles).toBe(0);
  });
});
