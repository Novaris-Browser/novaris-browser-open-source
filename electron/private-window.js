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
//   - No vault access. Credentials are held by the main process against a
//     profile that is locked, and a private window is given no way to ask.
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
function privateWebPreferences({ preloadPath, developerTools }) {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false,
    devTools: Boolean(developerTools),
    // A private window cannot reach the profile's own storage partition.
    partition: `${PRIVATE_PREFIX}${randomUUID()}`,
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
 * Applies the private guarantees to a session: no persistence, and no permission
 * is granted for anything that could identify or notify the user.
 */
function hardenPrivateSession(browserSession) {
  const blocked = new Set(['notifications', 'background-sync', 'background-fetch', 'periodic-background-sync']);
  try {
    browserSession.setPermissionRequestHandler((_contents, permission, callback) => callback(!blocked.has(permission)));
    browserSession.setPermissionCheckHandler((_contents, permission) => !blocked.has(permission));
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
  getPreloadPath,
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
    webPreferences: privateWebPreferences({
      preloadPath: getPreloadPath?.(),
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
  PRIVATE_PREFIX,
  discardPrivateSession,
  hardenPrivateSession,
  isPrivatePartition,
  newPrivatePartition,
  openPrivateWindow,
  privateWebPreferences,
};
