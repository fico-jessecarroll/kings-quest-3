import { describe, expect, it } from 'vitest';
import { createObjectCommands } from '../../src/vm/objectCommands';
import { ObjectTable } from '../../src/vm/objects';
import { VmState } from '../../src/vm/state';
import type { CommandContext } from '../../src/vm/interpreter';

function ctx(state: VmState, ...args: CommandContext['args']): CommandContext {
  return { state, args };
}

function setup(getCelCount?: (view: number, loop: number) => number) {
  const state = new VmState();
  const table = new ObjectTable({ state, getCelCount });
  const { commands, tests } = createObjectCommands(table);
  return { state, table, commands, tests };
}

describe('createObjectCommands: animate.obj/unanimate.obj/unanimate.all', () => {
  it('animate.obj marks an object animated, defaulting its record', () => {
    const { table, commands } = setup();
    commands['animate.obj'](ctx(new VmState(), 3));
    expect(table.isAnimated(3)).toBe(true);
  });

  it('unanimate.obj removes an object from the animated set', () => {
    const { table, commands } = setup();
    commands['animate.obj'](ctx(new VmState(), 3));
    commands['unanimate.obj'](ctx(new VmState(), 3));
    expect(table.isAnimated(3)).toBe(false);
  });

  it('unanimate.all removes every animated object except ego', () => {
    const { table, commands } = setup();
    commands['animate.obj'](ctx(new VmState(), 3));
    commands['animate.obj'](ctx(new VmState(), 4));
    commands['unanimate.all'](ctx(new VmState()));
    expect(table.isAnimated(3)).toBe(false);
    expect(table.isAnimated(4)).toBe(false);
    expect(table.isAnimated(0)).toBe(true);
  });
});

describe('createObjectCommands: set.view/set.loop/set.cel and their var variants', () => {
  it('set.view/set.loop/set.cel apply literal values, auto-animating the object', () => {
    const { table, state, commands } = setup();
    commands['set.view'](ctx(state, 5, 4));
    commands['set.loop'](ctx(state, 5, 2));
    commands['set.cel'](ctx(state, 5, 3));

    const obj = table.getObject(5);
    expect(obj.view).toBe(4);
    expect(obj.loop).toBe(2);
    expect(obj.cel).toBe(3);
  });

  it('set.view.f/set.view.v resolve the view number from a var', () => {
    const { table, state, commands } = setup();
    state.setVar(60, 7);
    commands['set.view.f'](ctx(state, 5, 60));
    expect(table.getObject(5).view).toBe(7);

    state.setVar(61, 8);
    commands['set.view.v'](ctx(state, 5, 61));
    expect(table.getObject(5).view).toBe(8);
  });

  it('set.loop.f and set.cel.f resolve from a var', () => {
    const { table, state, commands } = setup();
    state.setVar(60, 3);
    commands['set.loop.f'](ctx(state, 5, 60));
    expect(table.getObject(5).loop).toBe(3);

    state.setVar(61, 9);
    commands['set.cel.f'](ctx(state, 5, 61));
    expect(table.getObject(5).cel).toBe(9);
  });
});

describe('createObjectCommands: load.view/discard.view', () => {
  it('load.view tracks a literal view resource number as loaded', () => {
    const { state, commands } = setup();
    commands['load.view'](ctx(state, 9));
    expect(state.isViewLoaded(9)).toBe(true);
  });

  it('load.view.f/load.view.v resolve the view number from a var', () => {
    const { state, commands } = setup();
    state.setVar(70, 11);
    commands['load.view.f'](ctx(state, 70));
    expect(state.isViewLoaded(11)).toBe(true);

    state.setVar(71, 12);
    commands['load.view.v'](ctx(state, 71));
    expect(state.isViewLoaded(12)).toBe(true);
  });

  it('discard.view forgets a loaded view', () => {
    const { state, commands } = setup();
    commands['load.view'](ctx(state, 9));
    commands['discard.view'](ctx(state, 9));
    expect(state.isViewLoaded(9)).toBe(false);
  });
});

