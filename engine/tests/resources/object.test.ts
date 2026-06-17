import { describe, expect, it } from 'vitest';
import { decodeObjectFile } from '../../src/resources/object';
import { readObject } from '../helpers/assets';

const XOR_KEY = 'Avis Durgan';

function encrypt(bytes: number[]): Uint8Array {
  const key = Buffer.from(XOR_KEY, 'ascii');
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ key[i % key.length];
  }
  return out;
}

/**
 * Builds a plaintext (pre-XOR) OBJECT file from a list of [name, startRoom]
 * pairs, then encrypts it with the AGI v2 OBJECT key so it round-trips
 * through decodeObjectFile exactly like a real game asset would.
 */
function buildObjectFile(
  entries: Array<{ name: string; startRoom: number }>,
  maxAnimatedObjects = 16,
): Uint8Array {
  const headerSize = 3;
  const tableSize = entries.length * 3;
  const stringsStart = headerSize + tableSize;

  const nameBytes = entries.map((e) => Buffer.from(`${e.name}\0`, 'ascii'));
  const nameOffsets: number[] = [];
  let cursor = stringsStart;
  for (const buf of nameBytes) {
    nameOffsets.push(cursor);
    cursor += buf.length;
  }

  const plain = Buffer.alloc(cursor);
  // Offset to the strings section, stored relative to byte 3 (LE).
  plain.writeUInt16LE(tableSize, 0);
  plain.writeUInt8(maxAnimatedObjects, 2);

  entries.forEach((entry, i) => {
    const base = headerSize + i * 3;
    // Per-object name offset is also relative to byte 3 (LE).
    plain.writeUInt16LE(nameOffsets[i] - headerSize, base);
    plain.writeUInt8(entry.startRoom, base + 2);
  });

  nameBytes.forEach((buf, i) => {
    buf.copy(plain, nameOffsets[i]);
  });

  return encrypt(Array.from(plain));
}

describe('decodeObjectFile', () => {
  describe('golden file (SRC/OBJECT.TXT)', () => {
    const table = decodeObjectFile(readObject());

    it('reports the max number of animated objects (KQ3 = 16)', () => {
      expect(table.maxAnimatedObjects).toBe(16);
    });

    it('decodes one entry per object, including the unused ego placeholder', () => {
      expect(table.objects).toHaveLength(55);
      expect(table.objects[0]).toEqual({ id: 0, name: '?', startRoom: 0 });
    });

    it('assigns sequential ids matching each object record position', () => {
      table.objects.forEach((obj, i) => {
        expect(obj.id).toBe(i);
      });
    });

    it('decodes "Knife" starting in room 6', () => {
      const knife = table.objects.find((o) => o.name === 'Knife');
      expect(knife?.startRoom).toBe(6);
    });

    it('decodes "Brass Key*" starting in room 2', () => {
      const brassKey = table.objects.find((o) => o.name === 'Brass Key*');
      expect(brassKey?.startRoom).toBe(2);
    });

    it('decodes "Magic Wand*" starting in room 5', () => {
      const magicWand = table.objects.find((o) => o.name === 'Magic Wand*');
      expect(magicWand?.startRoom).toBe(5);
    });

    it('preserves the "*" suffix used for spell-ingredient items', () => {
      const chickenFeather = table.objects.find((o) => o.name === 'Chicken Feather*');
      expect(chickenFeather).toBeDefined();
      expect(chickenFeather?.startRoom).toBe(34);
    });

    it('decodes plain (non-spell) item names without alteration', () => {
      const bowl = table.objects.find((o) => o.name === 'Bowl');
      expect(bowl?.startRoom).toBe(6);
    });
  });

  describe('synthetic fixtures', () => {
    it('round-trips a small hand-built table', () => {
      const fixture = buildObjectFile(
        [
          { name: '?', startRoom: 0 },
          { name: 'Knife', startRoom: 6 },
          { name: 'Magic Wand*', startRoom: 5 },
        ],
        16,
      );

      const table = decodeObjectFile(fixture);

      expect(table.maxAnimatedObjects).toBe(16);
      expect(table.objects).toEqual([
        { id: 0, name: '?', startRoom: 0 },
        { id: 1, name: 'Knife', startRoom: 6 },
        { id: 2, name: 'Magic Wand*', startRoom: 5 },
      ]);
    });

    it('decodes a table with zero objects', () => {
      const fixture = buildObjectFile([], 0);
      const table = decodeObjectFile(fixture);
      expect(table.maxAnimatedObjects).toBe(0);
      expect(table.objects).toEqual([]);
    });
  });

  describe('negative cases', () => {
    it('throws on empty input', () => {
      expect(() => decodeObjectFile(new Uint8Array(0))).toThrow();
    });

    it('throws when the input is shorter than the 3-byte header', () => {
      expect(() => decodeObjectFile(encrypt([0x09, 0x00]))).toThrow();
    });

    it('throws when the object table is truncated mid-record', () => {
      // Header claims 2 objects (offset = 6) but only one 3-byte record follows.
      const truncated = encrypt([0x06, 0x00, 0x10, 0x01, 0x00, 0x06]);
      expect(() => decodeObjectFile(truncated)).toThrow();
    });

    it('throws when a name offset points outside the buffer', () => {
      // One object record whose name offset is far beyond the file's length.
      const tableSize = 3;
      const bad = encrypt([tableSize, 0x00, 0x10, 0xff, 0x7f, 0x06]);
      expect(() => decodeObjectFile(bad)).toThrow();
    });

    it('throws when a name string is missing its null terminator', () => {
      const headerSize = 3;
      const tableSize = 3;
      const stringsStart = headerSize + tableSize;
      const plain = Buffer.alloc(stringsStart + 4);
      plain.writeUInt16LE(tableSize, 0);
      plain.writeUInt8(16, 2);
      plain.writeUInt16LE(stringsStart - headerSize, headerSize);
      plain.writeUInt8(6, headerSize + 2);
      Buffer.from('Knif').copy(plain, stringsStart); // no trailing \0

      expect(() => decodeObjectFile(encrypt(Array.from(plain)))).toThrow();
    });
  });
});
