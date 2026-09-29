import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const writeChecksums = path.join(projectRoot, 'scripts', 'write-checksums.mjs');
const verifyDownload = path.join(projectRoot, 'scripts', 'verify-download.mjs');

// The trust anchor, and the reason a signature is needed at all. A checksums
// file served next to the download proves nothing on its own: whoever replaced
// the installer can replace the checksums too. The Ed25519 signature is what
// makes the digests evidence rather than decoration.
const signing = await import('../electron/update-signing.js');

let dir = '';
let privateKeyPem = '';
let publicKeyPem = '';
let publicKeyFile = '';

function run(script, args = []) {
  try {
    const out = execFileSync(process.execPath, [script, ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

// A release directory with the two installers, a public key, and a private key
// the scripts can find.
function makeRelease({ tamper = null, version = '9.9.9' } = {}) {
  const release = path.join(dir, 'release');
  fs.mkdirSync(release, { recursive: true });
  const payload = Buffer.from('pretend installer bytes for the test');
  const deb = Buffer.from('pretend deb bytes for the test');

  const exeName = `Novaris-Browser-${version}-Setup.exe`;
  const debName = `Novaris-Browser-${version}-Linux.deb`;
  fs.writeFileSync(path.join(release, exeName), tamper ? Buffer.concat([payload, Buffer.from('!')]) : payload);
  fs.writeFileSync(path.join(release, debName), deb);

  // package.json is what the script reads for the version, so the fixture
  // directory needs one naming the same version as the artifacts.
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'novaris-browser', version }),
    'utf8',
  );
  return { release, exeName, debName, payload, deb };
}

describe('publishing a signed checksums file', () => {
  // A throwaway project, in the same shape as the publisher's fixture: the
  // script resolves release/ and the public key relative to its own location, so
  // a key pair has to belong to the same fixture or the signature will not
  // verify against it, which is the correct behaviour and not a test failure.
  const VERSION = '9.9.9';
  let privateFile = '';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaris-checksums-'));
    const release = path.join(dir, 'release');
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'electron'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.mkdirSync(release, { recursive: true });

    fs.copyFileSync(writeChecksums, path.join(dir, 'scripts', 'write-checksums.mjs'));
    // The script imports it as ../electron/update-signing.js, so it has to sit
    // in the same relative place inside the fixture.
    fs.copyFileSync(
      path.join(projectRoot, 'electron', 'update-signing.js'),
      path.join(dir, 'electron', 'update-signing.js'),
    );
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'novaris-browser', version: VERSION }),
      'utf8',
    );

    const generated = signing.generateKeyPair();
    privateFile = path.join(dir, 'private.pem');
    fs.writeFileSync(privateFile, generated.privateKeyPem, 'utf8');
    signing.writePublicKey(path.join(dir, 'assets', 'update-public-key.pem'), generated.publicKeyPem);

    fs.writeFileSync(path.join(release, `Novaris-Browser-${VERSION}-Setup.exe`), Buffer.from('windows installer bytes'));
    fs.writeFileSync(path.join(release, `Novaris-Browser-${VERSION}-Linux.deb`), Buffer.from('linux package bytes'));
    // An older build left in release/ must not be listed: only this version is
    // being published.
    fs.writeFileSync(path.join(release, 'Novaris-Browser-0.0.1-Setup.exe'), Buffer.from('an old build'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const runWriter = () => run(path.join(dir, 'scripts', 'write-checksums.mjs'), ['--private-key', privateFile]);

  it('writes a file whose digests match the artifacts and whose signature verifies', () => {
    const { code, out } = runWriter();
    expect(code, out).toBe(0);
    expect(out).toContain('wrote and signed');
    expect(out).toContain('every recorded digest matches the file on disk');

    const text = fs.readFileSync(path.join(dir, 'release', 'checksums.txt'), 'utf8');
    expect(signing.verifyManifest(text, signing.readPublicKey(path.join(dir, 'assets', 'update-public-key.pem'))))
      .toMatchObject({ ok: true });
  });

  it('lists only this version, not older builds left in the directory', () => {
    runWriter();
    const text = fs.readFileSync(path.join(dir, 'release', 'checksums.txt'), 'utf8');
    expect(text).toContain(`Novaris-Browser-${VERSION}-Setup.exe`);
    expect(text).toContain(`Novaris-Browser-${VERSION}-Linux.deb`);
    expect(text).not.toContain('0.0.1');
  });

  it('records the real digest of each artifact', () => {
    runWriter();
    const text = fs.readFileSync(path.join(dir, 'release', 'checksums.txt'), 'utf8');
    const expected = crypto.createHash('sha256').update(Buffer.from('windows installer bytes')).digest('hex');
    expect(text).toContain(`${expected}  Novaris-Browser-${VERSION}-Setup.exe`);
  });

  it('signs only the platform that was actually built', () => {
    // Building one platform and not the other is the normal case, and a
    // checksums file naming a file that does not exist is worse than none.
    fs.rmSync(path.join(dir, 'release', `Novaris-Browser-${VERSION}-Linux.deb`));
    const { code, out } = runWriter();
    expect(code, out).toBe(0);
    const text = fs.readFileSync(path.join(dir, 'release', 'checksums.txt'), 'utf8');
    expect(text).toContain(`Novaris-Browser-${VERSION}-Setup.exe`);
    expect(text).not.toContain('Linux.deb');
  });

  it('does nothing when no artifact for this version has been built', () => {
    for (const name of [`Novaris-Browser-${VERSION}-Setup.exe`, `Novaris-Browser-${VERSION}-Linux.deb`]) {
      fs.rmSync(path.join(dir, 'release', name));
    }
    const { code, out } = runWriter();
    expect(code).toBe(0);
    expect(out).toContain('nothing to sign');
  });
});

