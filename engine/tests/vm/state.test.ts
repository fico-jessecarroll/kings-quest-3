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

describe('VmState picture buffers', () => {
  it('starts with no picture loaded, no buffers, and not visible', () => {
    const state = new VmState();
    expect(state.getLoadedPictureNumber()).toBeNull();
    expect(state.getPictureBuffers()).toBeNull();
    expect(state.isPictureVisible()).toBe(false);
  });

  it('tracks the loaded picture number independently of the drawn buffers', () => {
    const state = new VmState();
    state.setLoadedPictureNumber(12);
    expect(state.getLoadedPictureNumber()).toBe(12);
    state.setLoadedPictureNumber(null);
    expect(state.getLoadedPictureNumber()).toBeNull();
  });

  it('stores the visual+priority buffers drawn for the room', () => {
    const state = new VmState();
    const visual = new Uint8Array([1, 2, 3]);
    const priority = new Uint8Array([4, 5, 6]);
    state.setPictureBuffers({ visual, priority });
    expect(state.getPictureBuffers()).toEqual({ visual, priority });
  });

  it('toggles picture visibility independently of the buffers', () => {
    const state = new VmState();
    state.setPictureVisible(true);
    expect(state.isPictureVisible()).toBe(true);
    state.setPictureVisible(false);
    expect(state.isPictureVisible()).toBe(false);
  });
});

describe('VmState object positions', () => {
  it('defaults an untouched object to (0, 0)', () => {
    const state = new VmState();
    expect(state.getPosition(5)).toEqual({ x: 0, y: 0 });
  });

  it('sets and reads back a position', () => {
    const state = new VmState();
    state.setPosition(5, 38, 158);
    expect(state.getPosition(5)).toEqual({ x: 38, y: 158 });
  });

  it('throws on out-of-range object numbers or coordinates', () => {
    const state = new VmState();
    expect(() => state.getPosition(-1)).toThrow(RangeError);
    expect(() => state.setPosition(5, -1, 0)).toThrow(RangeError);
    expect(() => state.setPosition(5, 0, 256)).toThrow(RangeError);
  });
});

describe('VmState object priorities', () => {
  it('defaults an untouched object to automatic priority', () => {
    const state = new VmState();
    expect(state.getPriority(5)).toBeNull();
  });

  it('sets a fixed priority, then releases it back to automatic', () => {
    const state = new VmState();
    state.setPriority(5, 12);
    expect(state.getPriority(5)).toBe(12);
    state.releasePriority(5);
    expect(state.getPriority(5)).toBeNull();
  });

  it('throws on an out-of-range priority value', () => {
    const state = new VmState();
    expect(() => state.setPriority(5, 256)).toThrow(RangeError);
  });
});

describe('VmState add.to.pic log', () => {
  it('starts empty', () => {
    const state = new VmState();
    expect(state.getAddToPicCalls()).toEqual([]);
  });

  it('records each add.to.pic call in order', () => {
    const state = new VmState();
    const call = { view: 1, loop: 0, cel: 2, x: 10, y: 20, priority: 8, margin: 0 };
    state.recordAddToPic(call);
    expect(state.getAddToPicCalls()).toEqual([call]);
  });
});

describe('VmState last display event', () => {
  it('starts with no display event', () => {
    const state = new VmState();
    expect(state.getDisplay()).toBeNull();
  });

  it('records the most recent print/print.at/display event', () => {
    const state = new VmState();
    state.setDisplay({ kind: 'print', message: 1 });
    expect(state.getDisplay()).toEqual({ kind: 'print', message: 1 });

    state.setDisplay({ kind: 'print.at', message: 16, row: 2, col: 2, width: 37 });
    expect(state.getDisplay()).toEqual({ kind: 'print.at', message: 16, row: 2, col: 2, width: 37 });

    state.setDisplay({ kind: 'display', message: 30, row: 0, col: 20 });
    expect(state.getDisplay()).toEqual({ kind: 'display', message: 30, row: 0, col: 20 });
  });

  it('records show.obj/status/obj.status/get.string/get.num events the same way', () => {
    const state = new VmState();

    state.setDisplay({ kind: 'show.obj', object: 5 });
    expect(state.getDisplay()).toEqual({ kind: 'show.obj', object: 5 });

    state.setDisplay({ kind: 'status' });
    expect(state.getDisplay()).toEqual({ kind: 'status' });

    state.setDisplay({ kind: 'obj.status', object: 9 });
    expect(state.getDisplay()).toEqual({ kind: 'obj.status', object: 9 });

    state.setDisplay({ kind: 'get.string', index: 1, message: 27, row: 15, col: 1, maxLength: 33 });
    expect(state.getDisplay()).toEqual({ kind: 'get.string', index: 1, message: 27, row: 15, col: 1, maxLength: 33 });

    state.setDisplay({ kind: 'get.num', message: 4, target: 60 });
    expect(state.getDisplay()).toEqual({ kind: 'get.num', message: 4, target: 60 });
  });
});

