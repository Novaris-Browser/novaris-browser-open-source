const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const unzipper = require('unzipper');

const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const CRX_MAGIC = Buffer.from('Cr24', 'ascii');

function safeText(value, maxLength = 500) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength) : '';
}

function packageError(message) {
  const error = new Error(message);
  error.code = 'EXTENSION_PACKAGE_INVALID';
  return error;
}

function readUInt32(buffer, offset, label) {
  if (offset < 0 || offset + 4 > buffer.length) throw packageError(`The ${label} is truncated.`);
  return buffer.readUInt32LE(offset);
}

function unwrapCrx(buffer) {
  if (buffer.length < 4 || !buffer.subarray(0, 4).equals(CRX_MAGIC)) {
    if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ZIP_MAGIC)) return { zip: buffer, format: 'zip' };
    throw packageError('Choose a Chrome CRX or ZIP extension package.');
  }

  if (buffer.length < 16) throw packageError('The CRX header is truncated.');
  const version = readUInt32(buffer, 4, 'CRX header');
  let payloadOffset;
  if (version === 2) {
    const publicKeyLength = readUInt32(buffer, 8, 'CRX public-key header');
    const signatureLength = readUInt32(buffer, 12, 'CRX signature header');
    payloadOffset = 16 + publicKeyLength + signatureLength;
  } else if (version === 3) {
    const headerLength = readUInt32(buffer, 8, 'CRX header');
    payloadOffset = 12 + headerLength;
  } else {
    throw packageError(`Unsupported CRX version ${version}.`);
  }

  if (payloadOffset >= buffer.length || !buffer.subarray(payloadOffset, payloadOffset + 4).equals(ZIP_MAGIC)) {
    throw packageError('The CRX does not contain a valid extension ZIP payload.');
  }
  return { zip: buffer.subarray(payloadOffset), format: `crx${version}` };
}

function safeEntryName(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  if (!raw || raw.includes('\u0000') || raw.startsWith('/') || /^[a-z]:/i.test(raw)) throw packageError('The extension package contains an unsafe file path.');
  const segments = raw.split('/');
  if (segments.some((segment) => segment === '..')) throw packageError('The extension package contains a path traversal entry.');
  const normalized = path.posix.normalize(raw);
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) throw packageError('The extension package contains an unsafe file path.');
  return normalized.replace(/^\.\//, '');
}

