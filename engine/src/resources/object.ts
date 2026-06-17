// AGI v2 OBJECT (inventory) resource decoder.
//
// The file is XOR-encrypted in full with the repeating key "Avis Durgan".
// Decrypted layout:
//   byte 0-1: offset (LE) to the start of the name strings section,
//             measured from byte 3 (the first byte of the object table) —
//             so absolute offset = value + HEADER_SIZE. numObjects = value / 3.
//   byte 2:   max number of animated (screen) objects.
//   then, for each object, a 3-byte record:
//     byte 0-1: offset (LE) to a null-terminated name string, measured the
//               same way as above (absolute offset = value + HEADER_SIZE).
//     byte 2:   room number the object starts in.

const XOR_KEY = 'Avis Durgan';
const HEADER_SIZE = 3;
const RECORD_SIZE = 3;

export interface AgiObject {
  id: number;
  name: string;
  startRoom: number;
}

export interface ObjectTable {
  maxAnimatedObjects: number;
  objects: AgiObject[];
}

function decrypt(data: Uint8Array): Uint8Array {
  const key = new TextEncoder().encode(XOR_KEY);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ^ key[i % key.length];
  }
  return out;
}

function readNullTerminatedString(data: Uint8Array, offset: number): string {
  if (offset < 0 || offset >= data.length) {
    throw new Error(`OBJECT: name offset ${offset} is outside the file`);
  }
  let end = offset;
  while (end < data.length && data[end] !== 0) {
    end++;
  }
  if (end >= data.length) {
    throw new Error(`OBJECT: name at offset ${offset} is missing its null terminator`);
  }
  let name = '';
  for (let i = offset; i < end; i++) {
    name += String.fromCharCode(data[i]);
  }
  return name;
}

export function decodeObjectFile(data: Uint8Array): ObjectTable {
  if (data.length < HEADER_SIZE) {
    throw new Error('OBJECT: file is too short to contain a header');
  }

  const dec = decrypt(data);

  const stringsOffsetRelative = dec[0] | (dec[1] << 8);
  const maxAnimatedObjects = dec[2];

  if (stringsOffsetRelative % RECORD_SIZE !== 0) {
    throw new Error('OBJECT: strings offset is not a multiple of the 3-byte record size');
  }
  const numObjects = stringsOffsetRelative / RECORD_SIZE;

  const tableEnd = HEADER_SIZE + numObjects * RECORD_SIZE;
  if (tableEnd > dec.length) {
    throw new Error('OBJECT: object table is truncated');
  }

  const objects: AgiObject[] = [];
  for (let id = 0; id < numObjects; id++) {
    const base = HEADER_SIZE + id * RECORD_SIZE;
    const nameOffsetRelative = dec[base] | (dec[base + 1] << 8);
    const startRoom = dec[base + 2];
    const nameOffset = nameOffsetRelative + HEADER_SIZE;
    const name = readNullTerminatedString(dec, nameOffset);
    objects.push({ id, name, startRoom });
  }

  return { maxAnimatedObjects, objects };
}
