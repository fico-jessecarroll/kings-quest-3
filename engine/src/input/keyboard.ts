/**
 * Keyboard input: tracks which arrow keys are currently held (the way AGI's
 * own keyboard driver does) to drive ego's direction var, including the
 * eight-way diagonals from holding two adjacent arrows at once. Also
 * dispatches Enter, Escape, and a menu key to caller-supplied callbacks, and
 * records every keydown on {@link VmState} for the `have.key` test.
 *
 * New key presses are ignored while `prevent.input` is active
 * (`VmState.isInputEnabled() === false`) - see `accept.input`/
 * `prevent.input` in src/vm/commands.ts. Key releases are always processed
 * regardless of that state, so a direction key already held when input gets
 * disabled doesn't leave ego stuck walking after it's released.
 */

import { ReservedVar } from '../vm/state';
import type { VmState } from '../vm/state';

/** AGI's own encoding for var 6 (ego.dir): clockwise from north, 0 is stopped. */
export enum Direction {
  Stopped = 0,
  Up = 1,
  UpRight = 2,
  Right = 3,
  DownRight = 4,
  Down = 5,
  DownLeft = 6,
  Left = 7,
  UpLeft = 8,
}

const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;
type ArrowKey = (typeof ARROW_KEYS)[number];

function isArrowKey(key: string): key is ArrowKey {
  return (ARROW_KEYS as readonly string[]).includes(key);
}

/** Resolves the currently-held arrow keys to a single compound direction; opposite pairs (e.g. up+down) cancel out. */
function resolveDirection(held: Record<ArrowKey, boolean>): Direction {
  const vertical = held.ArrowUp === held.ArrowDown ? 0 : held.ArrowUp ? -1 : 1;
  const horizontal = held.ArrowLeft === held.ArrowRight ? 0 : held.ArrowLeft ? -1 : 1;

  if (vertical === -1 && horizontal === 0) return Direction.Up;
  if (vertical === -1 && horizontal === 1) return Direction.UpRight;
  if (vertical === 0 && horizontal === 1) return Direction.Right;
  if (vertical === 1 && horizontal === 1) return Direction.DownRight;
  if (vertical === 1 && horizontal === 0) return Direction.Down;
  if (vertical === 1 && horizontal === -1) return Direction.DownLeft;
  if (vertical === 0 && horizontal === -1) return Direction.Left;
  if (vertical === -1 && horizontal === -1) return Direction.UpLeft;
  return Direction.Stopped;
}

export interface KeyboardInputOptions {
  state: VmState;
  /** Key that opens the in-game menu, as `KeyboardEvent.key` would report it. Defaults to "F10", matching real AGI. */
  menuKey?: string;
  onEnter?: () => void;
  onEscape?: () => void;
  onMenu?: () => void;
}

/** Maps raw key events to ego's direction var plus Enter/Esc/menu callbacks. Takes plain key-name strings so it's testable without any DOM; src/main.ts wires real `KeyboardEvent`s to `handleKeyDown`/`handleKeyUp`. */
export class KeyboardInput {
  private readonly state: VmState;
  private readonly menuKey: string;
  private readonly onEnter?: () => void;
  private readonly onEscape?: () => void;
  private readonly onMenu?: () => void;
  private readonly held: Record<ArrowKey, boolean> = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
  };

  constructor(options: KeyboardInputOptions) {
    this.state = options.state;
    this.menuKey = options.menuKey ?? 'F10';
    this.onEnter = options.onEnter;
    this.onEscape = options.onEscape;
    this.onMenu = options.onMenu;
  }

  handleKeyDown(key: string): void {
    if (!this.state.isInputEnabled()) {
      return;
    }
    this.state.recordKeyPress();
    if (isArrowKey(key)) {
      this.held[key] = true;
      this.updateDirection();
      return;
    }
    if (key === 'Enter') {
      this.onEnter?.();
    } else if (key === 'Escape') {
      this.onEscape?.();
    } else if (key === this.menuKey) {
      this.onMenu?.();
    }
  }

  handleKeyUp(key: string): void {
    if (isArrowKey(key)) {
      this.held[key] = false;
      this.updateDirection();
    }
  }

  private updateDirection(): void {
    this.state.setVar(ReservedVar.EgoDirection, resolveDirection(this.held));
  }
}
