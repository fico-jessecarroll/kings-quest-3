import { describe, expect, it } from 'vitest';
import { listPicFiles, readObject } from './helpers/assets';

describe('scaffold', () => {
  it('can read repo-root assets', () => {
    expect(listPicFiles().length).toBeGreaterThan(0);
    expect(readObject().length).toBeGreaterThan(0);
  });
});
