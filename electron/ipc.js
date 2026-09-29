const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { clipboard, dialog, ipcMain, shell, session, webContents } = require('electron');
const { openExternalSafely } = require('./security');
const { PERSISTENT_PARTITION, pauseDownload, resumeDownload, cancelDownload, retryDownload } = require('./downloads');
const { tabThrottlingEnabled } = require('./performance');
const { storageOverview } = require('./storage');
const { updateJumpList } = require('./windows');
const { getEngineCapabilities } = require('./engine');
const { parseBookmarkHtml } = require('./bookmark-import');
const { parsePasswordCsv, MAX_CSV_BYTES } = require('./password-import');
const { detectImpersonation, evaluateFill } = require('./credential-guard');
const { describeHardening } = require('./privacy-posture');
const { describeGaming, spellcheckEnabled } = require('./gaming');
const { buildTrustCard } = require('./trust-card');
const { mediaPublisherSource, isAllowedMediaAction, clampSeek } = require('./media-controls');
const { canSave, assessCapture, buildOfflineDocument, isAcceptableSize, listOfflinePages, offlineUrlFor } = require('./offline-pages');
const { sealPayload, openPayload, tabPayload } = require('./tab-transfer');
const { TransferSender, receiveFrom, localAddresses, DEFAULT_PORT } = require('./tab-transfer-node');
const { guardIpcListener } = require('./ipc-guard');

// Pulls readable content out of a page. Only text and markup are taken, scripts
// and interactive parts are stripped, and the decision about whether the result
// is worth keeping is made by the offline module rather than here.
async function capturePage(contents) {
  return contents.executeJavaScript(`(() => {
    const pick = document.querySelector('article, main, [role="main"]') || document.body;
    const text = (pick ? pick.innerText : document.body.innerText) || '';
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('script, style, link, iframe, object, embed, form, input, button, noscript').forEach((el) => el.remove());
    return { title: document.title || '', text: text.slice(0, 200000), html: (clone.outerHTML || '').slice(0, 3000000) };
  })()`, true);
}

function buildFillScript(record) {
  const credential = JSON.stringify({
    username: record.username,
    email: record.email,
    password: record.password,
  });
  return `(() => {
    const credential = ${credential};
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && !element.disabled;
    };
    const inputs = [...document.querySelectorAll('input')].filter(visible);
    const passwordInput = inputs.find((input) => input.type === 'password');
    const identity = credential.username || credential.email;
    const identityInput = inputs.find((input) => ['email', 'text', 'username'].includes(input.type) && !['search', 'url'].includes(input.type));
    const setValue = (input, value) => {
      if (!input || !value) return;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setValue(passwordInput, credential.password);
    setValue(identityInput, identity);
    return { passwordFilled: Boolean(passwordInput), identityFilled: Boolean(identityInput) };
  })()`;
}

