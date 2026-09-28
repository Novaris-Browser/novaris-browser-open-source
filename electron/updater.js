const fs = require('node:fs');
const { readPublicKey, verifyManifest } = require('./update-signing');
const path = require('node:path');
const { app } = require('electron');

// The update channel is generated into the bundle at build time. An environment
// variable takes precedence so a build can be pointed at a test channel, but end
// users never set one, so the packaged application reads its own channel file.
//
// The packaged package.json cannot be used for this: electron-builder prunes the
// `build` section out of it, so the URL electron-builder itself uses is not
// readable by the running app.
let cachedFeedUrl;

function feedUrlFromBundle() {
  try {
    const channelPath = path.join(app.getAppPath(), 'assets', 'update-channel.json');
    const channel = JSON.parse(fs.readFileSync(channelPath, 'utf8'));
    return typeof channel.feedUrl === 'string' ? channel.feedUrl.trim() : '';
  } catch {
    return '';
  }
}

function resolveFeedUrl() {
  if (cachedFeedUrl !== undefined) return cachedFeedUrl;
  const fromEnv = String(process.env.NOVARIS_UPDATE_FEED || '').trim();
  cachedFeedUrl = (fromEnv || feedUrlFromBundle()).replace(/\/+$/, '');
  return cachedFeedUrl;
}

function normalizeNotes(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).join('\n\n');
  return String(value || '').trim();
}

// electron-updater surfaces the manifest entry, which carries the installer size.
function sizeFromInfo(info) {
  const candidates = [info?.files?.[0]?.size, info?.fileInfo?.size, info?.size];
  for (const value of candidates) {
    const bytes = Number(value);
    if (Number.isFinite(bytes) && bytes > 0) return bytes;
  }
  return 0;
}

function compareVersions(next, current) {
  const a = String(next || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const b = String(current || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) > (b[i] || 0)) return 1;
    if ((a[i] || 0) < (b[i] || 0)) return -1;
  }
  return 0;
}

class UpdateManager {
  constructor({ getWindow, getUserDataPath, onStateChange } = {}) {
    this.getWindow = getWindow || (() => null);
    this.getUserDataPath = getUserDataPath || (() => app.getPath('userData'));
    this.onStateChange = onStateChange || (() => {});
    this.autoUpdater = null;
    this.state = {
      status: 'idle',
      configured: Boolean(resolveFeedUrl()),
      feedUrl: resolveFeedUrl(),
      currentVersion: app.getVersion(),
      availableVersion: '',
      releaseNotes: '',
      progress: 0,
      totalBytes: 0,
      error: '',
      checkedAt: 0,
    };
  }

  patch(changes) {
    this.state = { ...this.state, ...changes };
    this.onStateChange(this.state);
    return this.state;
  }

  isPackaged() {
    return app.isPackaged;
  }

