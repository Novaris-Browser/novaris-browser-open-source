const path = require('node:path');
const { app, BrowserWindow, Menu, dialog, session } = require('electron');
const { JsonStore } = require('./store');
const { installSecurityHandlers, classifyPermission, isSecureOrigin } = require('./security');
const { buildCsp, cspHeaders } = require('./csp');
const { installDownloadManager, PERSISTENT_PARTITION } = require('./downloads');
const { registerIpcHandlers } = require('./ipc');
const { installExitPrivacy } = require('./privacy');
const { backgroundThrottlingEnabled } = require('./performance');
const { isPermissionForcedDenied, spellcheckEnabled } = require('./gaming');
const { Vault } = require('./vault');
const { createEngineAdapter } = require('./engine');
const { AdBlockManager } = require('./adblock');
const { SiteSafetyManager } = require('./site-safety');
const { ExtensionManager } = require('./extensions');
const { updateJumpList, installGlobalHotkey } = require('./windows');
const { openPrivateWindow, discardPrivateSession } = require('./private-window');
const { applyPendingReset, writePendingReset } = require('./profile-reset');
const { UpdateManager } = require('./updater');

app.setName('Novaris Browser');

// Windows and Linux are the two platforms with a packaged build. Anything else
// gets a clear refusal rather than a crash from a missing platform integration.
const SUPPORTED_PLATFORMS = ['win32', 'linux'];

let mainWindow = null;
let store = null;
let vault = null;
let extensionManager = null;
let adblockManager = null;
let siteSafetyManager = null;
let windowsIntegration = null;
let updateManager = null;
let lastResetSummary = null;
let appRoot = '';
let pendingProtocolUrl = '';
let rendererReady = false;

function getWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function isNovarisProtocolUrl(value) {
  return typeof value === 'string' && /^novaris:\/\//i.test(value);
}

// Private windows are tracked so their in-memory storage can be released the
// moment they close, rather than lingering until the process exits.
const privateWindows = new Set();

function createPrivateWindow(initialUrl = 'about:blank') {
  const preloadPath = path.join(__dirname, 'preload.js');
  const { window, partition } = openPrivateWindow({
    siteSafety: siteSafetyManager,
    getPreloadPath: () => preloadPath,
    isDeveloperToolsEnabled: () => Boolean(store?.snapshot().settings.developerTools),
    initialUrl,
    parent: getWindow(),
  });
  privateWindows.add(window);
  window.once('closed', () => {
    privateWindows.delete(window);
    // The partition is random per window, so releasing it by name is enough to
    // drop everything the page stored.
    void discardPrivateSession(partition);
  });
  return window;
}

function dispatchProtocolUrl(value) {
  if (!isNovarisProtocolUrl(value)) return;
  const window = getWindow();
  if (window && rendererReady) window.webContents.send('protocol:url', value);
  else pendingProtocolUrl = value;
}

function sendPendingProtocolUrl() {
  if (!pendingProtocolUrl) return;
  const value = pendingProtocolUrl;
  pendingProtocolUrl = '';
  dispatchProtocolUrl(value);
}

function sendWindowState() {
  const window = getWindow();
  if (!window) return;
  window.webContents.send('window:state', {
    maximized: window.isMaximized(),
    fullScreen: window.isFullScreen(),
    platform: process.platform,
  });
}

function createWindow() {
  const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
  const preloadPath = path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: '#090c16',
    autoHideMenuBar: true,
    title: 'Novaris Browser',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true,
      // Gaming Mode turns the spellchecker off, because it otherwise runs
      // against every open page.
      spellcheck: spellcheckEnabled(store.snapshot().settings),
      backgroundThrottling: backgroundThrottlingEnabled(store.snapshot().settings),
      devTools: isDevelopment || store.snapshot().settings.developerTools,
    },
  });

  mainWindow.once('ready-to-show', () => {
    rendererReady = true;
    sendPendingProtocolUrl();
    mainWindow.show();
    if (isDevelopment) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('maximize', sendWindowState);
  mainWindow.on('unmaximize', sendWindowState);
  mainWindow.on('enter-full-screen', sendWindowState);
  mainWindow.on('leave-full-screen', sendWindowState);
  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
  });

  if (isDevelopment) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

