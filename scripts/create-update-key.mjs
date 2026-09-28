// Creates the update signing key pair, writes the public half into the
// repository, and puts the private half somewhere the repository cannot see.
//
//   node scripts/create-update-key.mjs [--force]
//
// The private key is the only thing that can sign a release. Losing it means
// no more updates can be published for builds already shipped, so it is written
// with a mode that only the owner can read and is never created inside the
// project directory. Losing it is recoverable only by changing the key and
// accepting that existing installations will refuse new feeds until they are
// updated by hand, which is the correct failure: refusing is safe, trusting is
// not.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { generateKeyPair, writePublicKey } = await import('../electron/update-signing.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');

const publicTarget = path.join(root, 'assets', 'update-public-key.pem');
if (fs.existsSync(publicTarget) && !force) {
  console.log(`public key already exists: ${publicTarget}`);
  console.log('Pass --force to replace it. Replacing it invalidates every shipped build.');
  process.exit(1);
}

const { publicKeyPem, privateKeyPem } = generateKeyPair();

writePublicKey(publicTarget, publicKeyPem);

// Deliberately outside the project, and gitignored even so.
const keyDir = path.join(os.homedir(), '.novaris');
const privateTarget = path.join(keyDir, 'update-signing-key.pem');
fs.mkdirSync(keyDir, { recursive: true });
fs.writeFileSync(privateTarget, privateKeyPem, { encoding: 'utf8', mode: 0o600 });
try {
  fs.chmodSync(privateTarget, 0o600);
} catch {
  // Windows has no POSIX mode; the file inherits the user's own access.
}

console.log(`public  key written to ${publicTarget}`);
console.log(`private key written to ${privateTarget}`);
console.log('');
console.log('Back the private key up somewhere you control, and not in this repository.');
console.log('It is the only thing that can sign a release.');
