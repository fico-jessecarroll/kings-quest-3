import { describe, expect, it, vi } from 'vitest';
import { createCommands, tests as commandTests } from '../../src/vm/commands';
import { VmState } from '../../src/vm/state';
import type { CommandContext } from '../../src/vm/interpreter';

// F0 01: set visual colour 1. F2 0c: set priority colour 12.
// F6: absolute line (0,0)->(3,0) in both buffers. FF: end.
const SAMPLE_PIC_BYTES = Uint8Array.from([0xf0, 0x01, 0xf2, 0x0c, 0xf6, 0x00, 0x00, 0x03, 0x00, 0xff]);

// Same shape as SAMPLE_PIC_BYTES but drawing a disjoint line (5,0)->(8,0) in
// different colours, for exercising overlay.pic's merge against the buffers
// SAMPLE_PIC_BYTES already drew.
const OVERLAY_PIC_BYTES = Uint8Array.from([0xf0, 0x02, 0xf2, 0x09, 0xf6, 0x05, 0x00, 0x08, 0x00, 0xff]);

function ctx(state: VmState, ...args: CommandContext['args']): CommandContext {
  return { state, args };
}

/** Minimal in-memory stand-in for `localStorage` (the test environment is Node, which has no DOM globals). */
function createFakeStorage(initial: Record<string, string> = {}): { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
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

describe('createCommands: overlay.pic', () => {
  it('draws onto whatever is already on screen instead of replacing it', () => {
    const state = new VmState();
    const loadPictureResource = vi.fn((picture: number) => (picture === 1 ? SAMPLE_PIC_BYTES : OVERLAY_PIC_BYTES));
    const commands = createCommands({ loadPictureResource });

    commands['draw.pic'](ctx(state, 1));
    commands['overlay.pic'](ctx(state, 2));

    const buffers = state.getPictureBuffers()!;
    // The original line (0-3) survives the overlay...
    expect(buffers.visual[0]).toBe(1);
    expect(buffers.priority[0]).toBe(12);
    // ...and the overlay's own line (5-8) is now drawn on top of it.
    expect(buffers.visual[5]).toBe(2);
    expect(buffers.priority[5]).toBe(9);
  });

  it('with nothing drawn yet, behaves like draw.pic onto a blank screen', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => OVERLAY_PIC_BYTES });

    commands['overlay.pic'](ctx(state, 2));

    const buffers = state.getPictureBuffers()!;
    expect(buffers.visual[5]).toBe(2);
    expect(buffers.priority[5]).toBe(9);
  });

  it('logs once and leaves buffers untouched when the resource is missing', () => {
    const state = new VmState();
    const logger = vi.fn();
    const commands = createCommands({ loadPictureResource: () => undefined, logger });

    commands['overlay.pic'](ctx(state, 99));
    commands['overlay.pic'](ctx(state, 99));

    expect(state.getPictureBuffers()).toBeNull();
    expect(logger).toHaveBeenCalledTimes(1);
  });
});

describe('createCommands: add.to.pic', () => {
  it('records the call (no view decoder exists yet to paint the cel)', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['add.to.pic'](ctx(state, 3, 0, 1, 10, 20, 8, 0));

    expect(state.getAddToPicCalls()).toEqual([{ view: 3, loop: 0, cel: 1, x: 10, y: 20, priority: 8, margin: 0 }]);
  });

  it('add.to.pic.f/add.to.pic.v resolve every argument from a var', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    for (const [varIndex, value] of [[60, 3], [61, 0], [62, 1], [63, 10], [64, 20], [65, 8], [66, 0]] as const) {
      state.setVar(varIndex, value);
    }

    commands['add.to.pic.f'](ctx(state, 60, 61, 62, 63, 64, 65, 66));
    expect(state.getAddToPicCalls()).toEqual([{ view: 3, loop: 0, cel: 1, x: 10, y: 20, priority: 8, margin: 0 }]);

    commands['add.to.pic.v'](ctx(state, 60, 61, 62, 63, 64, 65, 66));
    expect(state.getAddToPicCalls()).toHaveLength(2);
  });

  it('add.to.picture.v is the same var-indexed implementation', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    expect(commands['add.to.picture.v']).toBe(commands['add.to.pic.f']);
  });
});

