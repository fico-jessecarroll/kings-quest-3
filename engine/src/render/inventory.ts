// The inventory ("status") screen and the single-item "show.obj"/look-at-
// object display. There's no VIEW decoder yet, so a carried item's picture
// is a labelled placeholder box - the same stand-in sprites.ts uses for
// animated-object cels - rather than a real view cel.

import { PICTURE_HEIGHT } from '../resources/pic';
import type { AgiObject } from '../resources/object';
import type { VmState } from '../vm/state';
import { CHAR_HEIGHT, CHAR_WIDTH, GRID_COLS, GRID_ROWS, PICTURE_TOP, SCREEN_WIDTH } from './screen';
import type { WindowBox } from './text';

/** 1-character border-plus-padding gutter on every side of the inventory box, matching the window chrome text.ts's message windows use. */
const MARGIN = 1;

/** Objects from `objects` that ego is currently carrying, in object-number order - the listing AGI's `status()` draws, and the set `show.obj.v`'s selection comes from. */
export function getCarriedItems(objects: readonly AgiObject[], state: VmState): AgiObject[] {
  return objects.filter((object) => state.isCarried(object.id));
}

/** The item a 0-based list cursor refers to, or undefined once it runs outside the list - the lookup "look at object"'s arrow-keys-then-ENTER selection resolves through. */
export function itemAtIndex(items: readonly AgiObject[], index: number): AgiObject | undefined {
  if (index < 0) return undefined;
  return items[index];
}

/** Clamps a moving list cursor to the carried-items range, or -1 if there's nothing to select - keeps keyboard up/down navigation from running off either end of the list. */
export function clampSelection(index: number, itemCount: number): number {
  if (itemCount <= 0) return -1;
  return Math.max(0, Math.min(index, itemCount - 1));
}

/** Lays out the inventory list box: just big enough for the longest item name, with a placeholder line substituted when nothing is carried, centered on the 40x25 grid and clamped to it. */
export function layoutInventoryBox(itemNames: readonly string[]): WindowBox {
  const lines = itemNames.length > 0 ? itemNames : ['(carrying nothing)'];
  const contentWidth = Math.max(1, ...lines.map((line) => line.length));
  const width = Math.min(GRID_COLS, contentWidth + MARGIN * 2);
  const height = Math.min(GRID_ROWS, lines.length + MARGIN * 2);
  return {
    col: Math.max(0, Math.floor((GRID_COLS - width) / 2)),
    row: Math.max(0, Math.floor((GRID_ROWS - height) / 2)),
    width,
    height,
  };
}

/** Character-grid row the first listed item is drawn on - one row in from the box's top edge, past the border/padding gutter. */
function firstItemRow(box: WindowBox): number {
  return box.row + MARGIN;
}

/** Maps a character-grid row (e.g. from a mouse click on the canvas) back to a 0-based list index, or null if the row falls in the box's border/padding gutter or past the last item - the inverse of the row each item is drawn on. */
export function indexForGridRow(box: WindowBox, itemCount: number, gridRow: number): number | null {
  const index = gridRow - firstItemRow(box);
  if (index < 0 || index >= itemCount) return null;
  return index;
}

function cellRect(box: WindowBox): { x: number; y: number; width: number; height: number } {
  return {
    x: box.col * CHAR_WIDTH,
    y: box.row * CHAR_HEIGHT,
    width: box.width * CHAR_WIDTH,
    height: box.height * CHAR_HEIGHT,
  };
}

/** Renders AGI's `status()` inventory screen: a centered box listing every carried item's name, with `selectedIndex` (if any) drawn in reverse video for the "look at object" picker. */
export function drawInventoryScreen(ctx: CanvasRenderingContext2D, items: readonly AgiObject[], selectedIndex: number | null = null): void {
  const names = items.map((item) => item.name);
  const lines = names.length > 0 ? names : ['(carrying nothing)'];
  const box = layoutInventoryBox(names);
  const rect = cellRect(box);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);

  ctx.font = `${CHAR_HEIGHT}px monospace`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  const textLeft = rect.x + MARGIN * CHAR_WIDTH;
  const textWidth = rect.width - MARGIN * 2 * CHAR_WIDTH;
  const firstRow = firstItemRow(box);
  for (let i = 0; i < lines.length; i++) {
    const lineTop = (firstRow + i) * CHAR_HEIGHT;
    if (i === selectedIndex) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(textLeft, lineTop, textWidth, CHAR_HEIGHT);
      ctx.fillStyle = '#ffffff';
    } else {
      ctx.fillStyle = '#000000';
    }
    ctx.fillText(lines[i], textLeft, lineTop);
  }
}

/** Placeholder "view" box size in canvas pixels, standing in for a real inventory-item view cel. */
export const ITEM_VIEW_WIDTH = 48;
export const ITEM_VIEW_HEIGHT = 64;

/** Renders AGI's `show.obj`/look-at-object display: a centered placeholder box for `item`'s view, captioned with its name underneath (there's no VIEW decoder yet to draw the real cel). */
export function drawObjectView(ctx: CanvasRenderingContext2D, item: AgiObject): void {
  const left = Math.floor((SCREEN_WIDTH - ITEM_VIEW_WIDTH) / 2);
  const top = PICTURE_TOP + Math.floor((PICTURE_HEIGHT - ITEM_VIEW_HEIGHT) / 2);

  ctx.fillStyle = '#5555ff';
  ctx.fillRect(left, top, ITEM_VIEW_WIDTH, ITEM_VIEW_HEIGHT);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, ITEM_VIEW_WIDTH - 1, ITEM_VIEW_HEIGHT - 1);

  ctx.font = `${CHAR_HEIGHT}px monospace`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(item.name, left + ITEM_VIEW_WIDTH / 2, top + ITEM_VIEW_HEIGHT + 2);
}
