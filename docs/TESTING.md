# Testing

`npm test` runs everything. There is no separate suite to remember.

## How the project is tested

**Pure logic is tested directly.** Layout arithmetic, ad block rules, the vault
keyring decision, the greeting, manifest signing, IPC sender validation, the
content security policy and the permission policy are all functions with no
platform dependency, and are tested as functions.

**The rest is tested against the packaged application.** Several claims in this
project were only believed once a real build was started, a real gesture was
driven through the DOM, and the result was read back. Those checks are scripts
rather than a test suite, because they need a built application and a display.

**The shipped configuration is tested, not just the code.** The electron-builder
configuration is validated against electron-builder's own schema by a test. The
schema is otherwise only consulted at package time, ten minutes into a build,
long after the mistake. That test found a signing configuration that had been in
place since an earlier commit and would have failed every build.

## Claims that are proved rather than asserted

| Claim | How |
|---|---|
| First-party ad scripts are blocked | The packaged build, with a page loading `/js/ads.js` and `/js/downloads.js` side by side. Only the ad asset is cancelled before any request is sent. |
| Split view works | The packaged build, dragging a tab onto a page edge. The edge lights up, two even panes appear, a third can be added, and the divider is present. |
| The vault refuses an untrusted keyring | A stubbed `safeStorage` reporting `basic_text` as available, which Electron does. |
| The signing pipeline works | A throwaway self-signed certificate through a full build. The installer and both binaries sign, with an RFC 3161 timestamp from a real responder. |
| Trusted Types is enforced | The packaged build. Assigning `innerHTML` throws. |
| IPC validation does not break the interface | The packaged build. A real `getBootstrap` call through the guard returns the version and settings. |
| A website in a private window has no privileged bridge | The real application, a real private window, a real site loaded in it. Read back from the page: no `novaris`, no `ipcRenderer`, no `require`, no `process`, no `module`. |
| The interface cannot navigate itself to a website | The real application. `location.href = 'https://example.com'` from the interface; the window is still on `dist/index.html` afterwards, and its bridge still works. |
| A private window is denied geolocation, camera and notifications | The real application, with real permission *requests* from the page rather than `navigator.permissions.query`, which reads Blink's own default and does not pass through the handler. Notifications resolve to `denied`, geolocation to `PERMISSION_DENIED`, the camera to `NotAllowedError`. |
| Update signatures stop a tampered manifest | Signing a real manifest, then altering the version, the hash, the size, the URL and the signature in turn. Each is refused; the genuine one is accepted. |
| A signed but malformed manifest is refused | Signing a manifest that names no version, lists no download, carries no digest or size, or points at plain HTTP, with the legitimate key. Only the content check can catch these. |
| The public update key is tracked, and private keys are not | Asking `git add --dry-run`, rather than reading `.gitignore`. |
| Nothing reaches Google | A Chromium network log of a real session. |
| The Linux build starts and its boundaries hold | The built `.deb`'s own payload, booted in WSL. A site in a private window has no bridge and is denied geolocation; the interface can still IPC and still cannot navigate itself to a website. |

## What is not covered

Stated so the gaps are visible.

- **The Linux package has been started, but not looked at.** It boots, the
  renderer loads, IPC works and the private-window boundary holds — all proved
  against the built payload. No display was available, so nothing was ever
  actually drawn: a build that rendered the wrong pixels, or a window that
  appeared off-screen, would not be caught by anything here.
- **The visual layout is not tested.** No screenshot comparison, so a change that
  looks wrong but works is not caught.
- **No end-to-end test through the interface.** A gesture is simulated in the DOM
  rather than performed, so a regression in event wiring between a real pointer
  and a synthetic one would not be caught.
- **WebRTC, passkeys and the certificate are documented limitations**, not fixed
  features, and no test asserts them as working.

## The Linux package

`release/Novaris-Browser-0.9.0-Linux.deb`, 102,390,236 bytes, built in WSL because
electron-builder cannot cross-compile.

What was verified against the built package, not the configuration:

| | |
|---|---|
| Control fields | `novaris-browser` 0.9.0, amd64, `libsecret-1-0` among the dependencies |
| Manifest integrity | `latest-linux.yml` size and SHA-512 match the `.deb` byte for byte |
| Desktop entry | Present, `Exec` is an absolute path, `StartupWMClass=com.novaris.browser` matches the app id, `x-scheme-handler/novaris` is registered |
| It starts | Booted under WSL, DevTools endpoint answered in 1s, `app.asar/dist/index.html` loaded, profile written |
| The boundaries hold on Linux | The interface can IPC, cannot navigate itself to a website, and a site in a private window has no bridge and is denied geolocation and notifications |

Two packaging defects were found this way, both invisible in the configuration:

- `desktop.entry.Categories` is **overwritten** by electron-builder with
  `linux.category` and ignored entirely, so the first `.deb` shipped
  `Categories=Network;` with no `WebBrowser` and the app could be filed in the
  wrong menu section. `linux.category` now carries the value, and a test asserts
  it lives in the field the builder actually reads.
- electron-builder creates **no `/usr/bin` entry** for a `deb`, so the binary is
  only at `/opt/Novaris Browser/novaris-browser`. The application menu and the
  `novaris://` handler both work, because the desktop entry's `Exec` is an
  absolute path, but `novaris-browser` is not on `PATH` and cannot be run from a
  terminal. Adding the symlink would mean repacking the `.deb` after the fact,
  which would invalidate the manifest hash, so it is documented rather than
  patched.

## Why the tests are written the way they are

Several tests here exist because something was wrong and the test is the
reminder:

- The permission test pins `geolocation` and `midi` to the grantable list,
  because they were in the deny list and the grantable list at once, with a
  comment claiming they were per-site. The deny list was checked first, so they
  were never grantable and only the comment said otherwise.
- The signing tests pin the canonical base64 requirement, because Node's decoder
  silently skips characters it does not recognise and a signature with junk
  prepended verified.
- The build-config test pins that `verifyUpdateCodeSignature` is not enabled
  without a publisher name, because electron-updater returns early when the name
  is absent, and the flag was a silent no-op while the project claimed to verify
  update signatures.
- The key-ignore test asks git rather than reading `.gitignore`, because the
  public update key was once excluded by rule ordering and never committed. A
  fresh clone would have produced a build with no key, refusing every update.
- The site-origin test pins the domain across eleven pages, the sitemap, the feed
  and the bucket CORS policy, because the site audit had its own hardcoded copy
  and reported all eleven pages as unlisted after the domain changed.
- The IPC guard compares the development server as a **parsed origin**, because
  the rule was a string prefix, and `http://127.0.0.1:5173.attacker.example/`
  starts with `http://127.0.0.1:5173`.
- The private-window test pins that the partition handed to the window is the one
  that was hardened, because the partition was generated twice. The window ran on
  a session no policy had reached, and the platform default granted it
  geolocation. Reading the code said the private window was hardened; running it
  said it was not.
- The IPC guard test pins its `file://` trust root to `dist/`, and asserts it
  against the navigation policy, because the root was the whole application
  directory and therefore wider than the navigation policy. Two boundaries that
  answer differently are one boundary too many.

## What the unit tests cannot reach

`electron/*.js` are CommonJS and call `require('electron')` inside their own
bodies. Vite cannot intercept that — it is a real Node require, so it resolves to
the real `electron` package, which exports the path to the binary as a string.
Neither a `vi.mock` factory nor the alias in `vitest.config.mjs` applies to it.

So anything that constructs a `BrowserWindow` cannot be driven from a unit test:
`openPrivateWindow` and `installSecurityHandlers` are not reachable that way. The
tests exercise the exported policy functions, which is where the decisions live,
and use a source-level assertion for the wiring, labelled as weaker where it is
used. What they do not do is claim coverage they do not have. The window
construction and the runtime behaviour are proved by the scripts in the table
above instead.

## Adding a test

Pure functions, tested directly. For anything that needs a window, add a script
that drives the packaged build and assert on what it reads back, in the same
spirit as the ad blocking and split view checks. A test that passes on a build
with a broken feature is worse than no test, because it is a claim.