describe('VmState object visibility (draw/erase)', () => {
  it('defaults every object to not visible', () => {
    const state = new VmState();
    expect(state.isObjectVisible(0)).toBe(false);
  });

  it('draw makes an object visible, erase hides it again', () => {
    const state = new VmState();
    state.setObjectVisible(3, true);
    expect(state.isObjectVisible(3)).toBe(true);
    state.setObjectVisible(3, false);
    expect(state.isObjectVisible(3)).toBe(false);
  });
});

describe('VmState text attribute', () => {
  it('defaults to foreground 15, background 0', () => {
    const state = new VmState();
    expect(state.getTextAttribute()).toEqual({ foreground: 15, background: 0 });
  });

  it('sets foreground/background colours', () => {
    const state = new VmState();
    state.setTextAttribute(4, 12);
    expect(state.getTextAttribute()).toEqual({ foreground: 4, background: 12 });
  });
});

describe('VmState key mappings', () => {
  it('has no controller mapped for a key by default', () => {
    const state = new VmState();
    expect(state.getControllerForKey(59, 0)).toBeUndefined();
  });

  it('maps an ascii/scan key pair to a controller number', () => {
    const state = new VmState();
    state.setKeyMapping(0, 59, 7);
    expect(state.getControllerForKey(0, 59)).toBe(7);
  });

  it('matches on either the ascii or the scan code alone', () => {
    const state = new VmState();
    state.setKeyMapping(43, 0, 9);
    expect(state.getControllerForKey(43, 999)).toBe(9);
  });
});

describe('VmState controller activation', () => {
  it('defaults every controller to inactive', () => {
    const state = new VmState();
    expect(state.isControllerActive(3)).toBe(false);
  });

  it('activates and deactivates a controller', () => {
    const state = new VmState();
    state.setControllerActive(3, true);
    expect(state.isControllerActive(3)).toBe(true);
    state.setControllerActive(3, false);
    expect(state.isControllerActive(3)).toBe(false);
  });
});

describe('VmState menus', () => {
  it('starts with no menus', () => {
    const state = new VmState();
    expect(state.getMenus()).toEqual([]);
  });

  it('adds a menu and items under it, tracking enabled state', () => {
    const state = new VmState();
    state.addMenu(121);
    state.addMenuItem(122, 5);
    state.addMenuItem(123, 6);

    expect(state.getMenus()).toEqual([
      { message: 121, items: [{ message: 122, controller: 5, enabled: true }, { message: 123, controller: 6, enabled: true }] },
    ]);

    state.setItemEnabled(5, false);
    expect(state.getMenus()[0].items[0].enabled).toBe(false);
  });

  it('starts a new menu group for each addMenu call', () => {
    const state = new VmState();
    state.addMenu(121);
    state.addMenuItem(122, 5);
    state.addMenu(130);
    state.addMenuItem(131, 6);

    expect(state.getMenus()).toEqual([
      { message: 121, items: [{ message: 122, controller: 5, enabled: true }] },
      { message: 130, items: [{ message: 131, controller: 6, enabled: true }] },
    ]);
  });
});

describe('VmState loaded views', () => {
  it('starts with no views loaded', () => {
    const state = new VmState();
    expect(state.isViewLoaded(4)).toBe(false);
  });

  it('loads and discards a view resource number', () => {
    const state = new VmState();
    state.loadView(4);
    expect(state.isViewLoaded(4)).toBe(true);
    state.discardView(4);
    expect(state.isViewLoaded(4)).toBe(false);
  });
});

describe('VmState script size', () => {
  it('defaults to 0', () => {
    const state = new VmState();
    expect(state.getScriptSize()).toBe(0);
  });

  it('records the requested script buffer size', () => {
    const state = new VmState();
    state.setScriptSize(127);
    expect(state.getScriptSize()).toBe(127);
  });
});
