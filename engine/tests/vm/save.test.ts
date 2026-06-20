import { describe, expect, it } from 'vitest';
import { DEFAULT_SAVE_KEY, restoreGame, saveGame, type SaveStorage } from '../../src/vm/save';
import { VmState } from '../../src/vm/state';

function createFakeStorage(initial: Record<string, string> = {}): SaveStorage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('saveGame/restoreGame', () => {
  it('round-trips a full VM state through storage', () => {
    const storage = createFakeStorage();
    const state = new VmState();
    state.setFlag(10, true);
    state.setVar(50, 123);
    state.setCurrentRoom(12);
    state.setScore(7);
    state.setObjectRoom(3, 12);
    state.takeObject(4);

    saveGame(storage, state);

    const restored = new VmState();
    expect(restoreGame(storage, restored)).toBe(true);

    expect(restored.serialize()).toEqual(state.serialize());
  });

  it('writes JSON under the default key', () => {
    const storage = createFakeStorage();
    saveGame(storage, new VmState());

    expect(storage.data[DEFAULT_SAVE_KEY]).toBeDefined();
    expect(() => JSON.parse(storage.data[DEFAULT_SAVE_KEY])).not.toThrow();
  });

  it('supports independent save slots via a custom key', () => {
    const storage = createFakeStorage();
    const slotA = new VmState();
    slotA.setCurrentRoom(1);
    const slotB = new VmState();
    slotB.setCurrentRoom(2);

    saveGame(storage, slotA, 'slot-a');
    saveGame(storage, slotB, 'slot-b');

    const restoredA = new VmState();
    restoreGame(storage, restoredA, 'slot-a');
    const restoredB = new VmState();
    restoreGame(storage, restoredB, 'slot-b');

    expect(restoredA.getCurrentRoom()).toBe(1);
    expect(restoredB.getCurrentRoom()).toBe(2);
  });

  it('restoring into a fresh VM resumes the correct room', () => {
    const storage = createFakeStorage();
    const state = new VmState();
    state.setCurrentRoom(99);
    saveGame(storage, state);

    const fresh = new VmState();
    expect(fresh.getCurrentRoom()).toBe(0);
    expect(restoreGame(storage, fresh)).toBe(true);
    expect(fresh.getCurrentRoom()).toBe(99);
  });

  it('returns false and leaves state untouched when nothing is saved', () => {
    const storage = createFakeStorage();
    const state = new VmState();
    state.setCurrentRoom(5);

    expect(restoreGame(storage, state)).toBe(false);
    expect(state.getCurrentRoom()).toBe(5);
  });

  it('returns false and leaves state untouched when the saved value is not valid JSON', () => {
    const storage = createFakeStorage({ [DEFAULT_SAVE_KEY]: '{not json' });
    const state = new VmState();
    state.setCurrentRoom(5);

    expect(restoreGame(storage, state)).toBe(false);
    expect(state.getCurrentRoom()).toBe(5);
  });

  it.each([
    ['missing fields', '{}'],
    ['wrong-length flags array', JSON.stringify({ flags: [1], vars: new Array(256).fill(0), objectRooms: [] })],
    ['non-numeric vars entry', JSON.stringify({ flags: new Array(256).fill(0), vars: new Array(256).fill('x'), objectRooms: [] })],
    ['malformed objectRooms entries', JSON.stringify({ flags: new Array(256).fill(0), vars: new Array(256).fill(0), objectRooms: [[1]] })],
    ['a JSON array instead of an object', '[]'],
    ['a JSON primitive', '"oops"'],
  ])('returns false and leaves state untouched for %s', (_label, raw) => {
    const storage = createFakeStorage({ [DEFAULT_SAVE_KEY]: raw });
    const state = new VmState();
    state.setCurrentRoom(5);

    expect(restoreGame(storage, state)).toBe(false);
    expect(state.getCurrentRoom()).toBe(5);
  });
});
