// Works out how much of an extension will actually function in Novaris.
//
// This exists because Electron can load a Manifest V3 extension but does not run
// extension service workers. The result is an extension that appears in the list,
// shows no error, and silently does nothing, which is the single most confusing
// failure mode for the user. The classification is derived from the manifest so
// it can be explained before anything is installed.
//
// Everything here is based on the declared manifest. It reports what the runtime
// is expected to support, not a promise that every code path inside the extension
// will work.

const LEVELS = Object.freeze({ unsupported: 'unsupported', limited: 'limited', ok: 'ok' });

// Extension APIs that Electron's extension host does not implement. Listed so
// the user is told up front rather than discovering it through broken features.
const UNSUPPORTED_APIS = Object.freeze([
  { api: 'nativeMessaging', label: 'Native messaging (talking to a Windows program)' },
  { api: 'offscreen', label: 'Offscreen documents' },
  { api: 'sidePanel', label: 'Side panel' },
  { api: 'declarativeNetRequestFeedback', label: 'Declarative Net Request feedback' },
  { api: 'enterprise.deviceAttributes', label: 'Enterprise device attributes' },
]);

function permissionsOf(manifest = {}) {
  const all = [];
  for (const key of ['permissions', 'optional_permissions']) {
    if (Array.isArray(manifest[key])) all.push(...manifest[key].filter((item) => typeof item === 'string'));
  }
  return all;
}

function findUnsupportedApis(manifest = {}) {
  const requested = permissionsOf(manifest);
  return UNSUPPORTED_APIS
    .filter((entry) => requested.includes(entry.api))
    .map((entry) => ({ type: 'api', id: entry.api, label: entry.label }));
}

function backgroundKind(manifest = {}) {
  const background = manifest.background;
  if (!background || typeof background !== 'object') return '';
  if (typeof background.service_worker === 'string' && background.service_worker) return 'service-worker';
  if (Array.isArray(background.scripts) && background.scripts.length) return 'scripts';
  if (typeof background.page === 'string' && background.page) return 'page';
  return '';
}

function manifestVersionOf(manifest = {}) {
  // Accepts either the raw Chrome spelling or the normalised one produced by
  // readManifest, so the classifier works on both.
  return Number(manifest.manifest_version ?? manifest.manifestVersion) || 0;
}

function classifyExtension(input = {}) {
  const manifest = input.manifest && typeof input.manifest === 'object' ? input.manifest : {};
  const version = manifestVersionOf(manifest);
  const name = typeof manifest.name === 'string' ? manifest.name : 'This extension';
  const reasons = [];

  if (input.loadError) {
    reasons.push({
      level: LEVELS.unsupported,
      title: 'The extension failed to load',
      detail: input.loadError,
    });
  }

  const background = backgroundKind(manifest);
  if (background === 'service-worker') {
    reasons.push({
      level: LEVELS.unsupported,
      title: 'This extension will not work in Novaris',
      detail: `${name} is Manifest V3 and runs its background logic in a service worker. Novaris cannot run extension service workers, so blocking, popups, and other features stay switched off.`,
      fix: 'Look for a Manifest V2 release of this extension, which Novaris can run.',
    });
  }

  // A background page that unloads itself is an event page, which depends on the
  // same lifecycle the service worker needs.
  if (background === 'page' && manifest.background?.persistent === false) {
    reasons.push({
      level: LEVELS.limited,
      title: 'Some features may not work',
      detail: 'This extension uses an event page that unloads when idle. Novaris may keep it dormant, so some features may not respond until the page is reloaded.',
    });
  }

  for (const api of findUnsupportedApis(manifest)) {
    reasons.push({
      level: LEVELS.unsupported,
      title: `Uses ${api.label}, which Novaris does not support`,
      detail: `The extension requests the "${api.api}" permission. Novaris does not provide it, so the features that depend on it will not work.`,
    });
  }

  // MV3 extensions that ship only a static declarativeNetRequest ruleset lose
  // their main blocking mechanism without a service worker to manage it.
  if (version >= 3 && Array.isArray(manifest.declarative_net_request?.rule_resources)
    && manifest.declarative_net_request.rule_resources.length > 0) {
    reasons.push({
      level: LEVELS.limited,
      title: 'Network rules may not apply',
      detail: 'This extension relies on declarative network rules, which need the service worker that Novaris cannot run.',
    });
  }

  let level = LEVELS.ok;
  for (const reason of reasons) {
    if (reason.level === LEVELS.unsupported) { level = LEVELS.unsupported; break; }
    if (reason.level === LEVELS.limited) level = LEVELS.limited;
  }

  return {
    level,
    manifestVersion: version,
    background,
    // Warns that the extension is expected to do nothing, without pretending to
    // have executed it.
    functional: level !== LEVELS.unsupported,
    reasons,
  };
}

const LEVEL_LABEL = Object.freeze({
  [LEVELS.unsupported]: 'Not supported',
  [LEVELS.limited]: 'Limited',
  [LEVELS.ok]: 'Works',
});

function levelLabel(level) {
  return LEVEL_LABEL[level] || LEVEL_LABEL[LEVELS.ok];
}

module.exports = {
  LEVELS,
  LEVEL_LABEL,
  UNSUPPORTED_APIS,
  backgroundKind,
  classifyExtension,
  levelLabel,
  manifestVersionOf,
  permissionsOf,
};
