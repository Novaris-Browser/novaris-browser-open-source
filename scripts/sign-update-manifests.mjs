// Signs the update manifests, and refuses to publish a release that is unsigned.
//
//   node scripts/sign-update-manifests.mjs [--private-key <path>]
//
// Run before uploading. The updater verifies the signature before it will act on
// a manifest, so a release published without this step is a release existing
// installations will refuse. That is deliberate: an update the user cannot
// verify is an update nobody should install.
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

if (!fs.existsSync(privatePath)) {
  console.error(`update signing: no private key at ${privatePath}`);
  console.error('Create one with:  node scripts/create-update-key.mjs');
  process.exit(1);
}
if (!fs.existsSync(publicPath)) {
  console.error(`update signing: no public key at ${publicPath}`);
  process.exit(1);
}

const privateKeyPem = fs.readFileSync(privatePath, 'utf8');
const publicKeyPem = readPublicKey(publicPath);

const manifests = ['latest.yml', 'latest-linux.yml']
  .map((name) => path.join(releaseDir, name))
  .filter((file) => fs.existsSync(file));

if (!manifests.length) {
  console.log('update signing: no manifests in release/, nothing to sign');
  process.exit(0);
}

let failed = false;
for (const file of manifests) {
  const text = fs.readFileSync(file, 'utf8');
  const signed = signManifest(text, privateKeyPem);
  // Verified with the key the application ships, not assumed correct.
  const verdict = verifyManifest(signed, publicKeyPem);
  if (!verdict.ok) {
    console.error(`update signing: ${path.basename(file)} did not verify: ${verdict.reason}`);
    failed = true;
    continue;
  }
  fs.writeFileSync(file, signed, 'utf8');
  console.log(`update signing: ${path.basename(file)} signed and verified`);
}

if (failed) process.exit(1);
