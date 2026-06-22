// Boot-time resource loader: fetches the compiled logic bundle (`npm run
// build:logic`'s output, written to src/generated/ and served from there),
// OBJECT, WORDS.TOK, and every PICTURE.n resource under repo-root PIC/
// (served via Vite's publicDir; see vite.config.ts) - all up front. Sound
// (SND.n) loading is handled separately by the existing sound-playback
// integration and is out of scope here. The Interpreter's picture commands
// (load.pic/draw.pic, etc., see render/frame.ts and vm/commands.ts) are
// synchronous, so callers need every picture resource already in hand as a
// Map before building a `loadPictureResource(n) => Uint8Array | undefined`
// lookup on top of it; there's no per-call await available at that layer.

import type { GlobalSymbolTables, LogicBundle } from '../../tools/compile-logic';

const GENERATED_DIR = '/src/generated';

/** AGI resource numbers are a single byte (0-255). */
export const MAX_PICTURE_NUMBER = 255;

export type GameMessages = Record<string, Record<string, string>>;

export interface GameResources {
  bundle: LogicBundle;
  symbols: GlobalSymbolTables;
  messages: GameMessages;
  objectBytes: Uint8Array;
  wordsBytes: Uint8Array;
  /** Raw PICTURE.n bytes keyed by resource number; only numbers that actually exist on disk are present. Undecoded - pass through `resources/pic.ts`'s `decodePic` on demand. */
  pictures: Map<number, Uint8Array>;
}

async function fetchJson<T>(fetchImpl: typeof fetch, path: string): Promise<T> {
  const res = await fetchImpl(path);
  if (!res.ok) {
    throw new Error(`failed to fetch ${path}: ${res.status} ${res.statusText} (run \`npm run build:logic\`?)`);
  }
  return (await res.json()) as T;
}

async function fetchBytes(fetchImpl: typeof fetch, path: string): Promise<Uint8Array> {
  const res = await fetchImpl(path);
  if (!res.ok) {
    throw new Error(`failed to fetch ${path}: ${res.status} ${res.statusText}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchPictures(fetchImpl: typeof fetch, max: number): Promise<Map<number, Uint8Array>> {
  const ids = Array.from({ length: max + 1 }, (_, i) => i);
  const entries = await Promise.all(
    ids.map(async (id): Promise<[number, Uint8Array] | null> => {
      const res = await fetchImpl(`/PIC/PIC.${id}`);
      if (!res.ok) return null;
      return [id, new Uint8Array(await res.arrayBuffer())];
    }),
  );
  return new Map(entries.filter((entry): entry is [number, Uint8Array] => entry !== null));
}

/**
 * Fetches and parses everything the Interpreter/renderer need before the
 * game loop can start. Pass a fake `fetchImpl` in tests; defaults to the
 * global `fetch` (Vite's dev/preview server) otherwise.
 */
export async function loadGameResources(fetchImpl: typeof fetch = fetch): Promise<GameResources> {
  const [bundle, symbols, messages, objectBytes, wordsBytes, pictures] = await Promise.all([
    fetchJson<LogicBundle>(fetchImpl, `${GENERATED_DIR}/logic-bundle.json`),
    fetchJson<GlobalSymbolTables>(fetchImpl, `${GENERATED_DIR}/symbols.json`),
    fetchJson<GameMessages>(fetchImpl, `${GENERATED_DIR}/messages.json`),
    fetchBytes(fetchImpl, '/OBJECT'),
    fetchBytes(fetchImpl, '/WORDS.TOK'),
    fetchPictures(fetchImpl, MAX_PICTURE_NUMBER),
  ]);
  return { bundle, symbols, messages, objectBytes, wordsBytes, pictures };
}
