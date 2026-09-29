// Signs a checksums file, so a first-time download can be verified.
//
//   node scripts/write-checksums.mjs [--private-key <path>]
//
// The update manifests are signed, which protects every update after the first
// one. They do not protect the first one: a user who downloads the installer
// from the website has nothing to compare it against, and a Windows code
// signature only helps on a machine that trusts the certificate, which for a
// self-signed one means a machine that was told to.
//
// So the published files are also listed in a checksums file, and that file is
// signed with the same Ed25519 key. A user downloads the installer, the
// checksums file and the public key, and can then establish that the file they
// have is the one that was published. It needs no CA, no certificate store and
// nothing installed.
//
// SHA-256 rather than the SHA-512 in latest.yml, because this is read by people
// and by other tools, and SHA-256 is what both of those expect. It is not
// interchangeable with the update manifest: the manifest digest is what
// electron-updater compares the download against, and this one is what a person
// compares it against. Both cover the same bytes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { signManifest, verifyManifest, readPublicKey } = await import('../electron/update-signing.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');

const keyFlag = process.argv.indexOf('--private-key');
const privatePath = keyFlag !== -1 && process.argv[keyFlag + 1]
  ? path.resolve(process.argv[keyFlag + 1])
  : path.join(os.homedir(), '.novaris', 'update-signing-key.pem');

const publicPath = path.join(root, 'assets', 'update-public-key.pem');
const outPath = path.join(releaseDir, 'checksums.txt');

// Only the two installers. Every other file in release/ is either an older
// version left behind by a previous build or a build tool's own output, and
// listing those would tell a user to verify a file that is not part of this
// release.
const wanted = /\.(exe|deb)$/i;

if (!fs.existsSync(privatePath)) {
  console.error(`checksums: no private key at ${privatePath}`);
  console.error('Create one with:  node scripts/create-update-key.mjs');
  process.exit(1);
}
if (!fs.existsSync(publicPath)) {
  console.error(`checksums: no public key at ${publicPath}`);
  process.exit(1);
}

const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const artifacts = fs.existsSync(releaseDir)
  ? fs.readdirSync(releaseDir)
    .filter((name) => wanted.test(name) && name.includes(version))
    .sort()
  : [];

if (!artifacts.length) {
  console.log(`checksums: no ${version} installers in release/, nothing to sign`);
  console.log('Build one first:  npm run dist:win');
  process.exit(0);
}

const lines = [
  '# Novaris Browser release checksums',
  `# version ${version}`,
  '#',
  '# SHA-256 of every published installer. This file is signed with the same',
  '# Ed25519 key the application uses to verify updates, so verifying the',
  '# signature below is what establishes that these hashes are ours.',
  '#',
  '# To verify a download:',
  '#   node scripts/verify-download.mjs <downloaded-file>',
  '',
];

for (const name of artifacts) {
  const bytes = fs.readFileSync(path.join(releaseDir, name));
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  lines.push(`${digest}  ${name}`);
  console.log(`  ${digest}  ${name}`);
}

const body = `${lines.join('\n')}\n`;
const privateKeyPem = fs.readFileSync(privatePath, 'utf8');
const publicKeyPem = readPublicKey(publicPath);
const signed = signManifest(body, privateKeyPem);

// Verified with the key the application ships, before it is written. A
// checksums file that does not verify is worse than none, because it looks like
// it is doing something.
const verdict = verifyManifest(signed, publicKeyPem);
if (!verdict.ok) {
  console.error(`checksums: the signed file did not verify: ${verdict.reason}`);
  process.exit(1);
}

fs.writeFileSync(outPath, signed, 'utf8');
console.log(`\nchecksums: wrote and signed ${path.relative(root, outPath)}`);

// The whole point is that a user can check this, so the file has to actually
// describe the files on disk. Verified here rather than assumed.
let failed = false;
for (const line of body.split('\n')) {
  const match = line.match(/^([0-9a-f]{64})  (.+)$/);
  if (!match) continue;
  const [, digest, name] = match;
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(releaseDir, name))).digest('hex');
  if (actual !== digest) {
    console.error(`checksums: ${name} does not match the digest recorded for it`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('checksums: every recorded digest matches the file on disk');