function registerIpcHandlers({ app, getWindow, rendererRoot = '', store, vault, extensionManager, adblockManager, siteSafetyManager, windowsIntegration, openPrivateWindow, updateManager, resetSummary, scheduleReset, relaunch }) {
  // Every channel goes through here, which is the only place that has to be
  // right. A listener is only reached by the application's own renderer: not by
  // a webview page, not by an iframe, and not by anything loaded from a URL the
  // project did not build.
  const handle = (channel, listener) => {
    ipcMain.handle(channel, guardIpcListener(listener, {
      rendererRoot,
      devServerUrl: process.env.VITE_DEV_SERVER_URL || '',
    }));
  };

  handle('bootstrap:get', () => ({
    ...store.snapshot(),
    platform: process.platform,
    version: app.getVersion(),
    downloadDirectory: store.snapshot().settings.downloadDirectory || app.getPath('downloads'),
    vault: vault?.status() || { available: false, count: 0, error: 'Vault unavailable.' },
    engine: getEngineCapabilities(),
  }));

  handle('app:make-default-browser', async () => {
    if (!['win32', 'linux'].includes(process.platform)) return { supported: false, opened: false };
    // In development the app runs unpackaged, so registering here would point the
    // desktop environment at a temporary build instead of the installed one.
    const registered = process.env.VITE_DEV_SERVER_URL
      ? { http: false, https: false }
      : {
        http: app.setAsDefaultProtocolClient('http'),
        https: app.setAsDefaultProtocolClient('https'),
      };

    if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:defaultapps');
      return { supported: true, opened: true, registered };
    }

    // On Linux the desktop environment, not the app, decides the default, so
    // registration only takes effect once the user confirms it. Each desktop has
    // its own entry point, so the first one that opens wins; if none does, the
    // registration is still recorded and the caller says so honestly rather than
    // claiming a settings window appeared.
    const candidates = [
      'gnome-control-center default-applications',
      'systemsettings defaultapplications',
      'xfce4-settings-manager default-web-browser',
      'kde-open5 kcm_browser',
    ];
    for (const command of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const launched = await new Promise((resolve) => {
        try {
          const child = spawn(command, { shell: true, detached: true, stdio: 'ignore' });
          child.once('error', () => resolve(false));
          child.unref();
          // A command that does not exist fails fast; a real one stays alive.
          setTimeout(() => resolve(true), 350);
        } catch { resolve(false); }
      });
      if (launched) return { supported: true, opened: true, registered };
    }
    return { supported: true, opened: false, registered };
  });

  handle('reader:extract', async (_event, webContentsId) => {
    const id = Number(webContentsId);
    if (!Number.isInteger(id) || id < 1) return null;
    const target = webContents.fromId(id);
    const window = getWindow();
    if (!target || target.getType() !== 'webview' || !window || target.hostWebContents !== window.webContents) return null;
    return target.executeJavaScript(`(() => ({
      title: document.title || 'Reader view',
      url: location.href,
      text: (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 120000)
    }))()`, true);
  });

  handle('engine:capabilities', () => getEngineCapabilities());

  handle('performance:set-tab', (_event, payload = {}) => {
    const id = Number(payload.id);
    const active = Boolean(payload.active);
    if (!Number.isInteger(id) || id < 1) return false;
    const contents = webContents.fromId(id);
    const window = getWindow();
    if (!contents || contents.getType() !== 'webview' || !window || contents.hostWebContents !== window.webContents) return false;
    contents.setBackgroundThrottling(tabThrottlingEnabled(store.snapshot().settings, active));
    return true;
  });

  handle('vault:status', () => vault?.status() || { available: false, count: 0, error: 'Vault unavailable.' });
  handle('vault:list', () => vault?.list() || []);
  handle('vault:save', (_event, input) => vault.save(input));
  handle('vault:update', (_event, id, input) => vault.update(id, input));
  handle('vault:remove', (_event, id) => vault.remove(id));
  handle('vault:copy-secret', (_event, id, field) => {
    const value = vault.secret(id, field);
    if (value === null || value === '') return false;
    clipboard.writeText(value);
    return true;
  });
  handle('extensions:list', () => extensionManager?.list() || []);
  handle('extensions:choose', () => extensionManager?.chooseAndInstall() || null);
  handle('extensions:open-store', (_event, value) => extensionManager?.openStoreListing(value) || null);
  handle('extensions:import-package', (_event, storeUrl) => extensionManager?.importPackage(storeUrl) || null);
  handle('extensions:toggle', (_event, id, enabled) => extensionManager?.toggle(id, Boolean(enabled)) || null);
  handle('extensions:remove', (_event, id) => extensionManager?.remove(id) || []);
  handle('extensions:open-action', (_event, id) => extensionManager?.openAction(id) || { opened: false });
  handle('extensions:restore-builtin', () => extensionManager?.restoreBuiltins() || null);
  handle('adblock:status', () => adblockManager?.status() || store.snapshot().adblock);
  handle('adblock:update', async (_event, patch) => {
    const next = adblockManager
      ? adblockManager.update(patch)
      : store.setAdblockSettings(patch);
    // Cosmetic filters live in the bundled content script, so it must be
    // rewritten and reloaded whenever the filter list or mode changes.
    await extensionManager?.refreshAdblock();
    return next;
  });
  handle('adblock:reset-stats', () => adblockManager?.resetStats() || null);
  handle('adblock:refresh', async () => {
    adblockManager?.refresh();
    await extensionManager?.refreshAdblock();
    return adblockManager?.status() || null;
  });

  // Updates. A missing feed is reported plainly rather than failing silently.
  handle('update:status', () => updateManager?.state || { status: 'unavailable', configured: false, currentVersion: app.getVersion(), progress: 0, error: '' });
  handle('update:check', () => updateManager?.check() || null);
  handle('update:download', () => updateManager?.download() || null);
  handle('update:install', () => updateManager?.installAndReset() || null);
  handle('update:summary', () => resetSummary || null);

  // Full reset. The work happens on the next launch because Chromium holds the
  // profile open while this window exists. The relaunch is deferred so the
  // renderer receives this reply before the process goes away.
  handle('profile:reset', (_event, payload = {}) => {
    scheduleReset({ reason: payload?.reason === 'update' ? 'update' : 'manual', releaseNotes: '' });
    setTimeout(relaunch, 250);
    return { scheduled: true };
  });
  handle('storage:overview', () => storageOverview({ app, store, vault }));
  handle('storage:clear-site', async (_event, origin) => {
    let normalizedOrigin;
    try {
      const parsed = new URL(String(origin));
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid origin');
      normalizedOrigin = parsed.origin;
    } catch {
      throw new Error('Invalid site origin.');
    }
    const browserSessions = new Set([session.defaultSession, session.fromPartition(PERSISTENT_PARTITION)]);
    await Promise.all([...browserSessions].map((browserSession) => browserSession.clearData({
      origins: [normalizedOrigin],
      dataTypes: ['cache', 'cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers'],
    })));
    return storageOverview({ app, store, vault });
  });

  handle('vault:import-csv', async () => {
    const window = getWindow();
    const options = {
      title: 'Import passwords from CSV',
      properties: ['openFile'],
      filters: [{ name: 'Password CSV export', extensions: ['csv'] }],
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    if (fs.statSync(filePath).size > MAX_CSV_BYTES) throw new Error('That password export is too large.');
    const records = parsePasswordCsv(fs.readFileSync(filePath));
    if (!records.length) return { imported: 0, skipped: 0, found: 0 };
    const confirmation = window
      ? await dialog.showMessageBox(window, { type: 'warning', title: 'Import passwords?', message: `Import ${records.length} password${records.length === 1 ? '' : 's'} into the Windows-encrypted vault?`, detail: 'Novaris does not read Chrome or Edge password databases directly. Use a CSV export you created and review the count before importing.', buttons: ['Cancel', 'Import passwords'], defaultId: 0, cancelId: 0 })
      : await dialog.showMessageBox({ type: 'warning', title: 'Import passwords?', message: `Import ${records.length} password${records.length === 1 ? '' : 's'} into the Windows-encrypted vault?`, detail: 'Novaris does not read Chrome or Edge password databases directly. Use a CSV export you created and review the count before importing.', buttons: ['Cancel', 'Import passwords'], defaultId: 0, cancelId: 0 });
    if (confirmation.response !== 1) return null;
    let imported = 0;
    let skipped = 0;
    for (const record of records) {
      try {
        vault.save(record);
        imported += 1;
      } catch {
        skipped += 1;
      }
    }
    return { imported, skipped, found: records.length };
  });

  handle('vault:setup-master', (_event, password) => vault.setupMaster(password));
  handle('vault:change-master', (_event, currentPassword, newPassword) => vault.changeMaster(currentPassword, newPassword));
  handle('vault:disable-master', (_event, password) => vault.disableMaster(password));
  handle('vault:set-master', (_event, password) => vault.setMaster(password));
  handle('vault:unlock', (_event, password) => vault.unlock(password));
  handle('vault:lock', () => vault.lock());
  handle('vault:export', async () => {
    const window = getWindow();
    const result = window
      ? await dialog.showSaveDialog(window, { title: 'Export encrypted Novaris vault', defaultPath: 'novaris-vault.nvx', filters: [{ name: 'Novaris encrypted vault', extensions: ['nvx'] }] })
      : await dialog.showSaveDialog({ title: 'Export encrypted Novaris vault', defaultPath: 'novaris-vault.nvx', filters: [{ name: 'Novaris encrypted vault', extensions: ['nvx'] }] });
    if (result.canceled || !result.filePath) return null;
    return vault.exportEncrypted(result.filePath);
  });
  handle('vault:import', async () => {
    const window = getWindow();
    const result = window
      ? await dialog.showOpenDialog(window, { title: 'Import encrypted Novaris vault', properties: ['openFile'], filters: [{ name: 'Novaris encrypted vault', extensions: ['nvx'] }] })
      : await dialog.showOpenDialog({ title: 'Import encrypted Novaris vault', properties: ['openFile'], filters: [{ name: 'Novaris encrypted vault', extensions: ['nvx'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const confirmation = window
      ? await dialog.showMessageBox(window, { type: 'warning', title: 'Replace encrypted vault?', message: 'Importing replaces the credentials currently stored on this device.', buttons: ['Cancel', 'Replace vault'], defaultId: 0, cancelId: 0 })
      : await dialog.showMessageBox({ type: 'warning', title: 'Replace encrypted vault?', message: 'Importing replaces the credentials currently stored on this device.', buttons: ['Cancel', 'Replace vault'], defaultId: 0, cancelId: 0 });
    if (confirmation.response !== 1) return null;
    return vault.importEncrypted(result.filePaths[0]);
  });

  handle('vault:fill', async (_event, id, webContentsId) => {
    const numericId = Number(webContentsId);
    if (!Number.isInteger(numericId) || numericId < 1) return false;
    const target = webContents.fromId(numericId);
    const window = getWindow();
    if (!target || target.getType() !== 'webview' || !window || target.hostWebContents !== window.webContents) return false;
    const record = vault.get(id, true);
    if (!record) return false;

    // Never hand a saved password to a page the guard does not trust. Without
    // this check, any page with a password field could receive the credential.
    const verdict = evaluateFill({
      pageUrl: target.getURL(),
      credentialUrl: record.url,
      classify: (value) => siteSafetyManager?.classify(value) || null,
    });
    if (!verdict.allowed) throw new Error(verdict.reason);

    await target.executeJavaScript(buildFillScript(record), true);
    return true;
  });

  // Reports a page that impersonates a well-known account provider.
  handle('credential:scan', async (_event, webContentsId) => {
    const numericId = Number(webContentsId);
    if (!Number.isInteger(numericId) || numericId < 1) return null;
    const target = webContents.fromId(numericId);
    const window = getWindow();
    if (!target || target.getType() !== 'webview' || !window || target.hostWebContents !== window.webContents) return null;
    const info = await target.executeJavaScript(`(() => ({
      title: document.title || '',
      text: (document.body?.innerText || '').slice(0, 4000),
      hasPasswordField: Boolean(document.querySelector('input[type="password"]')),
      hasPasteField: Boolean(document.querySelector('textarea'))
    }))()`, true);
    return detectImpersonation({ url: target.getURL(), ...info });
  });

  handle('settings:update', (_event, patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('Invalid settings payload.');
    }
    const next = store.updateSettings(patch);
    // Gaming Mode has to take effect on the live sessions, not at the next
    // launch, so the spellchecker state is pushed as soon as it changes.
    if (Object.prototype.hasOwnProperty.call(patch, 'gamingMode')) {
      const enabled = spellcheckEnabled(next);
      for (const browserSession of new Set([session.defaultSession, session.fromPartition(PERSISTENT_PARTITION)])) {
        try {
          browserSession.setSpellCheckerEnabled(enabled);
        } catch (error) {
          console.error('Novaris could not change the spellchecker state:', error);
        }
      }
    }
    windowsIntegration?.update();
    updateJumpList(app);
    return next;
  });

  handle('gaming:status', () => describeGaming(store.snapshot().settings));

  // --- Media bridge -------------------------------------------------------
  // The page publishes what it is playing; the shell asks for it and sends
  // commands back. Every command is checked against a fixed list, and only a
  // webview belonging to this window may be addressed.
  const mediaContents = (id) => {
    const contents = webContents.fromId(Number(id));
    if (!contents || contents.getType() !== 'webview') return null;
    if (!getWindow() || contents.hostWebContents !== getWindow().webContents) return null;
    return contents;
  };

  handle('media:install', async (_event, payload = {}) => {
    const contents = mediaContents(payload.id);
    if (!contents) return false;
    try {
      return await contents.executeJavaScript(mediaPublisherSource(), true);
    } catch (error) {
      return `error: ${error.message}`;
    }
  });

  handle('media:read', async (_event, payload = {}) => {
    const contents = mediaContents(payload.id);
    if (!contents) return null;
    try {
      return await contents.executeJavaScript('window.__novarisMedia ? window.__novarisMedia() : null', true);
    } catch {
      return null;
    }
  });

  handle('media:command', async (_event, payload = {}) => {
    const contents = mediaContents(payload.id);
    if (!contents) return false;
    if (!isAllowedMediaAction(payload.action)) return false;
    // A seek is clamped to the media's own duration before it is applied.
    let value = payload.value;
    if (payload.action === 'seek') {
      const current = await contents.executeJavaScript('window.__novarisMedia ? window.__novarisMedia() : null', true).catch(() => null);
      value = clampSeek(value, current?.duration);
      if (value === null) return false;
    }
    try {
      return await contents.executeJavaScript(
        `window.__novarisMediaCommand(${JSON.stringify(payload.action)}, ${JSON.stringify(value ?? null)})`,
        true,
      );
    } catch {
      return false;
    }
  });

  // --- Tab transfer, device to device on the local network -----------------
  // No server is involved. The sending device listens, the receiving device
  // connects to it directly, and the payload is encrypted before it moves.
  let sender = null;

  handle('transfer:serve', async (_event, payload = {}) => {
    if (sender) sender.close();
    sender = new TransferSender({
      port: DEFAULT_PORT,
      onDelivered: (outcome) => {
        if (outcome?.ok) sender = null;
      },
    });
    // The id doubles as the authenticated-data value, so a payload cannot be
    // moved onto a different code and still open.
    const sealed = await sealPayload(tabPayload(payload.tab || {}), String(payload.passphrase || ''), sender.code);
    const offered = await sender.listen(JSON.stringify(sealed));
    return offered;
  });

  handle('transfer:status', () => (sender ? sender.describe() : { listening: false, delivered: false }));

  handle('transfer:cancel', () => {
    if (!sender) return { listening: false };
    sender.close();
    sender = null;
    return { listening: false };
  });

  handle('transfer:receive', async (_event, payload = {}) => {
    const raw = await receiveFrom({ address: payload?.address, code: payload?.code, port: DEFAULT_PORT });
    let sealed;
    try {
      sealed = JSON.parse(raw);
    } catch {
      throw new Error('The sending device sent something that could not be read.');
    }
    const opened = await openPayload(sealed, String(payload?.passphrase || ''));
    return { opened: true, tab: opened };
  });

  handle('transfer:local-addresses', () => localAddresses());

  // --- Offline pages ------------------------------------------------------
  handle('offline:can-save', (_event, payload = {}) => ({ canSave: canSave(payload?.url), assessment: assessCapture(payload || {}) }));

  handle('offline:save', async (_event, payload = {}) => {
    const url = String(payload?.url || '');
    if (!canSave(url)) throw new Error('Only ordinary web pages can be saved.');
    const contents = mediaContents(payload.webContentsId);
    if (!contents) throw new Error('That tab is not available to save.');
    const captured = await capturePage(contents);
    const assessment = assessCapture({ url, text: captured.text, title: captured.title });
    if (!assessment.savable) throw new Error(assessment.reasons.join(' '));
    const document = buildOfflineDocument({ title: captured.title, url, savedAt: Date.now(), html: captured.html });
    if (!isAcceptableSize(document.length)) throw new Error('That page is too large to save.');
    return store.setOfflinePages([...(store.snapshot().offlinePages || []), { url, title: captured.title, html: document, savedAt: Date.now() }]);
  });

  handle('offline:list', () => listOfflinePages(store.snapshot().offlinePages || []));
  handle('offline:open', (_event, payload = {}) => {
    const pages = store.snapshot().offlinePages || [];
    const page = pages.find((item) => offlineUrlFor(item.url) === payload?.offlineUrl);
    if (!page) throw new Error('That saved page is no longer on this device.');
    return { offlineUrl: payload.offlineUrl };
  });
  handle('offline:remove', (_event, payload = {}) => {
    const pages = store.snapshot().offlinePages || [];
    return store.setOfflinePages(pages.filter((item) => offlineUrlFor(item.url) !== payload?.offlineUrl));
  });

  // A private window is opened by the main process so the renderer never gets
  // to choose its own partition, which is the guarantee the whole mode rests on.
  handle('window:open-private', (_event, payload = {}) => {
    if (typeof openPrivateWindow !== 'function') throw new Error('Private windows are unavailable.');
    const url = typeof payload?.url === 'string' ? payload.url : 'about:blank';
    const window = openPrivateWindow(url);
    return { id: window.id, opened: true };
  });

  handle('window:private-status', () => ({ supported: typeof openPrivateWindow === 'function' }));

  handle('trust:card', (_event, payload = {}) => {
    const snapshot = store.snapshot();
    return buildTrustCard({
      url: payload?.url,
      isInternal: Boolean(payload?.isInternal),
      extensions: snapshot.extensions,
      sitePermissions: snapshot.sitePermissions,
      adblock: adblockManager?.status() || {},
    });
  });

  handle('settings:choose-download-directory', async () => {
    const window = getWindow();
    const result = window
      ? await dialog.showOpenDialog(window, {
          title: 'Choose download location',
          defaultPath: store.snapshot().settings.downloadDirectory || app.getPath('downloads'),
          properties: ['openDirectory', 'createDirectory'],
        })
      : await dialog.showOpenDialog({
          title: 'Choose download location',
          defaultPath: app.getPath('downloads'),
          properties: ['openDirectory', 'createDirectory'],
        });

    if (result.canceled || !result.filePaths[0]) return null;
    return store.updateSettings({ downloadDirectory: result.filePaths[0] });
  });

  handle('bookmarks:import-html', async () => {
    const window = getWindow();
    const options = {
      title: 'Import bookmarks',
      properties: ['openFile'],
      filters: [{ name: 'Exported bookmarks HTML', extensions: ['html', 'htm'] }],
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    if (fs.statSync(filePath).size > 10 * 1024 * 1024) throw new Error('That bookmark file is too large.');
    const records = parseBookmarkHtml(fs.readFileSync(filePath));
    const imported = store.addImportedBookmarks(records);
    return { ...imported, found: records.length };
  });

  handle('bookmarks:toggle', (_event, input) => {
    const result = store.toggleBookmark(input);
    updateJumpList(app);
    return result;
  });
  handle('bookmarks:remove', (_event, id) => store.removeBookmark(id));
  handle('history:record', (_event, input) => {
    const result = store.recordVisit(input);
    updateJumpList(app);
    return result;
  });
  handle('history:clear', () => store.clearHistory());
  handle('reading-list:toggle', (_event, input) => store.toggleReadingList(input));
  handle('downloads:clear', () => store.clearDownloads());
  handle('downloads:pause', (_event, id) => pauseDownload(store, id));
  handle('downloads:resume', (_event, id) => resumeDownload(store, id));
  handle('downloads:cancel', (_event, id) => cancelDownload(store, id));
  handle('downloads:retry', (_event, id) => retryDownload(store, id));
  handle('tabs:add-closed', (_event, input) => store.addClosedTab(input));
  handle('tabs:consume-closed', () => store.consumeClosedTab());
  handle('session:save', (_event, input) => store.saveSession(input));
  handle('site-permissions:set', (_event, origin, permission, value) => store.setSitePermission(origin, permission, value));
  handle('site-permissions:reset', (_event, origin) => store.resetSitePermission(origin));
  handle('tab-groups:set', (_event, list) => store.setTabGroups(list));

  handle('workspaces:set', (_event, list) => store.setWorkspaces(list));

  handle('downloads:open', async (_event, id) => {
    const record = store.snapshot().downloads.find((item) => item.id === id);
    if (!record?.savePath || !fs.existsSync(record.savePath)) return false;
    const error = await shell.openPath(record.savePath);
    return !error;
  });

  handle('downloads:show', (_event, id) => {
    const record = store.snapshot().downloads.find((item) => item.id === id);
    if (!record?.savePath || !fs.existsSync(record.savePath)) return false;
    shell.showItemInFolder(record.savePath);
    return true;
  });

  handle('downloads:open-folder', async () => {
    const configured = store.snapshot().settings.downloadDirectory;
    const directory = configured && fs.existsSync(configured) ? configured : app.getPath('downloads');
    await shell.openPath(directory);
    return true;
  });

  handle('site-safety:allow', (_event, url) => siteSafetyManager?.allow(url) || false);
  handle('site-safety:classify', (_event, url) => siteSafetyManager?.classify(url) || null);
  handle('app:open-external', (_event, url) => openExternalSafely(url));
  handle('window:minimize', () => getWindow()?.minimize());
  handle('window:toggle-maximize', () => {
    const window = getWindow();
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  handle('window:toggle-fullscreen', () => {
    const window = getWindow();
    if (window) window.setFullScreen(!window.isFullScreen());
  });
  handle('window:close', () => getWindow()?.close());

  handle('privacy:posture', () => describeHardening());

  handle('privacy:clear-browsing-data', async (_event, options = {}) => {
    const clearCache = Boolean(options.cache);
    const clearCookies = Boolean(options.cookies);
    const clearHistory = Boolean(options.history);
    const clearDownloads = Boolean(options.downloads);

    const dataTypes = [];
    if (clearCache) dataTypes.push('cache');
    if (clearCookies) dataTypes.push('cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers');
    if (clearDownloads) dataTypes.push('downloads');

    const browserSessions = new Set([
      session.defaultSession,
      session.fromPartition(PERSISTENT_PARTITION),
    ]);
    await Promise.all(
      [...browserSessions].map((browserSession) => {
        if (!dataTypes.length) return Promise.resolve();
        if (typeof browserSession.clearData === 'function') {
          return browserSession.clearData({ dataTypes });
        }
        return browserSession.clearBrowsingData({ all: true });
      }),
    );

    if (clearHistory) store.clearHistory();
    if (clearDownloads) store.clearDownloads();

    return {
      history: store.snapshot().history,
      downloads: store.snapshot().downloads,
    };
  });
}

module.exports = { registerIpcHandlers };
