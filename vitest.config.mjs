import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `electron` is a native module that cannot be required outside an Electron
// process, so tests resolve it to a stub with matching behaviour. The alias is
// declared at the top level so it also applies to the CommonJS require() calls
// inside electron/*.js, not just to ESM imports in the tests.
export default defineConfig({
  resolve: {
    alias: {
      electron: fileURLToPath(new URL('./tests/stubs/electron.mjs', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    server: {
      deps: {
        inline: [/electron[\\/].*\.js$/],
      },
    },
  },
});