function permissionKey(permission) {
  return {
    camera: 'camera',
    microphone: 'microphone',
    notifications: 'notifications',
    geolocation: 'geolocation',
    'geolocation-approximate': 'geolocation',
    'clipboard-read': 'clipboardRead',
    downloads: 'downloads',
  }[permission] || null;
}

function permissionOrigin(webContents, requestingOrigin, details) {
  const candidates = [requestingOrigin, details?.securityOrigin, webContents?.getURL?.()];
  for (const candidate of candidates) {
    try {
      const parsed = new URL(String(candidate || ''));
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin;
    } catch {
      // Try the next origin source.
    }
  }
  return '';
}

function permissionAllowed(store, webContents, permission, requestingOrigin, details) {
  if (permission === 'fullscreen' || permission === 'automatic-fullscreen') return true;
  // Gaming Mode refuses these outright, before any site permission is consulted,
  // so a page cannot prompt for them mid-game.
  if (isPermissionForcedDenied(permission, store.snapshot().settings)) return false;
  // A permission Novaris never grants is refused regardless of what the user
  // allowed for that site. A site permission is not a wildcard.
  if (classifyPermission(permission) === 'denied') return false;
  const origin = permissionOrigin(webContents, requestingOrigin, details);
  if (!origin) return false;
  // Nothing worth granting is handed to a page served over plain http, where the
  // connection and the page itself can both be altered by whoever is on the path.
  if (!isSecureOrigin(origin)) return false;
  const policy = store.snapshot().sitePermissions[origin] || {};
  if (permission === 'media') {
    const mediaTypes = details?.mediaTypes || (details?.mediaType ? [details.mediaType] : ['video']);
    return mediaTypes.every((type) => {
      const key = type === 'audio' ? 'microphone' : 'camera';
      return policy[key] === 'allow';
    });
  }
  const key = permissionKey(permission);
  // An unrecognised permission has no key, so this is false. A permission
  // Chromium adds in a future version is therefore refused by default rather
  // than being handed out because nobody wrote it down.
  return Boolean(key && policy[key] === 'allow');
}

/**
 * Applies the deny-by-default permission policy to a session.
 *
 * Called for every session the application creates, not just the two obvious
 * ones. A private window uses a random partition, so before this listened for
 * session-created those windows had no handler at all and fell back to the
 * platform default, which is to allow.
 */
function installPermissionPolicy(store, browserSession) {
  if (!browserSession || browserSession.__novarisPermissionPolicy) return;
  browserSession.__novarisPermissionPolicy = true;
  browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(permissionAllowed(store, webContents, permission, '', details));
  });
  browserSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => (
    permissionAllowed(store, webContents, permission, requestingOrigin, details)
  ));
  // Hardware access is never granted. A browser has no feature that needs it, and
  // it is the first thing anything malicious asks for.
  if (typeof browserSession.setDevicePermissionHandler === 'function') {
    browserSession.setDevicePermissionHandler(() => false);
  }
}

function denySensitivePermissions(store) {
  const install = (browserSession) => installPermissionPolicy(store, browserSession);
  install(session.defaultSession);
  install(session.fromPartition(PERSISTENT_PARTITION));
  // Everything created later, which is every private window and any extension
  // session. Without this a private window gets no policy at all.
  app.on('session-created', (_event, created) => install(created));
}

/**
 * Puts the policy on every response the interface itself makes.
 *
 * The built application carries the policy in a meta tag, which is weaker: it
 * only applies once the document has begun to load. The development server is a
 * real HTTP origin, so the policy is also sent as a header there, which is
 * applied before anything is parsed.
 *
 * Only the interface's own session is touched. A webview page runs under that
 * page's own policy, which is the correct arrangement: a site is entitled to
 * load its own resources, and intercepting that would break most of the web.
 */
