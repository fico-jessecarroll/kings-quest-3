import { describe, expect, it } from 'vitest';
import {
  GRID_COLS,
  GRID_ROWS,
  INPUT_AREA_HEIGHT,
  INPUT_AREA_TOP,
  PICTURE_TOP,
  pictureToCanvasX,
  pictureToCanvasY,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  STATUS_LINE_HEIGHT,
} from '../../src/render/screen';

describe('screen geometry', () => {
  it('is a 320x200 grid of 8x8 cells (40x25)', () => {
    expect(SCREEN_WIDTH).toBe(320);
    expect(SCREEN_HEIGHT).toBe(200);
    expect(GRID_COLS).toBe(40);
    expect(GRID_ROWS).toBe(25);
  });

  it('stacks status line, picture, and input area to exactly fill the screen', () => {
    expect(STATUS_LINE_HEIGHT).toBe(8);
    expect(PICTURE_TOP).toBe(STATUS_LINE_HEIGHT);
    expect(INPUT_AREA_TOP).toBe(176);
    expect(INPUT_AREA_HEIGHT).toBe(24);
    expect(INPUT_AREA_TOP + INPUT_AREA_HEIGHT).toBe(SCREEN_HEIGHT);
  });
});

describe('pictureToCanvasX/Y', () => {
  it('doubles x to account for the 2x horizontal scale', () => {
    expect(pictureToCanvasX(0)).toBe(0);
    expect(pictureToCanvasX(10)).toBe(20);
    expect(pictureToCanvasX(159)).toBe(318);
  });

  it('offsets y below the status line, with no vertical scaling', () => {
    expect(pictureToCanvasY(0)).toBe(8);
    expect(pictureToCanvasY(167)).toBe(175);
  });
});
