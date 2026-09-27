// Adds the release notes to latest.yml.
//
// electron-builder has no supported way to put release notes into the generic
// provider's manifest, but electron-updater displays a "releaseNotes" field from
// it. Injecting the field after the build is deterministic and does not touch
// the version, file name, size, or SHA-512, so the integrity check that guards
// the download is unaffected.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'release', 'latest.yml');
const notesPath = path.join(root, 'RELEASE_NOTES.md');

if (!fs.existsSync(manifestPath)) {
  console.log('release notes: skipped, latest.yml not found (run dist:win first)');
  process.exit(0);
}

if (!fs.existsSync(notesPath)) {
  console.log('release notes: skipped, RELEASE_NOTES.md not found');
  process.exit(0);
}

const manifest = fs.readFileSync(manifestPath, 'utf8');
const notes = fs.readFileSync(notesPath, 'utf8').replace(/\r\n/g, '\n').trimEnd();

if (!notes) {
  console.log('release notes: skipped, RELEASE_NOTES.md is empty');
  process.exit(0);
}

if (/^releaseNotes:/m.test(manifest)) {
  console.log('release notes: already present, leaving latest.yml untouched');
  process.exit(0);
}

// A literal block scalar keeps the text readable and avoids YAML quoting issues
// with colons, hashes, and blank lines.
const body = notes.split('\n').map((line) => (line ? `  ${line}` : '')).join('\n');
const updated = `${manifest.replace(/\s*$/, '')}\nreleaseNotes: |-\n${body}\n`;

fs.writeFileSync(manifestPath, updated, 'utf8');
console.log(`release notes: added ${notes.split('\n').length} lines to latest.yml`);
