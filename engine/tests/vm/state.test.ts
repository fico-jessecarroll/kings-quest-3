import { describe, expect, it } from 'vitest';
import { CARRIED, FLAG_COUNT, ReservedVar, VAR_COUNT, VmState } from '../../src/vm/state';

describe('VmState flags', () => {
  it('defaults every flag to false', () => {
    const state = new VmState();
    expect(state.getFlag(0)).toBe(false);
    expect(state.getFlag(255)).toBe(false);
  });

  it('sets and resets a flag', () => {
    const state = new VmState();
    state.setFlag(40);
    expect(state.getFlag(40)).toBe(true);
    state.resetFlag(40);
    expect(state.getFlag(40)).toBe(false);
  });

  it('toggles a flag', () => {
    const state = new VmState();
    state.toggleFlag(40);
    expect(state.getFlag(40)).toBe(true);
    state.toggleFlag(40);
    expect(state.getFlag(40)).toBe(false);
  });

  it('accepts the boundary indices 0 and 255', () => {
    const state = new VmState();
    expect(() => state.setFlag(0)).not.toThrow();
    expect(() => state.setFlag(255)).not.toThrow();
  });

  it('throws on out-of-range flag indices', () => {
    const state = new VmState();
    expect(() => state.getFlag(-1)).toThrow(RangeError);
    expect(() => state.getFlag(FLAG_COUNT)).toThrow(RangeError);
    expect(() => state.setFlag(-1)).toThrow(RangeError);
    expect(() => state.setFlag(FLAG_COUNT)).toThrow(RangeError);
    expect(() => state.toggleFlag(256)).toThrow(RangeError);
  });
});

describe('VmState vars', () => {
  it('defaults every var to 0', () => {
    const state = new VmState();
    expect(state.getVar(0)).toBe(0);
    expect(state.getVar(255)).toBe(0);
  });

  it('sets and reads back a var', () => {
    const state = new VmState();
    state.setVar(50, 123);
    expect(state.getVar(50)).toBe(123);
  });

  it('accepts the boundary indices and values of 0 and 255', () => {
    const state = new VmState();
    expect(() => state.setVar(0, 0)).not.toThrow();
    expect(() => state.setVar(255, 255)).not.toThrow();
    expect(state.getVar(255)).toBe(255);
  });

  it('throws on out-of-range var indices', () => {
    const state = new VmState();
    expect(() => state.getVar(-1)).toThrow(RangeError);
    expect(() => state.getVar(VAR_COUNT)).toThrow(RangeError);
    expect(() => state.setVar(-1, 0)).toThrow(RangeError);
    expect(() => state.setVar(VAR_COUNT, 0)).toThrow(RangeError);
  });

  it('throws on out-of-range var values', () => {
    const state = new VmState();
    expect(() => state.setVar(50, -1)).toThrow(RangeError);
    expect(() => state.setVar(50, 256)).toThrow(RangeError);
    expect(() => state.setVar(50, 1.5)).toThrow(RangeError);
  });
});

describe('VmState reserved vars', () => {
  it('defaults current room and score to 0', () => {
    const state = new VmState();
    expect(state.getCurrentRoom()).toBe(0);
    expect(state.getScore()).toBe(0);
    expect(state.getMaxScore()).toBe(0);
  });

  it('maps named accessors onto the documented reserved var indices', () => {
    const state = new VmState();
    state.setCurrentRoom(12);
    expect(state.getVar(ReservedVar.CurrentRoom)).toBe(12);

    state.setScore(7);
    expect(state.getVar(ReservedVar.Score)).toBe(7);

    state.setMaxScore(254);
    expect(state.getVar(ReservedVar.MaxScore)).toBe(254);
  });

  it('keeps the reserved var indices stable (0-29 is the interpreter-only range)', () => {
    expect(ReservedVar.CurrentRoom).toBe(0);
    expect(ReservedVar.PreviousRoom).toBe(1);
    expect(ReservedVar.Score).toBe(3);
    expect(ReservedVar.MaxScore).toBe(7);
  });
});

describe('VmState sound and input enables', () => {
  it('defaults sound and input to enabled', () => {
    const state = new VmState();
    expect(state.isSoundEnabled()).toBe(true);
    expect(state.isInputEnabled()).toBe(true);
  });

  it('can disable and re-enable sound and input independently', () => {
    const state = new VmState();
    state.setSoundEnabled(false);
    expect(state.isSoundEnabled()).toBe(false);
    expect(state.isInputEnabled()).toBe(true);

    state.setInputEnabled(false);
    expect(state.isInputEnabled()).toBe(false);
  });
});

describe('VmState ego control mode', () => {
  it('defaults to player control', () => {
    const state = new VmState();
    expect(state.getEgoControlMode()).toBe('player');
  });

  it('switches to program control and back', () => {
    const state = new VmState();
    state.setEgoControlMode('program');
    expect(state.getEgoControlMode()).toBe('program');
    state.setEgoControlMode('player');
    expect(state.getEgoControlMode()).toBe('player');
  });
});

describe('VmState inventory ownership', () => {
  it('defaults an untouched object to room 0', () => {
    const state = new VmState();
    expect(state.getObjectRoom(13)).toBe(0);
    expect(state.isCarried(13)).toBe(false);
  });

  it('moves an object from a room into ego inventory and back out', () => {
    const state = new VmState();
    state.setObjectRoom(13, 22);
    expect(state.getObjectRoom(13)).toBe(22);
    expect(state.isCarried(13)).toBe(false);

    state.takeObject(13);
    expect(state.isCarried(13)).toBe(true);
    expect(state.getObjectRoom(13)).toBe(CARRIED);

    state.dropObject(13, 45);
    expect(state.isCarried(13)).toBe(false);
    expect(state.getObjectRoom(13)).toBe(45);
  });

  it('treats room 255 as the carried sentinel', () => {
    expect(CARRIED).toBe(255);
  });

  it('throws on out-of-range object numbers and rooms', () => {
    const state = new VmState();
    expect(() => state.getObjectRoom(-1)).toThrow(RangeError);
    expect(() => state.getObjectRoom(256)).toThrow(RangeError);
    expect(() => state.setObjectRoom(13, -1)).toThrow(RangeError);
    expect(() => state.setObjectRoom(13, 256)).toThrow(RangeError);
    expect(() => state.setObjectRoom(-1, 0)).toThrow(RangeError);
  });

  it('accepts the boundary object numbers and rooms of 0 and 255', () => {
    const state = new VmState();
    expect(() => state.setObjectRoom(0, 0)).not.toThrow();
    expect(() => state.setObjectRoom(255, 255)).not.toThrow();
  });
});

describe('VmState string registers', () => {
  it('defaults every string register to an empty string', () => {
    const state = new VmState();
    expect(state.getString(0)).toBe('');
  });

  it('sets and reads back a string register', () => {
    const state = new VmState();
    state.setString(1, 'Gwydion');
    expect(state.getString(1)).toBe('Gwydion');
  });

  it('throws on out-of-range string register indices', () => {
    const state = new VmState();
    expect(() => state.getString(-1)).toThrow(RangeError);
    expect(() => state.setString(-1, 'x')).toThrow(RangeError);
  });
});
