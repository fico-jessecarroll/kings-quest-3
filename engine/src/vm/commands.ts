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
  /** Receives one line per first-seen problem (bad args, missing resource). Defaults to console.warn. */
  logger?: (message: string) => void;
}

function numberArg(ctx: CommandContext, index: number): number | undefined {
  const value = ctx.args[index];
  return typeof value === 'number' ? value : undefined;
}

export function createCommands(options: CommandsOptions): Record<string, CommandImpl> {
  const logger = options.logger ?? ((message: string) => console.warn(message));
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

  return {
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
  };
}

/** Test-function implementations from the same AGI command subset. `posn` is a boolean test in real AGI, not a command. */
export const tests: Record<string, TestImpl> = {
  posn: (ctx) => {
    const [object, x1, y1, x2, y2] = ctx.args.map(Number);
    const position = ctx.state.getPosition(object);
    return position.x >= x1 && position.x <= x2 && position.y >= y1 && position.y <= y2;
  },
};
