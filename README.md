# Novaris Browser

Novaris Browser is a desktop browser for Windows and Linux, built with Electron,
Chromium, React and Vite. It uses a macOS-inspired liquid-glass interface without
copying Apple assets or proprietary UI resources.

The browser shell is not a webpage mockup: websites render inside isolated Chromium
`<webview>` surfaces with JavaScript, HTTPS, cookies, local storage, page
navigation, downloads, and a credential vault sealed by the operating system.

**Start with [SECURITY.md](SECURITY.md).** It describes every boundary, how it is
enforced, and where it does not hold. `docs/` has the architecture, the privacy
position, the testing approach and the release process.

## What it does now

Everything below was built and verified against the packaged application, not just
against a developer's build. The full measurements are in the
[official site](Official%20Website/) and in [`docs/`](docs/).

| Area | What it does |
| --- | --- |
| **Tabs** | Vertical tab strip, drag to reorder or move between groups, hover preview, search across every open tab, and a right-click menu for duplicate, mute, close, split and move. |
| **Workspaces** | A top-level container holding groups, groups holding tabs, and tabs optionally loose. Deleting either keeps the contents rather than destroying work. |
| **Split view** | Up to four pages at once. Drag a tab onto the left or right edge of a page and the edge lights up; drag the divider to change the widths; take any pane out on its own. A pane is never narrower than the point where a page becomes unreadable. |
| **Ad blocking** | Blocks at the network layer, before the request leaves the machine, so the destination never learns you visited the page. Host rules and first-party path rules, three tiers, custom filters, and a live counter. |
| **Unsafe sites** | Reported scam, fraud and malware hosts are stopped before load, with the reason shown. Blocking is always against the exact host, never the hosting platform. |
| **Vault** | Each credential sealed individually with AES-256-GCM under an Argon2id key, bound to its own record id, and layered over the operating system keyring. A hard lock with no bypass, and no recovery for anyone. |
| **Credential guard** | A saved login is only ever filled into the host it was saved for, and a page imitating a known sign-in provider raises a warning first. |
| **Website Trust Card** | Per-site panel: encryption, granted permissions, which extensions can read the page, ads stopped, and a local phishing verdict with its reasons. |
| **Phishing detection** | Entirely on-device. Catches lookalike characters, digit substitution, internationalised domains, and real brands parked in front of another address. |
| **Private windows** | A separate window on non-persistent storage with its own random partition, so nothing survives closing it and two private windows cannot see each other. It gets **no privileged bridge at all**, and grants only fullscreen. |
| **Gaming Mode** | Unloads inactive tabs rather than hiding them, refuses notifications, and stops the spellchecker. The cost is stated in the interface. |
| **Side panel** | Discord, YouTube, Spotify, Canvas, Mail and a Notes scratchpad beside the tabs. Only the open app is loaded. |
| **Media controls** | Transport, seek, volume and picture-in-picture for whatever the page is playing. Only a fixed command set can be sent to a page. |
| **Background audio** | Music and calls carry on in tabs you have switched away from, and a tab can be dropped into a split without stopping. Off by choice, on by default. |
| **Saved pages** | Offline reading from a sandboxed capture that carries the address and time it was taken, and refuses pages that would not save usefully. |
| **Tab transfer** | Device to device on the local network with no server. Encrypted before it moves, authorised by a 100-bit pairing code. |
| **Updates** | Ask first, show the size, verify the manifest signature and a published SHA-512, then install. No forced updates. |
| **Verifying a download** | Every release publishes a `checksums.txt` signed with the same key the updater uses, so the *first* install can be checked too, not just updates. `node scripts/verify-download.mjs <file>`. |
| **Security** | IPC sender validation, a `default-src 'none'` policy with Trusted Types, deny-by-default permissions on every session, no privileged preload on any page, an interface that cannot navigate itself to a website, and CodeQL with dependency scanning on every push. |

### What it does not do

Listed because a security product that only lists its wins is misleading. The
detail is on the site's limits section, in [`docs/`](docs/) and in
[SECURITY.md](SECURITY.md).

