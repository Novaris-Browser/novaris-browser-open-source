// Adds the release notes to the generated update manifests.
//
// electron-builder has no supported way to put release notes into the generic
// provider's manifest, but electron-updater displays a "releaseNotes" field from
// it. Injecting the field after the build is deterministic and does not touch the
// version, file name, size, or SHA-512, so the integrity check that guards the
// download is unaffected.
//
// electron-updater reads a different manifest per platform: latest.yml on
// Windows, latest-linux.yml on Linux. Each one that exists gets the same notes,
// because a user on either platform should read the same explanation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');
const notesPath = path.join(root, 'RELEASE_NOTES.md');

if (!fs.existsSync(notesPath)) {
  console.log('release notes: skipped, RELEASE_NOTES.md not found');
  process.exit(0);
}

const notes = fs.readFileSync(notesPath, 'utf8').replace(/\r\n/g, '\n').trimEnd();

if (!notes) {
  console.log('release notes: skipped, RELEASE_NOTES.md is empty');
  process.exit(0);
}

if (!fs.existsSync(releaseDir)) {
  console.log('release notes: skipped, release directory not found (run a build first)');
  process.exit(0);
}

const manifests = ['latest.yml', 'latest-linux.yml'].filter((name) => fs.existsSync(path.join(releaseDir, name)));

if (!manifests.length) {
  console.log('release notes: skipped, no latest.yml or latest-linux.yml found (run a build first)');
  process.exit(0);
}

// A literal block scalar keeps the text readable and avoids YAML quoting issues
// with colons, hashes, and blank lines.
const body = notes.split('\n').map((line) => (line ? `  ${line}` : '')).join('\n');

for (const name of manifests) {
  const target = path.join(releaseDir, name);
  const manifest = fs.readFileSync(target, 'utf8');
  if (/^releaseNotes:/m.test(manifest)) {
    console.log(`release notes: ${name} already has them, leaving it untouched`);
    continue;
  }
  fs.writeFileSync(target, `${manifest.replace(/\s*$/, '')}\nreleaseNotes: |-\n${body}\n`, 'utf8');
  console.log(`release notes: added ${notes.split('\n').length} lines to ${name}`);
}
