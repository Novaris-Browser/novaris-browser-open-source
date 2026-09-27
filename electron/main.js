const path = require('node:path');
const { app, BrowserWindow, Menu, dialog, session } = require('electron');
const { JsonStore } = require('./store');
const { installSecurityHandlers } = require('./security');
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
  const origin = permissionOrigin(webContents, requestingOrigin, details);
  if (!origin) return false;
  const policy = store.snapshot().sitePermissions[origin] || {};
  if (permission === 'media') {
    const mediaTypes = details?.mediaTypes || (details?.mediaType ? [details.mediaType] : ['video']);
    return mediaTypes.every((type) => {
      const key = type === 'audio' ? 'microphone' : 'camera';
      return policy[key] === 'allow';
    });
  }
  const key = permissionKey(permission);
  return Boolean(key && policy[key] === 'allow');
}

function denySensitivePermissions(store) {
  const browserSessions = new Set([
    session.defaultSession,
    session.fromPartition(PERSISTENT_PARTITION),
  ]);
  for (const browserSession of browserSessions) {
    browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      callback(permissionAllowed(store, webContents, permission, '', details));
    });
    browserSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => permissionAllowed(store, webContents, permission, requestingOrigin, details));
  }
}

function startWindowsApplication() {
  return app.whenReady().then(async () => {
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

  if (process.platform !== 'win32') {
    app.whenReady().then(() => {
      dialog.showErrorBox('Novaris Browser is Windows-only', 'Novaris Browser currently supports Windows 10/11 only.');
      app.quit();
    });
  } else {
    void startWindowsApplication();
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
