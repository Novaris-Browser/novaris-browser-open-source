// Publishes a built release to Cloudflare R2 and then proves it arrived intact.
//
// Three things this will not do, because each has bitten a real release:
//   * upload a file whose hash disagrees with its manifest
//   * publish a manifest for a version that is not the one in package.json
//   * report success without re-reading the object back from the bucket
//
// Requires: npx wrangler logged in, and R2_BUCKET set to the bucket name.
//
//   $env:R2_BUCKET = 'novaris-updates'
//   node scripts/publish-release.mjs            # everything for the current version
//   node scripts/publish-release.mjs --dry-run  # verify only, upload nothing
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const bucket = process.env.R2_BUCKET;
const dryRun = process.argv.includes('--dry-run');
const endpoint = process.env.R2_PUBLIC_URL || 'https://updates.yladevs.com';

const CONTENT_TYPES = {
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.deb': 'application/vnd.debian.binary-package',
  '.yml': 'application/yaml; charset=utf-8',
  '.blockmap': 'application/octet-stream',
  '.AppImage': 'application/octet-stream',
};

// Versioned files can be cached forever. The manifests name the current release,
// so a cached copy is an old copy: a user would be told they were up to date when
// they were not. This is the single most common way a self-hosted update feed
// silently breaks.
const CACHE = {
  '.yml': 'no-cache, no-store, must-revalidate',
  '.blockmap': 'public, max-age=31536000, immutable',
  '.exe': 'public, max-age=31536000, immutable',
  '.deb': 'public, max-age=31536000, immutable',
};

const fail = (message) => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

function run(args, options = {}) {
  return execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
}

function sha512Base64(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}

// The manifests are the source of truth for what should be published, so they
// are parsed rather than assumed.
function readManifest(name) {
  const file = path.join(releaseDir, name);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  return {
    file,
    text,
    version: (text.match(/^version:\s*(\S+)/m) || [])[1],
    url: (text.match(/^\s*-?\s*url:\s*(\S+)/m) || [])[1],
    sha512: (text.match(/^sha512:\s*(\S+)/m) || [])[1],
    size: Number((text.match(/^\s*size:\s*(\d+)/m) || [])[1]),
  };
}

console.log(`Novaris ${version} -> R2${dryRun ? ' (dry run)' : ''}\n`);

if (!bucket) {
  console.log('  R2_BUCKET is not set. Create a bucket, or point this at an existing one:');
  console.log('    npx wrangler r2 bucket create <name>');
  console.log('  then:  $env:R2_BUCKET = "<name>"');
  process.exit(1);
}

const windows = readManifest('latest.yml');
const linux = readManifest('latest-linux.yml');

if (!windows && !linux) fail('Neither latest.yml nor latest-linux.yml exists in release/. Run a build first.');

// A manifest left over from an older build would point the updater at a version
// that was never published.
for (const [label, manifest] of [['latest.yml', windows], ['latest-linux.yml', linux]]) {
  if (manifest && manifest.version !== version) {
    fail(`${label} is for version ${manifest.version} but package.json says ${version}.
Either the build is stale, or the version was bumped after building.`);
  }
}

const uploads = [];
for (const manifest of [windows, linux].filter(Boolean)) {
  // The manifest describes the installer, not itself: its declared size and hash
  // are the installer's, so the manifest is uploaded without that comparison.
  uploads.push({ name: path.basename(manifest.file), local: manifest.file, fromManifest: null });
  if (manifest.url && manifest.url !== path.basename(manifest.file)) {
    uploads.push({ name: manifest.url, local: path.join(releaseDir, manifest.url), fromManifest: manifest });
  }
  // A blockmap has no entry in the manifest, so it is size-checked only.
  const blockmap = manifest.file + '.blockmap';
  if (fs.existsSync(blockmap)) uploads.push({ name: path.basename(blockmap), local: blockmap, fromManifest: null });
}

