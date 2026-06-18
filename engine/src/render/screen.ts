// Screen geometry and the visual-buffer blitter.
//
// A real AGI screen is a 320x200 EGA display, but internally addressed as a
// 160x200 grid of double-wide pixels split into a 40x25 character grid (8x8
// cells): row 0 is the status line, rows 1-21 (168px, matching
// PICTURE_HEIGHT) are the picture, and rows 22-24 are the input/message
// area. This module owns that layout and the conversion between AGI
// picture-buffer coordinates and on-screen canvas pixels; sprites.ts and
// text.ts both import those conversions from here (one-way - this module
// does not depend on them) so every layer agrees on where things sit.

import { EGA_PALETTE, PICTURE_HEIGHT, PICTURE_WIDTH } from '../resources/pic';

/** Horizontal pixels are doubled on screen; vertical is 1:1 with the picture buffer. */
export const SCALE_X = 2;

export const CHAR_WIDTH = 8;
export const CHAR_HEIGHT = 8;
export const GRID_COLS = 40;
export const GRID_ROWS = 25;

export const SCREEN_WIDTH = PICTURE_WIDTH * SCALE_X; // 320
export const SCREEN_HEIGHT = GRID_ROWS * CHAR_HEIGHT; // 200

/** Row 0 of the 40x25 grid: the status line (score/sound). */
export const STATUS_LINE_HEIGHT = CHAR_HEIGHT; // 8
/** Where the picture starts, directly below the status line. */
export const PICTURE_TOP = STATUS_LINE_HEIGHT; // 8
/** Where the input/message area starts, directly below the picture. */
export const INPUT_AREA_TOP = PICTURE_TOP + PICTURE_HEIGHT; // 176
export const INPUT_AREA_HEIGHT = SCREEN_HEIGHT - INPUT_AREA_TOP; // 24

/** Maps an x coordinate in picture-buffer space (0-159) to a canvas pixel column. */
export function pictureToCanvasX(x: number): number {
  return x * SCALE_X;
}

/** Maps a y coordinate in picture-buffer space (0-167) to a canvas pixel row, offset below the status line. */
export function pictureToCanvasY(y: number): number {
  return y + PICTURE_TOP;
}

/** Sets a canvas's backing size to the full AGI screen (320x200) and disables smoothing so blits stay crisp. */
export function sizeScreenCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = SCREEN_WIDTH;
  canvas.height = SCREEN_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.imageSmoothingEnabled = false;
}

/** Fills the whole canvas with one colour - the base for every frame before the picture/sprites/text are drawn over it. */
export function clearScreen(ctx: CanvasRenderingContext2D, color = '#000000'): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
}

/**
 * Blits a decoded PICTURE visual buffer (160x168 EGA colour indices) into the
 * picture region of the screen, doubling each pixel horizontally.
 */
export function drawVisualBuffer(ctx: CanvasRenderingContext2D, visual: Uint8Array): void {
  const imageData = ctx.createImageData(SCREEN_WIDTH, PICTURE_HEIGHT);
  const data = imageData.data;

  for (let y = 0; y < PICTURE_HEIGHT; y++) {
    for (let x = 0; x < PICTURE_WIDTH; x++) {
      const [r, g, b, a] = EGA_PALETTE[visual[y * PICTURE_WIDTH + x] & 0x0f];
      for (let sx = 0; sx < SCALE_X; sx++) {
        const idx = (y * SCREEN_WIDTH + x * SCALE_X + sx) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      }
    }
  }

  ctx.putImageData(imageData, 0, PICTURE_TOP);
}