- **The certificate is self-signed.** Windows builds are signed and show
  "Novaris Browser" as the publisher, but the certificate is not issued by a
  certificate authority, so a machine that has not installed
  `Novaris-Browser-Root.cer` still shows "Unknown publisher". A CA-issued
  certificate is what a stranger's machine trusts, and that is not free. A
  bought certificate would not remove the SmartScreen warning either — that
  comes from downloads over time.
- **A site can still learn your public IP address** through WebRTC if it configures a
  STUN server, with no permission prompt. Chromium's own switches were tested three
  ways and none of them prevented it, so there is an explicit setting instead of a
  claim it does not meet.
- **Chrome Web Store installs are not available.** Google exposes no install API to
  third-party browsers. Novaris detects Manifest V3 extensions, warns before you
  install, and labels them afterwards so nothing silently does nothing.
- **Passkeys can be created but not yet used.** Registration works; signing in needs
  an account chooser that Electron does not draw.
- **Phishing detection reads the address, not a reputation.** A new malicious domain
  with an unusual name can still get through.
- **Tab transfer needs both devices on one network.** There is no relay, so there is
  no server to run.
- **There is no crash reporting.** By design, and it also means crashes are invisible
  to us.

## Official website

A static site lives in [`Official Website/`](Official%20Website/). No build step, no
framework, and no third-party requests until a visitor accepts advertising. It
carries a download page for both platforms, a changelog, the release feed, and
the legal pages, and it reads the live update feeds so it reports the version and
hash that are genuinely published.

```bash
# From inside Official Website/
node tools/site-audit.mjs
```

That audit checks metadata, canonicals, link targets, heading order, alt text,
structured data and the sitemap against the files on disk, and exits non-zero on
error so it can gate a deploy. It reads the origin from `js/config.js`, the same
file the pages read it from, so a renamed domain cannot leave the audit passing
against an address the site no longer uses.

## Documentation

| Document | What it covers |
| --- | --- |
| [SECURITY.md](SECURITY.md) | The security model. Start here. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Processes, module layout, and why the boundaries fall where they do. |
| [`docs/PRIVACY.md`](docs/PRIVACY.md) | What is stored, what leaves the device, what was measured, and what still sees you. |
| [`docs/UPDATES.md`](docs/UPDATES.md) | The update channel, release signing, and what a user can verify. |
| [`docs/PUBLISHING.md`](docs/PUBLISHING.md) | Publishing a release, and the checks that stop a broken one going out. |
| [`docs/TESTING.md`](docs/TESTING.md) | What is tested, what is proved rather than asserted, and what is not covered. |
| [`docs/ENGINE-MIGRATION.md`](docs/ENGINE-MIGRATION.md) | Moving away from Chromium. |

## Windows-first architecture

```text
Novaris Browser/
├── electron/
│   ├── main.js             # Windows lifecycle, window, startup preferences
│   ├── preload.js          # narrow contextBridge API; no raw ipcRenderer
│   ├── security.js         # navigation, window-open, webview, shortcut policy
│   ├── downloads.js        # Chromium download lifecycle and safe save paths
│   ├── ipc.js              # validated settings/library/vault IPC
│   ├── store.js            # persistent metadata with backup recovery
│   ├── privacy.js          # opt-in cleanup on normal Windows exit
│   ├── performance.js      # Chromium background-work policies
│   ├── extensions.js       # user-selected unpacked extension loading
│   ├── adblock.js           # first-party request blocking policy
│   ├── builtin-extension.js # bundled Novaris Ad Blocker files
│   ├── extension-package.js # CRX/ZIP parsing and safe extraction
│   ├── bookmark-import.js  # exported HTML bookmark parsing
│   ├── password-import.js  # local CSV password-import parsing
│   ├── engine.js            # runtime engine capability contract
│   ├── storage.js          # storage and memory usage overview
│   ├── windows.js          # Jump List, taskbar, and global-hotkey integration
│   └── vault.js            # Windows safeStorage encrypted credential vault
├── src/
│   ├── App.jsx             # shell composition and view orchestration
│   ├── components/         # reusable UI surfaces
│   ├── hooks/useBrowser.js # tabs, navigation, webview events, shortcuts
│   ├── lib/                # URL normalization, internal pages, formatting
│   └── styles.css          # responsive glass/liquid design system
├── tests/                  # URL, persistence, and extension-package tests
├── docs/                   # engine migration and architecture notes
├── scripts/                # development and readiness probes
├── assets/                 # application artwork
├── index.html
├── vite.config.mjs
└── package.json
```

