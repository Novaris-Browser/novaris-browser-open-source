// Writes the update channel into the bundle.
//
// electron-builder prunes the `build` section out of the packaged
// package.json, so the feed URL that electron-builder uses at build time is not
// readable by the running application. This generates a small file that is
// included in the bundle, keeping a single source of truth: package.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const publish = manifest.build?.publish || manifest.publish;

let feedUrl = '';
if (typeof publish === 'string') feedUrl = publish;
else feedUrl = publish?.url || publish?.generic?.url || '';

feedUrl = String(feedUrl).trim().replace(/\/+$/, '');

if (feedUrl && !/^https:\/\//i.test(feedUrl)) {
  throw new Error(`The update channel must be an https URL, got: ${feedUrl}`);
}

const target = path.join(root, 'assets', 'update-channel.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify({
  version: manifest.version,
  feedUrl,
  provider: 'generic',
}, null, 2)}\n`);

console.log(`update channel: ${feedUrl || '(none configured)'}`);
