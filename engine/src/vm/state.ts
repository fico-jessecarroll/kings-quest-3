export const FLAG_COUNT = 256;
export const VAR_COUNT = 256;
export const BYTE_MAX = 255;
export const STRING_REGISTER_COUNT = 12;

/**
 * Room number AGI uses to mean "ego is carrying this object" rather than it
 * sitting in a room. Confirmed by this game's own source: SRC/GAMEDEFS.H
 * defines `inventory = 255`, and object.room() returns it for carried items.
 */
export const CARRIED = 255;

/**
 * Indices for the vars the AGI interpreter itself reads and writes every
 * tick (current room, score, ego motion, parser state, etc). Per AGI
 * convention only the interpreter may use vars/flags 0-29; game logic owns
 * 30-219, individual rooms reuse 220-239, and dynamic logics reuse 240-255 -
 * see SRC/GAMEDEFS.H and SRC/DEFINES.AL in this repo for this game's own
 * statement of that convention.
 */
export enum ReservedVar {
  CurrentRoom = 0,
  PreviousRoom = 1,
  EgoBorderTouched = 2,
  Score = 3,
  ObjectBorderTouched = 4,
  ObjectBorderCode = 5,
  EgoDirection = 6,
  MaxScore = 7,
  MemoryLeft = 8,
  UnknownWordNumber = 9,
  TimeDelay = 10,
  Seconds = 11,
  Minutes = 12,
  Hours = 13,
  Days = 14,
  JoystickSensitivity = 15,
  EgoViewResource = 16,
}

/**
 * Indices for the flags the AGI interpreter itself sets every tick, per
 * this game's own SRC/SYSDEFS. `HaveInput` is the one the parser sets when
 * the player has entered a new command, for room logics to test directly
 * (e.g. `if (have.input)`).
 */
export enum ReservedFlag {
  OnWater = 0,
  EgoHidden = 1,
  HaveInput = 2,
  HitSpecial = 3,
  HaveMatch = 4,
  InitLogs = 5,
  RestartInProgress = 6,
  NoScript = 7,
  EnableDoubleClick = 8,
  SoundOn = 9,
  EnableTrace = 10,
  HasNoiseChannel = 11,
  RestoreInProgress = 12,
  EnableObjectSelect = 13,
  EnableMenu = 14,
  LeaveWindow = 15,
  NoPromptRestart = 16,
}

export const INTERPRETER_RESERVED_RANGE = { first: 0, last: 29 } as const;
export const ROOM_LOCAL_RANGE = { first: 220, last: 239 } as const;
export const DYNAMIC_LOCAL_RANGE = { first: 240, last: 255 } as const;

export type EgoControlMode = 'player' | 'program';

function assertIndex(index: number, count: number, label: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`${label} index out of range: ${index} (expected 0-${count - 1})`);
  }
}

function assertByteValue(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > BYTE_MAX) {
    throw new RangeError(`${label} value out of range: ${value} (expected 0-${BYTE_MAX})`);
  }
}

/**
 * Holds the full mutable state of one AGI interpreter instance: the 256
 * flags and 256 vars scripts address directly, plus the handful of concepts
 * AGI tracks outside that array (score, sound/input enables, which room each
 * inventory object currently sits in or whether ego carries it, string
 * registers, current room, and ego's control mode).
 */
export class VmState {
  private readonly flags = new Uint8Array(FLAG_COUNT);
  private readonly vars = new Uint8Array(VAR_COUNT);
  private readonly objectRoom = new Map<number, number>();
  private readonly strings: string[] = new Array(STRING_REGISTER_COUNT).fill('');

  private soundEnabled = true;
  private inputEnabled = true;
  private egoControlMode: EgoControlMode = 'player';

  getFlag(index: number): boolean {
    assertIndex(index, FLAG_COUNT, 'flag');
    return this.flags[index] === 1;
  }

  setFlag(index: number, value = true): void {
    assertIndex(index, FLAG_COUNT, 'flag');
    this.flags[index] = value ? 1 : 0;
  }

  resetFlag(index: number): void {
    this.setFlag(index, false);
  }

  toggleFlag(index: number): void {
    this.setFlag(index, !this.getFlag(index));
  }

  getVar(index: number): number {
    assertIndex(index, VAR_COUNT, 'var');
    return this.vars[index];
  }

  setVar(index: number, value: number): void {
    assertIndex(index, VAR_COUNT, 'var');
    assertByteValue(value, 'var');
    this.vars[index] = value;
  }

  getCurrentRoom(): number {
    return this.getVar(ReservedVar.CurrentRoom);
  }

  setCurrentRoom(room: number): void {
    this.setVar(ReservedVar.CurrentRoom, room);
  }

  getScore(): number {
    return this.getVar(ReservedVar.Score);
  }

  setScore(score: number): void {
    this.setVar(ReservedVar.Score, score);
  }

  getMaxScore(): number {
    return this.getVar(ReservedVar.MaxScore);
  }

  setMaxScore(score: number): void {
    this.setVar(ReservedVar.MaxScore, score);
  }

  isSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
  }

  isInputEnabled(): boolean {
    return this.inputEnabled;
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
  }

  getEgoControlMode(): EgoControlMode {
    return this.egoControlMode;
  }

  setEgoControlMode(mode: EgoControlMode): void {
    this.egoControlMode = mode;
  }

  /** Room the given object currently occupies, or {@link CARRIED} if ego holds it. Untouched objects default to room 0. */
  getObjectRoom(objectNumber: number): number {
    assertIndex(objectNumber, VAR_COUNT, 'object');
    return this.objectRoom.get(objectNumber) ?? 0;
  }

  setObjectRoom(objectNumber: number, room: number): void {
    assertIndex(objectNumber, VAR_COUNT, 'object');
    assertByteValue(room, 'room');
    this.objectRoom.set(objectNumber, room);
  }

  isCarried(objectNumber: number): boolean {
    return this.getObjectRoom(objectNumber) === CARRIED;
  }

  takeObject(objectNumber: number): void {
    this.setObjectRoom(objectNumber, CARRIED);
  }

  dropObject(objectNumber: number, room: number): void {
    this.setObjectRoom(objectNumber, room);
  }

  getString(index: number): string {
    assertIndex(index, STRING_REGISTER_COUNT, 'string register');
    return this.strings[index];
  }

  setString(index: number, value: string): void {
    assertIndex(index, STRING_REGISTER_COUNT, 'string register');
    this.strings[index] = value;
  }
}
