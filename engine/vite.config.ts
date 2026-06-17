import { defineConfig } from 'vitest/config';

export default defineConfig({
  publicDir: '../',
  build: {
    // The repo-root assets in publicDir are read-only game data, not build
    // output; copying them into dist would also recurse since dist lives
    // inside publicDir.
    copyPublicDir: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
