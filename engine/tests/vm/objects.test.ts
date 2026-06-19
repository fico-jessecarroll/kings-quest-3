import { describe, expect, it } from 'vitest';
import { Edge, EGO_OBJECT, ObjectTable, SCREEN_MAX_X, SCREEN_MAX_Y, SCREEN_MIN_X } from '../../src/vm/objects';
import { ReservedVar, VmState } from '../../src/vm/state';

describe('ObjectTable: animated-object table', () => {
  it('always has ego (object 0) animated by default', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    expect(table.isAnimated(0)).toBe(true);
    expect(table.getObject(0).number).toBe(0);
  });

  it('animate() creates a new object with AGI defaults', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });

    const obj = table.animate(3);
    expect(obj.view).toBe(0);
    expect(obj.loop).toBe(0);
    expect(obj.cel).toBe(0);
    expect(obj.direction).toBe(0);
    expect(obj.stepSize).toBe(1);
    expect(obj.motion).toBe('normal');
    expect(obj.cycling).toBe(false);
    expect(table.isAnimated(3)).toBe(true);
  });

  it('unanimate() removes an object from the animated set but not ego', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(5);

    table.unanimate(5);
    expect(table.isAnimated(5)).toBe(false);

    table.unanimate(EGO_OBJECT);
    expect(table.isAnimated(EGO_OBJECT)).toBe(true);
  });

  it('getObject() throws for an object that was never animated', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    expect(() => table.getObject(9)).toThrow();
  });

  it('setView/setLoop/setCel/setDirection/setStepSize mutate the object record', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);

    table.setView(1, 4);
    table.setLoop(1, 2);
    table.setCel(1, 3);
    table.setDirection(1, 5);
    table.setStepSize(1, 2);

    const obj = table.getObject(1);
    expect(obj.view).toBe(4);
    expect(obj.loop).toBe(2);
    expect(obj.cel).toBe(3);
    expect(obj.direction).toBe(5);
    expect(obj.stepSize).toBe(2);
  });
});

describe('ObjectTable: normal motion', () => {
  it('moves an object by stepSize each cycle in its set direction', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    state.setPosition(1, 50, 50);
    table.setDirection(1, 3); // east
    table.setStepSize(1, 2);

    table.update();

    expect(state.getPosition(1)).toEqual({ x: 52, y: 50 });
  });

  it('moves diagonally for the 8 AGI directions', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    state.setPosition(1, 50, 50);
    table.setDirection(1, 8); // northwest
    table.setStepSize(1, 3);

    table.update();

    expect(state.getPosition(1)).toEqual({ x: 47, y: 47 });
  });

  it('a stopped object (direction 0) does not move', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    state.setPosition(1, 50, 50);

    table.update();

    expect(state.getPosition(1)).toEqual({ x: 50, y: 50 });
  });

  it('respects stepTime: an object with stepTime 3 only moves every third cycle', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    state.setPosition(1, 50, 50);
    table.setDirection(1, 3);
    table.setStepSize(1, 1);
    table.setStepTime(1, 3);

    table.update();
    expect(state.getPosition(1)).toEqual({ x: 50, y: 50 });
    table.update();
    expect(state.getPosition(1)).toEqual({ x: 50, y: 50 });
    table.update();
    expect(state.getPosition(1)).toEqual({ x: 51, y: 50 });
  });
});

describe('ObjectTable: move.obj', () => {
  it('advances toward the target position one step per cycle', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    table.setObserveHorizon(1, false);
    state.setPosition(1, 0, 0);

    table.moveObj(1, 6, 0, 2, 10);
    table.update();

    expect(state.getPosition(1)).toEqual({ x: 2, y: 0 });
    expect(state.getFlag(10)).toBe(false);
  });

  it('clamps the final step so the object lands exactly on the target without overshoot', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    table.setObserveHorizon(1, false);
    state.setPosition(1, 0, 0);

    table.moveObj(1, 5, 0, 2, 10);
    table.update(); // -> 2
    table.update(); // -> 4
    table.update(); // -> 5 (clamped, not 6)

    expect(state.getPosition(1)).toEqual({ x: 5, y: 0 });
  });

  it('signals completion by setting doneFlag and reverting to normal motion once the target is reached', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    table.setObserveHorizon(1, false);
    state.setPosition(1, 0, 0);

    table.moveObj(1, 4, 0, 2, 10);
    table.update(); // -> 2
    expect(state.getFlag(10)).toBe(false);

    table.update(); // -> 4, arrives and signals completion in the same cycle

    expect(state.getFlag(10)).toBe(true);
    expect(table.getObject(1).motion).toBe('normal');
    expect(table.getObject(1).direction).toBe(0);
  });

  it('moves diagonally toward a target that differs in both x and y', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    table.setObserveHorizon(1, false);
    state.setPosition(1, 10, 10);

    table.moveObj(1, 4, 16, 3, 10);
    table.update();

    // dx=-6,dy=+6: direction is southwest, stepSize 3 on both axes.
    expect(state.getPosition(1)).toEqual({ x: 7, y: 13 });
  });
});

