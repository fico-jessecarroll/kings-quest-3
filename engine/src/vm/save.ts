/**
 * Persists a {@link VmState} snapshot to a `localStorage`-shaped store and
 * restores it back, backing the `save.game`/`restore.game` commands (wired
 * up in {@link ../vm/commands}) that AGI's File menu Save/Restore items
 * trigger via the `c.save`/`c.restore` controllers (see SRC/RM0.CG).
 */

import { FLAG_COUNT, VAR_COUNT, VmState, type VmStateSnapshot } from './state';

export const DEFAULT_SAVE_KEY = 'kq3-save';

/** The slice of the DOM `Storage` interface this module needs - small enough to fake in tests without a full localStorage polyfill. */
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isObjectRoomEntry(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number');
}

/** Guards against corrupt/foreign data in the save slot - wrong shape, wrong lengths, or non-numeric entries all fail validation rather than partially applying. */
function isValidSnapshot(value: unknown): value is VmStateSnapshot {
  if (!value || typeof value !== 'object') return false;
  const { flags, vars, objectRooms } = value as Record<string, unknown>;
  if (!Array.isArray(flags) || flags.length !== FLAG_COUNT || !flags.every((f) => typeof f === 'number')) return false;
  if (!Array.isArray(vars) || vars.length !== VAR_COUNT || !vars.every((v) => typeof v === 'number')) return false;
  if (!Array.isArray(objectRooms) || !objectRooms.every(isObjectRoomEntry)) return false;
  return true;
}

/** Serialises `state` and writes it to `storage` under `key`. */
export function saveGame(storage: SaveStorage, state: VmState, key: string = DEFAULT_SAVE_KEY): void {
  storage.setItem(key, JSON.stringify(state.serialize()));
}

/**
 * Reads `key` from `storage` and applies it to `state`. Returns false - and
 * leaves `state` untouched - if there's nothing saved under `key`, the
 * stored value isn't valid JSON, or it doesn't match the expected snapshot
 * shape.
 */
export function restoreGame(storage: SaveStorage, state: VmState, key: string = DEFAULT_SAVE_KEY): boolean {
  const raw = storage.getItem(key);
  if (raw === null) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }

  if (!isValidSnapshot(parsed)) return false;

  state.restore(parsed);
  return true;
}
