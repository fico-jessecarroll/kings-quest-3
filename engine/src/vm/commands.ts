/**
 * Command/test implementations for the AGI subset needed to display a room
 * and place ego: picture loading/drawing, flag/var mutation, object
 * position/priority, ego control mode, and input enable.
 *
 * `new.room` is deliberately not included here even though it's part of that
 * subset - the interpreter's built-in implementation aborts the rest of the
 * current cycle on a room change (see {@link Interpreter.runCycle}), which
 * needs access to interpreter-private state this module doesn't have.
 * Registering a `new.room` here would silently override and break that.
 */

import { decodePic } from '../resources/pic';
import type { CommandContext, CommandImpl, TestImpl } from './interpreter';
import { wrapByte } from './interpreter';

export interface CommandsOptions {
  /** Resolves a PICTURE resource number to its raw (undecoded) bytes, or undefined if not found. */
  loadPictureResource: (pictureNumber: number) => Uint8Array | undefined;
  /** Resolves an AGI %message number to its text, for `set.string`. Defaults to the stringified message number when not provided (there's no message-table wiring at this layer otherwise). */
  getMessage?: (messageNumber: number) => string | undefined;
  /** Source of randomness for `random`; defaults to {@link Math.random}. Inject a fake for deterministic tests. */
  random?: () => number;
  /** Receives one line per first-seen problem (bad args, missing resource). Defaults to console.warn. */
  logger?: (message: string) => void;
}

function numberArg(ctx: CommandContext, index: number): number | undefined {
  const value = ctx.args[index];
  return typeof value === 'number' ? value : undefined;
}

