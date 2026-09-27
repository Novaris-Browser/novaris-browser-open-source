const fs = require('node:fs');
const path = require('node:path');

// A full reset cannot safely run while Chromium has the profile open, so the
// request is written to a marker file, the app restarts, and the wipe happens
// on the next launch before any window is created.
const MARKER_NAME = 'pending-reset.json';

function markerPath(userDataPath) {
  return path.join(userDataPath, MARKER_NAME);
}

function readPendingReset(userDataPath) {
  try {
    const raw = fs.readFileSync(markerPath(userDataPath), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'reset',
      fromVersion: typeof parsed.fromVersion === 'string' ? parsed.fromVersion : '',
      toVersion: typeof parsed.toVersion === 'string' ? parsed.toVersion : '',
      releaseNotes: typeof parsed.releaseNotes === 'string' ? parsed.releaseNotes : '',
      requestedAt: Number.isFinite(parsed.requestedAt) ? parsed.requestedAt : 0,
    };
  } catch {
    return null;
  }
}

function writePendingReset(userDataPath, payload = {}) {
  const record = {
    reason: payload.reason || 'reset',
    fromVersion: payload.fromVersion || '',
    toVersion: payload.toVersion || '',
    // Release notes are stored as plain text so they survive the wipe and can
    // still be shown to the user afterwards.
    releaseNotes: String(payload.releaseNotes || '').slice(0, 20000),
    requestedAt: Date.now(),
  };
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(markerPath(userDataPath), JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}

function clearPendingReset(userDataPath) {
  try {
    fs.rmSync(markerPath(userDataPath), { force: true });
  } catch {
    // Nothing to clear.
  }
}

// Everything Chromium and Novaris keep lives directly under userData. The
// marker is read into memory first and deleted last, so an interrupted wipe
// still leaves a marker and is retried on the following launch.
function wipeProfileDirectory(userDataPath) {
  const removed = [];
  const kept = new Set([MARKER_NAME]);
  let entries = [];
  try {
    entries = fs.readdirSync(userDataPath);
  } catch {
    return { removed, failed: [] };
  }
  const failed = [];
  for (const entry of entries) {
    if (kept.has(entry)) continue;
    const target = path.join(userDataPath, entry);
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
      removed.push(entry);
    } catch (error) {
      failed.push({ entry, error: error.message });
    }
  }
  return { removed, failed };
}

// Runs on the next launch, before any session or window exists.
function applyPendingReset(userDataPath) {
  const pending = readPendingReset(userDataPath);
  if (!pending) return null;

  // The marker is consumed before the wipe, not after. Chromium recreates and
  // holds some profile files, so an all-or-nothing success check would keep the
  // marker alive and show this message on every single launch. Wiping twice
  // catches the files that were only locked during the first pass.
  clearPendingReset(userDataPath);
  const first = wipeProfileDirectory(userDataPath);
  const second = first.failed.length ? wipeProfileDirectory(userDataPath) : { removed: [], failed: [] };
  const failed = [...first.failed, ...second.failed];
  if (failed.length) {
    console.warn('Novaris could not remove some profile files during reset:', failed.map((item) => item.entry).join(', '));
  }
  return { ...pending, removed: first.removed.length + second.removed.length, failed };
}

module.exports = {
  MARKER_NAME,
  applyPendingReset,
  clearPendingReset,
  markerPath,
  readPendingReset,
  wipeProfileDirectory,
  writePendingReset,
};
