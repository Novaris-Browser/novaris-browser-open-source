const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_SETTINGS = Object.freeze({
  theme: 'system',
  transparency: 0.78,
  accent: '#7c8cff',
  newTabBackground: 'aurora',
  searchEngine: 'duckduckgo',
  homepage: 'https://www.startpage.com',
  startupBehavior: 'newtab',
  askBeforeDownload: true,
  developerTools: false,
  hardwareAcceleration: true,
  downloadDirectory: '',
  onboardingCompleted: false,
  // Used for the greeting on the new tab page. Never leaves the device and is
  // not part of any account, because there is no account.
  displayName: '',
  defaultBrowserPrompted: false,
  defaultBrowserRequested: false,
  performanceMode: 'balanced',
  gamingMode: false,
  backgroundThrottling: true,
  // Audio from a tab you have switched away from keeps playing. Mute it if you
  // would rather every background page stayed silent.
  backgroundAudio: true,
  suspendBackgroundTabs: false,
  reducedMotion: false,
  clearOnExit: false,
  clearCookiesOnExit: true,
  clearCacheOnExit: true,
  clearHistoryOnExit: true,
  restoreSession: true,
  customSearchEngines: [],
  globalHotkeyEnabled: false,
  globalHotkey: 'Control+Shift+Space',
  readerFontSize: 18,
  readerLineHeight: 1.7,
});

const ALLOWED_THEMES = new Set(['system', 'light', 'dark']);
const ALLOWED_BACKGROUNDS = new Set(['aurora', 'midnight', 'sunrise', 'forest']);
const ALLOWED_SEARCH_ENGINES = new Set(['duckduckgo', 'google', 'bing', 'brave', 'startpage', 'ecosia']);
const ALLOWED_PERFORMANCE_MODES = new Set(['balanced', 'speed', 'memory']);
const ALLOWED_STARTUP_BEHAVIORS = new Set(['newtab', 'homepage']);
const ALLOWED_PERMISSION_VALUES = new Set(['allow', 'block']);
const PERMISSION_KEYS = ['camera', 'microphone', 'notifications', 'geolocation', 'clipboardRead', 'downloads'];
const INTERNAL_SESSION_URLS = new Set([
  'novaris://newtab',
  'novaris://bookmarks',
  'novaris://history',
  'novaris://downloads',
  'novaris://reading-list',
  'novaris://passwords',
  'novaris://extensions',
  'novaris://settings',
  'novaris://about',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeText(value, maxLength = 300) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function safeId(value) {
  const text = safeText(value, 100);
  return text || randomUUID();
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeSettings(current, patch = {}) {
  const next = { ...DEFAULT_SETTINGS, ...current };

  if (Object.prototype.hasOwnProperty.call(patch, 'theme')) {
    const theme = String(patch.theme);
    if (ALLOWED_THEMES.has(theme)) next.theme = theme;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'transparency')) {
    const value = Number(patch.transparency);
    if (Number.isFinite(value)) next.transparency = Math.min(0.92, Math.max(0.45, value));
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'accent')) {
    const accent = String(patch.accent).toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(accent)) next.accent = accent;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'newTabBackground')) {
    const background = String(patch.newTabBackground);
    if (ALLOWED_BACKGROUNDS.has(background)) next.newTabBackground = background;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'searchEngine')) {
    const engine = String(patch.searchEngine);
    const customIds = normalizeSearchEngines(
      Object.prototype.hasOwnProperty.call(patch, 'customSearchEngines') ? patch.customSearchEngines : next.customSearchEngines,
    ).map((item) => item.id);
    if (ALLOWED_SEARCH_ENGINES.has(engine) || customIds.includes(engine)) next.searchEngine = engine;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'homepage')) {
    const homepage = safeText(patch.homepage, 2048);
    if (isHttpUrl(homepage)) next.homepage = new URL(homepage).toString();
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'startupBehavior')) {
    const behavior = String(patch.startupBehavior);
    if (ALLOWED_STARTUP_BEHAVIORS.has(behavior)) next.startupBehavior = behavior;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'askBeforeDownload')) {
    next.askBeforeDownload = Boolean(patch.askBeforeDownload);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'developerTools')) {
    next.developerTools = Boolean(patch.developerTools);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'backgroundAudio')) {
    next.backgroundAudio = Boolean(patch.backgroundAudio);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'displayName')) {
    // Kept to a plain short name. It is rendered into the new tab page as text,
    // and React escapes it, but a name is not a place for markup or a length
    // that could push the clock off the page.
    next.displayName = String(patch.displayName || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'hardwareAcceleration')) {
    next.hardwareAcceleration = Boolean(patch.hardwareAcceleration);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'downloadDirectory')) {
    const directory = safeText(patch.downloadDirectory, 2048);
    next.downloadDirectory = path.isAbsolute(directory) ? directory : '';
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'customSearchEngines')) {
    next.customSearchEngines = normalizeSearchEngines(patch.customSearchEngines);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'globalHotkey')) {
    const hotkey = safeText(patch.globalHotkey, 80)
      .replace(/\s+/g, '')
      .replace(/\bCtrl\b/gi, 'Control')
      .replace(/\bCmd\b/gi, 'CommandOrControl')
      .replace(/\bWin\b/gi, 'Super');
    if (/^(Control|Shift|Alt|Super|CommandOrControl)(\+(Control|Shift|Alt|Super|CommandOrControl))*\+[A-Z0-9]$/i.test(hotkey)) next.globalHotkey = hotkey;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'readerFontSize')) {
    const size = Number(patch.readerFontSize);
    if (Number.isFinite(size)) next.readerFontSize = Math.min(28, Math.max(14, size));
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'readerLineHeight')) {
    const lineHeight = Number(patch.readerLineHeight);
    if (Number.isFinite(lineHeight)) next.readerLineHeight = Math.min(2.2, Math.max(1.3, lineHeight));
  }

  for (const key of [
    'onboardingCompleted',
    'displayName',
    'defaultBrowserPrompted',
    'defaultBrowserRequested',
    'backgroundThrottling',
    'backgroundAudio',
    'suspendBackgroundTabs',
    'gamingMode',
    'reducedMotion',
    'clearOnExit',
    'clearCookiesOnExit',
    'clearCacheOnExit',
    'clearHistoryOnExit',
    'restoreSession',
    'globalHotkeyEnabled',
  ]) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = Boolean(patch[key]);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'performanceMode')) {
    const mode = String(patch.performanceMode);
    if (ALLOWED_PERFORMANCE_MODES.has(mode)) next.performanceMode = mode;
  }

  if (!ALLOWED_SEARCH_ENGINES.has(next.searchEngine) && !next.customSearchEngines.some((item) => item.id === next.searchEngine && item.enabled !== false)) {
    next.searchEngine = 'duckduckgo';
  }

  return next;
}