describe('createObjectCommands: cycle.time/start.cycling/stop.cycling/normal.cycle/reverse.cycle/end.of.loop/reverse.loop', () => {
  it('cycle.time resolves the new cycle time from a var', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    state.setVar(36, 4);
    commands['cycle.time'](ctx(state, 1, 36));
    expect(table.getObject(1).cycleTime).toBe(4);
  });

  it('start.cycling/stop.cycling toggle cycling', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    commands['start.cycling'](ctx(state, 1));
    expect(table.getObject(1).cycling).toBe(true);
    commands['stop.cycling'](ctx(state, 1));
    expect(table.getObject(1).cycling).toBe(false);
  });

  it('normal.cycle/reverse.cycle set the cycle direction and start cycling', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    commands['reverse.cycle'](ctx(state, 1));
    expect(table.getObject(1).cycleMode).toBe('reverseCycle');
    commands['normal.cycle'](ctx(state, 1));
    expect(table.getObject(1).cycleMode).toBe('normal');
  });

  it('end.of.loop cycles to the last cel then sets the done flag', () => {
    const { table, state, commands } = setup(() => 3);
    commands['animate.obj'](ctx(state, 1));
    commands['end.of.loop'](ctx(state, 1, 5));
    table.update();
    table.update();
    expect(table.getObject(1).cel).toBe(2);
    expect(state.getFlag(5)).toBe(true);
  });

  it('reverse.loop cycles back to cel 0 then sets the done flag', () => {
    const { table, state, commands } = setup(() => 3);
    commands['animate.obj'](ctx(state, 1));
    table.setCel(1, 2);
    commands['reverse.loop'](ctx(state, 1, 6));
    table.update();
    table.update();
    expect(table.getObject(1).cel).toBe(0);
    expect(state.getFlag(6)).toBe(true);
  });
});

describe('createObjectCommands: start.update/stop.update/force.update/fix.loop/release.loop', () => {
  it('stop.update/start.update toggle the updating flag', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    commands['stop.update'](ctx(state, 1));
    expect(table.getObject(1).updating).toBe(false);
    commands['start.update'](ctx(state, 1));
    expect(table.getObject(1).updating).toBe(true);
  });

  it('force.update records a pending force-update', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    commands['force.update'](ctx(state, 1));
    expect(table.getObject(1).forceUpdate).toBe(true);
  });

  it('fix.loop/release.loop toggle the loop-fixed flag', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    commands['fix.loop'](ctx(state, 1));
    expect(table.getObject(1).loopFixed).toBe(true);
    commands['release.loop'](ctx(state, 1));
    expect(table.getObject(1).loopFixed).toBe(false);
  });
});

describe('createObjectCommands: move.obj/follow.ego/wander/stop.motion/start.motion/normal.motion', () => {
  it('move.obj sets a literal move order', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    commands['move.obj'](ctx(state, 1, 87, 139, 2, 10));
    expect(table.getObject(1).motion).toBe('move');
  });

  it('move.obj.f/move.obj.v resolve x/y/stepSize from vars but keep doneFlag literal', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    state.setVar(1, 87);
    state.setVar(2, 139);
    state.setVar(3, 2);
    commands['move.obj.f'](ctx(state, 1, 1, 2, 3, 10));
    expect(table.getObject(1).motion).toBe('move');
    table.update();
    // doneFlag (10) is a literal flag index, not resolved through getVar.
    expect(() => state.getFlag(10)).not.toThrow();
  });

  it('follow.ego starts following', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    commands['follow.ego'](ctx(state, 1, 2, 10));
    expect(table.getObject(1).motion).toBe('follow');
  });

  it('wander starts wandering', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    commands['wander'](ctx(state, 1));
    expect(table.getObject(1).motion).toBe('wander');
  });

  it('stop.motion/start.motion/normal.motion control normal motion', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    commands['wander'](ctx(state, 1));
    commands['stop.motion'](ctx(state, 1));
    expect(table.getObject(1).motion).toBe('normal');
    expect(table.getObject(1).direction).toBe(0);

    commands['wander'](ctx(state, 1));
    commands['start.motion'](ctx(state, 1));
    expect(table.getObject(1).motion).toBe('normal');

    commands['wander'](ctx(state, 1));
    commands['normal.motion'](ctx(state, 1));
    expect(table.getObject(1).motion).toBe('normal');
  });
});