function installContentSecurityPolicy() {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || '';
  const policy = buildCsp({ development: Boolean(devServerUrl), devServerUrl });
  const headers = cspHeaders(policy);
  const target = session.fromPartition(PERSISTENT_PARTITION);
  if (typeof target.webRequest?.onHeadersReceived === 'function') {
    target.webRequest.onHeadersReceived((details, callback) => {
      const isOurInterface = details.url.startsWith('http://127.0.0.1:5173')
        || details.url.startsWith('http://localhost:5173')
        || details.url.startsWith('file://');
      if (!isOurInterface) { callback({}); return; }
      callback({ responseHeaders: { ...(details.responseHeaders || {}), ...headers } });
    });
  }
  return policy;
}

function startWindowsApplication() {  return app.whenReady().then(async () => {
    app.setAppUserModelId('com.novaris.browser');
    appRoot = path.resolve(app.getAppPath());
    vault = new Vault(path.join(app.getPath('userData'), 'novaris-vault.bin'));
    vault.init();
    const engine = createEngineAdapter({ browserSession: session.fromPartition(PERSISTENT_PARTITION) });
    adblockManager = new AdBlockManager({ store, browserSession: engine.browserSession });
    adblockManager.install();
    siteSafetyManager = new SiteSafetyManager();
    extensionManager = new ExtensionManager({ app, store, engine, browserSession: engine.browserSession, adblock: adblockManager });
    try {
      await extensionManager.init();
    } catch (error) {
      console.error('Novaris could not initialize extensions:', error);
    }
    if (!process.env.VITE_DEV_SERVER_URL) {
      try { app.setAsDefaultProtocolClient('novaris'); } catch (error) { console.warn('Novaris protocol registration failed:', error.message); }
    }
    updateJumpList(app);
    windowsIntegration = installGlobalHotkey({ app, getWindow, getSettings: () => store.snapshot().settings });
    Menu.setApplicationMenu(null);
    denySensitivePermissions(store);
    installContentSecurityPolicy();
    installSecurityHandlers({
      getWindow,
      appRoot,
      isDeveloperToolsEnabled: () => store.snapshot().settings.developerTools,
      getSettings: () => store.snapshot().settings,
      siteSafety: siteSafetyManager,
    });
    installDownloadManager({ app, store });
    installExitPrivacy({ app, getStore: () => store });
    updateManager = new UpdateManager({
      getWindow,
      getUserDataPath: () => app.getPath('userData'),
      onStateChange: (state) => getWindow()?.webContents.send('update:state', state),
    });
    registerIpcHandlers({
      app,
      getWindow,
      appRoot,
      store,
      vault,
      extensionManager,
      adblockManager,
      siteSafetyManager,
      windowsIntegration,
      openPrivateWindow: createPrivateWindow,
      updateManager,
      resetSummary: lastResetSummary,
      scheduleReset: (payload) => writePendingReset(app.getPath('userData'), payload),
      relaunch: () => {
        app.relaunch();
        app.exit(0);
      },
    });
    const initialProtocolUrl = process.argv.find((value) => isNovarisProtocolUrl(value));
    if (initialProtocolUrl) pendingProtocolUrl = initialProtocolUrl;
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const protocolUrl = commandLine.find((value) => isNovarisProtocolUrl(value));
    if (protocolUrl) dispatchProtocolUrl(protocolUrl);
    const window = getWindow();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    dispatchProtocolUrl(url);
  });

  if (SUPPORTED_PLATFORMS.includes(process.platform)) {
    void startWindowsApplication();
  } else {
    app.whenReady().then(() => {
      dialog.showErrorBox(
        'Novaris Browser is not available here',
        `Novaris Browser supports Windows 10/11 and Linux. This build is running on ${process.platform}, which is not supported.`,
      );
      app.quit();
    });
  }
}

app.on('window-all-closed', () => {
  app.quit();
});

// A scheduled full reset runs before the store or any Chromium session is
// touched, so the new launch is a genuine first run.
try {
  lastResetSummary = applyPendingReset(app.getPath('userData'));
} catch (error) {
  console.error('Novaris could not apply the scheduled profile reset:', error);
}

try {
  store = new JsonStore(path.join(app.getPath('userData'), 'novaris-data.json'));
  store.initSync();
  if (!store.snapshot().settings.hardwareAcceleration) {
    app.disableHardwareAcceleration();
  }
} catch (error) {
  console.error('Novaris could not initialize its data store:', error);
  store = new JsonStore(path.join(app.getPath('userData'), 'novaris-data.json'));
}
