import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `electron` is a native module that cannot be required outside an Electron
// process, so tests resolve it to a stub with matching behaviour. The alias is
// declared at the top level so it also applies to the ESM imports in the tests.
//
// It does NOT reach the CommonJS require() calls inside electron/*.js. Those are
// real Node requires, so they resolve to the real `electron` package, which
// exports the path to its binary as a string, and a vi.mock factory does not
// apply to them either. Consequence: a module that touches `app`, `session` or
// `BrowserWindow` at require time loads fine but its Electron bindings are
// undefined, so it can only be tested through what it exports as pure functions.
// Anything that constructs a window has to be proved by running the application.
// See docs/TESTING.md.
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
