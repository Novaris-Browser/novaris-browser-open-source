# Architecture

## Processes

Four kinds of process, and the privilege boundary between them is the point.

```
┌──────────────────────────────────────────────────────────────┐
│ Main process                                                  │
│   store, vault, extensions, ad blocker, updater, window      │
│   Node.js available · no page content · holds the vault       │
└──────────────┬───────────────────────────────┬───────────────┘
               │                               │
┌──────────────▼──────────────┐   ┌────────────▼──────────────┐
│ Renderer (the interface)     │   │ Webview guests (pages)    │
│   React, no Node.js          │   │   one per tab             │
│   contextBridge to the main  │   │   sandboxed               │
│   CSP + Trusted Types        │   │   no IPC, no Node, no     │
│                              │   │   permission to the main  │
└──────────────────────────────┘   └───────────────────────────┘
```

The renderer is the only thing that may ask the main process to do anything, and
every request is checked. See [SECURITY.md](../SECURITY.md) for what that check
is.

A page is not a lesser renderer. It has no preload bridge, no Node, no IPC, and
its permissions default to no.

## Layout

```
electron/          main process, CommonJS
  main.js          window creation, lifecycle, wiring
  security.js      navigation, webview preferences, permission policy
  ipc.js           every channel, through one guard
  ipc-guard.js     who is allowed to call one
  csp.js           the content security policy
  vault.js         the encrypted store
  crypto-box.js    Argon2id, AES-256-GCM, per-record sealing
  adblock.js       host and path rules
  split-view.js    up to four panes, widths, resizing
  sidebar-layout.js  app rail and split geometry
  updater.js       update state, signature verification
  update-signing.js  Ed25519 manifest signing
  phishing.js      local impersonation detection
  trust-card.js    what a site can see, and who is tracking
  tab-transfer*.js device to device tab transfer, LAN only
  ...

src/               renderer, React
  App.jsx          the shell: tabs, panes, settings, onboarding
  components/      one file per surface
  hooks/useBrowser.js  application state
  lib/             pure helpers, unit tested

Official Website/  the public site, no framework, no build step
scripts/           build, signing and publishing
tests/             vitest, run by npm test
```

## Why the main-process modules own arithmetic

Layout, ad blocking and update signing live in `electron/` as pure functions
with unit tests, and the renderer imports them.

That is a deliberate inversion of the usual arrangement. A split view computed in
CSS cannot be tested; the same geometry as arithmetic can, and it is why
`resolveLayout` refuses a split that would leave two unreadable columns rather
than producing two slivers. Ad blocking rules, the greeting, and the update
signature are all in the same position.

The cost is that the renderer reaches into `electron/`. It is one direction only,
`electron/` never imports from `src/`, and `tests/packaging.test.js` walks every
relative `require` in `electron/` to make sure each one is inside the packaging
allowlist. A module once ended up under `src/`, where tests and the bundler
resolved it happily and the packaged application did not ship it, and the main
process threw during startup.

## The renderer never decides security policy

Where a value affects a security decision, the renderer asks. The renderer
computes pane widths from `split-view.js` and then renders them; it does not
decide what a pane may be. It asks `csp.js` for nothing at all — the policy is
written into the document at build time and reinforced as a header for the
development server.

This is why the interface cannot be persuaded by a page. Everything a page can
influence arrives as data.

## State

`useBrowser` owns the application state, and it is a single hook rather than a
store, because the application has no state that outlives a window in a way the
platform does not already persist. Bookmarks, history, settings and the vault
live in `electron/store.js` and the vault file; the renderer holds a copy.

The split view is the exception worth naming. It is in the hook, not in the
store, because it describes the current window rather than the profile. It is
re-derived from the live tab list on every change, so closing a tab that is in a
pane cannot leave a pane pointing at a page that is not there.