function isSearchTemplate(value) {
  if (typeof value !== 'string' || !value.includes('{query}')) return false;
  try {
    const parsed = new URL(value.replaceAll('{query}', 'query'));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeSearchEngines(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: safeId(item.id),
      name: safeText(item.name, 80),
      url: safeText(item.url, 500),
      keyword: safeText(item.keyword, 30).toLowerCase(),
      enabled: item.enabled !== false,
    }))
    .filter((item) => item.name && isSearchTemplate(item.url))
    .slice(0, 30);
}

function normalizeSitePermissions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [origin, permissions] of Object.entries(value)) {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || !permissions || typeof permissions !== 'object') continue;
      const normalized = {};
      for (const key of PERMISSION_KEYS) {
        if (ALLOWED_PERMISSION_VALUES.has(permissions[key])) normalized[key] = permissions[key];
      }
      if (Object.keys(normalized).length) result[parsed.origin] = normalized;
    } catch {
      // Ignore malformed origins from older data.
    }
  }
  return result;
}

function normalizeExtensions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: safeId(item.id),
      name: safeText(item.name, 120),
      version: safeText(item.version, 40),
      description: safeText(item.description, 300),
      path: safeText(item.path, 2048),
      permissions: Array.isArray(item.permissions) ? item.permissions.filter((value) => typeof value === 'string').slice(0, 100) : [],
      hostPermissions: Array.isArray(item.hostPermissions) ? item.hostPermissions.filter((value) => typeof value === 'string').slice(0, 100) : [],
      action: item.action && typeof item.action === 'object' ? { defaultTitle: safeText(item.action.defaultTitle, 120), defaultPopup: safeText(item.action.defaultPopup, 300) } : { defaultTitle: '', defaultPopup: '' },
      optionsPage: safeText(item.optionsPage, 300),
      manifestVersion: Number.isFinite(item.manifestVersion) ? item.manifestVersion : 0,
      loadError: safeText(item.loadError, 400),
      compatibility: item.compatibility && typeof item.compatibility === 'object'
        ? {
          level: ['ok', 'limited', 'unsupported'].includes(item.compatibility.level) ? item.compatibility.level : 'ok',
          manifestVersion: Number.isFinite(item.compatibility.manifestVersion) ? item.compatibility.manifestVersion : 0,
          background: safeText(item.compatibility.background, 40),
          functional: item.compatibility.functional !== false,
          reasons: Array.isArray(item.compatibility.reasons)
            ? item.compatibility.reasons.slice(0, 10).map((reason) => ({
              level: ['ok', 'limited', 'unsupported'].includes(reason?.level) ? reason.level : 'limited',
              title: safeText(reason?.title, 160),
              detail: safeText(reason?.detail, 600),
              fix: safeText(reason?.fix, 300),
            }))
            : [],
        }
        : null,
      source: ['unpacked', 'chrome-web-store-import', 'builtin'].includes(item.source) ? item.source : 'unpacked',
      builtinId: safeText(item.builtinId, 40),
      storeUrl: safeText(item.storeUrl, 500),
      packageFormat: safeText(item.packageFormat, 20),
      signatureVerified: item.signatureVerified === true,
      enabled: item.enabled !== false,
      installedAt: Number.isFinite(item.installedAt) ? item.installedAt : Date.now(),
    }))
    .filter((item) => item.id && item.name && item.path)
    .slice(0, 50);
}

