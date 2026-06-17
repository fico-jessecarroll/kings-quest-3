import { describe, expect, it } from 'vitest';
import { listPicFiles, readPic } from '../helpers/assets';
import { decodePic } from '../../src/resources/pic';

describe('decodePic against every shipped PIC resource', () => {
  for (const name of listPicFiles()) {
    it(`decodes ${name} without throwing`, () => {
      const data = new Uint8Array(readPic(name));
      expect(() => decodePic(data)).not.toThrow();
    });
  }
});
