/**
 * Wires the AGI animated-object/view/motion command subset to an
 * {@link ObjectTable}: animate/unanimate, view/loop/cel selection, cycling,
 * motion, and the per-object collision/horizon flags. `load.view`/
 * `discard.view` live here too for cohesion even though they only touch
 * {@link VmState} (there's no VIEW decoder yet, so they just track which
 * resource numbers are "loaded").
 *
 * Several commands here (`cycle.time`, `step.size`, `step.time`, `set.dir`,
 * `get.dir`, `current.cel`/`current.loop`/`current.view`, `get.priority`)
 * have no separate immediate/var-indexed spelling in real AGI - the same
 * opcode takes either, and the compiler picks the encoding based on whether
 * you wrote a literal or a var name. This game's own logic source only ever
 * calls them with a var, so they're implemented here as always resolving
 * their numeric arg through `ctx.state.getVar`.
 */

import type { CommandContext, CommandImpl, TestImpl } from './interpreter';
import { ObjectTable } from './objects';

function numberArg(ctx: CommandContext, index: number): number | undefined {
  const value = ctx.args[index];
  return typeof value === 'number' ? value : undefined;
}

/** Reinterprets a 0-255 byte as a signed -128..127 delta - `reposition`'s dx/dy vars store negative offsets this way, the same two's-complement encoding AGI itself uses for signed byte values. */
function toSignedByte(value: number): number {
  return value > 127 ? value - 256 : value;
}

export interface ObjectCommandsOptions {
  /** Receives one line per first-seen problem (bad args). Defaults to console.warn. */
  logger?: (message: string) => void;
}