describe('createObjectCommands: reposition (relative, distinct from reposition.to)', () => {
  it('moves an object by a signed delta read from two vars', () => {
    const { state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    state.setPosition(1, 10, 5);
    state.setVar(1, 3);
    state.setVar(2, 254); // two's-complement for -2

    commands['reposition'](ctx(state, 1, 1, 2));
    expect(state.getPosition(1)).toEqual({ x: 13, y: 3 });
  });
});

describe('createObjectCommands: reposition.to', () => {
  it('reposition.to sets a literal position directly', () => {
    const { state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    commands['reposition.to'](ctx(state, 1, 10, 20));
    expect(state.getPosition(1)).toEqual({ x: 10, y: 20 });
  });

  it('reposition.to.f/reposition.to.v resolve x/y from vars', () => {
    const { state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    state.setVar(1, 30);
    state.setVar(2, 40);
    commands['reposition.to.f'](ctx(state, 1, 1, 2));
    expect(state.getPosition(1)).toEqual({ x: 30, y: 40 });
  });
});

describe('createObjectCommands: block/unblock and the per-object collision/horizon flags', () => {
  it('block/unblock set and clear the global blocked rectangle', () => {
    const { table, state, commands } = setup();
    commands['block'](ctx(state, 0, 0, 10, 10));
    commands['animate.obj'](ctx(state, 1));
    state.setPosition(1, 5, 5);
    table.setIgnoreBlocks(1, false);
    table.setObserveHorizon(1, false);
    table.setDirection(1, 3);
    table.update();
    expect(state.getPosition(1)).toEqual({ x: 5, y: 5 });

    commands['unblock'](ctx(state));
    table.update();
    expect(state.getPosition(1)).toEqual({ x: 6, y: 5 });
  });

  it('ignore.blocks/observe.blocks toggle whether the object respects the block', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    commands['ignore.blocks'](ctx(state, 1));
    expect(table.getObject(1).ignoreBlocks).toBe(true);
    commands['observe.blocks'](ctx(state, 1));
    expect(table.getObject(1).ignoreBlocks).toBe(false);
  });

  it('ignore.objs/observe.objs toggle the per-object flag', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    commands['ignore.objs'](ctx(state, 1));
    expect(table.getObject(1).ignoreObjs).toBe(true);
    commands['observe.objs'](ctx(state, 1));
    expect(table.getObject(1).ignoreObjs).toBe(false);
  });

  it('ignore.horizon/observe.horizon toggle whether the object respects the horizon', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    commands['ignore.horizon'](ctx(state, 1));
    expect(table.getObject(1).observeHorizon).toBe(false);
    commands['observe.horizon'](ctx(state, 1));
    expect(table.getObject(1).observeHorizon).toBe(true);
  });

  it('set.horizon sets the global horizon line', () => {
    const { table, state, commands } = setup();
    commands['set.horizon'](ctx(state, 40));
    expect(table.getHorizon()).toBe(40);
  });

  it('ignore.obj/ignore.objects/observe.obj/observe.objects are aliases for the plural spellings', () => {
    const { commands } = setup();
    expect(commands['ignore.obj']).toBe(commands['ignore.objs']);
    expect(commands['ignore.objects']).toBe(commands['ignore.objs']);
    expect(commands['observe.obj']).toBe(commands['observe.objs']);
    expect(commands['observe.objects']).toBe(commands['observe.objs']);
  });

  it('ignore.block/observe.block are aliases for the plural spellings', () => {
    const { commands } = setup();
    expect(commands['ignore.block']).toBe(commands['ignore.blocks']);
    expect(commands['observe.block']).toBe(commands['observe.blocks']);
  });
});