describe('verifying a download', () => {
  let release = '';
  let checksums = '';
  let keyFile = '';
  let exeName = '';
  let debName = '';
  let payload = '';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaris-verify-'));
    release = path.join(dir, 'release');
    fs.mkdirSync(release, { recursive: true });

    const version = '9.9.9';
    exeName = `Novaris-Browser-${version}-Setup.exe`;
    debName = `Novaris-Browser-${version}-Linux.deb`;
    payload = Buffer.from('the bytes that were published');
    fs.writeFileSync(path.join(release, exeName), payload);
    fs.writeFileSync(path.join(release, debName), Buffer.from('deb bytes'));

    const generated = signing.generateKeyPair();
    const privateFile = path.join(dir, 'private.pem');
    fs.writeFileSync(privateFile, generated.privateKeyPem, 'utf8');
    keyFile = path.join(dir, 'public.pem');
    signing.writePublicKey(keyFile, generated.publicKeyPem);

    checksums = path.join(release, 'checksums.txt');
    const body = [
      '# Novaris Browser release checksums',
      `# version ${version}`,
      '',
      `${crypto.createHash('sha256').update(payload).digest('hex')}  ${exeName}`,
      '',
    ].join('\n');
    fs.writeFileSync(checksums, signing.signManifest(body, generated.privateKeyPem), 'utf8');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Options are built rather than appended, because a duplicated flag is
  // resolved to the first occurrence and the override would be ignored.
  const verify = (exe, { sum = checksums, key = keyFile } = {}) => run(verifyDownload, [
    exe, '--checksums', sum, '--public-key', key,
  ]);

  it('accepts a download that matches the published digest', () => {
    const { code, out } = verify(path.join(release, exeName));
    expect(code).toBe(0);
    expect(out).toContain('step 1  checksums signature is valid');
    expect(out).toContain('step 3  the file matches the published digest');
  });

  // The whole point. One flipped byte, same length, so nothing but the digest
  // can catch it.
  it('rejects a tampered download of the same size', () => {
    const tampered = path.join(dir, exeName);
    const bytes = Buffer.from(payload);
    bytes[3] ^= 0xff;
    fs.writeFileSync(tampered, bytes);
    const { code, out } = verify(tampered);
    expect(code).not.toBe(0);
    expect(out).toContain('does not match the digest that was published');
  });

  it('rejects a checksums file with no signature', () => {
    // An attacker who replaces the download can also replace the digests, so a
    // checksums file with no signature is exactly the attack this prevents.
    const unsigned = path.join(dir, 'unsigned.txt');
    fs.writeFileSync(unsigned, fs.readFileSync(checksums, 'utf8')
      .split('\n').filter((line) => !line.includes('novaris-signature')).join('\n'), 'utf8');
    const { code, out } = verify(path.join(release, exeName), { sum: unsigned });
    expect(code).not.toBe(0);
    expect(out).toContain('carries no signature');
  });

  it('rejects a checksums file signed by a different key', () => {
    const other = signing.generateKeyPair();
    const otherChecksums = path.join(dir, 'other.txt');
    const otherKey = path.join(dir, 'other.pem');
    fs.writeFileSync(otherChecksums, signing.signManifest(
      fs.readFileSync(checksums, 'utf8'), other.privateKeyPem,
    ), 'utf8');
    signing.writePublicKey(otherKey, other.publicKeyPem);
    // The real public key, which is the case that matters: the user has not been
    // given the attacker's key.
    const { code, out } = verify(path.join(release, exeName), { sum: otherChecksums });
    expect(code).not.toBe(0);
    expect(out).toMatch(/does not match the bundled public key/);
  });

  it('rejects a digest that was edited after signing', () => {
    const forged = path.join(dir, 'forged.txt');
    fs.writeFileSync(forged, fs.readFileSync(checksums, 'utf8')
      .replace(crypto.createHash('sha256').update(payload).digest('hex'), 'f'.repeat(64)), 'utf8');
    const { code, out } = verify(path.join(release, exeName), { sum: forged });
    expect(code).not.toBe(0);
    expect(out).toMatch(/does not match the bundled public key/);
  });

  it('refuses a file that is not part of this release', () => {
    const other = path.join(dir, 'something-else.exe');
    fs.writeFileSync(other, 'unrelated');
    const { code, out } = verify(other);
    expect(code).not.toBe(0);
    expect(out).toContain('is not listed in the checksums file');
  });

  it('refuses rather than guessing when the checksums file is missing', () => {
    const { code, out } = verify(path.join(release, exeName), { sum: path.join(dir, 'nope.txt') });
    expect(code).not.toBe(0);
    expect(out).toContain('no checksums file');
  });
});
