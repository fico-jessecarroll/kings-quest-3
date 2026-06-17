// AGI v2 PICTURE resource decoder.
//
// A PICTURE resource is a stream of drawing opcodes (0xF0-0xFF) and their
// argument bytes. It paints two parallel 160x168 buffers: the "visual"
// buffer (one of the 16 EGA colours per pixel, what the player sees) and
// the "priority" buffer (a 0-15 priority/depth band used for sprite
// occlusion and special control regions). Coordinate bytes are always
// < 0xF0 because the maximum valid x (159) and y (167) never collide with
// an opcode byte; this is what lets the decoder use byte value 0xF0 as the
// universal "stop, that's the next opcode" signal inside variable-length
// argument lists (corners, lines, fills).

export const PICTURE_WIDTH = 160;
export const PICTURE_HEIGHT = 168;

/** Pixels not touched by any drawing command keep these defaults. */
export const DEFAULT_VISUAL_COLOR = 15;
export const DEFAULT_PRIORITY_COLOR = 4;

/** The 16 standard EGA colours used by AGI, as [r, g, b, a] tuples. */
export const EGA_PALETTE: ReadonlyArray<readonly [number, number, number, number]> = [
  [0x00, 0x00, 0x00, 0xff], // 0 black
  [0x00, 0x00, 0xaa, 0xff], // 1 blue
  [0x00, 0xaa, 0x00, 0xff], // 2 green
  [0x00, 0xaa, 0xaa, 0xff], // 3 cyan
  [0xaa, 0x00, 0x00, 0xff], // 4 red
  [0xaa, 0x00, 0xaa, 0xff], // 5 magenta
  [0xaa, 0x55, 0x00, 0xff], // 6 brown
  [0xaa, 0xaa, 0xaa, 0xff], // 7 light grey
  [0x55, 0x55, 0x55, 0xff], // 8 dark grey
  [0x55, 0x55, 0xff, 0xff], // 9 light blue
  [0x55, 0xff, 0x55, 0xff], // 10 light green
  [0x55, 0xff, 0xff, 0xff], // 11 light cyan
  [0xff, 0x55, 0x55, 0xff], // 12 light red
  [0xff, 0x55, 0xff, 0xff], // 13 light magenta
  [0xff, 0xff, 0x55, 0xff], // 14 yellow
  [0xff, 0xff, 0xff, 0xff], // 15 white
];

export interface PicBuffers {
  visual: Uint8Array;
  priority: Uint8Array;
}

export class PicDecodeError extends Error {}

const OPC_SET_VISUAL = 0xf0;
const OPC_DISABLE_VISUAL = 0xf1;
const OPC_SET_PRIORITY = 0xf2;
const OPC_DISABLE_PRIORITY = 0xf3;
const OPC_Y_CORNER = 0xf4;
const OPC_X_CORNER = 0xf5;
const OPC_ABSOLUTE_LINE = 0xf6;
const OPC_RELATIVE_LINE = 0xf7;
const OPC_FILL = 0xf8;
const OPC_SET_PEN = 0xf9;
const OPC_PLOT_PEN = 0xfa;
const OPC_END = 0xff;

/** Any byte >= this value is an opcode, never picture data. */
const OPCODE_THRESHOLD = 0xf0;

class Reader {
  pos = 0;

  constructor(private readonly data: Uint8Array) {}

  private atEnd(): boolean {
    return this.pos >= this.data.length;
  }

  /** Next byte without consuming it. Treats end-of-data as an implicit stop marker. */
  peek(): number {
    return this.atEnd() ? OPC_END : this.data[this.pos];
  }

  next(): number {
    if (this.atEnd()) {
      throw new PicDecodeError('Unexpected end of PIC data');
    }
    return this.data[this.pos++];
  }
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < PICTURE_WIDTH && y >= 0 && y < PICTURE_HEIGHT;
}

interface PenStyle {
  size: number;
  circle: boolean;
  splatter: boolean;
}

