const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { BrowserWindow, Menu, app, clipboard, shell } = require('electron');
const { backgroundThrottlingEnabled } = require('./performance');
const { webviewPreferencesFor } = require('./gaming');

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSafeFileUrl(value, rootPath) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'file:') return false;
    const filePath = path.resolve(fileURLToPath(parsed));
    const relative = path.relative(path.resolve(rootPath), filePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

function isAllowedRendererNavigation(value, rootPath) {
  return isHttpUrl(value) || isSafeFileUrl(value, rootPath);
}

function isAllowedGuestNavigation(value) {
  if (value === 'about:blank') return true;
  return isHttpUrl(value);
}

function ownerWindow(contents) {
  const direct = BrowserWindow.fromWebContents(contents);
  if (direct) return direct;
  if (typeof contents.getOwnerBrowserWindow === 'function') {
    const owner = contents.getOwnerBrowserWindow();
    if (owner) return owner;
  }
  const host = contents.hostWebContents;
  const hostWindow = host ? BrowserWindow.fromWebContents(host) : null;
  if (hostWindow) return hostWindow;
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
}

function reportBlockedSite(contents, url, threat) {
  ownerWindow(contents)?.webContents.send('site:blocked', { url: String(url), ...threat });
}

function shortcutFor(input) {
  const rawKey = String(input.key || input.code || '').toLowerCase();
  const key = rawKey.startsWith('key') && rawKey.length === 4 ? rawKey.slice(3) : rawKey;
  const command = Boolean(input.meta || input.control);
  const shift = Boolean(input.shift);

  if (input.alt && !command && (key === 'arrowleft' || input.code === 'ArrowLeft')) return 'back';
  if (input.alt && !command && (key === 'arrowright' || input.code === 'ArrowRight')) return 'forward';
  if (input.alt || !command) return null;

  if (key === 'l' && !shift) return 'focus-address';
  if (key === 't' && shift) return 'reopen-tab';
  if (key === 't') return 'new-tab';
  if (key === 'w') return 'close-tab';
  if (key === 'r') return 'reload';
  if (key === 'f') return 'find';
  if (key === 'd' && !shift) return 'bookmark';
  if ((key === '=' || key === '+' || key === 'add') && !shift) return 'zoom-in';
  if ((key === '-' || key === 'subtract') && !shift) return 'zoom-out';
  if (key === '0') return 'zoom-reset';
  if (key === 'i' && shift) return 'developer-tools';
  if (key === 'j' && shift) return 'developer-tools';
  if (key === 'k' && shift) return 'command-palette';
  if (key === 'delete' && shift) return 'clear-data';
  return null;
}

async function openExternalSafely(value) {
  if (!isHttpUrl(value)) return false;
  await shell.openExternal(value);
  return true;
}

function installSecurityHandlers({
  getWindow,
  appRoot,
  isDeveloperToolsEnabled = () => false,
  getSettings = () => ({}),
  siteSafety = null,
}) {
  app.on('web-contents-created', (_event, contents) => {
    const type = contents.getType();
    const isGuest = type === 'webview';
    const mainWindow = getWindow();

    // will-navigate covers link clicks and in-page navigation, but it is never
    // emitted for webContents.loadURL, so the renderer also checks before
    // navigating. Both paths are kept so neither route can be bypassed.
    contents.on('will-navigate', (event, url) => {
      const threat = isGuest ? siteSafety?.classify(url) : null;
      if (threat) {
        event.preventDefault();
        reportBlockedSite(contents, url, threat);
        return;
      }
      const allowed = isGuest
        ? isAllowedGuestNavigation(url)
        : (contents.__novarisExtensionPopup && String(url).startsWith('chrome-extension://')) || isAllowedRendererNavigation(url, appRoot);
      if (!allowed) event.preventDefault();
    });

    if (typeof contents.setWindowOpenHandler === 'function') {
      contents.setWindowOpenHandler(({ url }) => {
        void openExternalSafely(url);
        return { action: 'deny' };
      });
    }

    contents.on('context-menu', (event, params) => {
      if (!isGuest) return;
      const window = ownerWindow(contents);
      if (!window) return;
      const link = isHttpUrl(params.linkURL) ? params.linkURL : '';
      const template = [
        { label: 'Back', enabled: contents.canGoBack(), click: () => contents.goBack() },
        { label: 'Forward', enabled: contents.canGoForward(), click: () => contents.goForward() },
        { type: 'separator' },
        { label: 'Reload', click: () => contents.reload() },
        { label: 'Open link in Novaris', enabled: Boolean(link), click: () => (contents.hostWebContents || window.webContents).send('browser:open-link', link) },
        { label: 'Copy page address', enabled: isHttpUrl(contents.getURL()), click: () => clipboard.writeText(contents.getURL()) },
        { label: 'Copy link address', enabled: Boolean(link), click: () => clipboard.writeText(link) },
      ];
      if (isDeveloperToolsEnabled()) template.push({ type: 'separator' }, { label: 'Inspect page', click: () => contents.openDevTools({ mode: 'detach' }) });
      Menu.buildFromTemplate(template).popup({ window });
      event.preventDefault?.();
    });

    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' && input.type !== 'rawKeyDown') return;
      const action = shortcutFor(input);
      if (!action) return;
      event.preventDefault();
      const window = isGuest ? ownerWindow(contents) : mainWindow;
      window?.webContents.send('shortcut', action);
    });

    contents.on('will-attach-webview', (_event, preferences, params) => {
      preferences.nodeIntegration = false;
      preferences.contextIsolation = true;
      preferences.sandbox = true;
      preferences.webSecurity = true;
      preferences.allowRunningInsecureContent = false;
      preferences.devTools = Boolean(isDeveloperToolsEnabled());
      // Gaming Mode forces throttling on so a tab opened during a game starts
      // suspended instead of at full speed.
      Object.assign(preferences, webviewPreferencesFor(getSettings()));
      preferences.backgroundThrottling = backgroundThrottlingEnabled(getSettings());
      if (params?.src && siteSafety?.classify(params.src)) {
        const requestedUrl = String(params.src);
        const threat = siteSafety.classify(requestedUrl);
        params.src = 'about:blank';
        reportBlockedSite(contents, requestedUrl, threat);
      } else if (params?.src && !isAllowedGuestNavigation(params.src)) {
        params.src = 'about:blank';
      }
    });
  });
}

module.exports = {
  installSecurityHandlers,
  isAllowedGuestNavigation,
  isHttpUrl,
  openExternalSafely,
  shortcutFor,
};