// Workspaces are the top level container. A workspace holds tab groups, groups
// hold tabs, and a tab may also sit directly in a workspace with no group.
function normalizeWorkspaces(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: safeId(item.id),
      name: safeText(item.name, 60),
      color: /^#[0-9a-f]{6}$/i.test(String(item.color)) ? String(item.color) : '#7c8cff',
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : 0,
    }))
    .filter((item) => item.id)
    .slice(0, 20);
}

// A saved page is a copy of a website held on disk, so the stored shape is
// deliberately narrow: an address, a title, a timestamp, and the document itself.
// Anything that would let a saved copy point somewhere new is dropped, because a
// saved page is a snapshot and must not become a live one.
function normalizeOfflinePages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object' && isHttpUrl(item.url) && typeof item.html === 'string' && item.html)
    .map((item) => ({
      url: String(item.url).slice(0, 2048),
      title: safeText(item.title, 240),
      html: String(item.html).slice(0, 4 * 1024 * 1024),
      savedAt: Number.isFinite(item.savedAt) ? item.savedAt : 0,
    }))
    .slice(0, 100);
}

function normalizeTabGroups(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: safeId(item.id),
      name: safeText(item.name, 80),
      color: /^#[0-9a-f]{6}$/i.test(String(item.color)) ? String(item.color) : '#7c8cff',
      // A group with no workspace is treated as ungrouped, which is a valid
      // state rather than a broken one, so this is allowed to be empty.
      workspaceId: safeText(item.workspaceId, 100),
      collapsed: item.collapsed === true,
    }))
    .filter((item) => item.name)
    .slice(0, 30);
}

function normalizeSession(value) {
  if (!value || typeof value !== 'object') return { tabs: [], activeTabId: '', activeWorkspaceId: '', savedAt: 0 };
  const tabs = Array.isArray(value.tabs)
    ? value.tabs
        .filter((item) => item && typeof item === 'object' && (isHttpUrl(item.url) || INTERNAL_SESSION_URLS.has(String(item.url))))
        .map((item) => ({
          id: safeId(item.id),
          url: String(item.url),
          title: safeText(item.title, 240),
          favicon: safeText(item.favicon, 1000),
          pinned: Boolean(item.pinned),
          groupId: safeText(item.groupId, 100),
          workspaceId: safeText(item.workspaceId, 100),
          muted: item.muted === true,
          zoom: Math.min(2, Math.max(0.5, Number(item.zoom) || 1)),
        }))
        .slice(0, 50)
    : [];
  return {
    tabs,
    activeTabId: safeText(value.activeTabId, 100),
    activeWorkspaceId: safeText(value.activeWorkspaceId, 100),
    savedAt: Number.isFinite(value.savedAt) ? value.savedAt : 0,
  };
}

function normalizeAdblock(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    enabled: source.enabled !== false,
    trackingProtection: source.trackingProtection !== false,
    strictMode: source.strictMode === true,
    filters: Array.isArray(source.filters)
      ? source.filters.filter((item) => typeof item === 'string').map((item) => item.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).filter(Boolean).slice(0, 2000)
      : [],
    updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : 0,
  };
}

