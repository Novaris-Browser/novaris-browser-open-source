# Novaris engine migration spike

## Goal

Keep the existing Novaris interface while replacing the Electron browser host with a Chromium-based host that has broader extension compatibility.

The current Electron build remains the supported production build. This spike is intentionally non-destructive: no tabs, vault data, settings, or UI code are removed while the new engine is evaluated.

## What stays

- React renderer and `src/styles.css`
- Custom title bar, tab strip, toolbar, sidebar, settings, and onboarding
- `novaris://` internal pages
- Windows vault, history, bookmarks, downloads, and session metadata
- Existing user data directory and backup format

## What changes

The engine adapter must eventually own:

- Native browser windows and tab surfaces
- Navigation and webview lifecycle
- Chromium sessions and profiles
- Extension loading, updates, and permission handling
- Download and site-storage operations
- Native context menus, taskbar integration, and protocol routing

The current Electron code already has a narrow extension-manager boundary in `electron/extensions.js`; that boundary is the first seam for a future engine implementation.

## Phases

1. **Readiness spike** — verify the Windows C++ toolchain, CEF SDK, renderer bridge, packaging, and extension compatibility.
2. **Engine adapter** — implement a CEF-backed adapter behind the same browser operations used by the React shell.
3. **Profile migration** — import the existing Novaris metadata and Chromium `persist:novaris` data.
4. **Extension validation** — test representative content scripts, background pages, storage, permissions, and unsupported APIs.
5. **Distribution** — package, sign, update, and document the new engine. A true Chrome “Add to Chrome” flow still requires an approved Chrome/Chromium distribution path.

## Hard boundary

CEF is Chromium Embedded Framework, not Chrome. It does not include Google's Chrome Web Store installer, Chrome branding, or a public consumer store-install API. A CEF host cannot honestly be described as a complete Chrome Web Store client without additional distribution components and approval.

## Corrected assessment: CEF is not an upgrade for extensions

An earlier version of this document suggested a CEF host "can improve extension
compatibility". That is wrong, and worth stating plainly because it inverts the
actual comparison.

Novaris is **already Chromium**. Electron bundles Chromium, and every page
renders in a real Chromium `<webview>`. The rendering engine is not the gap.

The gap is Chrome's *platform layer* around extensions, and Electron already
implements more of it than CEF does:

| Capability | Electron (current) | CEF |
| --- | --- | --- |
| `session.extensions.loadExtension` | Maintained host | Experimental, far more limited |
| Content scripts, background pages | Supported | Limited |
| `chrome.webRequest` | Supported | Supported |
| `chrome.storage`, `chrome.tabs` | Supported | Partial |
| Chrome Web Store install | Not available | Not available |
| Component updater | Not available | Not available |

Moving to CEF would mean giving up the working extension host in exchange for a
smaller one, then rebuilding the missing parts by hand.

## What actually blocks Chrome extension parity

1. **Store distribution is policy, not engineering.** Google exposes no public
   consumer "Add to Chrome" API to third-party browsers. Only Chromium forks with
   their own distribution channel (Brave, Vivaldi, Thorium, Edge) can install
   Chrome Web Store extensions, because they are not party to Google's agreement.
   No amount of work in this repository changes that.
2. **MV3 service workers do not run.** Electron does not execute extension
   service workers. Most current Chrome extensions are MV3 with a service worker
   background, so they install and then do nothing. This is the largest
   *technical* gap, and the reason the built-in ad blocker is a bundled extension
   rather than a store import.
3. **Chrome's component updater is not public API.**

## The only route to real parity

Fork Chromium and run your own browser, which is what Brave and Vivaldi do. That
means carrying the patch stack, a GN/Ninja build, a security-patch cadence, and
Chrome's test suite. It is a multi-year, multi-engineer program, not a migration
inside an existing application.

The productive path for Novaris is therefore to keep Electron, use the extension
host it already has well, and be explicit about MV3 rather than letting users
install something that silently does nothing.

## Local readiness probe

From the project directory:

```powershell
npm run engine:spike
```

The probe reports the available compiler/build tools and whether `CEF_ROOT` points to a usable CEF SDK. It does not download binaries or modify the project.
