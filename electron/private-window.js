// Private windows.
//
// A private window is a separate BrowserWindow on a session partition that is
// never written to disk, so nothing about the session survives closing it. The
// guarantees that matter, and how each one is actually achieved:
//
//   - No history. The session is non-persistent, so nothing is written, and the
//     window additionally never reports its navigations to the main process.
//   - No cookies or site storage. They live in the in-memory partition and are
//     destroyed with it.
//   - No vault access, and no way to ask for any. The window has no preload at
//     all, so the privileged API is not merely refused, it is absent.
//   - No extensions, no ad block list sharing, and no restore-on-exit.
//   - Blocked and unsafe sites are still blocked. Privacy is not a loophole
//     around the scam and malware blocklist.
//
// The partition name is randomised per window rather than reused, which is what
// stops two private windows from seeing each other's data.

const { randomUUID } = require('node:crypto');
const { BrowserWindow, session: electronSession } = require('electron');
const { PERSISTENT_PARTITION } = require('./downloads');

const PRIVATE_PREFIX = 'private-';

// Capability overrides applied to a private window's preferences. These are
// tightened rather than merely defaulted, because a private window is the one
// place where a leak is most likely to go unnoticed.
//
// There is deliberately NO preload key, and that is the important part.
//
// A private window is untrusted content and nothing else: it loads the requested
// website directly and contains no Novaris interface of any kind. It used to
// attach the full privileged preload, so every site opened in a private window
// was handed the entire contextBridge surface, including the vault, the
// filesystem operations, the extension manager and the updater. The IPC guard
// refused those calls, but handing an arbitrary site a privileged API and relying
// on every call failing is not a boundary, it is a hope.
//
// Nothing in a private window needs a bridge. It is a page, and the page needs
// nothing from us. tests/security-boundaries.test.js asserts the key is absent.
//
// The partition is passed in rather than generated here, and that is load
// bearing. It used to be generated inside this function while openPrivateWindow
// separately generated one for the session it hardened, so the two were always
// different names. The window therefore ran on a session nothing had been
// applied to, and a private window could be handed geolocation and notifications
// by the platform default. The name is now the one the caller hardened.
function privateWebPreferences({ partition, developerTools } = {}) {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false,
    devTools: Boolean(developerTools),
    // A private window cannot reach the profile's own storage partition. The
    // fallback keeps a bare call safe, but openPrivateWindow always supplies the
    // partition it is about to harden.
    partition: partition || newPrivatePartition(),
  };
}

/** A fresh, never-persisted partition name. */
function newPrivatePartition() {
  return `${PRIVATE_PREFIX}${randomUUID()}`;
}

function isPrivatePartition(partition) {
  // The identifier after the prefix is required, so a bare prefix is never
  // treated as disposable storage.
  return typeof partition === 'string'
    && partition.startsWith(PRIVATE_PREFIX)
    && partition.length > PRIVATE_PREFIX.length;
}

/**
 * The only permissions a private window grants, and it grants them by allowlist
 * rather than by denylist.
 *
 * This was previously `!blocked.has(permission)`: everything allowed except a
 * short list, so camera, microphone, geolocation, MIDI, clipboard and every
 * permission Chromium adds later were all granted silently. A denylist is only
 * as good as the list, and Chromium grows one.
 *
 * Fullscreen is allowed because refusing it breaks ordinary video in a way the
 * user would experience as a broken browser. Nothing else is granted: a private
 * window is untrusted content with no interface to prompt from, so a prompt could
 * not be answered honestly, and the safe answer to a permission nobody can be
 * asked about is no. Camera and microphone in a private window are therefore
 * refused rather than granted, which is a deliberate trade and is documented in
 * SECURITY.md.
 */
const PRIVATE_ALLOWED_PERMISSIONS = new Set(['fullscreen', 'automatic-fullscreen']);

function privatePermissionAllowed(permission) {
  return PRIVATE_ALLOWED_PERMISSIONS.has(String(permission || '').trim());
}

/**
 * Applies the private guarantees to a session: no persistence, and no permission
 * beyond the allowlist above.
 */
function hardenPrivateSession(browserSession) {
  try {
    browserSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(privatePermissionAllowed(permission));
    });
    browserSession.setPermissionCheckHandler((_contents, permission) => privatePermissionAllowed(permission));
    // Hardware access is never granted in a private window.
    if (typeof browserSession.setDevicePermissionHandler === 'function') {
      browserSession.setDevicePermissionHandler(() => false);
    }
  } catch {
    // A session that refuses to register handlers is still non-persistent, which
    // is the guarantee that matters most, so this is not fatal.
  }
  return browserSession;
}

/**
 * Opens a private window. Returns the window so the caller can track it.
 *
 * The window is deliberately simple: a tab strip and a page area. Private mode
 * is a promise about storage, not a second full browser, and pretending
 * otherwise is how private modes end up leaking.
 */
function openPrivateWindow({
  siteSafety = null,
  isDeveloperToolsEnabled,
  initialUrl = 'about:blank',
  parent = null,
} = {}) {
  const partition = newPrivatePartition();
  const browserSession = electronSession.fromPartition(partition);

  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    title: 'Novaris Private Window',
    backgroundColor: '#090c16',
    autoHideMenuBar: true,
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    // No preload. See privateWebPreferences for why.
    webPreferences: privateWebPreferences({
      // The same partition as the session hardened below. Generating a second
      // name here once left the window on a session no policy had been applied
      // to, and the platform default is to allow.
      partition,
      developerTools: isDeveloperToolsEnabled?.(),
    }),
  });

  // Deliberately not calling installSecurityHandlers again: it registers a
  // global app-level listener, and the one installed at startup already covers
  // every webContents including this window. A second registration would double
  // up every navigation check.

  hardenPrivateSession(browserSession);

  // The page is still sandboxed and still cannot reach the profile's partition,
  // so nothing it does can land in stored history.
  void loadPrivateUrl(window, initialUrl, siteSafety);

  // The partition is returned alongside the window because the caller needs the
  // name in order to release the storage when the window closes.
  return { window, partition };
}

async function loadPrivateUrl(window, url, siteSafety) {
  try {
    // The scam and malware blocklist still applies. Privacy is not a way around it.
    if (siteSafety?.classify?.(url)) {
      await window.loadURL('about:blank');
      return;
    }
    await window.loadURL(url);
  } catch {
    // A failed navigation leaves the window on about:blank, which is correct.
  }
}

/**
 * Forgets a private window. Electron drops the partition when the last window
 * using it closes, but clearing storage explicitly means the data is released
 * immediately rather than lingering until the process exits.
 */
async function discardPrivateSession(partition) {
  if (!isPrivatePartition(partition)) return false;
  try {
    await electronSession.fromPartition(partition).clearStorageData({ storages: ['cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage'] });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  PERSISTENT_PARTITION,
  PRIVATE_ALLOWED_PERMISSIONS,
  PRIVATE_PREFIX,
  discardPrivateSession,
  hardenPrivateSession,
  isPrivatePartition,
  newPrivatePartition,
  openPrivateWindow,
  privatePermissionAllowed,
  privateWebPreferences,
};