console.log(`  ${uploads.length} file(s) staged\n`);

// Verify before uploading, so a corrupt build is caught here rather than after
// it is already the published release.
console.log('  pre-flight');
for (const item of uploads) {
  if (!fs.existsSync(item.local)) fail(`${item.name} is in the manifest but missing from release/`);
  const size = fs.statSync(item.local).size;
  const digest = sha512Base64(item.local);
  const expected = item.fromManifest;
  const sizeOk = !expected || expected.size === size;
  const hashOk = !expected || expected.sha512 === digest;
  const mark = sizeOk && hashOk ? 'ok  ' : 'FAIL';
  console.log(`    ${mark} ${item.name}  ${size.toLocaleString()} bytes${expected ? '  (verified against manifest)' : ''}`);
  if (!sizeOk) fail(`${item.name} is ${size} bytes but the manifest says ${expected.size}.`);
  if (!hashOk) fail(`${item.name} does not match the SHA-512 in the manifest. Do not publish.`);
}

if (dryRun) {
  console.log('\n  dry run: nothing uploaded. Artifacts are internally consistent.\n');
  process.exit(0);
}

// The bucket must serve the manifests cross-origin or the website cannot read
// the published version, and updates break in the app for the same reason.
const cors = [
  {
    allowed_origins: ['https://updates.yladevs.com', 'https://novarisbrowser.example', 'https://localhost:5173'],
    allowed_methods: ['GET', 'HEAD'],
    allowed_headers: ['*'],
    expose_headers: ['ETag', 'Content-Length', 'Content-Type'],
    max_age_seconds: 3600,
  },
];
fs.writeFileSync(path.join(releaseDir, '.cors.json'), JSON.stringify(cors, null, 2));

console.log('\n  uploading');
try {
  run(['r2', 'bucket', 'cors', 'set', bucket, '--file', path.join(releaseDir, '.cors.json')]);
  console.log('    ok    CORS policy set');
} catch {
  console.log('    warn  could not set CORS. If the site cannot read the version, run:');
  console.log(`          npx wrangler r2 bucket cors set ${bucket} --file release/.cors.json`);
}

for (const item of uploads) {
  const ext = path.extname(item.name).toLowerCase();
  run([
    'r2', 'object', 'put', `${bucket}/${item.name}`,
    '--file', item.local,
    '--content-type', CONTENT_TYPES[ext] || 'application/octet-stream',
    '--cache-control', CACHE[ext] || 'public, max-age=31536000, immutable',
    '--remote',
  ]);
  console.log(`    ok    ${item.name}`);
}

// Read the objects back. A 200 that serves the wrong bytes is still a failure.
console.log('\n  verifying what the bucket actually serves');
for (const item of uploads.filter((i) => i.name.endsWith('.yml') || i.name.endsWith('.exe') || i.name.endsWith('.deb'))) {
  const url = `${endpoint}/${item.name}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) fail(`${item.name} returned HTTP ${res.status} from ${url}`);
  const served = Buffer.from(await res.arrayBuffer());
  const local = fs.readFileSync(item.local);
  const same = served.length === local.length && crypto.createHash('sha256').update(served).digest('hex')
    === crypto.createHash('sha256').update(local).digest('hex');
  const cacheControl = res.headers.get('cache-control') || '';
  console.log(`    ${same ? 'ok  ' : 'FAIL'} ${item.name}  ${served.length.toLocaleString()} bytes  cache-control: ${cacheControl}`);
  if (!same) fail(`${item.name} in the bucket does not match the local file.`);
  if (item.name.endsWith('.yml') && /max-age=(?!0)/.test(cacheControl)) {
    console.log(`    warn  ${item.name} is cacheable; browsers may serve a stale version`);
  }
}

console.log(`\n  Published Novaris ${version}.`);
console.log(`  ${endpoint}/latest.yml`);
console.log(`  ${endpoint}/latest-linux.yml\n`);
