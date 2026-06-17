import { describe, expect, it } from 'vitest';
import { readPic } from '../helpers/assets';
import {
  decodePic,
  PicDecodeError,
  PICTURE_WIDTH,
  PICTURE_HEIGHT,
  DEFAULT_VISUAL_COLOR,
  DEFAULT_PRIORITY_COLOR,
  EGA_PALETTE,
  render,
} from '../../src/resources/pic';

function at(buffer: Uint8Array, x: number, y: number): number {
  return buffer[y * PICTURE_WIDTH + x];
}

describe('decodePic', () => {
  it('produces buffers of the correct AGI picture dimensions, filled with defaults', () => {
    const { visual, priority } = decodePic(Uint8Array.from([0xff]));
    expect(visual.length).toBe(PICTURE_WIDTH * PICTURE_HEIGHT);
    expect(priority.length).toBe(PICTURE_WIDTH * PICTURE_HEIGHT);
    expect(at(visual, 0, 0)).toBe(DEFAULT_VISUAL_COLOR);
    expect(at(priority, 0, 0)).toBe(DEFAULT_PRIORITY_COLOR);
  });

  it('0xF0 sets the visual colour and enables visual drawing for 0xF6 absolute lines', () => {
    // F0 01: set visual colour 1 (blue); F6: absolute line (0,0)->(5,0); FF: end
    const bytes = [0xf0, 0x01, 0xf6, 0x00, 0x00, 0x05, 0x00, 0xff];
    const { visual } = decodePic(Uint8Array.from(bytes));
    for (let x = 0; x <= 5; x++) {
      expect(at(visual, x, 0)).toBe(1);
    }
    // a pixel off the line keeps the default background colour
    expect(at(visual, 0, 1)).toBe(DEFAULT_VISUAL_COLOR);
  });

  it('0xF1 disables visual drawing so subsequent lines do not touch the visual buffer', () => {
    const bytes = [0xf0, 0x02, 0xf1, 0xf6, 0x00, 0x00, 0x05, 0x00, 0xff];
    const { visual } = decodePic(Uint8Array.from(bytes));
    expect(at(visual, 0, 0)).toBe(DEFAULT_VISUAL_COLOR);
    expect(at(visual, 5, 0)).toBe(DEFAULT_VISUAL_COLOR);
  });

  it('0xF2 sets the priority colour and 0xF3 disables it again', () => {
    // F2 0C: priority colour 12, draw a line into the priority buffer only.
    const bytes = [0xf2, 0x0c, 0xf6, 0x01, 0x01, 0x04, 0x01, 0xf3, 0xf6, 0x06, 0x01, 0x08, 0x01, 0xff];
    const { visual, priority } = decodePic(Uint8Array.from(bytes));
    for (let x = 1; x <= 4; x++) {
      expect(at(priority, x, 1)).toBe(12);
    }
    // visual buffer was never enabled, stays default
    expect(at(visual, 1, 1)).toBe(DEFAULT_VISUAL_COLOR);
    // priority disabled before the second line, so it must not have been drawn
    expect(at(priority, 6, 1)).toBe(DEFAULT_PRIORITY_COLOR);
    expect(at(priority, 8, 1)).toBe(DEFAULT_PRIORITY_COLOR);
  });

  it('0xF4 y-corner draws an alternating vertical-then-horizontal staircase', () => {
    // F0 03: visual colour 3. F4 corner: start (2,2); vertical to y=8; horizontal to x=6.
    const bytes = [0xf0, 0x03, 0xf4, 0x02, 0x02, 0x08, 0x06, 0xff];
    const { visual } = decodePic(Uint8Array.from(bytes));
    for (let y = 2; y <= 8; y++) {
      expect(at(visual, 2, y)).toBe(3);
    }
    for (let x = 2; x <= 6; x++) {
      expect(at(visual, x, 8)).toBe(3);
    }
  });

  it('0xF5 x-corner draws an alternating horizontal-then-vertical staircase', () => {
    // F0 05: visual colour 5. F5 corner: start (2,2); horizontal to x=8; vertical to y=6.
    const bytes = [0xf0, 0x05, 0xf5, 0x02, 0x02, 0x08, 0x06, 0xff];
    const { visual } = decodePic(Uint8Array.from(bytes));
    for (let x = 2; x <= 8; x++) {
      expect(at(visual, x, 2)).toBe(5);
    }
    for (let y = 2; y <= 6; y++) {
      expect(at(visual, 8, y)).toBe(5);
    }
  });

  it('0xF6 absolute line draws straight segments between explicit coordinates', () => {
    const bytes = [0xf0, 0x04, 0xf6, 0x00, 0x00, 0x00, 0x05, 0x05, 0x05, 0xff];
    const { visual } = decodePic(Uint8Array.from(bytes));
    for (let y = 0; y <= 5; y++) {
      expect(at(visual, 0, y)).toBe(4);
    }
    for (let x = 0; x <= 5; x++) {
      expect(at(visual, x, 5)).toBe(4);
    }
  });

  it('0xF7 relative line decodes signed nibble displacements from the start point', () => {
    // F0 02: visual colour 2. F7: start (2,2); displacement byte 0x31 -> dx=+3, dy=+1 => (5,3).
    const bytes = [0xf0, 0x02, 0xf7, 0x02, 0x02, 0x31, 0xff];
    const { visual } = decodePic(Uint8Array.from(bytes));
    expect(at(visual, 2, 2)).toBe(2);
    expect(at(visual, 5, 3)).toBe(2);
  });

  it('0xF7 relative line supports negative displacements via the sign nibble bit', () => {
    // displacement 0x9A -> dx nibble 9 (negative, magnitude 1) => -1; dy nibble A (negative, magnitude 2) => -2
    const bytes = [0xf0, 0x06, 0xf7, 0x08, 0x08, 0x9a, 0xff];
    const { visual } = decodePic(Uint8Array.from(bytes));
    expect(at(visual, 8, 8)).toBe(6);
    expect(at(visual, 7, 6)).toBe(6);
  });

  it('0xF8 flood fill paints enclosed background pixels up to the drawn border', () => {
    // Draw a small closed rectangle border in colour 7, then flood fill colour 9 from inside it.
    const bytes = [
      0xf0, 0x07,
      0xf6, 0x02, 0x02, 0x06, 0x02, 0x06, 0x06, 0x02, 0x06, 0x02, 0x02,
      0xf0, 0x09,
      0xf8, 0x04, 0x04,
      0xff,
    ];
    const { visual } = decodePic(Uint8Array.from(bytes));
    // interior is filled
    expect(at(visual, 4, 4)).toBe(9);
    expect(at(visual, 3, 3)).toBe(9);
    // border itself keeps its own colour
    expect(at(visual, 2, 2)).toBe(7);
    // outside the rectangle is untouched
    expect(at(visual, 0, 0)).toBe(DEFAULT_VISUAL_COLOR);
  });

  it('0xF9/0xFA set a pen pattern and plot it without throwing, painting the centre pixel', () => {
    // F0 0A: visual colour 10. F9 00: solid square pen, smallest size. FA: plot at (10,10).
    const bytes = [0xf0, 0x0a, 0xf9, 0x00, 0xfa, 0x0a, 0x0a, 0xff];
    const { visual } = decodePic(Uint8Array.from(bytes));
    expect(at(visual, 10, 10)).toBe(10);
  });

  it('throws PicDecodeError for an unrecognised opcode', () => {
    const bytes = [0xf0, 0x01, 0xee, 0xff];
    expect(() => decodePic(Uint8Array.from(bytes))).toThrow(PicDecodeError);
  });

  it('throws PicDecodeError for a stream truncated mid-opcode', () => {
    // 0xF0 requires a colour byte that never arrives.
    expect(() => decodePic(Uint8Array.from([0xf0]))).toThrow(PicDecodeError);
  });

  it('throws PicDecodeError when the stream ends without an 0xFF terminator', () => {
    expect(() => decodePic(Uint8Array.from([0xf0, 0x01]))).toThrow(PicDecodeError);
  });

  it('decodes a real PIC resource without throwing', () => {
    const data = readPic('PIC.1');
    const { visual, priority } = decodePic(new Uint8Array(data));
    expect(visual.length).toBe(PICTURE_WIDTH * PICTURE_HEIGHT);
    expect(priority.length).toBe(PICTURE_WIDTH * PICTURE_HEIGHT);
    // the picture draws into more than just the default background colour
    expect(new Set(visual)).not.toEqual(new Set([DEFAULT_VISUAL_COLOR]));
  });
});

