import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  publicDir: '../',
  // This is a multi-page app (index.html + viewer.html), not a client-routed
  // SPA. Without this, Vite's dev/preview servers fall back to serving
  // index.html (200) for any unrecognised path, including missing resource
  // files the viewer probes for via fetch - breaking 404-based detection.
  appType: 'mpa',
  build: {
    // The repo-root assets in publicDir are read-only game data, not build
    // output; copying them into dist would also recurse since dist lives
    // inside publicDir.
    copyPublicDir: false,
    rollupOptions: {
      input: {
        main: `${root}index.html`,
        viewer: `${root}viewer.html`,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