describe('createCommands: print/print.at/display', () => {
  it('print records the message number', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['print'](ctx(state, 1));
    expect(state.getDisplay()).toEqual({ kind: 'print', message: 1 });
  });

  it('print.f/print.v resolve the message number from a var', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setVar(36, 1);

    commands['print.f'](ctx(state, 36));
    expect(state.getDisplay()).toEqual({ kind: 'print', message: 1 });

    state.setVar(37, 5);
    commands['print.v'](ctx(state, 37));
    expect(state.getDisplay()).toEqual({ kind: 'print', message: 5 });
  });

  it('print.at records the message, row, col and width', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['print.at'](ctx(state, 16, 2, 2, 37));
    expect(state.getDisplay()).toEqual({ kind: 'print.at', message: 16, row: 2, col: 2, width: 37 });
  });

  it('print.at.v resolves only the message number from a var, leaving row/col/width literal', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setVar(36, 16);

    commands['print.at.v'](ctx(state, 36, 2, 2, 37));
    expect(state.getDisplay()).toEqual({ kind: 'print.at', message: 16, row: 2, col: 2, width: 37 });
  });

  it('display records the row, col and message', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['display'](ctx(state, 0, 20, 30));
    expect(state.getDisplay()).toEqual({ kind: 'display', message: 30, row: 0, col: 20 });
  });

  it('display.f resolves row, col and message all from vars', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setVar(38, 0);
    state.setVar(37, 20);
    state.setVar(36, 30);

    commands['display.f'](ctx(state, 38, 37, 36));
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

  it('position.f is the same var-indexed implementation as position.v', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    expect(commands['position.f']).toBe(commands['position.v']);
  });

  it('get.posn writes an object coordinates into two vars', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setPosition(0, 38, 158);

    commands['get.posn'](ctx(state, 0, 60, 61));
    expect(state.getVar(60)).toBe(38);
    expect(state.getVar(61)).toBe(158);
  });

  it('get.position is the same implementation as get.posn', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    expect(commands['get.position']).toBe(commands['get.posn']);
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

  it('set.priority.f/set.priority.v resolve the priority from a var, with the object still a literal', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setVar(60, 12);

    commands['set.priority.f'](ctx(state, 0, 60));
    expect(state.getPriority(0)).toBe(12);

    state.setVar(61, 5);
    commands['set.priority.v'](ctx(state, 3, 61));
    expect(state.getPriority(3)).toBe(5);
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

describe('tests.obj.in.box', () => {
  it('behaves identically to posn (same box-containment check, for an arbitrary object)', () => {
    const state = new VmState();
    state.setPosition(3, 50, 100);

    expect(commandTests['obj.in.box'](ctx(state, 3, 45, 95, 55, 105))).toBe(true);
    expect(commandTests['obj.in.box'](ctx(state, 3, 0, 0, 10, 10))).toBe(false);
  });
});

describe('createCommands: get/drop/put/get.room.f', () => {
  it('get takes a literal object into inventory', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['get'](ctx(state, 13));
    expect(state.isCarried(13)).toBe(true);
  });

  it('get.f/get.v resolve the object number from a var', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setVar(36, 13);

    commands['get.f'](ctx(state, 36));
    expect(state.isCarried(13)).toBe(true);

    state.setVar(37, 14);
    commands['get.v'](ctx(state, 37));
    expect(state.isCarried(14)).toBe(true);
  });

  it('drop sets the literal object room to 0, regardless of the current room', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.takeObject(13);

    commands['drop'](ctx(state, 13));
    expect(state.isCarried(13)).toBe(false);
    expect(state.getObjectRoom(13)).toBe(0);
  });

  it('put drops a literal object into the room held by a var (room is always var-encoded)', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setVar(0, 22); // e.g. current.room

    commands['put'](ctx(state, 13, 0));
    expect(state.getObjectRoom(13)).toBe(22);
  });

  it('put.f/put.v resolve both the object and the room from vars', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setVar(36, 13);
    state.setVar(37, 22);

    commands['put.f'](ctx(state, 36, 37));
    expect(state.getObjectRoom(13)).toBe(22);
  });

  it('get.room.f/get.room.v resolve the object from a var and write its room into another var', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setObjectRoom(13, 22);
    state.setVar(36, 13);

    commands['get.room.f'](ctx(state, 36, 60));
    expect(state.getVar(60)).toBe(22);
  });
});

