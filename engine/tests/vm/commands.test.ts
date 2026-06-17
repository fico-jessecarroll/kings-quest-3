import { describe, expect, it, vi } from 'vitest';
import { createCommands, tests as commandTests } from '../../src/vm/commands';
import { VmState } from '../../src/vm/state';
import type { CommandContext } from '../../src/vm/interpreter';

// F0 01: set visual colour 1. F2 0c: set priority colour 12.
// F6: absolute line (0,0)->(3,0) in both buffers. FF: end.
const SAMPLE_PIC_BYTES = Uint8Array.from([0xf0, 0x01, 0xf2, 0x0c, 0xf6, 0x00, 0x00, 0x03, 0x00, 0xff]);

function ctx(state: VmState, ...args: CommandContext['args']): CommandContext {
  return { state, args };
}

describe('createCommands: load.pic/draw.pic/show.pic/discard.pic', () => {
  it('load.pic records the picture number without touching the drawn buffers', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['load.pic'](ctx(state, 7));
    expect(state.getLoadedPictureNumber()).toBe(7);
    expect(state.getPictureBuffers()).toBeNull();
  });

  it('draw.pic decodes the resource via the PIC decoder and stores the visual+priority buffers', () => {
    const state = new VmState();
    const loadPictureResource = vi.fn((picture: number) => (picture === 7 ? SAMPLE_PIC_BYTES : undefined));
    const commands = createCommands({ loadPictureResource });

    commands['draw.pic'](ctx(state, 7));

    expect(loadPictureResource).toHaveBeenCalledWith(7);
    const buffers = state.getPictureBuffers();
    expect(buffers).not.toBeNull();
    expect(buffers!.visual[0]).toBe(1);
    expect(buffers!.priority[0]).toBe(12);
  });

  it('draw.pic logs once and leaves buffers untouched when the resource is missing', () => {
    const state = new VmState();
    const logger = vi.fn();
    const commands = createCommands({ loadPictureResource: () => undefined, logger });

    commands['draw.pic'](ctx(state, 99));
    commands['draw.pic'](ctx(state, 99));

    expect(state.getPictureBuffers()).toBeNull();
    expect(logger).toHaveBeenCalledTimes(1);
  });

  it('show.pic makes the drawn picture visible', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    expect(state.isPictureVisible()).toBe(false);
    commands['show.pic'](ctx(state));
    expect(state.isPictureVisible()).toBe(true);
  });

  it('discard.pic clears the loaded picture number but not the buffers already drawn on screen', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => SAMPLE_PIC_BYTES });

    commands['draw.pic'](ctx(state, 7));
    commands['load.pic'](ctx(state, 7));
    commands['discard.pic'](ctx(state, 7));

    expect(state.getLoadedPictureNumber()).toBeNull();
    expect(state.getPictureBuffers()).not.toBeNull();
  });
});

describe('createCommands: add.to.pic', () => {
  it('records the call (no view decoder exists yet to paint the cel)', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['add.to.pic'](ctx(state, 3, 0, 1, 10, 20, 8, 0));

    expect(state.getAddToPicCalls()).toEqual([{ view: 3, loop: 0, cel: 1, x: 10, y: 20, priority: 8, margin: 0 }]);
  });
});

describe('createCommands: print/print.at/display', () => {
  it('print records the message number', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['print'](ctx(state, 1));
    expect(state.getDisplay()).toEqual({ kind: 'print', message: 1 });
  });

  it('print.at records the message, row, col and width', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['print.at'](ctx(state, 16, 2, 2, 37));
    expect(state.getDisplay()).toEqual({ kind: 'print.at', message: 16, row: 2, col: 2, width: 37 });
  });

  it('display records the row, col and message', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['display'](ctx(state, 0, 20, 30));
    expect(state.getDisplay()).toEqual({ kind: 'display', message: 30, row: 0, col: 20 });
  });
});

