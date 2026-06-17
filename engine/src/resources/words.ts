const HEADER_SIZE = 52; // 26 letters * 2-byte big-endian offset

export interface DecodedWords {
  words: Map<string, number>;
  groups: Map<number, string[]>;
}

/**
 * Decodes an AGI v2 WORDS.TOK vocabulary buffer.
 *
 * Layout: a 52-byte header of 26 big-endian offsets (one per letter a-z)
 * into the word table, followed by prefix-compressed word entries:
 *   1 byte  - number of leading characters shared with the previous word
 *   N bytes - remaining characters, each XOR 0x7F, with the final
 *             character's high bit (0x80) set as a terminator
 *   2 bytes - big-endian word-group number
 * Words are stored in alphabetical order as one contiguous stream; the
 * per-letter header offsets are lookup shortcuts into that same stream.
 */
export function decodeWords(buffer: Buffer | Uint8Array): DecodedWords {
  if (buffer.length < HEADER_SIZE) {
    throw new Error(`WORDS.TOK buffer too short: expected at least ${HEADER_SIZE} header bytes, got ${buffer.length}`);
  }

  const data = buffer instanceof Buffer ? buffer : Buffer.from(buffer);
  const words = new Map<string, number>();
  const groups = new Map<number, string[]>();

  let firstOffset = 0;
  for (let letter = 0; letter < 26; letter++) {
    const offset = data.readUInt16BE(letter * 2);
    if (offset > 0) {
      firstOffset = offset;
      break;
    }
  }

  let pos = firstOffset;
  let previousWord = '';

  while (pos < data.length) {
    const entryStart = pos;
    const prefixLen = data[pos];
    pos += 1;

    let chars = '';
    let terminated = false;
    while (pos < data.length) {
      const byte = data[pos];
      pos += 1;
      chars += String.fromCharCode((byte & 0x7f) ^ 0x7f);
      if (byte & 0x80) {
        terminated = true;
        break;
      }
    }

    if (!terminated || pos + 2 > data.length) {
      pos = entryStart;
      break;
    }

    const group = data.readUInt16BE(pos);
    pos += 2;

    const word = previousWord.slice(0, prefixLen) + chars;
    previousWord = word;

    words.set(word, group);
    const groupWords = groups.get(group);
    if (groupWords) {
      groupWords.push(word);
    } else {
      groups.set(group, [word]);
    }
  }

  return { words, groups };
}