function normalizeBuiltinExtensions(value) {
  const source = value && typeof value === 'object' ? value : {};
  const adblock = source.adblock && typeof source.adblock === 'object' ? source.adblock : {};
  return {
    adblock: {
      removed: adblock.removed === true,
      installedAt: Number.isFinite(adblock.installedAt) ? adblock.installedAt : 0,
    },
  };
}

function normalizeData(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};

  return {
    settings: sanitizeSettings(DEFAULT_SETTINGS, source.settings || {}),
    bookmarks: Array.isArray(source.bookmarks)
      ? source.bookmarks
          .filter((item) => item && isHttpUrl(item.url))
          .map((item) => ({
            id: safeId(item.id),
            title: safeText(item.title, 240) || new URL(item.url).hostname,
            url: new URL(item.url).toString(),
            createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
          }))
          .slice(0, 500)
      : [],
    history: Array.isArray(source.history)
      ? source.history
          .filter((item) => item && isHttpUrl(item.url))
          .map((item) => ({
            id: safeId(item.id),
            title: safeText(item.title, 240) || new URL(item.url).hostname,
            url: new URL(item.url).toString(),
            visitedAt: Number.isFinite(item.visitedAt) ? item.visitedAt : Date.now(),
          }))
          .sort((a, b) => b.visitedAt - a.visitedAt)
          .slice(0, 1000)
      : [],
    readingList: Array.isArray(source.readingList)
      ? source.readingList
          .filter((item) => item && isHttpUrl(item.url))
          .map((item) => ({
            id: safeId(item.id),
            title: safeText(item.title, 240) || new URL(item.url).hostname,
            url: new URL(item.url).toString(),
            createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
          }))
          .slice(0, 500)
      : [],
    downloads: Array.isArray(source.downloads)
      ? source.downloads
          .filter((item) => item && typeof item.id === 'string')
          .map((item) => ({
            id: safeId(item.id),
            url: safeText(item.url, 2048),
            filename: safeText(item.filename, 240),
            savePath: safeText(item.savePath, 2048),
            mimeType: safeText(item.mimeType, 160),
            state: (() => {
              const state = safeText(item.state, 40) || 'progressing';
              return state === 'progressing' || state === 'paused' ? 'interrupted' : state;
            })(),
            receivedBytes: Math.max(0, Number(item.receivedBytes) || 0),
            totalBytes: Math.max(0, Number(item.totalBytes) || 0),
            createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
            updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
          }))
          .slice(0, 200)
      : [],
    closedTabs: Array.isArray(source.closedTabs)
      ? source.closedTabs
          .filter((item) => item && isHttpUrl(item.url))
          .map((item) => ({
            id: safeId(item.id),
            title: safeText(item.title, 240),
            url: new URL(item.url).toString(),
            closedAt: Number.isFinite(item.closedAt) ? item.closedAt : Date.now(),
          }))
          .slice(0, 30)
      : [],
    sitePermissions: normalizeSitePermissions(source.sitePermissions),
    extensions: normalizeExtensions(source.extensions),
    tabGroups: normalizeTabGroups(source.tabGroups),
    workspaces: normalizeWorkspaces(source.workspaces),
    offlinePages: normalizeOfflinePages(source.offlinePages),
    adblock: normalizeAdblock(source.adblock),
    builtinExtensions: normalizeBuiltinExtensions(source.builtinExtensions),
    session: normalizeSession(source.session),
  };
}

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = normalizeData({});
  }

  initSync() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this._write(this.data);
      return;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.data = normalizeData(parsed);
    } catch {
      const backupPath = `${this.filePath}.bak`;
      let recovered = false;
      if (fs.existsSync(backupPath)) {
        try {
          this.data = normalizeData(JSON.parse(fs.readFileSync(backupPath, 'utf8')));
          recovered = true;
        } catch {
          recovered = false;
        }
      }
      if (!recovered) {
        const corruptPath = `${this.filePath}.corrupt-${Date.now()}`;
        try { fs.renameSync(this.filePath, corruptPath); } catch { /* Start with a clean store. */ }
        this.data = normalizeData({});
      }
      this._write(this.data);
    }
  }

  snapshot() {
    return clone(this.data);
  }

  // Ad blocker request filtering runs on every network request, so it needs a
  // cheap read that does not deep-clone the whole profile.
  readAdblockSettings() {
    return { ...this.data.adblock, filters: this.data.adblock.filters.slice() };
  }

  updateSettings(patch) {
    this.data.settings = sanitizeSettings(this.data.settings, patch);
    this._write(this.data);
    return clone(this.data.settings);
  }

  saveSession(input = {}) {
    this.data.session = normalizeSession(input);
    this._write(this.data);
    return clone(this.data.session);
  }

  setSitePermission(origin, permission, value) {
    let normalizedOrigin;
    try {
      const parsed = new URL(String(origin));
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid origin');
      normalizedOrigin = parsed.origin;
    } catch {
      throw new Error('Invalid site origin.');
    }
    if (!PERMISSION_KEYS.includes(permission) || !ALLOWED_PERMISSION_VALUES.has(value)) {
      throw new Error('Invalid site permission.');
    }
    this.data.sitePermissions[normalizedOrigin] = {
      ...(this.data.sitePermissions[normalizedOrigin] || {}),
      [permission]: value,
    };
    this._write(this.data);
    return clone(this.data.sitePermissions);
  }

  resetSitePermission(origin) {
    try {
      const parsed = new URL(String(origin));
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol');
      delete this.data.sitePermissions[parsed.origin];
      this._write(this.data);
    } catch {
      throw new Error('Invalid site origin.');
    }
    return clone(this.data.sitePermissions);
  }

  setAdblockSettings(patch = {}) {
    this.data.adblock = normalizeAdblock({ ...this.data.adblock, ...patch, updatedAt: Date.now() });
    this._write(this.data);
    return clone(this.data.adblock);
  }

  setBuiltinExtensionState(id, state = {}) {
    if (id !== 'adblock') throw new Error('Unknown built-in extension.');
    this.data.builtinExtensions.adblock = normalizeBuiltinExtensions({ adblock: { ...this.data.builtinExtensions.adblock, ...state } }).adblock;
    this._write(this.data);
    return clone(this.data.builtinExtensions);
  }

  setExtensions(list) {
    this.data.extensions = normalizeExtensions(list);
    this._write(this.data);
    return clone(this.data.extensions);
  }

  setTabGroups(list) {
    this.data.tabGroups = normalizeTabGroups(list);
    this._write(this.data);
    return clone(this.data.tabGroups);
  }

  setWorkspaces(list) {
    this.data.workspaces = normalizeWorkspaces(list);
    this._write(this.data);
    return clone(this.data.workspaces);
  }

  setOfflinePages(list) {
    this.data.offlinePages = normalizeOfflinePages(list);
    this._write(this.data);
    return clone(this.data.offlinePages);
  }

  toggleBookmark(input = {}) {
    const url = safeText(input.url, 2048);
    const title = safeText(input.title, 240);
    if (!isHttpUrl(url)) return clone(this.data.bookmarks);

    const normalizedUrl = new URL(url).toString();
    const existing = this.data.bookmarks.find((item) => item.url === normalizedUrl);
    if (existing) {
      this.data.bookmarks = this.data.bookmarks.filter((item) => item.id !== existing.id);
    } else {
      this.data.bookmarks.unshift({
        id: randomUUID(),
        title: title || new URL(normalizedUrl).hostname,
        url: normalizedUrl,
        createdAt: Date.now(),
      });
      this.data.bookmarks = this.data.bookmarks.slice(0, 500);
    }

    this._write(this.data);
    return clone(this.data.bookmarks);
  }

  addImportedBookmarks(records = []) {
    const existing = new Set(this.data.bookmarks.map((item) => item.url));
    const additions = [];
    for (const item of Array.isArray(records) ? records : []) {
      const url = safeText(item?.url, 2048);
      if (!isHttpUrl(url) || existing.has(new URL(url).toString())) continue;
      const normalizedUrl = new URL(url).toString();
      existing.add(normalizedUrl);
      additions.push({
        id: randomUUID(),
        title: safeText(item?.title, 240) || new URL(normalizedUrl).hostname,
        url: normalizedUrl,
        createdAt: Date.now(),
      });
      if (this.data.bookmarks.length + additions.length >= 500) break;
    }
    if (additions.length) {
      this.data.bookmarks = [...additions, ...this.data.bookmarks].slice(0, 500);
      this._write(this.data);
    }
    return { added: additions.length, bookmarks: clone(this.data.bookmarks) };
  }

  removeBookmark(id) {
    const bookmarkId = safeText(id, 100);
    this.data.bookmarks = this.data.bookmarks.filter((item) => item.id !== bookmarkId);
    this._write(this.data);
    return clone(this.data.bookmarks);
  }

  recordVisit(input = {}) {
    const url = safeText(input.url, 2048);
    const title = safeText(input.title, 240);
    if (!isHttpUrl(url)) return clone(this.data.history);

    const normalizedUrl = new URL(url).toString();
    const visitedAt = Date.now();
    const previous = this.data.history.find((item) => item.url === normalizedUrl);
    if (previous && visitedAt - previous.visitedAt < 1200) return clone(this.data.history);

    this.data.history = [
      {
        id: randomUUID(),
        title: title || new URL(normalizedUrl).hostname,
        url: normalizedUrl,
        visitedAt,
      },
      ...this.data.history.filter((item) => item.url !== normalizedUrl),
    ].slice(0, 1000);

    this._write(this.data);
    return clone(this.data.history);
  }

  clearHistory() {
    this.data.history = [];
    this._write(this.data);
    return clone(this.data.history);
  }

  toggleReadingList(input = {}) {
    const url = safeText(input.url, 2048);
    const title = safeText(input.title, 240);
    if (!isHttpUrl(url)) return clone(this.data.readingList);

    const normalizedUrl = new URL(url).toString();
    const existing = this.data.readingList.find((item) => item.url === normalizedUrl);
    if (existing) {
      this.data.readingList = this.data.readingList.filter((item) => item.id !== existing.id);
    } else {
      this.data.readingList.unshift({
        id: randomUUID(),
        title: title || new URL(normalizedUrl).hostname,
        url: normalizedUrl,
        createdAt: Date.now(),
      });
      this.data.readingList = this.data.readingList.slice(0, 500);
    }

    this._write(this.data);
    return clone(this.data.readingList);
  }

  addDownload(input = {}) {
    const record = {
      id: randomUUID(),
      url: safeText(input.url, 2048),
      filename: safeText(input.filename, 240),
      savePath: safeText(input.savePath, 2048),
      mimeType: safeText(input.mimeType, 160),
      state: 'progressing',
      receivedBytes: Math.max(0, Number(input.receivedBytes) || 0),
      totalBytes: Math.max(0, Number(input.totalBytes) || 0),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.data.downloads.unshift(record);
    this.data.downloads = this.data.downloads.slice(0, 200);
    this._write(this.data);
    return clone(record);
  }

  updateDownload(id, patch = {}) {
    const downloadId = safeText(id, 100);
    const index = this.data.downloads.findIndex((item) => item.id === downloadId);
    if (index === -1) return null;

    const current = this.data.downloads[index];
    const next = { ...current };
    if (Object.prototype.hasOwnProperty.call(patch, 'state')) next.state = safeText(patch.state, 40);
    if (Object.prototype.hasOwnProperty.call(patch, 'receivedBytes')) {
      next.receivedBytes = Math.max(0, Number(patch.receivedBytes) || 0);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'totalBytes')) {
      next.totalBytes = Math.max(0, Number(patch.totalBytes) || 0);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'savePath')) next.savePath = safeText(patch.savePath, 2048);
    next.updatedAt = Date.now();

    this.data.downloads[index] = next;
    this._write(this.data);
    return clone(next);
  }

  clearDownloads() {
    this.data.downloads = [];
    this._write(this.data);
    return clone(this.data.downloads);
  }

  addClosedTab(input = {}) {
    const url = safeText(input.url, 2048);
    if (!isHttpUrl(url)) return clone(this.data.closedTabs);

    this.data.closedTabs.unshift({
      id: randomUUID(),
      title: safeText(input.title, 240),
      url: new URL(url).toString(),
      closedAt: Date.now(),
    });
    this.data.closedTabs = this.data.closedTabs.slice(0, 30);
    this._write(this.data);
    return clone(this.data.closedTabs);
  }

  consumeClosedTab() {
    const [next, ...rest] = this.data.closedTabs;
    this.data.closedTabs = rest;
    this._write(this.data);
    return next ? clone(next) : null;
  }

  _write(data) {
    const temporaryPath = `${this.filePath}.tmp`;
    const backupPath = `${this.filePath}.bak`;
    if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, backupPath);
    fs.writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.rmSync(this.filePath, { force: true });
    fs.renameSync(temporaryPath, this.filePath);
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  JsonStore,
  isHttpUrl,
};