describe('tests.has/obj.in.room', () => {
  it('has is true once the object has been taken', () => {
    const state = new VmState();
    state.takeObject(13);
    expect(commandTests['has'](ctx(state, 13))).toBe(true);
    expect(commandTests['has'](ctx(state, 14))).toBe(false);
  });

  it('obj.in.room compares the object room against a var (always var-encoded)', () => {
    const state = new VmState();
    state.setObjectRoom(13, 22);
    state.setVar(0, 22);

    expect(commandTests['obj.in.room'](ctx(state, 13, 0))).toBe(true);

    state.setVar(0, 23);
    expect(commandTests['obj.in.room'](ctx(state, 13, 0))).toBe(false);
  });
});

describe('createCommands: draw/erase', () => {
  it('defaults an object to not visible, draw shows it, erase hides it', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    expect(state.isObjectVisible(3)).toBe(false);
    commands['draw'](ctx(state, 3));
    expect(state.isObjectVisible(3)).toBe(true);
    commands['erase'](ctx(state, 3));
    expect(state.isObjectVisible(3)).toBe(false);
  });
});

describe('createCommands: random', () => {
  it('writes a value in [low, high] into the target var, using the injected RNG', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined, random: () => 0.999 });

    commands['random'](ctx(state, 10, 20, 60));
    expect(state.getVar(60)).toBe(20);
  });

  it('defaults to Math.random when none is injected', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['random'](ctx(state, 5, 5, 60));
    expect(state.getVar(60)).toBe(5);
  });
});

describe('createCommands: distance', () => {
  it('writes the Manhattan distance between two objects into a var', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setPosition(0, 10, 10);
    state.setPosition(3, 14, 17);

    commands['distance'](ctx(state, 0, 3, 60));
    expect(state.getVar(60)).toBe(11);
  });

  it('clamps to 255', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setPosition(0, 0, 0);
    state.setPosition(3, 159, 167);

    commands['distance'](ctx(state, 0, 3, 60));
    expect(state.getVar(60)).toBe(255);
  });
});

describe('createCommands: addn/subn', () => {
  it('addn adds an immediate constant to a var, wrapping at 256', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setVar(1, 250);

    commands['addn'](ctx(state, 1, 10));
    expect(state.getVar(1)).toBe(4);
  });

  it('subn subtracts an immediate constant from a var, wrapping below 0', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setVar(1, 5);

    commands['subn'](ctx(state, 1, 10));
    expect(state.getVar(1)).toBe(251);
  });
});

describe('createCommands: set.text.attribute', () => {
  it('sets the foreground/background colours', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['set.text.attribute'](ctx(state, 4, 12));
    expect(state.getTextAttribute()).toEqual({ foreground: 4, background: 12 });
  });
});

describe('createCommands: set.key and tests.controller', () => {
  it('set.key maps an ascii/scan code pair to a controller number', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['set.key'](ctx(state, 0, 59, 7));
    expect(state.getControllerForKey(0, 59)).toBe(7);
  });

  it('controller test reads whether that controller is currently active', () => {
    const state = new VmState();
    state.setControllerActive(7, true);
    expect(commandTests['controller'](ctx(state, 7))).toBe(true);
    expect(commandTests['controller'](ctx(state, 8))).toBe(false);
  });
});

describe('createCommands: set.menu/set.menu.item/enable.item/disable.item/submit.menu', () => {
  it('builds up a menu registry', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['set.menu'](ctx(state, 121));
    commands['set.menu.item'](ctx(state, 122, 5));
    commands['disable.item'](ctx(state, 5));

    expect(state.getMenus()).toEqual([{ message: 121, items: [{ message: 122, controller: 5, enabled: false }] }]);

    commands['enable.item'](ctx(state, 5));
    expect(state.getMenus()[0].items[0].enabled).toBe(true);
  });

  it('submit.menu finalizes the menu structure', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    expect(state.isMenuSubmitted()).toBe(false);
    commands['submit.menu'](ctx(state));
    expect(state.isMenuSubmitted()).toBe(true);
  });
});

describe('createCommands: script.size', () => {
  it('records the requested script buffer size', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['script.size'](ctx(state, 127));
    expect(state.getScriptSize()).toBe(127);
  });
});