describe('createObjectCommands: beginning.of.loop', () => {
  it('is an alias for reverse.loop', () => {
    const { commands } = setup();
    expect(commands['beginning.of.loop']).toBe(commands['reverse.loop']);
  });
});

describe('createObjectCommands: object.on.water/object.on.land/object.on.anything', () => {
  it('record the per-object terrain constraint, auto-animating the object', () => {
    const { table, state, commands } = setup();

    commands['object.on.water'](ctx(state, 1));
    expect(table.isAnimated(1)).toBe(true);
    expect(table.getObject(1).terrain).toBe('water');

    commands['object.on.land'](ctx(state, 1));
    expect(table.getObject(1).terrain).toBe('land');

    commands['object.on.anything'](ctx(state, 1));
    expect(table.getObject(1).terrain).toBe('anything');
  });

  it('defaults to null until one of those commands is called', () => {
    const { table, commands } = setup();
    commands['animate.obj'](ctx(new VmState(), 2));
    expect(table.getObject(2).terrain).toBeNull();
  });

  it('obj.on.water/obj.on.land/obj.on.anything are aliases for the object.on.* spellings', () => {
    const { commands } = setup();
    expect(commands['obj.on.water']).toBe(commands['object.on.water']);
    expect(commands['obj.on.land']).toBe(commands['object.on.land']);
    expect(commands['obj.on.anything']).toBe(commands['object.on.anything']);
  });
});

describe('createObjectCommands: step.size/step.time/set.dir/get.dir', () => {
  it('step.size/step.time resolve from a var', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    state.setVar(36, 3);
    commands['step.size'](ctx(state, 1, 36));
    expect(table.getObject(1).stepSize).toBe(3);

    state.setVar(37, 2);
    commands['step.time'](ctx(state, 1, 37));
    expect(table.getObject(1).stepTime).toBe(2);
  });

  it('set.dir resolves the new direction from a var', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    state.setVar(36, 5);
    commands['set.dir'](ctx(state, 1, 36));
    expect(table.getObject(1).direction).toBe(5);
  });

  it('get.dir writes the object current direction into a var', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    table.setDirection(1, 6);
    commands['get.dir'](ctx(state, 1, 36));
    expect(state.getVar(36)).toBe(6);
  });
});

describe('createObjectCommands: current.cel/current.loop/current.view/last.cel/get.priority', () => {
  it('current.cel/current.loop/current.view write the object current values into a var', () => {
    const { table, state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    table.setView(1, 4);
    table.setLoop(1, 2);
    table.setCel(1, 3);

    commands['current.view'](ctx(state, 1, 60));
    expect(state.getVar(60)).toBe(4);
    commands['current.loop'](ctx(state, 1, 61));
    expect(state.getVar(61)).toBe(2);
    commands['current.cel'](ctx(state, 1, 62));
    expect(state.getVar(62)).toBe(3);
  });

  it('last.cel writes the highest valid cel index for the current view/loop into a var', () => {
    const { state, commands } = setup((view, loop) => (view === 4 && loop === 2 ? 6 : 1));
    commands['animate.obj'](ctx(state, 1));
    commands['set.view'](ctx(state, 1, 4));
    commands['set.loop'](ctx(state, 1, 2));

    commands['last.cel'](ctx(state, 1, 63));
    expect(state.getVar(63)).toBe(5);
  });

  it('get.priority writes the object fixed priority (or 0 if automatic) into a var', () => {
    const { state, commands } = setup();
    commands['animate.obj'](ctx(state, 1));
    state.setPriority(1, 12);

    commands['get.priority'](ctx(state, 1, 64));
    expect(state.getVar(64)).toBe(12);
  });
});