Two packages are produced: an NSIS installer for Windows x64, and a Debian package
for Linux x64. The Linux build is produced on Linux rather than cross-compiled,
because electron-builder cannot build it from Windows.

```bash
# Windows
npm run dist:win

# Linux, from WSL
npm run dist:linux
```

Both land in `release/`, each with its own `latest*.yml` and its own SHA-512.

On Linux the package installs the application under `/opt/Novaris Browser/`. It
appears in the application menu, but there is no `/usr/bin` entry, so
`novaris-browser` is not on `PATH` and cannot be started from a terminal; the
binary is at the `/opt` path above.

Novaris exits with an explanatory message on any other platform, which is macOS.

### Process boundaries

- **Main process:** owns the BrowserWindow, Chromium sessions, navigation policy, downloads, performance policies, persistent metadata, and encrypted vault.
- **Preload bridge:** exposes named operations through `contextBridge`; the renderer cannot access Node.js, raw `ipcRenderer`, arbitrary IPC channels, or the filesystem. Every channel is additionally checked for sender, frame and origin before it runs.
- **Renderer:** React owns the browser shell, tabs, internal pages, settings, and user interface, under a `default-src 'none'` policy with Trusted Types required.
- **Page webviews:** `nodeIntegration=false`, `contextIsolation=true`, `sandbox=true`, and `webSecurity=true` are enforced in the webview attributes and the main-process attach policy.

### What each package ships

`build.files` is an allowlist: `dist/`, `electron/`, `assets/` and `package.json`.
Nothing else is packaged. `tests/packaging.test.js` walks every relative `require`
in `electron/` and asserts it resolves inside that allowlist, because a module
once ended up under `src/`, where the tests and the bundler both resolved it and
the packaged application did not ship it.

## Engine migration spike

The current Electron/Chromium build remains the supported application. A non-destructive engine-adapter seam now reports runtime capabilities, and `docs/ENGINE-MIGRATION.md` describes the staged CEF/Chromium migration. Run `npm run engine:spike` to check whether the machine has the C++ toolchain and CEF SDK required for the next phase. A CEF host is not yet built or packaged; installing one is a native-toolchain and distribution project, not a renderer change.

## Requirements

**To run:** Windows 10 or 11, or Linux x64 with a desktop keyring if you want the
password vault. Everything else in the browser works without one, and the vault
reports itself unavailable rather than falling back to an unencrypted store.

**To build:** Node.js 20.19 or newer (Node 24 is supported), npm 10 or newer, and
a network connection for the first dependency install. The Linux package
additionally needs WSL with a Node 24 toolchain, or any Linux x64 machine.

There is no macOS build. The source uses standard Electron APIs throughout, and
the platform guard would be the only thing to change, but nothing has been
packaged or tested there.

## Install

```powershell
cd "C:\Users\norep\Downloads\Novaris Browser"
npm install
```

If npm reports that the Electron binary is missing, repair the package:

```powershell
npm rebuild electron --verbose
node node_modules\electron\install.js
```

The tested runtime is Electron `44.4.5`.

## Development

Start Vite and Electron together:

```powershell
npm run dev
```

Useful commands:

```powershell
npm test          # Vitest unit tests
npm run build     # production renderer build into dist/
npm start         # launch the already-built app
npm run engine:spike # report CEF/Windows build readiness
```

## Production packaging

Build the Windows installer:

```powershell
npm run dist:win
```

`npm run dist` is an alias for the same Windows packaging command. The installer is written to:

```text
release\Novaris-Browser-0.1.0-Setup.exe
```

## First-run setup

On the first launch Novaris opens a three-step setup flow:

1. Review the default-browser choice, import exported bookmarks, and optionally import a password CSV.
2. Choose a search provider.
3. Choose appearance, startup behavior, privacy baseline, and an optional vault password.

Windows protects final default-browser selection, so Novaris makes a best-effort protocol registration and opens the Windows **Default Apps** settings page when the user chooses **Make default**. The user must confirm Novaris there; Novaris does not silently change the protected Windows UserChoice setting.

