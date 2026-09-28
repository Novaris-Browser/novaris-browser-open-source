# Novaris Security Model

Novaris is a browser, so the interesting question is not whether it uses
encryption. It is **what a page can reach, and who says yes**. This document
describes each boundary, how it is enforced, and — as importantly — where it
does not hold.

Anything here that reads as a limitation is one. Where a defence is partial, it
says so rather than implying more than it does.

---

## Renderer isolation

The interface and the pages are different processes with different privileges.

| | Interface | Page |
|---|---|---|
| Node.js | No | No |
| Electron IPC | Yes, guarded | No |
| Origin | `file://` inside the install | whatever it navigated to |
| Preload bridge | `contextBridge`, narrow surface | none |

A page is not a diminished interface. It has no path to the filesystem, no path
to the vault, and no path to the main process. The preload script is the only
bridge and it is attached to the interface, never to a page.

A private window is a page, and it is held to the same rule. It receives **no
preload at all**, so the privileged surface is not merely refused there, it is
absent. It used to receive the full bridge while loading an arbitrary website,
which meant every site opened privately was handed the vault, the filesystem
operations, the extension manager and the updater. The IPC guard refused those
calls, but handing a site a privileged API and relying on every call failing is
not a boundary, it is a hope.

The interface itself cannot be navigated off its own resources. It may load
files inside the built `dist/` directory and, in development, the development
server's exact origin. It may **not** load any `http` or `https` address, so it
cannot become a website while keeping its bridge. Links and popups out of the
interface are opened in the system browser. Pages belong in the sandboxed
webviews, which is where they already are, and a redirect is checked on the same
rule as a navigation, because `will-navigate` is not emitted for one.

*Enforced in* `electron/security.js` (`will-attach-webview`,
`isAllowedRendererNavigation`), `electron/private-window.js`,
`src/components/WebviewSurface.jsx`.
*Covered by* `tests/security-boundaries.test.js`.

---

## IPC security

Every privileged operation lives in the main process: reading the vault, filling
a password, importing a bookmark, moving a file, resetting the profile. A
preload bridge being the intended route is not a boundary, so the sender is
checked.

All channels pass through one guard, which requires:

1. the sender is one of our own window contents — not a `webview`, not a
   `browserView`, not a remote frame
2. the message came from the **top** frame, not an iframe inside the interface
3. that frame is running our renderer — a `file://` URL inside the install
   directory, or the development server origin and nothing else
4. a development origin is only honoured when one is configured, and only on
   loopback

The development origin is compared as a **parsed origin**, not as a string
prefix. A prefix match on `http://127.0.0.1:5173` also accepts
`http://127.0.0.1:5173.attacker.example/`, which is a different host sharing a
prefix; that was a real defect and is now covered by a test.

A refusal rejects the promise with a reason, so the caller can tell "blocked"
from "nothing happened".

*Enforced in* `electron/ipc-guard.js`, wired in `electron/ipc.js`.
*Covered by* `tests/ipc-guard.test.js`, `tests/security-boundaries.test.js`.

---

## Sandbox

Page views run sandboxed with context isolation on and Node integration off.
These are set in three places, and a webview cannot override them because
`will-attach-webview` rewrites the preferences rather than trusting them.

```
nodeIntegration            false
contextIsolation           true
sandbox                    true
webSecurity                true
allowRunningInsecureContent false
allowpopups                false
```

*Enforced in* `electron/security.js`, `electron/extensions.js`, `electron/private-window.js`.

---

## Permission system

**The default is no.** A permission is granted only when the user has stored a
decision for that specific site.

Three lists, checked in order:

- **Never granted.** `openExternal`, `hid`, `serial`, `usb`, `mediaKeySystem`,
  `midiSysex`, `pointerLock`, `fullscreen`, `window-management`,
  `speaker-selection`, `top-level-storage-access`. A site permission cannot
  override this list. Hardware access is refused outright with
  `setDevicePermissionHandler`.
- **Asked first.** `camera`, `microphone`, `geolocation`, `notifications`,
  `clipboard-read`, `display-capture`, `midi`, `persistent-storage`,
  `idle-detection`, `background-sync`, `window-placement`.
- **Unknown.** Anything Chromium adds in a future version is **refused**. A
  permission nobody enumerated must not start being handed out.

Two further rules:

- Nothing is granted over plain `http`. Both the page and the connection can be
  rewritten on the way, so a permission handed there is handed to whoever is on
  the path. Loopback counts as secure, which is what the platform considers it.