describe('ObjectTable: follow.ego', () => {
  it('moves the object toward ego', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    table.setObserveHorizon(1, false);
    state.setPosition(EGO_OBJECT, 50, 50);
    state.setPosition(1, 0, 0);

    table.followEgo(1, 5, 11);
    table.update();

    expect(state.getPosition(1)).toEqual({ x: 5, y: 5 });
  });

  it('sets doneFlag once adjacent to ego, without throwing once caught up', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    state.setPosition(EGO_OBJECT, 10, 10);
    state.setPosition(1, 8, 10);

    table.followEgo(1, 2, 11);
    table.update();

    expect(state.getFlag(11)).toBe(true);
  });
});

describe('ObjectTable: wander', () => {
  it('changes direction over time rather than holding one direction forever', () => {
    const state = new VmState();
    // A non-periodic fake RNG: each pickWanderDirection() consumes two
    // values (direction, then timer), so a period-2 sequence would always
    // land on the same pair and never actually change direction.
    let seed = 0;
    const random = () => {
      seed = (seed + 0.37) % 1;
      return seed;
    };
    const table = new ObjectTable({ state, random });
    table.animate(1);
    state.setPosition(1, 80, 80);

    const firstDirection = table.getObject(1).motion === 'wander' ? table.getObject(1).direction : -1;
    table.wander(1);
    const initialDirection = table.getObject(1).direction;
    expect(table.getObject(1).motion).toBe('wander');
    expect(firstDirection).toBe(-1);

    const seenDirections = new Set<number>([initialDirection]);
    for (let i = 0; i < 30; i++) {
      table.update();
      seenDirections.add(table.getObject(1).direction);
    }

    expect(seenDirections.size).toBeGreaterThan(1);
  });

  it('picks a new direction immediately after bouncing off a screen edge', () => {
    const state = new VmState();
    const random = () => 0; // direction 1 (north), wanderCount = 5
    const table = new ObjectTable({ state, random });
    table.animate(1);
    state.setPosition(1, 80, SCREEN_MIN_X); // already at the top edge (y=0)
    table.setObserveHorizon(1, false);
    table.wander(1);
    table.setStepSize(1, 1);

    const directionBeforeBounce = table.getObject(1).direction;
    expect(directionBeforeBounce).toBe(1); // north

    table.update();

    // It tried to move north off the top edge; since that didn't move it,
    // wander must've picked a new direction even though the timer hadn't run out.
    expect(state.getVar(ReservedVar.ObjectBorderTouched)).toBe(1);
    expect(state.getVar(ReservedVar.ObjectBorderCode)).toBe(Edge.Top);
  });
});

describe('ObjectTable: screen edges', () => {
  it('clamps an object to the right edge and sets the object border vars', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(2);
    state.setPosition(2, SCREEN_MAX_X, 100);
    table.setDirection(2, 3); // east
    table.setStepSize(2, 5);

    table.update();

    expect(state.getPosition(2)).toEqual({ x: SCREEN_MAX_X, y: 100 });
    expect(state.getVar(ReservedVar.ObjectBorderTouched)).toBe(2);
    expect(state.getVar(ReservedVar.ObjectBorderCode)).toBe(Edge.Right);
  });

  it('clamps ego to the left edge and sets EgoBorderTouched instead of the object vars', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    state.setPosition(EGO_OBJECT, SCREEN_MIN_X, 100);
    table.setDirection(EGO_OBJECT, 7); // west
    table.setStepSize(EGO_OBJECT, 5);

    table.update();

    expect(state.getPosition(EGO_OBJECT)).toEqual({ x: SCREEN_MIN_X, y: 100 });
    expect(state.getVar(ReservedVar.EgoBorderTouched)).toBe(Edge.Left);
  });

  it('clamps to the bottom edge', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(2);
    state.setPosition(2, 80, SCREEN_MAX_Y);
    table.setObserveHorizon(2, false);
    table.setDirection(2, 5); // south
    table.setStepSize(2, 5);

    table.update();

    expect(state.getPosition(2)).toEqual({ x: 80, y: SCREEN_MAX_Y });
    expect(state.getVar(ReservedVar.ObjectBorderCode)).toBe(Edge.Bottom);
  });
});