describe('createCommands: show.obj/status/obj.status.f', () => {
  it('show.obj records a show.obj display event for a literal object', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['show.obj'](ctx(state, 9));
    expect(state.getDisplay()).toEqual({ kind: 'show.obj', object: 9 });
  });

  it('show.obj.v resolves the object number from a var', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setVar(36, 9);

    commands['show.obj.v'](ctx(state, 36));
    expect(state.getDisplay()).toEqual({ kind: 'show.obj', object: 9 });
  });

  it('status records a status display event with no object', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['status'](ctx(state));
    expect(state.getDisplay()).toEqual({ kind: 'status' });
  });

  it('obj.status.f resolves the object from a var', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    state.setVar(36, 9);

    commands['obj.status.f'](ctx(state, 36));
    expect(state.getDisplay()).toEqual({ kind: 'obj.status', object: 9 });
  });
});

describe('createCommands: get.string/get.num/set.string and tests.compare.strings', () => {
  it('get.string records the prompt without touching the string register', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['get.string'](ctx(state, 1, 27, 15, 1, 33));
    expect(state.getDisplay()).toEqual({ kind: 'get.string', index: 1, message: 27, row: 15, col: 1, maxLength: 33 });
    expect(state.getString(1)).toBe('');
  });

  it('get.num records the prompt without touching the target var', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['get.num'](ctx(state, 4, 60));
    expect(state.getDisplay()).toEqual({ kind: 'get.num', message: 4, target: 60 });
    expect(state.getVar(60)).toBe(0);
  });

  it('set.string resolves message text via the injected getMessage option', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined, getMessage: (n) => (n === 2 ? 'hello' : undefined) });

    commands['set.string'](ctx(state, 0, 2));
    expect(state.getString(0)).toBe('hello');
  });

  it('set.string falls back to the stringified message number with no getMessage option', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['set.string'](ctx(state, 0, 2));
    expect(state.getString(0)).toBe('2');
  });

  it('compare.strings does a case/whitespace-insensitive equality check between two string registers', () => {
    const state = new VmState();
    state.setString(1, '  Hello  ');
    state.setString(2, 'hello');
    expect(commandTests['compare.strings'](ctx(state, 1, 2))).toBe(true);

    state.setString(2, 'goodbye');
    expect(commandTests['compare.strings'](ctx(state, 1, 2))).toBe(false);
  });
});

describe('createCommands: clear.lines/open.dialogue/close.dialogue/status.line.on/status.line.off', () => {
  it('clear.lines records the row range and colour', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['clear.lines'](ctx(state, 22, 24, 0));
    expect(state.getClearLinesCall()).toEqual({ row1: 22, row2: 24, color: 0 });
  });

  it('open.dialogue/close.dialogue toggle the dialogue-open state', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    expect(state.isDialogueOpen()).toBe(false);
    commands['open.dialogue'](ctx(state));
    expect(state.isDialogueOpen()).toBe(true);
    commands['close.dialogue'](ctx(state));
    expect(state.isDialogueOpen()).toBe(false);
  });

  it('status.line.on/status.line.off toggle status-line visibility', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['status.line.off'](ctx(state));
    expect(state.isStatusLineVisible()).toBe(false);
    commands['status.line.on'](ctx(state));
    expect(state.isStatusLineVisible()).toBe(true);
  });
});

describe('createCommands: text.screen/graphics/shake.screen', () => {
  it('text.screen/graphics switch the tracked screen mode', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    expect(state.getScreenMode()).toBe('graphics');
    commands['text.screen'](ctx(state));
    expect(state.getScreenMode()).toBe('text');
    commands['graphics'](ctx(state));
    expect(state.getScreenMode()).toBe('graphics');
  });

  it('shake.screen records the requested duration', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });

    commands['shake.screen'](ctx(state, 4));
    expect(state.getShakeDuration()).toBe(4);
  });
});

describe('createCommands: debug/system no-ops', () => {
  it('register every low-value debug/system command as a callable no-op, leaving state untouched', () => {
    const state = new VmState();
    const commands = createCommands({ loadPictureResource: () => undefined });
    const names = [
      'log',
      'quit',
      'version',
      'pause',
      'restart.game',
      'init.joy',
      'menu.input',
      'echo.line',
      'cancel.line',
      'show.mem',
      'show.pri.screen',
      'set.cursor.char',
      'set.game.id',
      'trace.info',
      'toggle.monitor',
      'configure.screen',
    ];

    for (const name of names) {
      expect(commands[name]).toBeTypeOf('function');
      expect(() => commands[name](ctx(state, 1, 2, 3))).not.toThrow();
    }
  });
});

