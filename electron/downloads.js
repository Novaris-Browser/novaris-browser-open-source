const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, dialog, session } = require('electron');

const PERSISTENT_PARTITION = 'persist:novaris';

function safeFilename(value) {
  const fallback = `novaris-download-${Date.now()}`;
  const cleaned = String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();
  return (cleaned || fallback).slice(0, 180);
}

function uniquePath(directory, filename) {
  const parsed = path.parse(filename);
  let candidate = path.join(directory, filename);
  let index = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${parsed.name} (${index})${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function getOwnerWindow(webContents) {
  if (webContents && typeof webContents.getOwnerBrowserWindow === 'function') {
    const owner = webContents.getOwnerBrowserWindow();
    if (owner) return owner;
  }
  if (webContents?.hostWebContents) {
    const hostWindow = BrowserWindow.fromWebContents(webContents.hostWebContents);
    if (hostWindow) return hostWindow;
  }
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
}

const activeDownloads = new Map();

function notifyDownloads(store) {
  const downloads = store.snapshot().downloads;
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send('downloads:changed', downloads);
    const active = downloads.find((item) => activeDownloads.has(item.id) && item.state === 'progressing');
    if (active) {
      const fraction = active.totalBytes > 0 ? Math.min(0.99, active.receivedBytes / active.totalBytes) : 0.01;
      window.setProgressBar(fraction);
    } else {
      window.setProgressBar(-1);
    }
  }
}

function getDownloadItem(id) {
  return activeDownloads.get(id) || null;
}

function pauseDownload(store, id) {
  const item = getDownloadItem(id);
  if (!item || typeof item.pause !== 'function') return false;
  item.pause();
  store.updateDownload(id, { state: 'paused' });
  notifyDownloads(store);
  return true;
}

function resumeDownload(store, id) {
  const item = getDownloadItem(id);
  if (!item || typeof item.resume !== 'function') return false;
  item.resume();
  store.updateDownload(id, { state: 'progressing' });
  notifyDownloads(store);
  return true;
}

function cancelDownload(store, id) {
  const item = getDownloadItem(id);
  if (!item || typeof item.cancel !== 'function') return false;
  item.cancel();
  store.updateDownload(id, { state: 'cancelled' });
  activeDownloads.delete(id);
  notifyDownloads(store);
  return true;
}

function retryDownload(store, id) {
  const record = store.snapshot().downloads.find((item) => item.id === id);
  if (!record || !/^https?:\/\//i.test(record.url)) return false;
  session.fromPartition(PERSISTENT_PARTITION).downloadURL(record.url);
  return true;
}

function installDownloadManager({ app, store }) {
  const sessions = new Set([
    session.defaultSession,
    session.fromPartition(PERSISTENT_PARTITION),
  ]);

  const onWillDownload = async (_event, item, webContents) => {
    try {
      const settings = store.snapshot().settings;
      const configuredDirectory = settings.downloadDirectory;
      const defaultDirectory = configuredDirectory && fs.existsSync(configuredDirectory)
        ? configuredDirectory
        : app.getPath('downloads');
      fs.mkdirSync(defaultDirectory, { recursive: true });

      const filename = safeFilename(item.getFilename());
      let savePath = uniquePath(defaultDirectory, filename);
      const owner = getOwnerWindow(webContents);

      if (settings.askBeforeDownload) {
        const dialogOptions = {
          title: 'Download file',
          defaultPath: savePath,
          properties: ['showOverwriteConfirmation'],
        };
        const result = owner
          ? await dialog.showSaveDialog(owner, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions);

        if (result.canceled || !result.filePath) {
          item.cancel();
          return;
        }
        savePath = path.resolve(result.filePath);
      }

      item.setSavePath(savePath);
      const record = store.addDownload({
        url: item.getURL(),
        filename: path.basename(savePath),
        savePath,
        mimeType: item.getMimeType(),
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
      });
      activeDownloads.set(record.id, item);
      notifyDownloads(store);

      item.on('updated', (_updateEvent, state) => {
        store.updateDownload(record.id, {
          state,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
          savePath: item.getSavePath(),
        });
        notifyDownloads(store);
      });

      item.on('done', (_doneEvent, state) => {
        activeDownloads.delete(record.id);
        store.updateDownload(record.id, {
          state,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
          savePath: item.getSavePath(),
        });
        notifyDownloads(store);
      });
    } catch (error) {
      console.error('Novaris download error:', error);
    }
  };

  for (const browserSession of sessions) {
    browserSession.on('will-download', onWillDownload);
  }
}

module.exports = {
  PERSISTENT_PARTITION,
  installDownloadManager,
  safeFilename,
  pauseDownload,
  resumeDownload,
  cancelDownload,
  retryDownload,
};
