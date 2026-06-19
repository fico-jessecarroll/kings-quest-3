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

describe('createCommands: set.menu/set.menu.item/enable.item/disable.item', () => {
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