- `media` is split: a page asking for audio needs the microphone decision
  specifically, not a general media permission.

The policy is installed on **every** session as it is created. Private windows
use a random partition, and before this listened for `session-created` those
windows had no handler at all and fell back to the platform default, which is to
allow.

A private window is held to a stricter policy of its own, because it has no
interface to prompt from and a prompt nobody can answer honestly is not a prompt.
It grants **only** `fullscreen` and `automatic-fullscreen`, by allowlist, and
refuses everything else including anything Chromium adds later. Camera and
microphone in a private window are therefore refused rather than granted, which
is a deliberate trade: a video call in a private window will not work. The
alternative, silently granting a microphone to a window with no visible control,
is worse.

The partition a private window runs on is the same one that was hardened. It used
to be generated twice — once for the session being hardened and once in the
window preferences — so the window always ran on a session no policy had reached,
and the platform default granted it geolocation and notifications. That was
found by running the built application, not by reading it.

*Enforced in* `electron/main.js` (`installPermissionPolicy`), policy in `electron/security.js`,
private policy in `electron/private-window.js`.
*Covered by* `tests/permissions.test.js`, `tests/private-window.test.js`, `tests/security-boundaries.test.js`.

---

## Content Security Policy

The interface runs with the browser's own privileges, so the policy is the
boundary that matters most after process isolation.

```
default-src 'none'
script-src 'self'
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob:
font-src 'self' data:
media-src 'self' blob:
connect-src 'self'
frame-src 'none'
child-src 'none'
worker-src 'self' blob:
object-src 'none'
manifest-src 'self'
base-uri 'none'
form-action 'none'
frame-ancestors 'none'
require-trusted-types-for 'script'
upgrade-insecure-requests
```

Three decisions behind it:

- **`default-src 'none'`, not `'self'`.** `'self'` permits anything the page can
  reach and only narrows the categories someone remembered.
- **No network origin at all.** Every script, style, font and image is in the
  bundle. A production policy with a remote origin in it is a policy with a
  hole waiting for an injection. The development server origins that were
  previously in the shipped policy are gone; every installed copy had been
  willing to open a connection to port 5173 on the local machine.
- **Trusted Types is required.** Affordable only because the interface never
  assigns to `innerHTML` and never calls `eval`. Verified in the packaged build:
  assigning `innerHTML` now throws.

The policy ships as a meta tag and is also sent as a header for the development
server, which is stronger because it applies before the document is parsed.

*Enforced in* `electron/csp.js`, `index.html`, `electron/main.js`.
*Covered by* `tests/csp.test.js`.

---

## Password protection

Local only. There is no server component, so there is nothing to sync to and no
account to attach a vault to.

**Key hierarchy**

```
master password --Argon2id(salt)--> key-encryption key
                --AES-256-GCM--> per-record ciphertext
```

Each record is sealed individually, with the record id bound in as additional
authenticated data, so a record cannot be moved to a different entry. Every
sealed item gets its own random nonce, never reused with the same key.

The container is additionally sealed by the operating system keyring: DPAPI on
Windows, GNOME Keyring or KWallet on Linux.

**What this does not do.** Nobody, including whoever built it, can recover a
lost master password. There is no reset link and no back door. The only
supported route resets the vault and destroys its contents, because a support
process that can open a vault is a process that can open anyone's.

**On Linux the vault refuses to work without a real keyring.** Chromium can fall
back to a backend called `basic_text`, which encrypts with a hardcoded password
published in Chromium's own source, and reports itself available. Novaris checks
which backend was actually selected and treats `basic_text` and `unknown` as
unavailable. The vault then stays unavailable rather than appearing protected.
This is the one place where refusing to start is the correct behaviour.

*Code in* `electron/vault.js`, `electron/crypto-box.js`.
*Covered by* `tests/vault-keyring.test.js`, `tests/vault-crypto.test.js`.

---

## Update security

Two independent questions, and they are not the same one.

**Who built this file?** A code-signing certificate. Novaris is currently
**unsigned** — there is no certificate, so Windows shows "Unknown publisher" and
SmartScreen shows its warning. The build is configured for signing and takes the
certificate from the environment, so signing works the moment one exists. It has
been proved end to end with a throwaway certificate: the installer and both
shipped binaries sign, with an RFC 3161 timestamp from a real responder.

**Who published it?** A signature over the update manifest.

