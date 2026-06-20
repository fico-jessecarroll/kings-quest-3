import { describe, expect, it } from 'vitest';
import { GRID_COLS, GRID_ROWS } from '../../src/render/screen';
import { centeredBox, formatMenuBar, formatStatusLine, layoutMenuBarSegments, layoutWindowBox, wordWrap } from '../../src/render/text';

describe('wordWrap', () => {
  it('keeps a short line on its own', () => {
    expect(wordWrap('hello world', 30)).toEqual(['hello world']);
  });

  it('breaks on whitespace once a line would exceed the width', () => {
    expect(wordWrap('the quick brown fox jumps', 10)).toEqual(['the quick', 'brown fox', 'jumps']);
  });

  it('never produces a line longer than maxWidth', () => {
    const lines = wordWrap('a bb ccc dddd eeeee ffffff ggggggg', 5);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(5);
    }
  });

  it('hard-splits a single word longer than maxWidth', () => {
    expect(wordWrap('supercalifragilistic', 6)).toEqual(['superc', 'alifra', 'gilist', 'ic']);
  });

  it('collapses runs of whitespace between words', () => {
    expect(wordWrap('hello    world', 30)).toEqual(['hello world']);
  });

  it('returns a single empty line for empty input', () => {
    expect(wordWrap('', 10)).toEqual(['']);
  });

  it('rejects a non-positive width', () => {
    expect(() => wordWrap('hi', 0)).toThrow(RangeError);
    expect(() => wordWrap('hi', -1)).toThrow(RangeError);
  });
});

describe('layoutWindowBox', () => {
  it('sizes the box to the longest line plus margin on every side', () => {
    const box = layoutWindowBox(['hi', 'there'], { col: 0, row: 0 });
    expect(box.width).toBe('there'.length + 4);
    expect(box.height).toBe(2 + 4);
  });

  it('anchors at the requested top-left when it fits', () => {
    const box = layoutWindowBox(['hi'], { col: 5, row: 3 });
    expect(box).toMatchObject({ col: 5, row: 3 });
  });

  it('clamps so the box never runs off the grid', () => {
    const box = layoutWindowBox(['a long line of text here'], { col: GRID_COLS, row: GRID_ROWS });
    expect(box.col + box.width).toBeLessThanOrEqual(GRID_COLS);
    expect(box.row + box.height).toBeLessThanOrEqual(GRID_ROWS);
  });

  it('never grows past the grid even for very long content', () => {
    const longLine = 'x'.repeat(GRID_COLS * 2);
    const box = layoutWindowBox([longLine], { col: 0, row: 0 });
    expect(box.width).toBeLessThanOrEqual(GRID_COLS);
  });
});

describe('centeredBox', () => {
  it('centers a box of the given size on the grid', () => {
    const { col, row } = centeredBox(10, 4);
    expect(col).toBe(Math.floor((GRID_COLS - 10) / 2));
    expect(row).toBe(Math.floor((GRID_ROWS - 4) / 2));
  });

  it('never returns a negative position for an oversized box', () => {
    const { col, row } = centeredBox(GRID_COLS + 10, GRID_ROWS + 10);
    expect(col).toBeGreaterThanOrEqual(0);
    expect(row).toBeGreaterThanOrEqual(0);
  });
});

describe('formatStatusLine', () => {
  it('puts score on the left and sound state on the right, padded to the grid width', () => {
    const line = formatStatusLine(12, 100, true);
    expect(line.startsWith('Score:12 of 100')).toBe(true);
    expect(line.endsWith('Sound:on')).toBe(true);
    expect(line.length).toBe(GRID_COLS);
  });

  it('reflects sound being off', () => {
    expect(formatStatusLine(0, 0, false).endsWith('Sound:off')).toBe(true);
  });
});

describe('formatMenuBar', () => {
  it('joins menu items with double spaces', () => {
    expect(formatMenuBar(['File', 'Game', 'Speed'])).toBe('File  Game  Speed');
  });

  it('returns an empty string for no items', () => {
    expect(formatMenuBar([])).toBe('');
  });
});