Six search providers are available:

- Google
- Bing
- DuckDuckGo
- Brave Search
- Startpage
- Ecosia

The choice is used for non-URL address-bar searches and can be changed later in Settings.

## Internal Novaris pages

The address bar recognizes local shell routes:

```text
novaris://newtab
novaris://bookmarks
novaris://history
novaris://downloads
novaris://reading-list
novaris://passwords
novaris://extensions
novaris://settings
novaris://about
```

These pages are rendered by the trusted Novaris shell rather than loaded as arbitrary web content. Webviews are blanked while an internal page is active.

## Updates and starting fresh

Novaris never installs anything without asking first.

1. Once per launch it checks the update channel. If a newer build exists, a dialog appears with the new version and its release notes, plus **Download update** and **Not now**.
2. Choosing **Download update** downloads it in the background with a progress bar. `autoDownload` and `autoInstallOnAppQuit` are both off, so nothing is fetched or applied without a click.
3. When the download finishes, **Restart and start fresh** is offered, with a plain warning that installing deletes the profile.
4. Installing restarts Novaris into a **full new install**: the profile is wiped before the window is created, and the user is shown a summary of what happened, what was deleted, and what is new in that version. First-run setup then runs again, so they can set a new browser password.

**The update channel is generated into the bundle.** `scripts/write-update-channel.mjs` copies `build.publish.url` from `package.json` into `assets/update-channel.json`, which is what the running application reads. The packaged `package.json` cannot be used for this, because electron-builder prunes the `build` section out of it. The full publishing procedure, including the Cloudflare R2 setup and a troubleshooting table, is in `docs/UPDATES.md`.

**Starting fresh.** A full reset cannot safely run while Chromium holds the profile open, so Settings → General → **Reset browser** writes a marker, restarts the app, and wipes the profile on the next launch before any session exists. The wipe removes settings, bookmarks, history, reading list, downloads, site permissions, extensions, ad blocker rules, the encrypted vault, and Chromium's own cookies, cache, and site data. It requires an explicit confirmation dialog.

The marker is consumed *before* the wipe, and the wipe runs twice. Chromium recreates and locks some profile files during startup, so clearing the marker only after a fully clean removal would have shown the summary screen on every launch forever. `tests/update-reset.test.js` covers the locked-file case.

Uninstalling now also removes the profile (`deleteAppDataOnUninstall`). Previously the profile survived an uninstall, which is why a reinstall could silently skip first-run setup: `onboardingCompleted` was still `true` from the earlier install.

## Built-in Windows vault

Open **Passwords** from the toolbar or sidebar to use the local credential manager.

Implemented:

- Website and account name
- Username
- Email address
- Password
- Notes
- Strong password generator
- Username generator
- Copy username
- Copy password
- User-triggered fill on the active page
- Delete credentials
- Search credentials
- Optional master-password lock for the vault controls
- Browser lock screen that asks for the vault password at launch
- Change the vault password, or remove the lock, from Settings → Security
- Encrypted vault export (`.nvx`) and encrypted import
- Windows-encrypted backup recovery
- Optional first-run vault password setup
- Local CSV password import with explicit confirmation (Chrome/Edge password databases are never read directly)

### The browser password

The vault password is optional, and it can be set at three points: during first-run setup, later from Settings → Security, or not at all.

Once it is set, Novaris shows a lock screen on the next launch and asks for the password before the browser, the new tab page, or the onboarding flow becomes reachable. The password is also asked for when you lock the vault manually or remove the lock, and changing it requires the current password.

There is a deliberate **hard lock**: once a browser password is set, the lock screen has no skip path. The password is the only thing that can decrypt the vault, so a bypass would make the lock decorative. A forgotten password cannot be recovered, because Novaris never stores it; the lock screen says so plainly and offers only a full browser reset, which destroys the vault rather than opening it.

**Do not force-quit Novaris while it is open.** Terminating the process outright can leave a `safeStorage` blob that Windows declines to decrypt on the next launch, which would lock you out of the vault. Closing the window normally shuts down cleanly and the vault reopens as expected.

### Cryptography

