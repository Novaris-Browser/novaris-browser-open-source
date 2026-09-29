// Checks a downloaded installer against the published, signed checksums file.
//
//   node scripts/verify-download.mjs <downloaded-file> [--checksums <path>] [--public-key <path>]
//
// The question this answers is "is the file I just downloaded the one that was
// published", and it takes three steps to answer it properly:
//
//   1. the checksums file carries a valid Ed25519 signature, so the digests in
//      it are ours and were not written by whoever served the download
//   2. the file named in the checksums is the one the user asked about
//   3. the bytes hash to the recorded digest
//
// Step 1 is the part that matters. A checksums file served from the same place
// as the download proves nothing on its own: an attacker who replaced the
// installer can replace the checksums file too. The signature is what makes it
// evidence rather than decoration.
//
// Exits 0 when the file is good, 1 when it is not, and says which of the three
// steps failed rather than only that something did.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { verifyManifest, readPublicKey } = await import('../electron/update-signing.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : '';
};

const target = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '';

function fail(step, message) {
  console.error(`\n  FAILED at step ${step}: ${message}\n`);
  process.exit(1);
}

if (!target) {
  console.error('usage: node scripts/verify-download.mjs <downloaded-file>');
  console.error('');
  console.error('  --checksums <path>   default release/checksums.txt');
  console.error('  --public-key <path>  default assets/update-public-key.pem');
  process.exit(1);
}

if (!fs.existsSync(target)) {
  fail(0, `no such file: ${target}`);
}

const checksumsPath = path.resolve(flag('--checksums') || path.join(root, 'release', 'checksums.txt'));
const publicKeyPath = path.resolve(flag('--public-key') || path.join(root, 'assets', 'update-public-key.pem'));

if (!fs.existsSync(checksumsPath)) {
  fail(1, `no checksums file at ${checksumsPath}
  Download it from the same place as the installer.`);
}
if (!fs.existsSync(publicKeyPath)) {
  fail(1, `no public key at ${publicKeyPath}`);
}

const checksumsText = fs.readFileSync(checksumsPath, 'utf8');
const publicKeyPem = readPublicKey(publicKeyPath);

// ---------------------------------------------------------------- step 1
const verdict = verifyManifest(checksumsText, publicKeyPem);
if (!verdict.ok) {
  fail('1, signature', `the checksums file is not signed by the key in ${path.basename(publicKeyPath)}
  Reason: ${verdict.reason}
  Do not trust the digests in that file.`);
}
console.log('  step 1  checksums signature is valid');

// ---------------------------------------------------------------- step 2
const name = path.basename(target);
const entry = checksumsText.split(/\r?\n/)
  .map((line) => line.match(/^([0-9a-f]{64})  (.+)$/))
  .find((match) => match && match[2] === name);
if (!entry) {
  fail(2, `${name} is not listed in the checksums file
  Either it is not part of this release, or it was renamed.`);
}
const [, declared] = entry;
console.log(`  step 2  ${name} is listed in this release`);

// ---------------------------------------------------------------- step 3
const actual = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
if (actual !== declared) {
  fail(3, `the file does not match the digest that was published
  expected ${declared}
  actual   ${actual}
  The download is corrupt, or it was replaced. Do not run it.`);
}
console.log('  step 3  the file matches the published digest');
console.log(`\n  sha256  ${actual}\n`);
console.log('  This file is the one that was published, and the checksums file is');
console.log('  signed by the same key the browser uses to verify its own updates.');
console.log('');
console.log('  What that does and does not cover. The public key is the root of trust');
console.log('  here: whoever supplies it decides what counts as genuine. Someone who can');
console.log('  replace your download can also replace both the checksums file and the');
console.log('  key, and this script would then agree with them. So get the key from the');
console.log('  repository, or from the installed application, and not from the same');
console.log('  place as the download you are checking.\n');