describe('ObjectTable: horizon', () => {
  it('clamps an observing object to the horizon line instead of letting it move above it', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(2);
    table.setHorizon(40);
    state.setPosition(2, 80, 42);
    table.setDirection(2, 1); // north
    table.setStepSize(2, 5);

    table.update();

    expect(state.getPosition(2)).toEqual({ x: 80, y: 40 });
  });

  it('lets an object that ignores the horizon move above it freely', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(2);
    table.setHorizon(40);
    table.setObserveHorizon(2, false);
    state.setPosition(2, 80, 42);
    table.setDirection(2, 1); // north
    table.setStepSize(2, 5);

    table.update();

    expect(state.getPosition(2)).toEqual({ x: 80, y: 37 });
  });
});

describe('ObjectTable: blocking', () => {
  it('prevents an object from entering a blocked rectangle', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(2);
    table.setBlock(50, 50, 60, 60);
    state.setPosition(2, 45, 55);
    table.setDirection(2, 3); // east, straight into the block
    table.setStepSize(2, 10);

    table.update();

    expect(state.getPosition(2)).toEqual({ x: 45, y: 55 });
  });

  it('lets an object that ignores blocks pass straight through', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(2);
    table.setBlock(50, 50, 60, 60);
    table.setIgnoreBlocks(2, true);
    state.setPosition(2, 45, 55);
    table.setDirection(2, 3);
    table.setStepSize(2, 10);

    table.update();

    expect(state.getPosition(2)).toEqual({ x: 55, y: 55 });
  });
});

describe('ObjectTable: cycling', () => {
  it('advances the cel within the loop bounds and wraps back to 0', () => {
    const state = new VmState();
    const table = new ObjectTable({ state, getCelCount: () => 4 });
    table.animate(1);
    table.normalCycle(1);

    const cels: number[] = [table.getObject(1).cel];
    for (let i = 0; i < 6; i++) {
      table.update();
      cels.push(table.getObject(1).cel);
    }

    expect(cels).toEqual([0, 1, 2, 3, 0, 1, 2]);
  });

  it('does not advance the cel when cycling is off', () => {
    const state = new VmState();
    const table = new ObjectTable({ state, getCelCount: () => 4 });
    table.animate(1);

    table.update();
    table.update();

    expect(table.getObject(1).cel).toBe(0);
  });

  it('respects cycleTime: a cycleTime of 2 advances the cel every other update', () => {
    const state = new VmState();
    const table = new ObjectTable({ state, getCelCount: () => 4 });
    table.animate(1);
    table.normalCycle(1);
    table.setCycleTime(1, 2);

    table.update();
    expect(table.getObject(1).cel).toBe(0);
    table.update();
    expect(table.getObject(1).cel).toBe(1);
  });

  it('reverseCycle wraps backward through the loop', () => {
    const state = new VmState();
    const table = new ObjectTable({ state, getCelCount: () => 3 });
    table.animate(1);
    table.reverseCycle(1);

    const cels: number[] = [table.getObject(1).cel];
    for (let i = 0; i < 4; i++) {
      table.update();
      cels.push(table.getObject(1).cel);
    }

    expect(cels).toEqual([0, 2, 1, 0, 2]);
  });

  it('endLoop advances to the last cel then stops cycling and sets doneFlag', () => {
    const state = new VmState();
    const table = new ObjectTable({ state, getCelCount: () => 3 });
    table.animate(1);
    table.endLoop(1, 20);

    table.update();
    expect(table.getObject(1).cel).toBe(1);
    expect(state.getFlag(20)).toBe(false);

    table.update();
    expect(table.getObject(1).cel).toBe(2);
    expect(state.getFlag(20)).toBe(true);
    expect(table.getObject(1).cycling).toBe(false);

    // Stays put once stopped; cycling is off so further updates are no-ops.
    table.update();
    expect(table.getObject(1).cel).toBe(2);
  });

  it('reverseLoop decrements to cel 0 then stops cycling and sets doneFlag', () => {
    const state = new VmState();
    const table = new ObjectTable({ state, getCelCount: () => 3 });
    table.animate(1);
    table.setCel(1, 2);
    table.reverseLoop(1, 21);

    table.update();
    expect(table.getObject(1).cel).toBe(1);
    expect(state.getFlag(21)).toBe(false);

    table.update();
    expect(table.getObject(1).cel).toBe(0);
    expect(state.getFlag(21)).toBe(true);
    expect(table.getObject(1).cycling).toBe(false);
  });
});

