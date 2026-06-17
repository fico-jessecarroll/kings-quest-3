import { describe, expect, it } from 'vitest';
import { decodeWords } from '../../src/resources/words';
import { readWordsTok } from '../helpers/assets';

function buildWordsTok(entries: { prefixLen: number; chars: string; group: number }[]): Buffer {
  const header = Buffer.alloc(52);
  const body: number[] = [];
  for (const { prefixLen, chars, group } of entries) {
    body.push(prefixLen);
    for (let i = 0; i < chars.length; i++) {
      const code = chars.charCodeAt(i);
      const isLast = i === chars.length - 1;
      body.push((code ^ 0x7f) | (isLast ? 0x80 : 0x00));
    }
    body.push((group >> 8) & 0xff, group & 0xff);
  }
  // 'a' starts right after the header in this synthetic fixture.
  header.writeUInt16BE(52, 0);
  return Buffer.concat([header, Buffer.from(body)]);
}

describe('decodeWords', () => {
  it('decodes the first word of the real WORDS.TOK as "abominable"', () => {
    const { words } = decodeWords(readWordsTok());
    expect(words.get('abominable')).toBe(0);
  });

  it('decodes more than 100 words from the real WORDS.TOK', () => {
    const { words } = decodeWords(readWordsTok());
    expect(words.size).toBeGreaterThan(100);
  });

  it('groups synonyms (e.g. north/n) under the same word-group number', () => {
    const buf = buildWordsTok([
      { prefixLen: 0, chars: 'n', group: 10 },
      { prefixLen: 0, chars: 'north', group: 10 },
    ]);
    const { words, groups } = decodeWords(buf);
    expect(words.get('n')).toBe(10);
    expect(words.get('north')).toBe(10);
    expect(groups.get(10)?.sort()).toEqual(['n', 'north']);
  });

  it('applies prefix-reuse compression relative to the previous word', () => {
    const buf = buildWordsTok([
      { prefixLen: 0, chars: 'above', group: 48 },
      { prefixLen: 2, chars: 'le', group: 100 },
    ]);
    const { words } = decodeWords(buf);
    expect(words.get('above')).toBe(48);
    expect(words.get('able')).toBe(100);
  });

  it('stops cleanly at trailing zero padding without walking off the buffer', () => {
    const buf = buildWordsTok([{ prefixLen: 0, chars: 'a', group: 1 }]);
    const padded = Buffer.concat([buf, Buffer.alloc(8)]);
    const { words } = decodeWords(padded);
    expect(words.get('a')).toBe(1);
    expect(words.size).toBe(1);
  });

  it('rejects buffers shorter than the 52-byte header', () => {
    expect(() => decodeWords(Buffer.alloc(51))).toThrow();
  });
});