A certificate says nothing about the bucket. If the feed were writable by
anyone, or the response altered in transit, a correctly signed installer would
still be replaced by a different one, and the updater would download it because
the manifest said so.

So the manifest is signed too, with **Ed25519**, and verified against a public
key bundled in the application *before* the updater will act on it. A
substituted URL or hash is refused rather than downloaded.

- The signature covers the whole manifest, not a chosen subset of fields.
- A **missing** signature is a failure, not a pass. Treating its absence as
  acceptable would make the mechanism optional.
- Signatures are decoded **strictly**. Node's base64 decoder silently skips
  characters it does not recognise, so junk prepended to a signature decodes to
  the same bytes and verifies. It cannot forge anything, but several texts were
  accepted for one manifest. Canonical encoding is now required.
- Being signed is not the same as being usable, so the manifest's **shape** is
  checked too. A manifest that names no version, lists no download, carries no
  real SHA-512 or no size, or points at anything other than HTTPS is refused
  even when correctly signed. Ownership of the repository is not a substitute
  for a signature, and a signature is not a substitute for a well-formed file.
- Nothing is downloaded unless the feed verified in this session, so a later
  download call cannot proceed on state that was set by another route.
- The publisher refuses to upload an unsigned manifest, and says so in the dry
  run that people actually run first.
- The **private** key is written to `~/.novaris`, outside the repository, and
  the build fails if any private key is ever tracked.

**What SHA-512 does and does not do.** The digest in the manifest proves the
downloaded bytes are the bytes that were published. It does **not** prove who
published them — a digest is a checksum, not a signature, and anyone who can
change the manifest can change the digest to match their own file. Publisher
authentication is the Ed25519 manifest signature. Integrity is SHA-512 plus the
signature; neither is a claim about who built the installer, which is what a
certificate would say.

`verifyUpdateCodeSignature` was found to be a silent no-op: electron-updater
returns early when `publisherName` is absent, so the project claimed to verify
update signatures while verifying none. It is now off rather than on and doing
nothing, with a test that fails if the flag and the name are ever set apart.
Turning it on before a real certificate is in place would make every update
fail closed with no way to install one, which is a worse outcome than not
checking.

**What is still required for real publisher authentication on Windows:** a code
signing certificate from a CA the OS trusts, added to
`build.win.certificateFile`, and the rebuild verified with `Get-AuthenticodeSignature`.
Nothing in this repository substitutes for that, and the installer is currently
unsigned. The Ed25519 manifest signature already covers the update path
independently of any certificate.

*Code in* `electron/update-signing.js`, `electron/updater.js`, `scripts/sign-update-manifests.mjs`.
*Covered by* `tests/update-signing.test.js`, `tests/security-boundaries.test.js`, `tests/publish-release.test.js`, `tests/build-config.test.js`, `tests/signing-key-ignore.test.js`.

---

## Network security

All traffic is HTTPS, and `upgrade-insecure-requests` is on for the interface.

**Ad blocking.** Remote hosts by default, tracker hosts on by default, session
replay and fingerprinting only in strict mode. First-party ad scripts are
blocked by path as well, anchored to a path separator — matched as plain text,
`ads.js` would also block `downloads.js`, `uploads.js` and `leads.js`.

**Phishing detection is local.** Punycode, homoglyphs, digit substitution,
brand-in-subdomain and brand-plus-credential wording, all evaluated on the
device. Nothing about the sites you visit is sent anywhere.

**What still sees you.** A site that configures a STUN server can obtain your
public IP address through WebRTC, with no permission prompt. Three
mitigations were attempted — a preference switch, a command-line switch and a
host-resolver blackhole — and none of them worked. This is a Chromium
limitation rather than a Novaris one, and it is stated on the website rather than
left out. Blocking WebRTC is available as an explicit setting because the user
is entitled to the choice even though a complete fix is not available.

*Code in* `electron/adblock.js`, `electron/phishing.js`, `electron/privacy-posture.js`.

---

## Extension security

Extensions are unpacked and read from disk. Nothing is downloaded from a store.

- The manifest is parsed and permissions are listed **before** anything loads.
- Manifest V3 is detected from the manifest and reported, because its background
  runs in a service worker Electron does not execute. The extension may install,
  and it is labelled afterwards rather than being allowed to mislead.
- The Chrome Web Store cannot be scraped and its signature cannot be bypassed.
  Both are labelled in the application rather than spoofed.
- An extension is installed as a page view with the same sandbox, not with more.

