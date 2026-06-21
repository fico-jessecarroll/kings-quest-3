import { describe, expect, it } from 'vitest';
import { VmState } from '../../src/vm/state';
import {
  autoPriorityForY,
  collectSprites,
  colorForPriority,
  DEFAULT_HORIZON,
  EGO_OBJECT_NUMBER,
  MAX_AUTO_PRIORITY,
  MAX_PRIORITY,
  MIN_PRIORITY,
  priorityForObject,
} from '../../src/render/sprites';

describe('autoPriorityForY', () => {
  it('is the minimum band at or above the horizon', () => {
    expect(autoPriorityForY(0, 40)).toBe(MIN_PRIORITY);
    expect(autoPriorityForY(40, 40)).toBe(MIN_PRIORITY);
  });

  it('increases monotonically with y below the horizon', () => {
    const horizon = 40;
    let previous = MIN_PRIORITY;
    for (let y = horizon; y <= 167; y += 5) {
      const priority = autoPriorityForY(y, horizon);
      expect(priority).toBeGreaterThanOrEqual(previous);
      previous = priority;
    }
  });

  it('never reaches 15 automatically - that band is reserved for an explicit set.priority override', () => {
    expect(autoPriorityForY(167, 0)).toBeLessThan(MAX_PRIORITY);
    expect(autoPriorityForY(167, 0)).toBe(MAX_AUTO_PRIORITY);
  });

  it('defaults to AGI\'s standard horizon (36) when none is given', () => {
    expect(autoPriorityForY(36)).toBe(MIN_PRIORITY);
    expect(autoPriorityForY(0)).toBe(MIN_PRIORITY);
    expect(DEFAULT_HORIZON).toBe(36);
  });
});

describe('priorityForObject', () => {
  it('uses the fixed priority when set.priority was called', () => {
    const state = new VmState();
    state.setPosition(0, 10, 167);
    state.setPriority(0, 9);
    expect(priorityForObject(state, 0)).toBe(9);
  });

  it('falls back to the automatic y-based band when no fixed priority is set', () => {
    const state = new VmState();
    state.setPosition(0, 10, 100);
    expect(priorityForObject(state, 0, 0)).toBe(autoPriorityForY(100, 0));
  });
});

describe('collectSprites', () => {
  it('builds one descriptor per object number with its position and priority', () => {
    const state = new VmState();
    state.setPosition(EGO_OBJECT_NUMBER, 38, 158);
    state.setPriority(EGO_OBJECT_NUMBER, 12);

    const [sprite] = collectSprites(state, [EGO_OBJECT_NUMBER]);
    expect(sprite).toEqual({ objectNumber: EGO_OBJECT_NUMBER, x: 38, y: 158, priority: 12 });
  });

  it('sorts back-to-front by priority so closer objects draw last (on top)', () => {
    const state = new VmState();
    state.setPosition(1, 0, 0);
    state.setPriority(1, 14);
    state.setPosition(2, 0, 0);
    state.setPriority(2, 4);
    state.setPosition(3, 0, 0);
    state.setPriority(3, 9);

    const sprites = collectSprites(state, [1, 2, 3]);
    expect(sprites.map((s) => s.objectNumber)).toEqual([2, 3, 1]);
  });
});

describe('colorForPriority', () => {
  it('returns a distinct colour for each usable priority band', () => {
    const colors = new Set();
    for (let p = MIN_PRIORITY; p <= MAX_PRIORITY; p++) {
      colors.add(colorForPriority(p));
    }
    expect(colors.size).toBe(MAX_PRIORITY - MIN_PRIORITY + 1);
  });

  it('clamps out-of-range priorities instead of throwing', () => {
    expect(() => colorForPriority(-5)).not.toThrow();
    expect(() => colorForPriority(99)).not.toThrow();
  });
});