export function createCommands(options: CommandsOptions): Record<string, CommandImpl> {
  const logger = options.logger ?? ((message: string) => console.warn(message));
  const random = options.random ?? Math.random;
  const getMessage = options.getMessage ?? ((messageNumber: number) => String(messageNumber));
  const loggedOnce = new Set<string>();

  function logOnce(key: string, message: string): void {
    if (loggedOnce.has(key)) return;
    loggedOnce.add(key);
    logger(message);
  }

  /** Reads `count` numeric args, or logs once and returns undefined if any are missing/non-numeric. */
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

  const commands: Record<string, CommandImpl> = {
    'load.pic': (ctx) => {
      const args = requireNumbers(ctx, 'load.pic', 1);
      if (!args) return;
      ctx.state.setLoadedPictureNumber(args[0]);
    },

    'draw.pic': (ctx) => {
      const args = requireNumbers(ctx, 'draw.pic', 1);
      if (!args) return;
      const [picture] = args;
      const bytes = options.loadPictureResource(picture);
      if (!bytes) {
        logOnce(`draw.pic:${picture}`, `draw.pic(${picture}): picture resource not found`);
        return;
      }
      ctx.state.setPictureBuffers(decodePic(bytes));
    },

    'show.pic': (ctx) => {
      ctx.state.setPictureVisible(true);
    },

    'discard.pic': (ctx) => {
      const args = requireNumbers(ctx, 'discard.pic', 1);
      if (!args) return;
      ctx.state.setLoadedPictureNumber(null);
    },

    'add.to.pic': (ctx) => {
      const args = requireNumbers(ctx, 'add.to.pic', 7);
      if (!args) return;
      const [view, loop, cel, x, y, priority, margin] = args;
      ctx.state.recordAddToPic({ view, loop, cel, x, y, priority, margin });
    },

    print: (ctx) => {
      const args = requireNumbers(ctx, 'print', 1);
      if (!args) return;
      ctx.state.setDisplay({ kind: 'print', message: args[0] });
    },

    'print.at': (ctx) => {
      const numbers = requireNumbers(ctx, 'print.at', 4);
      if (!numbers) return;
      const [message, row, col, width] = numbers;
      ctx.state.setDisplay({ kind: 'print.at', message, row, col, width });
    },

    display: (ctx) => {
      const numbers = requireNumbers(ctx, 'display', 3);
      if (!numbers) return;
      const [row, col, message] = numbers;
      ctx.state.setDisplay({ kind: 'display', message, row, col });
    },

    set: (ctx) => {
      const args = requireNumbers(ctx, 'set', 1);
      if (!args) return;
      ctx.state.setFlag(args[0], true);
    },

    reset: (ctx) => {
      const args = requireNumbers(ctx, 'reset', 1);
      if (!args) return;
      ctx.state.setFlag(args[0], false);
    },

    toggle: (ctx) => {
      const args = requireNumbers(ctx, 'toggle', 1);
      if (!args) return;
      ctx.state.toggleFlag(args[0]);
    },

    'set.v': (ctx) => {
      const args = requireNumbers(ctx, 'set.v', 1);
      if (!args) return;
      ctx.state.setFlag(ctx.state.getVar(args[0]), true);
    },

    'reset.v': (ctx) => {
      const args = requireNumbers(ctx, 'reset.v', 1);
      if (!args) return;
      ctx.state.setFlag(ctx.state.getVar(args[0]), false);
    },

    assign: (ctx) => {
      const args = requireNumbers(ctx, 'assign', 2);
      if (!args) return;
      const [target, value] = args;
      ctx.state.setVar(target, wrapByte(value));
    },

    addv: (ctx) => {
      const args = requireNumbers(ctx, 'addv', 2);
      if (!args) return;
      const [target, source] = args;
      ctx.state.setVar(target, wrapByte(ctx.state.getVar(target) + ctx.state.getVar(source)));
    },

    subv: (ctx) => {
      const args = requireNumbers(ctx, 'subv', 2);
      if (!args) return;
      const [target, source] = args;
      ctx.state.setVar(target, wrapByte(ctx.state.getVar(target) - ctx.state.getVar(source)));
    },

    position: (ctx) => {
      const args = requireNumbers(ctx, 'position', 3);
      if (!args) return;
      const [object, x, y] = args;
      ctx.state.setPosition(object, x, y);
    },

    'position.v': (ctx) => {
      const args = requireNumbers(ctx, 'position.v', 3);
      if (!args) return;
      const [object, xVar, yVar] = args;
      ctx.state.setPosition(object, ctx.state.getVar(xVar), ctx.state.getVar(yVar));
    },

    'get.posn': (ctx) => {
      const args = requireNumbers(ctx, 'get.posn', 3);
      if (!args) return;
      const [object, xVar, yVar] = args;
      const position = ctx.state.getPosition(object);
      ctx.state.setVar(xVar, position.x);
      ctx.state.setVar(yVar, position.y);
    },

    'set.priority': (ctx) => {
      const args = requireNumbers(ctx, 'set.priority', 2);
      if (!args) return;
      const [object, priority] = args;
      ctx.state.setPriority(object, priority);
    },

    'release.priority': (ctx) => {
      const args = requireNumbers(ctx, 'release.priority', 1);
      if (!args) return;
      ctx.state.releasePriority(args[0]);
    },

    'player.control': (ctx) => {
      ctx.state.setEgoControlMode('player');
    },

    'program.control': (ctx) => {
      ctx.state.setEgoControlMode('program');
    },

    'prevent.input': (ctx) => {
      ctx.state.setInputEnabled(false);
    },

    'accept.input': (ctx) => {
      ctx.state.setInputEnabled(true);
    },

    get: (ctx) => {
      const args = requireNumbers(ctx, 'get', 1);
      if (!args) return;
      ctx.state.takeObject(args[0]);
    },

    'get.f': (ctx) => {
      const args = requireNumbers(ctx, 'get.f', 1);
      if (!args) return;
      ctx.state.takeObject(ctx.state.getVar(args[0]));
    },

    drop: (ctx) => {
      const args = requireNumbers(ctx, 'drop', 1);
      if (!args) return;
      ctx.state.dropObject(args[0], 0);
    },

    put: (ctx) => {
      const args = requireNumbers(ctx, 'put', 2);
      if (!args) return;
      const [object, roomVar] = args;
      ctx.state.dropObject(object, ctx.state.getVar(roomVar));
    },

    'put.f': (ctx) => {
      const args = requireNumbers(ctx, 'put.f', 2);
      if (!args) return;
      const [objectVar, roomVar] = args;
      ctx.state.dropObject(ctx.state.getVar(objectVar), ctx.state.getVar(roomVar));
    },

    'get.room.f': (ctx) => {
      const args = requireNumbers(ctx, 'get.room.f', 2);
      if (!args) return;
      const [objectVar, varOut] = args;
      ctx.state.setVar(varOut, ctx.state.getObjectRoom(ctx.state.getVar(objectVar)));
    },

    draw: (ctx) => {
      const args = requireNumbers(ctx, 'draw', 1);
      if (!args) return;
      ctx.state.setObjectVisible(args[0], true);
    },

    erase: (ctx) => {
      const args = requireNumbers(ctx, 'erase', 1);
      if (!args) return;
      ctx.state.setObjectVisible(args[0], false);
    },

    random: (ctx) => {
      const args = requireNumbers(ctx, 'random', 3);
      if (!args) return;
      const [low, high, varOut] = args;
      ctx.state.setVar(varOut, low + Math.floor(random() * (high - low + 1)));
    },

    distance: (ctx) => {
      const args = requireNumbers(ctx, 'distance', 3);
      if (!args) return;
      const [object1, object2, varOut] = args;
      const a = ctx.state.getPosition(object1);
      const b = ctx.state.getPosition(object2);
      ctx.state.setVar(varOut, Math.min(255, Math.abs(a.x - b.x) + Math.abs(a.y - b.y)));
    },

    addn: (ctx) => {
      const args = requireNumbers(ctx, 'addn', 2);
      if (!args) return;
      const [target, amount] = args;
      ctx.state.setVar(target, wrapByte(ctx.state.getVar(target) + amount));
    },

    subn: (ctx) => {
      const args = requireNumbers(ctx, 'subn', 2);
      if (!args) return;
      const [target, amount] = args;
      ctx.state.setVar(target, wrapByte(ctx.state.getVar(target) - amount));
    },

    'set.text.attribute': (ctx) => {
      const args = requireNumbers(ctx, 'set.text.attribute', 2);
      if (!args) return;
      ctx.state.setTextAttribute(args[0], args[1]);
    },

    'set.key': (ctx) => {
      const args = requireNumbers(ctx, 'set.key', 3);
      if (!args) return;
      const [asciiCode, scanCode, controller] = args;
      ctx.state.setKeyMapping(asciiCode, scanCode, controller);
    },

    'set.menu': (ctx) => {
      const args = requireNumbers(ctx, 'set.menu', 1);
      if (!args) return;
      ctx.state.addMenu(args[0]);
    },

    'set.menu.item': (ctx) => {
      const args = requireNumbers(ctx, 'set.menu.item', 2);
      if (!args) return;
      ctx.state.addMenuItem(args[0], args[1]);
    },

    'enable.item': (ctx) => {
      const args = requireNumbers(ctx, 'enable.item', 1);
      if (!args) return;
      ctx.state.setItemEnabled(args[0], true);
    },

    'disable.item': (ctx) => {
      const args = requireNumbers(ctx, 'disable.item', 1);
      if (!args) return;
      ctx.state.setItemEnabled(args[0], false);
    },

    'script.size': (ctx) => {
      const args = requireNumbers(ctx, 'script.size', 1);
      if (!args) return;
      ctx.state.setScriptSize(args[0]);
    },

    'show.obj': (ctx) => {
      const args = requireNumbers(ctx, 'show.obj', 1);
      if (!args) return;
      ctx.state.setDisplay({ kind: 'show.obj', object: args[0] });
    },

    status: (ctx) => {
      ctx.state.setDisplay({ kind: 'status' });
    },

    'obj.status.f': (ctx) => {
      const args = requireNumbers(ctx, 'obj.status.f', 1);
      if (!args) return;
      ctx.state.setDisplay({ kind: 'obj.status', object: ctx.state.getVar(args[0]) });
    },

    'get.string': (ctx) => {
      const args = requireNumbers(ctx, 'get.string', 5);
      if (!args) return;
      const [index, message, row, col, maxLength] = args;
      ctx.state.setDisplay({ kind: 'get.string', index, message, row, col, maxLength });
    },

    'get.num': (ctx) => {
      const args = requireNumbers(ctx, 'get.num', 2);
      if (!args) return;
      const [message, target] = args;
      ctx.state.setDisplay({ kind: 'get.num', message, target });
    },

    'set.string': (ctx) => {
      const args = requireNumbers(ctx, 'set.string', 2);
      if (!args) return;
      const [index, message] = args;
      ctx.state.setString(index, getMessage(message) ?? String(message));
    },
  };

  // .v is the macro alias real CG source actually writes for these (SYSDEFS.AL:
  // `%define get.v get.f` etc.) - register both names against the same impl.
  commands['get.v'] = commands['get.f'];
  commands['put.v'] = commands['put.f'];
  commands['get.room.v'] = commands['get.room.f'];

  return commands;
}

