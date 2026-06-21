import { describe, expect, it } from 'vitest';
import { loadGameResources, MAX_PICTURE_NUMBER } from '../../src/game/resources';

const SAMPLE_BUNDLE = { rooms: [{ room: 0, file: 'RM0.CG', statements: [], localSymbols: {} }] };
const SAMPLE_SYMBOLS = { flags: { f: 1 }, vars: { v: 2 }, views: {}, objects: {}, roomNames: {} };
const SAMPLE_MESSAGES = { '0': { '1': 'hello' } };

type FetchHandlers = Record<string, () => Response>;

function createMockFetch(handlers: FetchHandlers): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const handler = handlers[url];
    return handler ? handler() : new Response(null, { status: 404 });
  }) as typeof fetch;
}

function jsonResponse(body: unknown): () => Response {
  return () => new Response(JSON.stringify(body), { status: 200 });
}

function bytesResponse(bytes: number[]): () => Response {
  return () => new Response(new Uint8Array(bytes), { status: 200 });
}

function baseHandlers(): FetchHandlers {
  return {
    '/src/generated/logic-bundle.json': jsonResponse(SAMPLE_BUNDLE),
    '/src/generated/symbols.json': jsonResponse(SAMPLE_SYMBOLS),
    '/src/generated/messages.json': jsonResponse(SAMPLE_MESSAGES),
    '/OBJECT': bytesResponse([1, 2, 3]),
    '/WORDS.TOK': bytesResponse([4, 5, 6]),
  };
}

describe('loadGameResources', () => {
  it('fetches and parses the compiled logic bundle, symbols, and messages', async () => {
    const fetchImpl = createMockFetch(baseHandlers());

    const resources = await loadGameResources(fetchImpl);

    expect(resources.bundle).toEqual(SAMPLE_BUNDLE);
    expect(resources.symbols).toEqual(SAMPLE_SYMBOLS);
    expect(resources.messages).toEqual(SAMPLE_MESSAGES);
  });

  it('fetches OBJECT and WORDS.TOK as raw bytes from the repo root', async () => {
    const fetchImpl = createMockFetch(baseHandlers());

    const resources = await loadGameResources(fetchImpl);

    expect(resources.objectBytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(resources.wordsBytes).toEqual(new Uint8Array([4, 5, 6]));
  });

  it('prefetches every existing PIC.n resource into a Map, skipping missing ones', async () => {
    const handlers = baseHandlers();
    handlers['/PIC/PIC.0'] = bytesResponse([10, 20]);
    handlers['/PIC/PIC.4'] = bytesResponse([30]);
    handlers[`/PIC/PIC.${MAX_PICTURE_NUMBER}`] = bytesResponse([40, 50, 60]);
    const fetchImpl = createMockFetch(handlers);

    const resources = await loadGameResources(fetchImpl);

    expect(resources.pictures.size).toBe(3);
    expect(resources.pictures.get(0)).toEqual(new Uint8Array([10, 20]));
    expect(resources.pictures.get(4)).toEqual(new Uint8Array([30]));
    expect(resources.pictures.get(MAX_PICTURE_NUMBER)).toEqual(new Uint8Array([40, 50, 60]));
    expect(resources.pictures.has(1)).toBe(false);
  });

  it('builds a Map whose synchronous .get matches the loadPictureResource(n) => Uint8Array | undefined signature', async () => {
    const handlers = baseHandlers();
    handlers['/PIC/PIC.7'] = bytesResponse([99]);
    const fetchImpl = createMockFetch(handlers);

    const resources = await loadGameResources(fetchImpl);
    const loadPictureResource: (pictureNumber: number) => Uint8Array | undefined = (n) => resources.pictures.get(n);

    expect(loadPictureResource(7)).toEqual(new Uint8Array([99]));
    expect(loadPictureResource(8)).toBeUndefined();
  });

  it('rejects with a descriptive error when a required resource fetch fails', async () => {
    const handlers = baseHandlers();
    handlers['/OBJECT'] = () => new Response(null, { status: 500, statusText: 'Internal Server Error' });
    const fetchImpl = createMockFetch(handlers);

    await expect(loadGameResources(fetchImpl)).rejects.toThrow(/OBJECT/);
  });

  it('rejects when the compiled logic bundle is missing (build:logic not run)', async () => {
    const handlers = baseHandlers();
    delete handlers['/src/generated/logic-bundle.json'];
    const fetchImpl = createMockFetch(handlers);

    await expect(loadGameResources(fetchImpl)).rejects.toThrow(/logic-bundle\.json/);
  });
});
