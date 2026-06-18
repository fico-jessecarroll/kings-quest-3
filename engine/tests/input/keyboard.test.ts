import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Direction, KeyboardInput } from '../../src/input/keyboard';
import { ReservedVar, VmState } from '../../src/vm/state';

describe('KeyboardInput direction-var updates', () => {
  let state: VmState;

  beforeEach(() => {
    state = new VmState();
  });

  function keyboard(): KeyboardInput {
    return new KeyboardInput({ state });
  }

  it('defaults to Stopped before any key is pressed', () => {
    expect(state.getVar(ReservedVar.EgoDirection)).toBe(Direction.Stopped);
  });

  it.each([
    ['ArrowUp', Direction.Up],
    ['ArrowDown', Direction.Down],
    ['ArrowLeft', Direction.Left],
    ['ArrowRight', Direction.Right],
  ] as const)('%s sets the direction var to %i', (key, direction) => {
    const input = keyboard();
    input.handleKeyDown(key);
    expect(state.getVar(ReservedVar.EgoDirection)).toBe(direction);
  });

  it.each([
    [['ArrowUp', 'ArrowRight'], Direction.UpRight],
    [['ArrowDown', 'ArrowRight'], Direction.DownRight],
    [['ArrowDown', 'ArrowLeft'], Direction.DownLeft],
    [['ArrowUp', 'ArrowLeft'], Direction.UpLeft],
  ] as const)('holding %j resolves to the diagonal %i', (keys, direction) => {
    const input = keyboard();
    for (const key of keys) input.handleKeyDown(key);
    expect(state.getVar(ReservedVar.EgoDirection)).toBe(direction);
  });

  it('opposite arrow keys held together cancel out to Stopped', () => {
    const input = keyboard();
    input.handleKeyDown('ArrowUp');
    input.handleKeyDown('ArrowDown');
    expect(state.getVar(ReservedVar.EgoDirection)).toBe(Direction.Stopped);

    input.handleKeyDown('ArrowLeft');
    input.handleKeyDown('ArrowRight');
    expect(state.getVar(ReservedVar.EgoDirection)).toBe(Direction.Stopped);
  });

  it('releasing one of two held keys falls back to the remaining direction', () => {
    const input = keyboard();
    input.handleKeyDown('ArrowUp');
    input.handleKeyDown('ArrowRight');
    expect(state.getVar(ReservedVar.EgoDirection)).toBe(Direction.UpRight);

    input.handleKeyUp('ArrowRight');
    expect(state.getVar(ReservedVar.EgoDirection)).toBe(Direction.Up);

    input.handleKeyUp('ArrowUp');
    expect(state.getVar(ReservedVar.EgoDirection)).toBe(Direction.Stopped);
  });

  it('ignores unmapped keys for direction purposes', () => {
    const input = keyboard();
    input.handleKeyDown('a');
    expect(state.getVar(ReservedVar.EgoDirection)).toBe(Direction.Stopped);
  });
});

describe('KeyboardInput accept.input/prevent.input gating', () => {
  let state: VmState;

  beforeEach(() => {
    state = new VmState();
  });

  it('ignores new direction key presses while prevent.input is active', () => {
    state.setInputEnabled(false);
    const input = new KeyboardInput({ state });

    input.handleKeyDown('ArrowUp');

    expect(state.getVar(ReservedVar.EgoDirection)).toBe(Direction.Stopped);
  });

  it('still processes key releases while prevent.input is active, so a held key cannot get stuck', () => {
    const input = new KeyboardInput({ state });
    input.handleKeyDown('ArrowUp');
    expect(state.getVar(ReservedVar.EgoDirection)).toBe(Direction.Up);

    state.setInputEnabled(false);
    input.handleKeyUp('ArrowUp');

    expect(state.getVar(ReservedVar.EgoDirection)).toBe(Direction.Stopped);
  });

  it('does not fire Enter/Escape/menu callbacks while prevent.input is active', () => {
    state.setInputEnabled(false);
    const onEnter = vi.fn();
    const onEscape = vi.fn();
    const onMenu = vi.fn();
    const input = new KeyboardInput({ state, onEnter, onEscape, onMenu });

    input.handleKeyDown('Enter');
    input.handleKeyDown('Escape');
    input.handleKeyDown('F10');

    expect(onEnter).not.toHaveBeenCalled();
    expect(onEscape).not.toHaveBeenCalled();
    expect(onMenu).not.toHaveBeenCalled();
  });
});

describe('KeyboardInput Enter/Escape/menu callbacks', () => {
  let state: VmState;

  beforeEach(() => {
    state = new VmState();
  });

  it('invokes onEnter on Enter and onEscape on Escape', () => {
    const onEnter = vi.fn();
    const onEscape = vi.fn();
    const input = new KeyboardInput({ state, onEnter, onEscape });

    input.handleKeyDown('Enter');
    input.handleKeyDown('Escape');

    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('invokes onMenu on the configured menu key, defaulting to F10', () => {
    const onMenu = vi.fn();
    const input = new KeyboardInput({ state, onMenu });

    input.handleKeyDown('F10');

    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it('honors a custom menuKey option', () => {
    const onMenu = vi.fn();
    const input = new KeyboardInput({ state, onMenu, menuKey: 'Tab' });

    input.handleKeyDown('F10');
    expect(onMenu).not.toHaveBeenCalled();

    input.handleKeyDown('Tab');
    expect(onMenu).toHaveBeenCalledTimes(1);
  });
});