/** Test-function implementations from the same AGI command subset. `posn` is a boolean test in real AGI, not a command. */
export const tests: Record<string, TestImpl> = {
  posn: (ctx) => {
    const [object, x1, y1, x2, y2] = ctx.args.map(Number);
    const position = ctx.state.getPosition(object);
    return position.x >= x1 && position.x <= x2 && position.y >= y1 && position.y <= y2;
  },

  has: (ctx) => {
    const [object] = ctx.args.map(Number);
    return ctx.state.isCarried(object);
  },

  /** `obj.in.room`'s room argument is always var-encoded in this game's logic source (it's always `current.room` or a scratch var), so it's resolved through `getVar` here rather than treated as a literal. */
  'obj.in.room': (ctx) => {
    const [object, roomVar] = ctx.args.map(Number);
    return ctx.state.getObjectRoom(object) === ctx.state.getVar(roomVar);
  },

  controller: (ctx) => {
    const [controller] = ctx.args.map(Number);
    return ctx.state.isControllerActive(controller);
  },

  'compare.strings': (ctx) => {
    const [a, b] = ctx.args.map(Number);
    const normalize = (s: string) => s.trim().toLowerCase();
    return normalize(ctx.state.getString(a)) === normalize(ctx.state.getString(b));
  },
};

tests['obj.in.box'] = tests['posn'];