function entrySize(value) {
  const size = Number(value);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

async function readEntryBuffer(entry) {
  const chunks = [];
  let size = 0;
  for await (const chunk of entry.stream()) {
    size += chunk.length;
    if (size > MAX_FILE_BYTES) throw packageError('An extension file is too large to import safely.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}

async function extractZip(zipPath, destination) {
  const archive = await unzipper.Open.file(zipPath);
  if (archive.files.length > MAX_FILES) throw packageError('The extension package contains too many files.');

  let totalBytes = 0;
  const names = new Set();
  fs.mkdirSync(destination, { recursive: true });

  for (const entry of archive.files) {
    const rawName = String(entry.path || '').replace(/\\/g, '/');
    if (!rawName || rawName === '.' || rawName === './') {
      if (entry.type === 'Directory' || rawName.endsWith('/')) continue;
      throw packageError('The extension package contains an invalid file entry.');
    }
    const name = safeEntryName(rawName);
    if (names.has(name)) throw packageError(`The extension package contains a duplicate file: ${name}`);
    names.add(name);

    const target = path.resolve(destination, ...name.split('/'));
    const relative = path.relative(path.resolve(destination), target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw packageError('The extension package contains an unsafe file path.');

    const isDirectory = entry.type === 'Directory' || name.endsWith('/');
    if (isDirectory) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    if (entry.type === 'SymbolicLink') throw packageError('Symbolic links are not allowed in extension packages.');

    const declaredSize = entrySize(entry.uncompressedSize);
    if (declaredSize !== null && declaredSize > MAX_FILE_BYTES) throw packageError('An extension file is too large to import safely.');
    totalBytes += declaredSize || 0;
    if (totalBytes > MAX_EXTRACTED_BYTES) throw packageError('The extracted extension is too large to import safely.');

    fs.mkdirSync(path.dirname(target), { recursive: true });
    const content = await readEntryBuffer(entry);
    totalBytes += content.length - (declaredSize || 0);
    if (totalBytes > MAX_EXTRACTED_BYTES) throw packageError('The extracted extension is too large to import safely.');
    fs.writeFileSync(target, content, { mode: 0o600 });
  }
}

function readManifest(directory) {
  const manifestPath = path.join(directory, 'manifest.json');
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) throw packageError('The package does not contain a manifest.json file.');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw packageError('The extension manifest is not valid JSON.');
  }
  const manifestVersion = Number(manifest?.manifest_version);
  if (!manifest || typeof manifest !== 'object' || typeof manifest.name !== 'string' || !manifest.name.trim() || typeof manifest.version !== 'string' || !manifest.version.trim() || ![2, 3].includes(manifestVersion)) {
    throw packageError('The package does not contain a supported extension manifest.');
  }
  const list = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, 100) : [];
  const action = manifest.action && typeof manifest.action === 'object' ? manifest.action : {};
  const optionsUi = manifest.options_ui && typeof manifest.options_ui === 'object' ? manifest.options_ui : {};
  return {
    name: String(manifest.name).slice(0, 120),
    version: String(manifest.version).slice(0, 40),
    manifestVersion,
    // Retained in the raw Chrome spelling, because the compatibility classifier
    // needs to know how the background is implemented and must be able to tell
    // an absent "persistent" flag apart from an explicit false.
    manifest_version: manifestVersion,
    background: manifest.background && typeof manifest.background === 'object'
      ? {
        service_worker: typeof manifest.background.service_worker === 'string' ? manifest.background.service_worker : '',
        scripts: list(manifest.background.scripts),
        page: typeof manifest.background.page === 'string' ? manifest.background.page : '',
        persistent: manifest.background.persistent,
      }
      : null,
    declarative_net_request: manifest.declarative_net_request && typeof manifest.declarative_net_request === 'object'
      ? { rule_resources: Array.isArray(manifest.declarative_net_request.rule_resources) ? manifest.declarative_net_request.rule_resources : [] }
      : null,
    description: String(manifest.description || '').slice(0, 300),
    permissions: [...new Set([...list(manifest.permissions), ...list(manifest.optional_permissions)])],
    hostPermissions: [...new Set([...list(manifest.host_permissions), ...list(manifest.optional_host_permissions)])],
    action: {
      defaultTitle: safeText(action.default_title || manifest.name, 120),
      defaultPopup: safeText(action.default_popup, 300),
    },
    optionsPage: safeText(manifest.options_page || optionsUi.page, 300),
  };
}

async function prepareExtensionPackage(packagePath, stagingRoot) {
  const stat = fs.statSync(packagePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PACKAGE_BYTES) throw packageError('The extension package is empty or too large.');
  const buffer = fs.readFileSync(packagePath);
  const unwrapped = unwrapCrx(buffer);
  fs.mkdirSync(stagingRoot, { recursive: true });
  const staging = fs.mkdtempSync(path.join(stagingRoot, 'candidate-'));
  const zipPath = path.join(staging, 'package.zip');
  try {
    fs.writeFileSync(zipPath, unwrapped.zip, { mode: 0o600 });
    const directory = path.join(staging, 'extension');
    await extractZip(zipPath, directory);
    const manifest = readManifest(directory);
    return { staging, directory, manifest, format: unwrapped.format, signatureVerified: false };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function chromeStoreUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 500) return null;
  if (/^[a-p]{32}$/i.test(raw)) return `https://chromewebstore.google.com/detail/${raw.toLowerCase()}`;
  let parsed;
  try { parsed = new URL(raw); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'chromewebstore.google.com' && host !== 'chrome.google.com') return null;
  if (!parsed.pathname.startsWith('/detail/')) return null;
  return parsed.toString();
}

function createInstallDirectory(root, manifest) {
  fs.mkdirSync(root, { recursive: true });
  const safeName = String(manifest.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'extension';
  return path.join(root, `${safeName}-${randomUUID().slice(0, 8)}`);
}

module.exports = {
  MAX_EXTRACTED_BYTES,
  MAX_PACKAGE_BYTES,
  chromeStoreUrl,
  createInstallDirectory,
  prepareExtensionPackage,
  readManifest,
  unwrapCrx,
};