describe('createCommands: save.game/restore.game', () => {
  it('round-trips flags, vars, current room, score, and inventory through the injected storage', () => {
    const storage = createFakeStorage();
    const commands = createCommands({ loadPictureResource: () => undefined, storage });

    const saved = new VmState();
    saved.setFlag(10, true);
    saved.setVar(50, 123);
    saved.setCurrentRoom(12);
    saved.setScore(7);
    saved.setObjectRoom(3, 12);
    saved.takeObject(4);

    commands['save.game'](ctx(saved));
    expect(storage.data['kq3-save']).toBeDefined();

    const restored = new VmState();
    commands['restore.game'](ctx(restored));

    expect(restored.getFlag(10)).toBe(true);
    expect(restored.getVar(50)).toBe(123);
    expect(restored.getCurrentRoom()).toBe(12);
    expect(restored.getScore()).toBe(7);
    expect(restored.getObjectRoom(3)).toBe(12);
    expect(restored.isCarried(4)).toBe(true);
  });

  it('restoring into a fresh VM resumes the correct room', () => {
    const storage = createFakeStorage();
    const commands = createCommands({ loadPictureResource: () => undefined, storage });

    const saved = new VmState();
    saved.setCurrentRoom(42);
    commands['save.game'](ctx(saved));

    const fresh = new VmState();
    expect(fresh.getCurrentRoom()).toBe(0);
    commands['restore.game'](ctx(fresh));
    expect(fresh.getCurrentRoom()).toBe(42);
  });

  it('restore.game leaves state untouched when nothing has been saved', () => {
    const storage = createFakeStorage();
    const commands = createCommands({ loadPictureResource: () => undefined, storage });

    const state = new VmState();
    state.setCurrentRoom(5);
    commands['restore.game'](ctx(state));

    expect(state.getCurrentRoom()).toBe(5);
  });

  it('restore.game leaves state untouched when the save data is corrupt', () => {
    const storage = createFakeStorage({ 'kq3-save': '{not valid json' });
    const commands = createCommands({ loadPictureResource: () => undefined, storage });

    const state = new VmState();
    state.setCurrentRoom(5);
    commands['restore.game'](ctx(state));

    expect(state.getCurrentRoom()).toBe(5);
  });

  it('restore.game leaves state untouched when the save data has the wrong shape', () => {
    const storage = createFakeStorage({ 'kq3-save': JSON.stringify({ flags: [], vars: [], objectRooms: [] }) });
    const commands = createCommands({ loadPictureResource: () => undefined, storage });

    const state = new VmState();
    state.setCurrentRoom(5);
    commands['restore.game'](ctx(state));

    expect(state.getCurrentRoom()).toBe(5);
  });

  it('save.game/restore.game use a custom saveKey when provided', () => {
    const storage = createFakeStorage();
    const commands = createCommands({ loadPictureResource: () => undefined, storage, saveKey: 'slot-2' });

    const saved = new VmState();
    saved.setCurrentRoom(9);
    commands['save.game'](ctx(saved));
    expect(storage.data['slot-2']).toBeDefined();
    expect(storage.data['kq3-save']).toBeUndefined();

    const restored = new VmState();
    commands['restore.game'](ctx(restored));
    expect(restored.getCurrentRoom()).toBe(9);
  });

  it('are no-ops that warn once when no storage is available', () => {
    const logger = vi.fn();
    const commands = createCommands({ loadPictureResource: () => undefined, storage: undefined, logger });

    const state = new VmState();
    state.setCurrentRoom(5);

    expect(() => commands['save.game'](ctx(state))).not.toThrow();
    expect(() => commands['restore.game'](ctx(state))).not.toThrow();
    expect(state.getCurrentRoom()).toBe(5);
    expect(logger).toHaveBeenCalled();
  });
});

describe('tests.isset.v', () => {
  it('reads the flag whose number is held in a var', () => {
    const state = new VmState();
    state.setVar(60, 10);
    state.setFlag(10, true);

    expect(commandTests['isset.v'](ctx(state, 60))).toBe(true);

    state.setFlag(10, false);
    expect(commandTests['isset.v'](ctx(state, 60))).toBe(false);
  });
});

describe('tests.have.key', () => {
  it('is true exactly once after a key press is recorded, then false until the next one', () => {
    const state = new VmState();

    expect(commandTests['have.key'](ctx(state))).toBe(false);

    state.recordKeyPress();
    expect(commandTests['have.key'](ctx(state))).toBe(true);
    expect(commandTests['have.key'](ctx(state))).toBe(false);
  });
});