describe('createCommands: set/reset/toggle/set.v/reset.v', () => {
  it('set turns a flag on, reset turns it off', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['set'](ctx(state, 10));
    expect(state.getFlag(10)).toBe(true);
    commands['reset'](ctx(state, 10));
    expect(state.getFlag(10)).toBe(false);
  });

  it('toggle flips a flag', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['toggle'](ctx(state, 10));
    expect(state.getFlag(10)).toBe(true);
    commands['toggle'](ctx(state, 10));
    expect(state.getFlag(10)).toBe(false);
  });

  it('set.v/reset.v set/reset the flag whose number is held in a var', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setVar(20, 45);

    commands['set.v'](ctx(state, 20));
    expect(state.getFlag(45)).toBe(true);
    commands['reset.v'](ctx(state, 20));
    expect(state.getFlag(45)).toBe(false);
  });
});

describe('createCommands: assign/addv/subv', () => {
  it('assign sets a var to an immediate value', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['assign'](ctx(state, 50, 123));
    expect(state.getVar(50)).toBe(123);
  });

  it('addv adds one var into another, wrapping at 256', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setVar(1, 250);
    state.setVar(2, 10);

    commands['addv'](ctx(state, 1, 2));
    expect(state.getVar(1)).toBe(4);
  });

  it('subv subtracts one var from another, wrapping below 0', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setVar(1, 5);
    state.setVar(2, 10);

    commands['subv'](ctx(state, 1, 2));
    expect(state.getVar(1)).toBe(251);
  });
});

describe('createCommands: position/position.v/get.posn', () => {
  it('position sets an object/ego coordinates directly', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['position'](ctx(state, 0, 38, 158));
    expect(state.getPosition(0)).toEqual({ x: 38, y: 158 });
  });

  it('position.v sets coordinates from two vars', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setVar(60, 38);
    state.setVar(61, 158);

    commands['position.v'](ctx(state, 0, 60, 61));
    expect(state.getPosition(0)).toEqual({ x: 38, y: 158 });
  });

  it('get.posn writes an object coordinates into two vars', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setPosition(0, 38, 158);

    commands['get.posn'](ctx(state, 0, 60, 61));
    expect(state.getVar(60)).toBe(38);
    expect(state.getVar(61)).toBe(158);
  });
});

describe('createCommands: set.priority/release.priority', () => {
  it('set.priority fixes the priority band, release.priority returns it to automatic', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['set.priority'](ctx(state, 0, 12));
    expect(state.getPriority(0)).toBe(12);
    commands['release.priority'](ctx(state, 0));
    expect(state.getPriority(0)).toBeNull();
  });
});

describe('createCommands: player.control/program.control/prevent.input/accept.input', () => {
  it('switches ego control mode', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['program.control'](ctx(state));
    expect(state.getEgoControlMode()).toBe('program');
    commands['player.control'](ctx(state));
    expect(state.getEgoControlMode()).toBe('player');
  });

  it('enables/disables input', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['prevent.input'](ctx(state));
    expect(state.isInputEnabled()).toBe(false);
    commands['accept.input'](ctx(state));
    expect(state.isInputEnabled()).toBe(true);
  });
});

describe('createCommands: new.room is intentionally excluded', () => {
  it('does not export new.room, leaving the interpreter built-in (which can abort the cycle) in place', () => {
    const commands = createCommands({ loadPictureResource: () => undefined });
    expect(commands['new.room']).toBeUndefined();
  });
});

describe('tests.posn', () => {
  it('is true when the object sits within the given box', () => {
    const state = new VmState();
    state.setPosition(0, 50, 100);

    expect(commandTests['posn'](ctx(state, 0, 45, 95, 55, 105))).toBe(true);
  });

  it('is false when the object sits outside the given box', () => {
    const state = new VmState();
    state.setPosition(0, 200, 100);

    expect(commandTests['posn'](ctx(state, 0, 45, 95, 55, 105))).toBe(false);
  });
});