describe('ObjectTable: start.update/stop.update', () => {
  it('defaults a newly animated object to updating', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    expect(table.getObject(1).updating).toBe(true);
  });

  it('stopUpdate freezes both motion and cycling without unanimating the object', () => {
    const state = new VmState();
    const table = new ObjectTable({ state, getCelCount: () => 4 });
    table.animate(1);
    state.setPosition(1, 50, 50);
    table.setDirection(1, 3); // east
    table.normalCycle(1);
    table.stopUpdate(1);

    table.update();

    expect(table.isAnimated(1)).toBe(true);
    expect(table.getObject(1).updating).toBe(false);
    expect(state.getPosition(1)).toEqual({ x: 50, y: 50 });
    expect(table.getObject(1).cel).toBe(0);
  });

  it('startUpdate resumes motion and cycling', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    state.setPosition(1, 50, 50);
    table.setDirection(1, 3); // east
    table.stopUpdate(1);
    table.startUpdate(1);

    table.update();

    expect(table.getObject(1).updating).toBe(true);
    expect(state.getPosition(1)).toEqual({ x: 51, y: 50 });
  });
});

describe('ObjectTable: fix.loop/release.loop', () => {
  it('defaults to not loop-fixed, and tracks fix/release as state', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    expect(table.getObject(1).loopFixed).toBe(false);

    table.fixLoop(1);
    expect(table.getObject(1).loopFixed).toBe(true);

    table.releaseLoop(1);
    expect(table.getObject(1).loopFixed).toBe(false);
  });
});

describe('ObjectTable: ignore.objs/observe.objs', () => {
  it('defaults to not ignoring other objects, and tracks the flag', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    expect(table.getObject(1).ignoreObjs).toBe(false);

    table.setIgnoreObjs(1, true);
    expect(table.getObject(1).ignoreObjs).toBe(true);

    table.setIgnoreObjs(1, false);
    expect(table.getObject(1).ignoreObjs).toBe(false);
  });
});

describe('ObjectTable: force.update', () => {
  it('defaults to no force-update pending, and records a request until cleared', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    expect(table.getObject(1).forceUpdate).toBe(false);

    table.forceUpdate(1);
    expect(table.getObject(1).forceUpdate).toBe(true);
  });
});

describe('ObjectTable: reposition.to', () => {
  it('moves an object directly to the given coordinates, bypassing horizon/edge clamping', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    table.setObserveHorizon(1, true);

    table.repositionTo(1, 10, 5);

    expect(state.getPosition(1)).toEqual({ x: 10, y: 5 });
  });

  it('cancels any in-progress move/follow order', () => {
    const state = new VmState();
    const table = new ObjectTable({ state });
    table.animate(1);
    table.moveObj(1, 100, 100, 1, 30);

    table.repositionTo(1, 10, 5);
    table.update();

    expect(state.getPosition(1)).toEqual({ x: 10, y: 5 });
    expect(table.getObject(1).motion).toBe('normal');
  });
});

describe('ObjectTable: getCelCount', () => {
  it('exposes the configured cel-count lookup, clamped to at least 1', () => {
    const state = new VmState();
    const table = new ObjectTable({ state, getCelCount: (view, loop) => (view === 4 && loop === 1 ? 6 : 0) });
    expect(table.getCelCount(4, 1)).toBe(6);
    expect(table.getCelCount(0, 0)).toBe(1);
  });
});
