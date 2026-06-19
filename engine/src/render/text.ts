// AGI text rendering: word-wrapped message windows, the status line, and a
// basic menu bar. AGI draws text on an 8x8 character grid (40 columns x 25
// rows over the 320x200 screen, see screen.ts), so every layout below works
// in character cells and is converted to canvas pixels only at draw time -
// that keeps the wrapping/layout math pure and unit-testable without a DOM.

import { CHAR_HEIGHT, CHAR_WIDTH, GRID_COLS, GRID_ROWS } from './screen';

/** AGI's `print` command wraps to this width when no explicit width is given (its own default is roughly a third of the screen). */
export const DEFAULT_PRINT_WIDTH = 30;

/**
 * Greedily wraps `text` into lines no longer than `maxWidth` characters,
 * breaking on whitespace. A single word longer than `maxWidth` is hard-split
 * so it still fits, rather than overflowing the line.
 */
export function wordWrap(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) {
    throw new RangeError(`wordWrap: maxWidth must be positive, got ${maxWidth}`);
  }

  const lines: string[] = [];
  let current = '';

  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    let remaining = word;
    while (remaining.length > maxWidth) {
      if (current.length > 0) {
        lines.push(current);
        current = '';
      }
      lines.push(remaining.slice(0, maxWidth));
      remaining = remaining.slice(maxWidth);
    }

    if (current.length === 0) {
      current = remaining;
    } else if (current.length + 1 + remaining.length <= maxWidth) {
      current += ` ${remaining}`;
    } else {
      lines.push(current);
      current = remaining;
    }
  }

  if (current.length > 0 || lines.length === 0) {
    lines.push(current);
  }
  return lines;
}

export interface WindowBox {
  /** Character column/row of the box's top-left corner, including its border. */
  col: number;
  row: number;
  /** Character width/height of the box, including its border. */
  width: number;
  height: number;
}

/** 1-character border plus 1-character padding on each side, matching AGI's standard message window chrome. */
const BOX_MARGIN = 2;

/** Lays out a box just big enough for `lines`, with margin on every side, anchored at the given top-left cell and clamped to stay on the grid. */
export function layoutWindowBox(lines: string[], topLeft: { col: number; row: number }): WindowBox {
  const contentWidth = Math.max(1, ...lines.map((line) => line.length));
  const width = Math.min(GRID_COLS, contentWidth + BOX_MARGIN * 2);
  const height = Math.min(GRID_ROWS, lines.length + BOX_MARGIN * 2);
  const col = Math.min(Math.max(0, topLeft.col), GRID_COLS - width);
  const row = Math.min(Math.max(0, topLeft.row), GRID_ROWS - height);
  return { col, row, width, height };
}

/** Centers a box of the given size within the grid. */
export function centeredBox(width: number, height: number): { col: number; row: number } {
  return {
    col: Math.max(0, Math.floor((GRID_COLS - width) / 2)),
    row: Math.max(0, Math.floor((GRID_ROWS - height) / 2)),
  };
}

function cellRect(box: WindowBox): { x: number; y: number; width: number; height: number } {
  return {
    x: box.col * CHAR_WIDTH,
    y: box.row * CHAR_HEIGHT,
    width: box.width * CHAR_WIDTH,
    height: box.height * CHAR_HEIGHT,
  };
}

function setTextStyle(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.font = `${CHAR_HEIGHT}px monospace`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = color;
}

/** Draws a window box (white fill, black border) with `lines` printed inside it, one per row. */
function paintWindow(ctx: CanvasRenderingContext2D, lines: string[], box: WindowBox): void {
  const rect = cellRect(box);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);

  setTextStyle(ctx, '#000000');
  const textLeft = rect.x + BOX_MARGIN * CHAR_WIDTH;
  const textTop = rect.y + (BOX_MARGIN / 2) * CHAR_HEIGHT;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], textLeft, textTop + i * CHAR_HEIGHT);
  }
}

/** Renders AGI's `print(message)`: word-wraps to `maxWidth` and draws the box centered on the screen. */
export function drawMessageWindow(ctx: CanvasRenderingContext2D, text: string, maxWidth = DEFAULT_PRINT_WIDTH): void {
  const lines = wordWrap(text, maxWidth);
  const contentWidth = Math.max(1, ...lines.map((line) => line.length));
  const box = layoutWindowBox(lines, centeredBox(contentWidth + BOX_MARGIN * 2, lines.length + BOX_MARGIN * 2));
  paintWindow(ctx, lines, box);
}

/** Renders AGI's `print.at(message, row, col, width)`: word-wraps to `width` and draws the box anchored at (col, row). */
export function drawPrintAt(ctx: CanvasRenderingContext2D, text: string, row: number, col: number, width: number): void {
  const lines = wordWrap(text, width);
  const box = layoutWindowBox(lines, { col, row });
  paintWindow(ctx, lines, box);
}

/** Renders AGI's `display(row, col, message)`: plain text drawn directly over the picture, no window/border. */
export function drawDisplay(ctx: CanvasRenderingContext2D, text: string, row: number, col: number): void {
  setTextStyle(ctx, '#ffffff');
  ctx.fillText(text, col * CHAR_WIDTH, row * CHAR_HEIGHT);
}

/** Plain-text content of the status line: score on the left, sound state on the right, padded to the full grid width. */
export function formatStatusLine(score: number, maxScore: number, soundOn: boolean): string {
  const left = `Score:${score} of ${maxScore}`;
  const right = `Sound:${soundOn ? 'on' : 'off'}`;
  const padding = Math.max(1, GRID_COLS - left.length - right.length);
  return `${left}${' '.repeat(padding)}${right}`;
}

/** Draws the status line (row 0) in AGI's classic reverse-video style: black text on a white bar. */
export function drawStatusLine(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, GRID_COLS * CHAR_WIDTH, CHAR_HEIGHT);
  setTextStyle(ctx, '#000000');
  ctx.fillText(text, 0, 0);
}

/** Plain-text content of a basic menu bar: menu names separated by two spaces. */
export function formatMenuBar(items: string[]): string {
  return items.join('  ');
}

/** Draws a basic menu bar (row 0, replacing the status line while a menu is open). */
export function drawMenuBar(ctx: CanvasRenderingContext2D, items: string[]): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, GRID_COLS * CHAR_WIDTH, CHAR_HEIGHT);
  setTextStyle(ctx, '#000000');
  ctx.fillText(formatMenuBar(items), CHAR_WIDTH / 2, 0);
}