| Concern | What is actually used |
| --- | --- |
| Key derivation | Argon2id, 19 MiB, 1 pass, 256-bit output |
| Record encryption | AES-256-GCM, one random 12-byte nonce per record |
| Alternative cipher | ChaCha20-Poly1305, used when the runtime lacks AES-256-GCM |
| Salt | 16 random bytes, fresh for every key derivation, stored with the lock file |
| File container | Electron `safeStorage` (Windows DPAPI) |
| KDF cost | Recorded in the lock file so a later build can raise it |

The main process owns every key. Nothing is derived in the renderer, and no key,
salt, or password is written to a config file or to the application source.

**Argon2id in Electron.** Node exposes `crypto.argon2`, but Electron's build of
Node ships without the backing implementation and throws
`ERR_CRYPTO_ARGON2_NOT_SUPPORTED`, even though the function exists. Capability
detection therefore performs a real derivation instead of checking
`typeof`. Where native support is missing, `hash-wasm` is used, verified
byte-for-byte against Node's native Argon2id by `tests/argon2-parity.test.js`.
`@noble/hashes` was evaluated and rejected because version 2.4.0 produces
different output for the same inputs, which would have made a vault readable on
one build and not another. Unlock takes about 55 ms.

**Each record is sealed separately.** With a browser password set, every record
gets its own nonce and is bound to its own id as additional authenticated data,
so two records cannot be swapped and a single leaked ciphertext reveals nothing
else. Changing the password re-encrypts every record under the new key, and the
old key is wiped from memory on lock.

**Not implemented.** Binding the vault key to a TPM 2.0 device, and unlocking
with Windows Hello or a WebAuthn passkey, both need a native helper: Electron
exposes no API for sealing a key to a TPM or for using a passkey to unwrap key
material. Neither is claimed here.

Security behavior:

- Passwords are encrypted with Electron `safeStorage`, backed by Windows user protection.
- Passwords are never written to the JSON metadata store.
- The normal credential list does not return password values to React.
- Copy operations write directly to the Windows clipboard in the main process.
- Fill operations execute only after an explicit user action and only against a Novaris webview.
- Novaris does not scan page fields in the background.
- If Windows encryption is unavailable, Novaris refuses to save passwords rather than falling back to plaintext.
- The master lock is an additional application lock; the vault file remains protected by Windows `safeStorage` and is never exported in plaintext.
- Setting the password in first-run setup unlocks the vault immediately, so onboarding never ends on a locked screen.

This is a local vault, not a cloud account or sync service. The app does not pretend to provide Google Password-level account recovery.

## Persistence and privacy

By default, Novaris data is persistent and stored in the Windows user-data directory:

- Bookmarks
- History
- Reading list
- Settings
- Download records
- Closed-tab records
- Restorable tab sessions, pinned tabs, and tab groups
- Per-site permission policies
- User-selected unpacked extension records
- Encrypted credential vault
- Chromium cookies and site storage in the persistent `persist:novaris` partition

Metadata writes keep a local backup copy and can recover from a damaged primary metadata file. The vault also keeps an encrypted backup copy.

Privacy settings include:

- Manual clearing of cookies/site storage
- Manual clearing of cache
- Manual clearing of Novaris history
- Manual clearing of download records
- Optional automatic cleanup during a normal Windows exit

Automatic cleanup is opt-in. When enabled, Novaris can clear selected cookies, site storage, cache, and Novaris history during a normal shutdown/window close. It cannot run after a crash, forced termination, power loss, or kill process.

## Performance settings

Settings → Performance includes working controls for:

- **Speed:** keeps background page work active
- **Balanced:** enables Chromium background throttling
- **Memory saver:** reduces inactive-tab work
- Background-tab throttling
- Reduced inactive-tab work
- Reduced interface motion
- Hardware acceleration (applied on the next launch)

Performance changes are sent through the main process to existing Chromium webviews. The app does not disable Chromium security to obtain faster performance.

## Browser feature surfaces

The Settings and sidebar surfaces expose the requested browser features without giving page content access to the trusted shell:

- **Session recovery:** the active tab list, URLs, titles, favicon, zoom, pinned state, and tab groups are periodically saved and restored after a restart or crash. Turn it off in Settings → General when a fresh New Tab is preferred.
- **Bookmark import:** import exported Chrome, Edge, or Firefox bookmark HTML during first-run setup or later from Settings → General; unsafe protocols and duplicates are ignored.
- **Command palette:** press `Ctrl + Shift + K` to search browser commands, pages, and Novaris tools without leaving the keyboard.
- **Shortcut bridge:** browser and webview key events are normalized in the main process, so shortcuts such as `Ctrl + T`, `Ctrl + W`, `Ctrl + R`, and `Ctrl + F` work even while a page has focus.
- **Custom search:** add HTTP(S) search templates containing `{query}` in Settings → General. Optional keyword shortcuts such as `s privacy` are expanded only by the selected custom provider.
- **Site permissions:** camera, microphone, notifications, location, clipboard-read, and download policies are stored per exact origin. Sensitive requests are denied until explicitly allowed.
- **Downloads:** the download shelf supports pause, resume, cancel, retry for HTTP(S) transfers, show-in-folder, and taskbar progress. Interrupted records from a previous run are marked for retry.
- **Tab organization:** pin tabs from the tab strip, create and rename groups, assign tabs to groups, and delete groups without losing the tabs.
- **Storage dashboard:** Settings → Storage shows user-data, partition, vault, memory, bookmark, history, and download usage. Current-site data can be cleared without deleting the rest of the profile.
- **Reader mode:** the reader button extracts page text into a plain-text, local reading surface. It does not inject page HTML or scripts into the Novaris renderer.
- **Windows integration:** the `novaris://` protocol is registered by the installer, Jump List tasks open internal pages, taskbar progress reflects downloads, and the optional global focus hotkey defaults to `Ctrl+Shift+Space`.
- **Built-in Novaris Ad Blocker:** every new profile receives a first-party ad-blocking extension. It cancels matching requests in the main Chromium session, removes common ad elements from the page, supports custom filter rules, can be toggled, and can be permanently removed or restored from `novaris://extensions`.
- **Extension action bar:** enabled extensions appear in a browser-style action strip. The built-in blocker has a secure in-app action popover; extensions declaring a Chrome action popup can open that popup in an isolated sandboxed window.
- **Extensions:** Settings → Extensions supports trusted unpacked folders and a Chrome Web Store-assisted workflow. Paste an official store URL or extension ID, open the listing in the system browser, then import a CRX/ZIP you obtained there. Novaris extracts it into private app data, shows its manifest permissions, and requires confirmation.

## Ad blocking

The blocker has two layers, because request blocking alone does not remove the empty space an ad leaves behind.

**Network layer.** `electron/adblock.js` cancels requests in the persistent Chromium session. The bundled list covers the major ad exchanges, and a separate optional set covers analytics and tag managers. Blocking is applied through `webRequest.onBeforeRequest`, and the decision is made from a cached copy of the settings so that no profile data is cloned per request.

**Cosmetic layer.** The bundled extension injects a content script that hides and then removes common ad containers, and keeps watching with a `MutationObserver` so lazily inserted ad boxes are removed too. Its selector list lives in `electron/builtin-extension.js`.

**Custom rules.** Settings → Extensions accepts one rule per line and supports the most common Adblock Plus forms:

| Rule | Effect |
| --- | --- |
| `||ads.example.com^` | Block a host and its subdomains |
| `/banner/ad` | Block any URL containing that text |
| `\|http://example.com/` | Block URLs starting with that text |
| `##.ad-slot` | Hide matching page elements |
| `example.com##.promo` | Hide those elements on one site only |
| `#@#.allowed` | Exception for a cosmetic rule |
| `@@\|\|safe.example.com^` | Never block, even if another rule matches |
| `$script,third-party` | Restrict a rule to a resource type or party |

Filter matching uses string containment only. Rule text never reaches `RegExp`, `eval`, or any dynamic code path, so a pasted filter cannot execute.

`Trackers` and `Strict` are separate toggles, and a live counter in Settings → Extensions shows how many requests were actually blocked along with the busiest hosts. The three tiers are kept in separate lists: ad exchanges are always on, analytics and tag managers sit behind `Trackers`, and higher-risk hosts such as session-replay and attribution services sit behind `Strict`. Because cosmetic rules are compiled into the bundled content script, saving the filter list regenerates that file and reloads the extension.

