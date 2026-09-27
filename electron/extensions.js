const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, dialog, shell } = require('electron');
const { PERSISTENT_PARTITION } = require('./downloads');
const { buildAdblockFiles } = require('./builtin-extension');
const { classifyExtension } = require('./extension-compat');
const {
  chromeStoreUrl,
  createInstallDirectory,
  prepareExtensionPackage,
  readManifest,
} = require('./extension-package');

class ExtensionManager {
  constructor({ app, store, engine, browserSession, adblock }) {
    this.app = app;
    this.store = store;
    this.adblock = adblock || null;
    this.engine = engine || null;
    this.browserSession = browserSession || engine?.browserSession;
    this.loaded = new Map();
    this.extensionRoot = path.join(app.getPath('userData'), 'extensions');
    this.stagingRoot = path.join(app.getPath('userData'), 'extension-staging');
    this.importing = false;
  }

  async init() {
    await this.ensureBuiltins();
    for (const extension of this.store.snapshot().extensions) {
      if (extension.enabled) await this.load(extension, false);
    }
  }

  // The content script embeds the cosmetic filter list, so it is regenerated
  // from the current ad blocker settings every time it is written.
  writeBuiltinFiles(directory) {
    const files = buildAdblockFiles(this.adblock?.cosmeticRules() || { block: [], allow: [] });
    fs.mkdirSync(directory, { recursive: true });
    let changed = false;
    for (const [name, content] of Object.entries(files)) {
      const filePath = path.join(directory, name);
      if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== content) {
        fs.writeFileSync(filePath, content, { mode: 0o600 });
        changed = true;
      }
    }
    return changed;
  }

  async refreshAdblock() {
    const record = this.store.snapshot().extensions.find((item) => item.builtinId === 'adblock');
    if (!record || !record.enabled) return null;
    const changed = this.writeBuiltinFiles(record.path);
    if (!changed) return record;
    // Chromium caches an unpacked extension in memory, so it must be reloaded
    // for new cosmetic filters to take effect.
    try { this.extensionApi.removeExtension(record.id); } catch { /* Already unloaded. */ }
    this.loaded.delete(record.id);
    return this.load(record, false);
  }

  async ensureBuiltins(force = false) {
    const state = this.store.snapshot().builtinExtensions.adblock;
    const existing = this.store.snapshot().extensions.find((item) => item.builtinId === 'adblock');
    if (existing) {
      this.writeBuiltinFiles(existing.path);
      return existing;
    }
    if (state.removed && !force) return null;
    const directory = path.join(this.extensionRoot, 'novaris-adblock');
    this.writeBuiltinFiles(directory);
    const record = await this.install(directory, { source: 'builtin', builtinId: 'adblock', signatureVerified: true, packageFormat: 'builtin' });
    this.store.setBuiltinExtensionState('adblock', { removed: false, installedAt: Date.now() });
    return record;
  }

  async restoreBuiltins() {
    this.store.setBuiltinExtensionState('adblock', { removed: false });
    const existing = this.store.snapshot().extensions.find((item) => item.builtinId === 'adblock');
    if (existing) return this.toggle(existing.id, true);
    return this.ensureBuiltins(true);
  }

  get extensionApi() {
    return this.engine?.extensionApi || this.browserSession?.extensions || this.browserSession;
  }

  async load(record, persist = true) {
    let directory = '';
    let manifest = null;
    try {
      directory = fs.realpathSync(record.path);
      manifest = readManifest(directory);
    } catch (error) {
      if (persist) throw error;
      return null;
    }

    // A Manifest V3 service worker is the failure that matters most: Electron
    // accepts the extension and then never runs its background logic, so the
    // record is still created with an explanation attached.
    const compatibility = classifyExtension({ manifest });
    let loaded = null;
    let loadError = '';
    try {
      loaded = await this.extensionApi.loadExtension(directory);
    } catch (error) {
      loadError = String(error?.message || error);
      if (persist) throw error;
    }
    if (loaded) this.loaded.set(loaded.id, loaded);

    const finalCompat = loadError
      ? classifyExtension({ manifest, loadError })
      : compatibility;

    const next = {
      ...record,
      id: loaded?.id || record.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description || '',
      permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
      hostPermissions: Array.isArray(manifest.hostPermissions) ? manifest.hostPermissions : [],
      action: manifest.action || { defaultTitle: manifest.name, defaultPopup: '' },
      optionsPage: manifest.optionsPage || '',
      manifestVersion: Number(manifest.manifest_version) || 0,
      compatibility: finalCompat,
      path: directory,
      enabled: true,
      loadError,
    };
    if (loaded && (persist || next.id !== record.id)) {
      this.store.setExtensions([...this.store.snapshot().extensions.filter((item) => item.id !== record.id), next]);
    }
    return next;
  }

  async chooseAndInstall() {
    const options = {
      title: 'Choose an unpacked Novaris extension',
      properties: ['openDirectory'],
    };
    const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    return this.install(result.filePaths[0], { source: 'unpacked', signatureVerified: false, packageFormat: 'directory' });
  }

  async openStoreListing(value) {
    const url = chromeStoreUrl(value);
    if (!url) throw new Error('Enter a valid Chrome Web Store URL or 32-character extension ID.');
    await shell.openExternal(url);
    return url;
  }

  async confirmImport(prepared, window) {
    const manifest = prepared.manifest;
    const permissions = [...(manifest.permissions || []), ...(manifest.hostPermissions || []).map((value) => `host: ${value}`)];
    // The compatibility verdict is shown before the install, so nobody ends up
    // with an extension that silently does nothing.
    const compatibility = classifyExtension({ manifest });
    const detail = [
      `Name: ${manifest.name}`,
      `Version: ${manifest.version}`,
      `Manifest: V${manifest.manifestVersion}`,
      `Package: ${prepared.format.toUpperCase()}`,
      '',
      'Requested permissions:',
      ...(permissions.length ? permissions.slice(0, 40).map((value) => `• ${value}`) : ['• None declared']),
      ...(permissions.length > 40 ? ['• …'] : []),
      '',
      ...(compatibility.level === 'ok' ? [] : [
        `Compatibility in Novaris: ${compatibility.level === 'unsupported' ? 'WILL NOT WORK' : 'LIMITED'}`,
        ...compatibility.reasons.map((reason) => `• ${reason.detail}`),
        ...compatibility.reasons.filter((reason) => reason.fix).map((reason) => `  ${reason.fix}`),
        '',
      ]),
      'Novaris cannot verify a Chrome Web Store signature for imported packages.',
      'Only continue if you obtained this package from the official listing and trust it.',
    ].join('\n');
    const options = {
      type: 'warning',
      title: 'Review extension permissions',
      message: compatibility.level === 'unsupported'
        ? `Install ${manifest.name}? It will not work.`
        : `Install ${manifest.name}?`,
      detail,
      buttons: ['Cancel', 'Install extension'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const result = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
    return result.response === 1;
  }

  async importPackage(storeUrl = '') {
    if (this.importing) throw new Error('Another extension import is already in progress.');
    this.importing = true;
    let prepared = null;
    let permanentDirectory = '';
    try {
      const options = {
        title: 'Import Chrome Web Store extension package',
        properties: ['openFile'],
        filters: [{ name: 'Chrome extension package', extensions: ['crx', 'zip'] }],
      };
      const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return null;

      prepared = await prepareExtensionPackage(result.filePaths[0], this.stagingRoot);
      const confirmed = await this.confirmImport(prepared, window);
      if (!confirmed) return null;

      permanentDirectory = createInstallDirectory(this.extensionRoot, prepared.manifest);
      fs.renameSync(prepared.directory, permanentDirectory);
      const canonicalStoreUrl = chromeStoreUrl(storeUrl) || '';
      return await this.install(permanentDirectory, {
        source: 'chrome-web-store-import',
        storeUrl: canonicalStoreUrl,
        packageFormat: prepared.format,
        signatureVerified: false,
      });
    } catch (error) {
      if (permanentDirectory && !this.store.snapshot().extensions.some((item) => path.resolve(item.path) === path.resolve(permanentDirectory))) {
        fs.rmSync(permanentDirectory, { recursive: true, force: true });
      }
      throw error;
    } finally {
      if (prepared?.staging) fs.rmSync(prepared.staging, { recursive: true, force: true });
      this.importing = false;
    }
  }

  async install(directory, metadata = {}) {
    const resolved = fs.realpathSync(directory);
    const manifest = readManifest(resolved);
    const existing = this.store.snapshot().extensions.find((item) => path.resolve(item.path) === resolved);
    const record = {
      ...metadata,
      id: existing?.id || metadata.id || `extension-${Date.now()}`,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description || '',
      permissions: manifest.permissions || [],
      hostPermissions: manifest.hostPermissions || [],
      action: manifest.action || { defaultTitle: manifest.name, defaultPopup: '' },
      optionsPage: manifest.optionsPage || '',
      source: metadata.source || existing?.source || 'unpacked',
      storeUrl: metadata.storeUrl || existing?.storeUrl || '',
      packageFormat: metadata.packageFormat || existing?.packageFormat || '',
      signatureVerified: metadata.signatureVerified === true,
      path: resolved,
      enabled: true,
      installedAt: existing?.installedAt || Date.now(),
    };
    if (existing) {
      try { this.extensionApi.removeExtension(existing.id); } catch { /* It may not be loaded. */ }
      this.loaded.delete(existing.id);
    }
    return this.load(record, true);
  }

  remove(id) {
    const record = this.store.snapshot().extensions.find((item) => item.id === id);
    if (record?.builtinId === 'adblock') {
      this.adblock?.update({ enabled: false });
      this.store.setBuiltinExtensionState('adblock', { removed: true });
    }
    try { this.extensionApi.removeExtension(id); } catch { /* Already unloaded. */ }
    this.loaded.delete(id);
    const next = this.store.setExtensions(this.store.snapshot().extensions.filter((item) => item.id !== id));
    if (record?.path) {
      const relative = path.relative(path.resolve(this.extensionRoot), path.resolve(record.path));
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        fs.rmSync(record.path, { recursive: true, force: true });
      }
    }
    return next;
  }

  async toggle(id, enabled) {
    const record = this.store.snapshot().extensions.find((item) => item.id === id);
    if (!record) return null;
    if (record.builtinId === 'adblock') this.adblock?.update({ enabled: Boolean(enabled) });
    if (enabled) return this.load({ ...record, enabled: true }, true);
    try { this.extensionApi.removeExtension(id); } catch { /* Already unloaded. */ }
    this.loaded.delete(id);
    const next = this.store.snapshot().extensions.map((item) => item.id === id ? { ...item, enabled: false } : item);
    return this.store.setExtensions(next).find((item) => item.id === id) || null;
  }

  async openAction(id) {
    const record = this.store.snapshot().extensions.find((item) => item.id === id);
    const loaded = this.loaded.get(id);
    if (!record || !loaded) throw new Error('That extension is not loaded.');
    const popup = String(record.action?.defaultPopup || '').trim();
    if (!popup) return { opened: false, optionsPage: record.optionsPage || '' };
    const base = String(loaded.url || '').endsWith('/') ? loaded.url : `${loaded.url}/`;
    const popupUrl = new URL(popup.replace(/^\/+/, ''), base);
    if (popupUrl.protocol !== 'chrome-extension:') throw new Error('The extension action popup URL is invalid.');
    const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
    const popupWindow = new BrowserWindow({
      width: 390,
      height: 540,
      parent: parent || undefined,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        partition: PERSISTENT_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    popupWindow.webContents.__novarisExtensionPopup = true;
    popupWindow.once('ready-to-show', () => popupWindow.show());
    popupWindow.on('closed', () => { if (!popupWindow.isDestroyed()) popupWindow.destroy(); });
    await popupWindow.loadURL(popupUrl.toString());
    return { opened: true, url: popupUrl.toString() };
  }

  list() {
    return this.store.snapshot().extensions.map((item) => ({ ...item, loaded: this.loaded.has(item.id) }));
  }
}

module.exports = {
  ExtensionManager,
  PERSISTENT_PARTITION,
};