*Code in* `electron/extensions.js`, `electron/extension-package.js`, `electron/extension-compat.js`.

---

## Build integrity

The build configuration is validated against electron-builder's own schema by a
test, because the schema is only consulted at package time — ten minutes into a
build, long after the mistake. It caught a signing configuration that had been
in place since a previous commit and would have failed every build.

The publisher will not release something inconsistent:

- an installer whose SHA-512 disagrees with its manifest
- a manifest built for a different version than `package.json`
- a manifest that is not signed
- a missing file the manifest names

After uploading, every object is **read back** from the public URL and compared
to the local file, because a `200` serving the wrong bytes is still a failure.

Every credential and key file is ignored, with a test that asks git what it
would actually do rather than reading `.gitignore` and being satisfied by what
it appears to say. That test exists because the public update key was once
silently excluded by rule ordering, and a fresh clone would have produced a
build carrying no key.

*Code in* `scripts/publish-release.mjs`, `tests/build-config.test.js`, `tests/publish-release.test.js`, `tests/signing-key-ignore.test.js`.

---

## Dependency security

- `npm audit` on every push, production and full, with a high threshold for
  shipped code.
- **Dependabot** on npm and on the workflows, daily for npm and monthly for
  actions, with Electron grouped because a quarterly release needs reading
  rather than just taking.
- **CodeQL** with the `security-extended` and `security-and-quality` suites on
  every push and weekly on a schedule, because Electron's main process holds the
  vault and the filesystem and the default suite misses a great deal in code of
  this shape.
- **Secret scanning** across the full history, plus a step that fails if a
  private key or certificate is tracked at all.

*Configuration in* `.github/workflows/security.yml`, `.github/dependabot.yml`.

---

## Privacy

**Measured, not asserted.** A Chromium network log over a real session visiting
three sites recorded 39 requests to exactly three hosts, all page content, with
no telemetry, no Safe Browsing, no component updater and no autofill upload.
Third-party cookie partitioning is already on by default.

**What is stored, and where.** Bookmarks, history, the reading list, downloads,
cookies, site data, the encrypted vault and settings, in the user-data
directory. Nothing is uploaded. The application has no telemetry, no analytics
and no crash reporting, which means a crash is only visible to the person it
happened to.

**The website is separate.** The application does not contact the website, and
the website does carry advertising, behind consent. Advertising is not loaded
and no advertising cookie is set until a visitor accepts, and the choice is
stored in local storage rather than a cookie, so the site sets no first-party
cookie of its own.

**The display name** collected at first run is used for the new tab greeting and
nothing else. It is stored locally, and there is no account to attach it to.

---

## Vulnerability reporting

**Please report privately.** There is no public issue tracker for security
reports, and a disclosed exploit is not a fixed exploit.

Email **security@novaris.example** with:

- what the issue is, and what an attacker gains
- how to reproduce it, ideally the smallest case that shows it
- the version, `Help → About`, and the platform
- whether it is already public

You will get an acknowledgement. A confirmed issue is fixed before it is
disclosed, and you are credited unless you would rather not be.

**In scope.** Anything that lets a page read or change something it should not;
anything that exposes vault contents or the master password; the update path;
the ad blocker's effect on a site being misled by it.

**Out of scope.** The WebRTC IP exposure described above, which is a Chromium
limitation that is disclosed rather than hidden; a SmartScreen warning on an
unsigned build; the absence of a certificate; and anything requiring an
attacker to already control the machine.

**Not a vulnerability.** Finding that the browser is Chromium. It is stated
plainly, in the application, on the website and in the release notes.

---

## Known limitations

Stated here so they are not buried.

| | |
|---|---|
| Installer is unsigned | No certificate. Windows shows "Unknown publisher". Signing is configured and proved to work. |
| SmartScreen warning | Reputation comes from downloads over time. It does not disappear because a certificate was bought, and even an extended-validation certificate stopped bypassing it in 2024. |
| WebRTC public IP | A site with a STUN server can learn it. Blocking is available as a setting; there is no complete fix. |
| Passkeys create but do not assert | Electron draws no account chooser, so a passkey can be saved and then not used. A broken promise in a security feature, and worse than not having it. |
| No crash reporting | By design. It also means crashes are invisible to us. |
| Extension support | Manifest V3 background workers do not run. Detected and labelled, not spoofed. |
| Camera and microphone in a private window | Refused rather than granted. A private window has no interface to prompt from, and a prompt nobody can answer honestly is not a prompt. A video call opened privately will not work. |