## Credential protection

Novaris treats credential theft, not cookie theft, as the threat here.

**Cross-origin cookie access is not possible.** Chromium keeps each site's cookies separate, so a page on `walltrks.com` cannot read your `youtube.com`, `google.com`, or `myaccount.google.com` cookies. A credentialed cross-origin request does not help either, because the response is unreadable without CORS approval. Sites like these often *ask* you to paste your cookies as the trick; a page requesting that is already telling you what it wants.

**What these pages actually do** is show a convincing sign-in form, or invite you to paste a session token, and then capture whatever you type. That is what Novaris defends against:

- **Password fill is domain-locked.** A saved credential is only ever filled into a host the credential was saved for. Filling a Google login into `127.0.0.1` is refused with *"This login belongs to Google, not to 127.0.0.1"*. Before this check existed, any page with a password field could receive the credential.
- **Filling is refused outright on flagged sites**, even when the domain matches, and the scam reason is shown instead.
- **Fake sign-in pages raise a warning.** On each navigation Novaris checks whether an unrelated host is asking for a password or a pasted token while using a well-known provider's name. The warning explains that the provider's cookies cannot be read, what the real risk is, and what to do if a password was already entered.
- A brand mention alone never triggers the warning, because plenty of ordinary pages write about Google. A credential-capture field is required first. `tests/credential-guard.test.js` covers both the true positives and that false positive.

## Unsafe site protection

`electron/site-safety.js` keeps a high-confidence blocklist of scam, malware, fraud, and phishing hosts. A match stops the navigation before the page loads and shows a warning screen naming the reason. Choosing **Continue anyway** requires a second, explicit confirmation, and the override applies only to that host for the rest of the session.

The list is made of **exact hosts, not parent platforms**. A malicious tenant such as `v0-iroblox.vercel.app` blocks only that project and its subdomains, so other Vercel, GitHub Pages, Blogspot, and Onrender tenants keep working. A parent domain is only listed when the whole parent is malicious. `tests/site-safety.test.js` asserts both directions: every reported host is blocked, and neighbouring tenants on the same platforms are not.

Host matching accepts a full URL, a bare host, any port, any letter case, and a `www.` prefix, so `walltrks.com`, `https://www.Walltrks.com/`, and `http://walltrks.com:8080/deep/path` are all caught.

Entries may carry a specific reason instead of the shared phrase. `roblox-redeem-codes.onrender.com` reports collecting a username, password, and code and posting them to a Discord webhook with the visitor's IP, so its warning names that rather than saying only "scam".

Electron never emits `will-navigate` for `webContents.loadURL`, which is how the address bar navigates, so the check runs in the renderer before navigating and again in the main process for in-page link navigation and initial webview attachment. `tests/site-safety.test.js` asserts both interception points exist, so a future refactor cannot silently drop one.

## Extension scope

Novaris does not bundle a VPN. It does not download, redistribute, or ship an unreviewed VPN client with shared credentials, and it does not run a VPN of its own. A VPN is a network-level product with its own licensing, auditing and abuse surface, and shipping somebody else's binary under our name would be indefensible. If that is ever built, it should be a separate decision with its own review.

Extension loading is deliberately restricted to unpacked extensions and CRX/ZIP packages that the user explicitly selects. Novaris does not scrape, proxy, or bypass the Chrome Web Store, and it cannot verify Google's package signature after import. The store listing opens in the system browser, while the package is imported only after a permission review.

Two things follow from Electron's extension host, and both are surfaced in the interface rather than left to be discovered:

- **Manifest V3 background service workers do not run.** Electron does not execute them, so an MV3 extension can install and then do nothing at all. Novaris reads the manifest before installing, warns you, and labels the extension afterwards with the specific reason.
- **Manifest V2 extensions work**, including content scripts, background pages and `webRequest`-based blocking.

Extensions run in Chromium's webview session and can read or modify pages they are permitted to touch. Install only code you trust. Full Chrome-extension API compatibility is not promised, and a browser on this engine should not claim to have a Chrome Web Store integration it does not have.

## Keyboard shortcuts

Windows shortcuts are used throughout the interface:

```text
Ctrl + L              Focus address bar
Ctrl + T              New tab
Ctrl + W              Close tab
Ctrl + Shift + T      Reopen closed tab
Ctrl + R              Reload
Ctrl + F              Find on page
Ctrl + D              Bookmark page
Ctrl + +              Zoom in
Ctrl + -              Zoom out
Ctrl + 0              Reset zoom
Ctrl + Shift + I      Developer tools
Ctrl + Shift + K      Command palette
Alt + Left            Back
Alt + Right           Forward
```

## Security model

- Navigation accepts only `http:` and `https:` page URLs.
- `javascript:`, `file:`, `data:`, and other unsafe schemes are rejected.
- External `window.open` requests are denied inside the app and only valid HTTP(S) URLs are handed to the operating system.
- Renderer navigation is restricted to the local app file or development server.
- Guest webviews cannot navigate to arbitrary local files.
- Permission requests such as camera, microphone, geolocation, notifications, and clipboard reads are denied by default and can be allowed only for an exact saved origin.
- Download names are sanitized and the renderer cannot provide arbitrary filesystem paths.
- Native Windows link context menus are limited to safe reload/navigation, opening validated HTTP(S) links in a new Novaris tab, and copy actions.
- Unpacked and imported extensions are user-selected and are loaded only into the isolated browser session; the Novaris renderer receives no extension bridge.
- Extension action popups open in separate sandboxed windows and never receive Node.js access or the Novaris preload bridge.
- The built-in ad blocker is first-party, removable, restorable, and controlled by the same extension manager rather than bypassing the user’s choice.
- CRX/ZIP imports reject path traversal, symbolic links, oversized archives, and unsupported manifests, and always require a permission confirmation.
- Password CSV imports are parsed locally, confirmed before writing, validated as HTTP(S) records, and stored only through the Windows-encrypted vault.
- Novaris does not disable certificate validation, web security, context isolation, or Chromium sandboxing.
- Webpage content never receives Node.js integration.

## Known scope boundaries

These are deliberate boundaries for this Windows-first release:

- No VPN implementation in this iteration
- No one-click Chrome Web Store API, cloud extension sync, or full Chrome-extension API compatibility
- No account system, cloud sync, or password recovery service
- No silent Windows UserChoice modification; setup opens Windows confirmation settings
- No native printing or full password-manager account import
- No background form scanning or automatic credential submission
- No direct Chrome/Edge password-database extraction; password import uses a user-created CSV export
- Address suggestions use local bookmarks/history rather than a third-party suggestion service
- Hardware acceleration changes require a restart
- Cleanup-on-exit cannot run after a crash or forced termination

The navigation, tabs, webview, search, bookmarks, history, downloads, settings, themes, performance controls, internal pages, encrypted vault, keyboard shortcuts, and first-run setup are implemented in source rather than represented by placeholder screens.

## Troubleshooting

### Electron says it failed to install correctly

Run:

```powershell
npm rebuild electron --verbose
node node_modules\electron\install.js
npm run dev
```

If the binary is still absent:

```powershell
Remove-Item -Recurse -Force node_modules\electron
npm install
```

A corporate proxy can prevent the Electron archive download. Configure npm/Electron proxy access and rerun the install.

### The first-run setup does not appear

The setup flag is stored in the Novaris user-data JSON file. To rerun onboarding, close Novaris and remove `novaris-data.json` from the Novaris Windows user-data directory, or change `onboardingCompleted` to `false` in that file.

### A site is unavailable

Novaris does not bypass HTTPS certificates or website security. Check the URL, network, proxy, and the site's availability. Failed pages retain Retry and Home actions.

### The Windows vault is unavailable

Novaris refuses to store passwords in plaintext when `safeStorage` reports that Windows encryption is unavailable. Confirm that Novaris is running in the normal packaged Windows application and that the Windows user profile is available.

### Automatic cleanup did not run

Exit cleanup runs only during a normal Windows quit/window close. It cannot run after a crash, forced termination, power loss, or process kill.

### Downloads do not appear

Check the download shelf and Settings → Downloads. When **Ask before downloading** is enabled, allow the native save dialog. Clearing the download list does not delete files already on disk.

## License

MIT. See [LICENSE](./LICENSE).
