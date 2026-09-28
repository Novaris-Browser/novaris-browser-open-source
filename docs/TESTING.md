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
| Update signatures stop a tampered manifest | Signing a real manifest, then altering the version, the hash, the size, the URL and the signature in turn. Each is refused; the genuine one is accepted. |
| The public update key is tracked, and private keys are not | Asking `git add --dry-run`, rather than reading `.gitignore`. |
| Nothing reaches Google | A Chromium network log of a real session. |

## What is not covered

Stated so the gaps are visible.

- **The Linux package has never been launched.** It builds, the structure and the
  manifest hash verify, but there was no display available in the environment used
  to build it. A Linux build with a rendering problem would not be caught by
  anything here.
- **The visual layout is not tested.** No screenshot comparison, so a change that
  looks wrong but works is not caught.
- **No end-to-end test through the interface.** A gesture is simulated in the DOM
  rather than performed, so a regression in event wiring between a real pointer
  and a synthetic one would not be caught.
- **WebRTC, passkeys and the certificate are documented limitations**, not fixed
  features, and no test asserts them as working.

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

## Adding a test

Pure functions, tested directly. For anything that needs a window, add a script
that drives the packaged build and assert on what it reads back, in the same
spirit as the ad blocking and split view checks. A test that passes on a build
with a broken feature is worse than no test, because it is a claim.