class Decoder {
  readonly visual = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(DEFAULT_VISUAL_COLOR);
  readonly priority = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(DEFAULT_PRIORITY_COLOR);

  visualOn = false;
  priorityOn = false;
  visualColor = 0;
  priorityColor = 0;
  pen: PenStyle = { size: 0, circle: false, splatter: false };

  plot(x: number, y: number): void {
    if (!inBounds(x, y)) return;
    const idx = y * PICTURE_WIDTH + x;
    if (this.visualOn) this.visual[idx] = this.visualColor;
    if (this.priorityOn) this.priority[idx] = this.priorityColor;
  }

  drawLine(x1: number, y1: number, x2: number, y2: number): void {
    // Integer Bresenham, walking from (x1,y1) to (x2,y2) inclusive.
    let x = x1;
    let y = y1;
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const sx = x2 >= x1 ? 1 : -1;
    const sy = y2 >= y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.plot(x, y);
      if (x === x2 && y === y2) break;
      const err2 = err * 2;
      if (err2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (err2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  yCorner(reader: Reader): void {
    let x1 = reader.next();
    let y1 = reader.next();
    this.plot(x1, y1);
    for (;;) {
      if (reader.peek() >= OPCODE_THRESHOLD) break;
      const y2 = reader.next();
      this.drawLine(x1, y1, x1, y2);
      y1 = y2;
      if (reader.peek() >= OPCODE_THRESHOLD) break;
      const x2 = reader.next();
      this.drawLine(x1, y1, x2, y1);
      x1 = x2;
    }
  }

  xCorner(reader: Reader): void {
    let x1 = reader.next();
    let y1 = reader.next();
    this.plot(x1, y1);
    for (;;) {
      if (reader.peek() >= OPCODE_THRESHOLD) break;
      const x2 = reader.next();
      this.drawLine(x1, y1, x2, y1);
      x1 = x2;
      if (reader.peek() >= OPCODE_THRESHOLD) break;
      const y2 = reader.next();
      this.drawLine(x1, y1, x1, y2);
      y1 = y2;
    }
  }

  absoluteLine(reader: Reader): void {
    let x1 = reader.next();
    let y1 = reader.next();
    this.plot(x1, y1);
    while (reader.peek() < OPCODE_THRESHOLD) {
      const x2 = reader.next();
      const y2 = reader.next();
      this.drawLine(x1, y1, x2, y2);
      x1 = x2;
      y1 = y2;
    }
  }

  relativeLine(reader: Reader): void {
    let x1 = reader.next();
    let y1 = reader.next();
    this.plot(x1, y1);
    while (reader.peek() < OPCODE_THRESHOLD) {
      const disp = reader.next();
      let dx = (disp & 0xf0) >> 4;
      let dy = disp & 0x0f;
      if (dx & 0x08) dx = -(dx & 0x07);
      if (dy & 0x08) dy = -(dy & 0x07);
      const x2 = x1 + dx;
      const y2 = y1 + dy;
      this.drawLine(x1, y1, x2, y2);
      x1 = x2;
      y1 = y2;
    }
  }

  fill(reader: Reader): void {
    while (reader.peek() < OPCODE_THRESHOLD) {
      const x = reader.next();
      const y = reader.next();
      this.floodFill(x, y);
    }
  }

  private floodFill(startX: number, startY: number): void {
    if (!inBounds(startX, startY)) return;
    // Flood fill tests the visual background colour, matching the original
    // AGI engine's behaviour: lines drawn first form the boundary, and the
    // fill stops the moment it meets any non-background pixel. Visited
    // pixels are tracked separately from the paint, because painting alone
    // (e.g. visual drawing disabled, only priority enabled) must not be the
    // signal that a pixel was already processed - otherwise the same
    // background pixel is requeued by every neighbour forever.
    if (this.visual[startY * PICTURE_WIDTH + startX] !== DEFAULT_VISUAL_COLOR) return;

    const visited = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT);
    const stack: Array<[number, number]> = [[startX, startY]];
    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      if (!inBounds(x, y)) continue;
      const idx = y * PICTURE_WIDTH + x;
      if (visited[idx]) continue;
      if (this.visual[idx] !== DEFAULT_VISUAL_COLOR) continue;
      visited[idx] = 1;
      if (this.visualOn) this.visual[idx] = this.visualColor;
      if (this.priorityOn) this.priority[idx] = this.priorityColor;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  setPen(styleByte: number): void {
    this.pen = {
      size: styleByte & 0x07,
      circle: (styleByte & 0x10) !== 0,
      splatter: (styleByte & 0x20) !== 0,
    };
  }

  plotPen(reader: Reader): void {
    while (reader.peek() < OPCODE_THRESHOLD) {
      if (this.pen.splatter) {
        reader.next(); // texture seed byte, consumed to keep the stream aligned
      }
      const x = reader.next();
      const y = reader.next();
      this.stampPen(x, y);
    }
  }

  private stampPen(cx: number, cy: number): void {
    const radius = this.pen.size;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (this.pen.circle && dx * dx + dy * dy > radius * radius + 1) continue;
        if (this.pen.splatter && (dx + dy + cx + cy) % 2 !== 0) continue;
        this.plot(cx + dx, cy + dy);
      }
    }
  }
}

/** Decodes a raw AGI v2 PICTURE resource (no resource header) into its visual/priority buffers. */
export function decodePic(data: Uint8Array): PicBuffers {
  const decoder = new Decoder();
  const reader = new Reader(data);

  for (;;) {
    const opcode = reader.next();
    switch (opcode) {
      case OPC_SET_VISUAL:
        decoder.visualColor = reader.next() & 0x0f;
        decoder.visualOn = true;
        break;
      case OPC_DISABLE_VISUAL:
        decoder.visualOn = false;
        break;
      case OPC_SET_PRIORITY:
        decoder.priorityColor = reader.next() & 0x0f;
        decoder.priorityOn = true;
        break;
      case OPC_DISABLE_PRIORITY:
        decoder.priorityOn = false;
        break;
      case OPC_Y_CORNER:
        decoder.yCorner(reader);
        break;
      case OPC_X_CORNER:
        decoder.xCorner(reader);
        break;
      case OPC_ABSOLUTE_LINE:
        decoder.absoluteLine(reader);
        break;
      case OPC_RELATIVE_LINE:
        decoder.relativeLine(reader);
        break;
      case OPC_FILL:
        decoder.fill(reader);
        break;
      case OPC_SET_PEN:
        decoder.setPen(reader.next());
        break;
      case OPC_PLOT_PEN:
        decoder.plotPen(reader);
        break;
      case OPC_END:
        return { visual: decoder.visual, priority: decoder.priority };
      default:
        throw new PicDecodeError(`Unknown PIC opcode 0x${opcode.toString(16)} at offset ${reader.pos - 1}`);
    }
  }
}

export interface RenderedImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Renders a decoded picture buffer (visual or priority) to RGBA pixel data,
 * scaled 2x horizontally (AGI pixels are stored 160 wide but displayed at
 * roughly 320x168, i.e. twice as wide as tall).
 */
export function render(buffer: Uint8Array, scaleX = 2): RenderedImage {
  const width = PICTURE_WIDTH * scaleX;
  const height = PICTURE_HEIGHT;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < PICTURE_HEIGHT; y++) {
    for (let x = 0; x < PICTURE_WIDTH; x++) {
      const [r, g, b, a] = EGA_PALETTE[buffer[y * PICTURE_WIDTH + x] & 0x0f];
      for (let sx = 0; sx < scaleX; sx++) {
        const idx = (y * width + x * scaleX + sx) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      }
    }
  }

  return { width, height, data };
}

/** Draws a decoded picture buffer onto a canvas element (browser only). */
export function renderToCanvas(buffer: Uint8Array, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to acquire a 2D canvas context');
  }
  const { width, height, data } = render(buffer);
  canvas.width = width;
  canvas.height = height;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
}
