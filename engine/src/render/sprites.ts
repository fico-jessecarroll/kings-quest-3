// Placeholder sprite rendering.
//
// There are no decoded VIEW resources yet, so ego and animated objects are
// drawn as flat coloured boxes rather than real cels. What *is* real is each
// object's VM position (position/position.v) and priority band
// (set.priority, or AGI's automatic y-based calculation) - this module only
// honours those two things, anchoring each box at its object's (x, y) the
// same way a real AGI cel is anchored: x is the left edge, y is the bottom.

import { PICTURE_HEIGHT } from '../resources/pic';
import type { VmState } from '../vm/state';
import { pictureToCanvasX, pictureToCanvasY, SCALE_X } from './screen';

/** AGI convention: object/view 0 is always ego. */
export const EGO_OBJECT_NUMBER = 0;

/** Priorities 0-3 are reserved for picture control lines; only 4-15 are usable drawing bands. */
export const MIN_PRIORITY = 4;
export const MAX_PRIORITY = 15;

/** Number of automatic priority bands spread between the horizon and the bottom of the picture. */
const AUTO_PRIORITY_BANDS = MAX_PRIORITY - MIN_PRIORITY + 1;

/**
 * Default horizon (in picture-buffer y) used for automatic priority when a
 * room hasn't set one. Real rooms call `set.horizon`, but the VM doesn't
 * track that yet (no command/state for it exists in this codebase), so this
 * is a placeholder until that lands.
 */
export const DEFAULT_HORIZON = 0;

/**
 * AGI's automatic (y-based) priority calculation, used for any object that
 * hasn't been given a fixed priority via `set.priority`: everything above
 * the horizon is priority 4, and the region from the horizon to the bottom
 * of the picture is split evenly into bands 4-15 (closer to the bottom of
 * the screen reads as higher priority, i.e. nearer the viewer).
 */
export function autoPriorityForY(y: number, horizon = DEFAULT_HORIZON): number {
  if (y <= horizon) return MIN_PRIORITY;
  const span = Math.max(1, PICTURE_HEIGHT - horizon);
  const band = Math.floor(((y - horizon) * AUTO_PRIORITY_BANDS) / span);
  return Math.min(MAX_PRIORITY, MIN_PRIORITY + band);
}

/** An object's effective priority: its fixed `set.priority` value if any, otherwise the automatic y-based band. */
export function priorityForObject(state: VmState, objectNumber: number, horizon = DEFAULT_HORIZON): number {
  const fixed = state.getPriority(objectNumber);
  if (fixed !== null) return fixed;
  return autoPriorityForY(state.getPosition(objectNumber).y, horizon);
}

/** One flat colour per priority band (indices 0-3 are unused/reserved, but kept so `priority` can index directly). */
const PRIORITY_COLORS: readonly string[] = [
  '#000000',
  '#000000',
  '#000000',
  '#000000',
  '#5555ff', // 4
  '#55ff55', // 5
  '#55ffff', // 6
  '#ff5555', // 7
  '#ff55ff', // 8
  '#ffff55', // 9
  '#aa0000', // 10
  '#aa00aa', // 11
  '#aa5500', // 12
  '#aaaaaa', // 13
  '#ffffff', // 14
  '#00aaaa', // 15
];

export function colorForPriority(priority: number): string {
  const index = Math.min(PRIORITY_COLORS.length - 1, Math.max(0, Math.round(priority)));
  return PRIORITY_COLORS[index];
}

/** Placeholder box size in picture-buffer pixels, standing in for a real AGI view cel (roughly ego-sized). */
export const PLACEHOLDER_WIDTH = 8;
export const PLACEHOLDER_HEIGHT = 16;

export interface SpriteDescriptor {
  objectNumber: number;
  x: number;
  y: number;
  priority: number;
}

/**
 * Builds one sprite descriptor per object number, sorted back-to-front by
 * priority (lower priority bands first) so equal-priority ties keep their
 * input order and higher-priority objects paint over lower ones, the same
 * occlusion rule AGI applies to real view cels.
 */
export function collectSprites(state: VmState, objectNumbers: number[], horizon = DEFAULT_HORIZON): SpriteDescriptor[] {
  return objectNumbers
    .map((objectNumber) => {
      const { x, y } = state.getPosition(objectNumber);
      return { objectNumber, x, y, priority: priorityForObject(state, objectNumber, horizon) };
    })
    .sort((a, b) => a.priority - b.priority);
}

/** Draws one placeholder sprite box, anchored at (x, y) with y as the box's bottom edge - matching real AGI cel anchoring. */
export function drawSprite(ctx: CanvasRenderingContext2D, sprite: SpriteDescriptor): void {
  const width = PLACEHOLDER_WIDTH * SCALE_X;
  const height = PLACEHOLDER_HEIGHT;
  const left = pictureToCanvasX(sprite.x);
  const top = pictureToCanvasY(sprite.y) - height;

  ctx.fillStyle = colorForPriority(sprite.priority);
  ctx.fillRect(left, top, width, height);
  ctx.strokeStyle = '#000000';
  ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
}

export function drawSprites(ctx: CanvasRenderingContext2D, sprites: SpriteDescriptor[]): void {
  for (const sprite of sprites) {
    drawSprite(ctx, sprite);
  }
}