export function createObjectCommands(
  table: ObjectTable,
  options: ObjectCommandsOptions = {},
): { commands: Record<string, CommandImpl>; tests: Record<string, TestImpl> } {
  const logger = options.logger ?? ((message: string) => console.warn(message));
  const loggedOnce = new Set<string>();

  function logOnce(key: string, message: string): void {
    if (loggedOnce.has(key)) return;
    loggedOnce.add(key);
    logger(message);
  }

  function requireNumbers(ctx: CommandContext, name: string, count: number): number[] | undefined {
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      const value = numberArg(ctx, i);
      if (value === undefined) {
        logOnce(`${name}:bad-args`, `${name}(): expected ${count} numeric args, got ${ctx.args.join(', ')}`);
        return undefined;
      }
      values.push(value);
    }
    return values;
  }

  /** Ensures `objectNumber` is animated before a command mutates it, since AGI scripts don't always call `animate.obj` first and {@link ObjectTable} throws for unknown objects. */
  function ensureAnimated(objectNumber: number): void {
    table.animate(objectNumber);
  }

  const commands: Record<string, CommandImpl> = {
    'animate.obj': (ctx) => {
      const args = requireNumbers(ctx, 'animate.obj', 1);
      if (!args) return;
      table.animate(args[0]);
    },

    'unanimate.obj': (ctx) => {
      const args = requireNumbers(ctx, 'unanimate.obj', 1);
      if (!args) return;
      table.unanimate(args[0]);
    },

    'unanimate.all': () => {
      table.unanimateAll();
    },

    'set.view': (ctx) => {
      const args = requireNumbers(ctx, 'set.view', 2);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setView(args[0], args[1]);
    },

    'set.view.f': (ctx) => {
      const args = requireNumbers(ctx, 'set.view.f', 2);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setView(args[0], ctx.state.getVar(args[1]));
    },

    'set.loop': (ctx) => {
      const args = requireNumbers(ctx, 'set.loop', 2);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setLoop(args[0], args[1]);
    },

    'set.loop.f': (ctx) => {
      const args = requireNumbers(ctx, 'set.loop.f', 2);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setLoop(args[0], ctx.state.getVar(args[1]));
    },

    'set.cel': (ctx) => {
      const args = requireNumbers(ctx, 'set.cel', 2);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setCel(args[0], args[1]);
    },

    'set.cel.f': (ctx) => {
      const args = requireNumbers(ctx, 'set.cel.f', 2);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setCel(args[0], ctx.state.getVar(args[1]));
    },

    'load.view': (ctx) => {
      const args = requireNumbers(ctx, 'load.view', 1);
      if (!args) return;
      ctx.state.loadView(args[0]);
    },

    'load.view.f': (ctx) => {
      const args = requireNumbers(ctx, 'load.view.f', 1);
      if (!args) return;
      ctx.state.loadView(ctx.state.getVar(args[0]));
    },

    'discard.view': (ctx) => {
      const args = requireNumbers(ctx, 'discard.view', 1);
      if (!args) return;
      ctx.state.discardView(args[0]);
    },

    'cycle.time': (ctx) => {
      const args = requireNumbers(ctx, 'cycle.time', 2);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setCycleTime(args[0], ctx.state.getVar(args[1]));
    },

    'start.cycling': (ctx) => {
      const args = requireNumbers(ctx, 'start.cycling', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.startCycling(args[0]);
    },

    'stop.cycling': (ctx) => {
      const args = requireNumbers(ctx, 'stop.cycling', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.stopCycling(args[0]);
    },

    'normal.cycle': (ctx) => {
      const args = requireNumbers(ctx, 'normal.cycle', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.normalCycle(args[0]);
    },

    'reverse.cycle': (ctx) => {
      const args = requireNumbers(ctx, 'reverse.cycle', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.reverseCycle(args[0]);
    },

    'end.of.loop': (ctx) => {
      const args = requireNumbers(ctx, 'end.of.loop', 2);
      if (!args) return;
      ensureAnimated(args[0]);
      table.endLoop(args[0], args[1]);
    },

    'reverse.loop': (ctx) => {
      const args = requireNumbers(ctx, 'reverse.loop', 2);
      if (!args) return;
      ensureAnimated(args[0]);
      table.reverseLoop(args[0], args[1]);
    },

    'start.update': (ctx) => {
      const args = requireNumbers(ctx, 'start.update', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.startUpdate(args[0]);
    },

    'stop.update': (ctx) => {
      const args = requireNumbers(ctx, 'stop.update', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.stopUpdate(args[0]);
    },

    'force.update': (ctx) => {
      const args = requireNumbers(ctx, 'force.update', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.forceUpdate(args[0]);
    },

    'fix.loop': (ctx) => {
      const args = requireNumbers(ctx, 'fix.loop', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.fixLoop(args[0]);
    },

    'release.loop': (ctx) => {
      const args = requireNumbers(ctx, 'release.loop', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.releaseLoop(args[0]);
    },

    'move.obj': (ctx) => {
      const args = requireNumbers(ctx, 'move.obj', 5);
      if (!args) return;
      const [object, x, y, stepSize, doneFlag] = args;
      ensureAnimated(object);
      table.moveObj(object, x, y, stepSize, doneFlag);
    },

    'move.obj.f': (ctx) => {
      const args = requireNumbers(ctx, 'move.obj.f', 5);
      if (!args) return;
      const [object, xVar, yVar, stepSizeVar, doneFlag] = args;
      ensureAnimated(object);
      table.moveObj(object, ctx.state.getVar(xVar), ctx.state.getVar(yVar), ctx.state.getVar(stepSizeVar), doneFlag);
    },

    'follow.ego': (ctx) => {
      const args = requireNumbers(ctx, 'follow.ego', 3);
      if (!args) return;
      const [object, stepSize, doneFlag] = args;
      ensureAnimated(object);
      table.followEgo(object, stepSize, doneFlag);
    },

    wander: (ctx) => {
      const args = requireNumbers(ctx, 'wander', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.wander(args[0]);
    },

    'stop.motion': (ctx) => {
      const args = requireNumbers(ctx, 'stop.motion', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.stopMotion(args[0]);
    },

    'start.motion': (ctx) => {
      const args = requireNumbers(ctx, 'start.motion', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.normalMotion(args[0]);
    },

    'normal.motion': (ctx) => {
      const args = requireNumbers(ctx, 'normal.motion', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.normalMotion(args[0]);
    },

    reposition: (ctx) => {
      const args = requireNumbers(ctx, 'reposition', 3);
      if (!args) return;
      const [object, dxVar, dyVar] = args;
      ensureAnimated(object);
      table.reposition(object, toSignedByte(ctx.state.getVar(dxVar)), toSignedByte(ctx.state.getVar(dyVar)));
    },

    'reposition.to': (ctx) => {
      const args = requireNumbers(ctx, 'reposition.to', 3);
      if (!args) return;
      const [object, x, y] = args;
      ensureAnimated(object);
      table.repositionTo(object, x, y);
    },

    'reposition.to.f': (ctx) => {
      const args = requireNumbers(ctx, 'reposition.to.f', 3);
      if (!args) return;
      const [object, xVar, yVar] = args;
      ensureAnimated(object);
      table.repositionTo(object, ctx.state.getVar(xVar), ctx.state.getVar(yVar));
    },

    block: (ctx) => {
      const args = requireNumbers(ctx, 'block', 4);
      if (!args) return;
      table.setBlock(args[0], args[1], args[2], args[3]);
    },

    unblock: () => {
      table.clearBlock();
    },

    'ignore.blocks': (ctx) => {
      const args = requireNumbers(ctx, 'ignore.blocks', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setIgnoreBlocks(args[0], true);
    },

    'observe.blocks': (ctx) => {
      const args = requireNumbers(ctx, 'observe.blocks', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setIgnoreBlocks(args[0], false);
    },

    'ignore.objs': (ctx) => {
      const args = requireNumbers(ctx, 'ignore.objs', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setIgnoreObjs(args[0], true);
    },

    'observe.objs': (ctx) => {
      const args = requireNumbers(ctx, 'observe.objs', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setIgnoreObjs(args[0], false);
    },

    'ignore.horizon': (ctx) => {
      const args = requireNumbers(ctx, 'ignore.horizon', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setObserveHorizon(args[0], false);
    },

    'observe.horizon': (ctx) => {
      const args = requireNumbers(ctx, 'observe.horizon', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setObserveHorizon(args[0], true);
    },

    'set.horizon': (ctx) => {
      const args = requireNumbers(ctx, 'set.horizon', 1);
      if (!args) return;
      table.setHorizon(args[0]);
    },

    'step.size': (ctx) => {
      const args = requireNumbers(ctx, 'step.size', 2);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setStepSize(args[0], ctx.state.getVar(args[1]));
    },

    'step.time': (ctx) => {
      const args = requireNumbers(ctx, 'step.time', 2);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setStepTime(args[0], ctx.state.getVar(args[1]));
    },

    'set.dir': (ctx) => {
      const args = requireNumbers(ctx, 'set.dir', 2);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setDirection(args[0], ctx.state.getVar(args[1]));
    },

    'get.dir': (ctx) => {
      const args = requireNumbers(ctx, 'get.dir', 2);
      if (!args) return;
      const [object, varOut] = args;
      ensureAnimated(object);
      ctx.state.setVar(varOut, table.getObject(object).direction);
    },

    'current.view': (ctx) => {
      const args = requireNumbers(ctx, 'current.view', 2);
      if (!args) return;
      const [object, varOut] = args;
      ensureAnimated(object);
      ctx.state.setVar(varOut, table.getObject(object).view);
    },

    'current.loop': (ctx) => {
      const args = requireNumbers(ctx, 'current.loop', 2);
      if (!args) return;
      const [object, varOut] = args;
      ensureAnimated(object);
      ctx.state.setVar(varOut, table.getObject(object).loop);
    },

    'current.cel': (ctx) => {
      const args = requireNumbers(ctx, 'current.cel', 2);
      if (!args) return;
      const [object, varOut] = args;
      ensureAnimated(object);
      ctx.state.setVar(varOut, table.getObject(object).cel);
    },

    'last.cel': (ctx) => {
      const args = requireNumbers(ctx, 'last.cel', 2);
      if (!args) return;
      const [object, varOut] = args;
      ensureAnimated(object);
      const obj = table.getObject(object);
      ctx.state.setVar(varOut, table.getCelCount(obj.view, obj.loop) - 1);
    },

    'get.priority': (ctx) => {
      const args = requireNumbers(ctx, 'get.priority', 2);
      if (!args) return;
      const [object, varOut] = args;
      ctx.state.setVar(varOut, ctx.state.getPriority(object) ?? 0);
    },

    'object.on.water': (ctx) => {
      const args = requireNumbers(ctx, 'object.on.water', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setTerrain(args[0], 'water');
    },

    'object.on.land': (ctx) => {
      const args = requireNumbers(ctx, 'object.on.land', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setTerrain(args[0], 'land');
    },

    'object.on.anything': (ctx) => {
      const args = requireNumbers(ctx, 'object.on.anything', 1);
      if (!args) return;
      ensureAnimated(args[0]);
      table.setTerrain(args[0], 'anything');
    },
  };

  // .v is the macro alias real CG source actually writes for the suffixed
  // commands above (SYSDEFS.AL: `%define position.v position.f` etc.); some
  // logics' compiled IR still carries the .v spelling directly, so register
  // both names against the same implementation.
  for (const name of ['set.view', 'set.loop', 'set.cel', 'load.view', 'move.obj', 'reposition.to']) {
    commands[`${name}.v`] = commands[`${name}.f`];
  }

  // SYSDEFS.AL also aliases the singular/plural and "beginning.of.loop"
  // spellings below to the implementations above; some logics' compiled IR
  // still carries the un-substituted spelling, so register both names.
  commands['ignore.obj'] = commands['ignore.objs'];
  commands['ignore.objects'] = commands['ignore.objs'];
  commands['observe.obj'] = commands['observe.objs'];
  commands['observe.objects'] = commands['observe.objs'];
  commands['ignore.block'] = commands['ignore.blocks'];
  commands['observe.block'] = commands['observe.blocks'];
  commands['beginning.of.loop'] = commands['reverse.loop'];
  commands['obj.on.water'] = commands['object.on.water'];
  commands['obj.on.land'] = commands['object.on.land'];
  commands['obj.on.anything'] = commands['object.on.anything'];

  return { commands, tests: {} };
}