  // electron-updater is only loaded for packaged builds so that `npm start`
  // never tries to reach a channel and dev builds stay offline.
  loadUpdater() {
    if (this.autoUpdater) return this.autoUpdater;
    let autoUpdater;
    try {
      // eslint-disable-next-line global-require
      ({ autoUpdater } = require('electron-updater'));
    } catch (error) {
      this.patch({ status: 'error', error: 'The updater is unavailable in this build.' });
      return null;
    }
    this.autoUpdater = autoUpdater;
    const feedUrl = resolveFeedUrl();
    if (feedUrl) {
      try {
        autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
      } catch (error) {
        this.patch({ status: 'error', error: `The update channel is invalid: ${error.message}` });
      }
    }
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = null;

    autoUpdater.on('checking-for-update', () => this.patch({ status: 'checking', error: '' }));
    autoUpdater.on('update-available', (info) => this.patch({
      status: 'available',
      availableVersion: String(info?.version || ''),
      releaseNotes: normalizeNotes(info?.releaseNotes),
      // latest.yml carries the installer size, so the UI can say how much the
      // download costs before the user agrees to it.
      totalBytes: sizeFromInfo(info),
      progress: 0,
    }));
    autoUpdater.on('update-not-available', (info) => this.patch({
      status: 'current',
      availableVersion: String(info?.version || this.state.currentVersion),
      releaseNotes: '',
      progress: 0,
    }));
    // The total byte count is what lets the UI show the download size before
    // the user commits to downloading.
    autoUpdater.on('download-progress', (progress) => this.patch({
      status: 'downloading',
      progress: Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0))),
      totalBytes: Number(progress?.total) || this.state.totalBytes || 0,
    }));
    autoUpdater.on('update-downloaded', (info) => this.patch({
      status: 'downloaded',
      availableVersion: String(info?.version || this.state.availableVersion),
      progress: 100,
    }));
    autoUpdater.on('error', (error) => this.patch({
      status: 'error',
      error: String(error?.message || error || 'The update check failed.'),
    }));
    return autoUpdater;
  }

  /**
   * Fetches the manifest and checks its signature before anything else happens.
   *
   * This runs ahead of electron-updater rather than alongside it, on purpose.
   * If the manifest is not signed by the key inside this build, the updater is
   * never asked to look at it, so a substituted URL, a swapped hash or an
   * injected release note cannot reach the download stage. The certificate on the
   * installer says who built it; this says who published it, and they are
   * different questions.
   */
  async verifyFeedSignature() {
    const feedUrl = resolveFeedUrl();
    if (!feedUrl) return { ok: false, reason: 'No update channel is configured for this build.' };

    let publicKey = '';
    try {
      const keyPath = path.join(app.getAppPath(), 'assets', 'update-public-key.pem');
      publicKey = readPublicKey(keyPath);
    } catch {
      return { ok: false, reason: 'This build carries no update signing key, so the feed cannot be trusted.' };
    }
    if (!publicKey) {
      return { ok: false, reason: 'The bundled update signing key is empty.' };
    }

    // electron-updater reads a different manifest per platform.
    const manifestName = process.platform === 'linux' ? 'latest-linux.yml' : 'latest.yml';
    let text = '';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(`${feedUrl}/${manifestName}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) return { ok: false, reason: `The update feed returned HTTP ${response.status}.` };
      text = await response.text();
    } catch (error) {
      return { ok: false, reason: `The update feed could not be read: ${String(error?.message || error)}` };
    }

    return verifyManifest(text, publicKey);
  }

  async check() {
    if (!this.isPackaged()) {
      return this.patch({ status: 'unavailable', error: 'Updates are only checked in an installed build.' });
    }
    if (!resolveFeedUrl()) {
      return this.patch({
        status: 'unconfigured',
        error: 'No update channel is configured for this build.',
      });
    }

    // Verify first. An unverified feed is not a slow update, it is a rejected one.
    this.patch({ status: 'checking', error: '', checkedAt: Date.now() });
    const verdict = await this.verifyFeedSignature();
    this.signatureVerified = verdict.ok;
    if (!verdict.ok) {
      this.patch({
        status: 'error',
        error: `The update was refused: ${verdict.reason}`,
        signatureVerified: false,
      });
      return this.state;
    }

    const autoUpdater = this.loadUpdater();
    if (!autoUpdater) return this.state;
    this.patch({ status: 'checking', error: '', checkedAt: Date.now(), signatureVerified: true });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.patch({ status: 'error', error: String(error?.message || error) });
    }
    return this.state;
  }

  async download() {
    const autoUpdater = this.loadUpdater();
    if (!autoUpdater) return this.state;
    if (compareVersions(this.state.availableVersion, this.state.currentVersion) <= 0) {
      return this.patch({ status: 'current', error: '' });
    }
    this.patch({ status: 'downloading', progress: 0, error: '' });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.patch({ status: 'error', error: String(error?.message || error) });
    }
    return this.state;
  }

  // Installing relaunches the app, so the reset is scheduled first and applied
  // by the next launch before any window is created.
  async installAndReset() {
    const autoUpdater = this.loadUpdater();
    if (!autoUpdater) return this.state;
    if (this.state.status !== 'downloaded') {
      return this.patch({ status: 'error', error: 'No downloaded update is ready to install.' });
    }
    this.patch({ status: 'installing', error: '' });
    try {
      const { writePendingReset } = require('./profile-reset');
      writePendingReset(this.getUserDataPath(), {
        reason: 'update',
        fromVersion: this.state.currentVersion,
        toVersion: this.state.availableVersion,
        releaseNotes: this.state.releaseNotes,
      });
    } catch (error) {
      return this.patch({ status: 'error', error: `The reset could not be scheduled: ${error.message}` });
    }
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (error) {
        this.patch({ status: 'error', error: String(error?.message || error) });
      }
    });
    return this.state;
  }
}

module.exports = { UpdateManager, compareVersions, normalizeNotes, resolveFeedUrl, sizeFromInfo };