describe('EGA_PALETTE', () => {
  it('maps all 16 AGI colours to RGBA tuples', () => {
    expect(EGA_PALETTE.length).toBe(16);
    expect(EGA_PALETTE[0]).toEqual([0x00, 0x00, 0x00, 0xff]); // black
    expect(EGA_PALETTE[15]).toEqual([0xff, 0xff, 0xff, 0xff]); // white
  });
});

describe('render', () => {
  it('scales a picture buffer 2x horizontally into RGBA pixel data', () => {
    const bytes = [0xf0, 0x04, 0xf6, 0x00, 0x00, 0x02, 0x00, 0xff]; // red horizontal line
    const { visual } = decodePic(Uint8Array.from(bytes));
    const image = render(visual);
    expect(image.width).toBe(PICTURE_WIDTH * 2);
    expect(image.height).toBe(PICTURE_HEIGHT);
    expect(image.data.length).toBe(image.width * image.height * 4);

    const [r, g, b, a] = EGA_PALETTE[4];
    // source pixel (0,0) should appear at both (0,0) and (1,0) in the scaled output
    for (const dx of [0, 1]) {
      const idx = (0 * image.width + dx) * 4;
      expect([image.data[idx], image.data[idx + 1], image.data[idx + 2], image.data[idx + 3]]).toEqual([r, g, b, a]);
    }
  });
});
