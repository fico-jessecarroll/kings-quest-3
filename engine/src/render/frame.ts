// Composes screen.ts/sprites.ts/text.ts into one full-frame render. Kept
// separate from those modules (rather than folded into screen.ts) so each
// stays a one-way dependency - this is the only file that depends on all
// three - which is what room/main integration and the browser smoke test
// call into.

import { decodePic } from '../resources/pic';
import type { VmState } from '../vm/state';
import { clearScreen, drawVisualBuffer } from './screen';
import { collectSprites, drawSprites, EGO_OBJECT_NUMBER } from './sprites';
import { drawDisplay, drawMessageWindow, drawPrintAt, drawStatusLine, formatStatusLine } from './text';

export interface RenderFrameOptions {
  /** Resolves a PICTURE resource number to its raw (undecoded) bytes, used as a fallback when the VM hasn't decoded one yet. */
  loadPictureResource?: (pictureNumber: number) => Uint8Array | undefined;
  /** Object numbers to draw as placeholder sprites; defaults to just ego. */
  spriteObjectNumbers?: number[];
  /** Resolves an AGI %message number to its text, for `print`/`print.at`/`display` events. */
  resolveMessage?: (messageNumber: number) => string | undefined;
}

/**
 * Renders one full frame: clears the screen, blits the room picture (if
 * shown), draws placeholder sprites for the given objects, then overlays the
 * status line and any pending message window/display text. This is the
 * single entry point room/main integration calls once the VM has finished a
 * cycle.
 */
export function renderFrame(ctx: CanvasRenderingContext2D, state: VmState, options: RenderFrameOptions = {}): void {
  clearScreen(ctx);

  let visual = state.getPictureBuffers()?.visual;
  if (!visual && options.loadPictureResource) {
    const picture = state.getLoadedPictureNumber();
    if (picture !== null) {
      const bytes = options.loadPictureResource(picture);
      if (bytes) visual = decodePic(bytes).visual;
    }
  }
  if (state.isPictureVisible() && visual) {
    drawVisualBuffer(ctx, visual);
  }

  const spriteObjects = options.spriteObjectNumbers ?? [EGO_OBJECT_NUMBER];
  drawSprites(ctx, collectSprites(state, spriteObjects));

  drawStatusLine(ctx, formatStatusLine(state.getScore(), state.getMaxScore(), state.isSoundEnabled()));

  const display = state.getDisplay();
  if (display) {
    const text = options.resolveMessage?.(display.message) ?? `(message ${display.message})`;
    switch (display.kind) {
      case 'print':
        drawMessageWindow(ctx, text);
        break;
      case 'print.at':
        drawPrintAt(ctx, text, display.row, display.col, display.width);
        break;
      case 'display':
        drawDisplay(ctx, text, display.row, display.col);
        break;
    }
  }
}
