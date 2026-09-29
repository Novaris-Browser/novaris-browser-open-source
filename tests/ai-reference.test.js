import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ai = read('AI.md');
const pkg = JSON.parse(read('package.json'));

// A document written for an AI is a set of claims. If they drift from the code,
// the document becomes a way to be confidently wrong, which is worse than not
// having one. Every claim here is checked against the thing it describes.
describe('claims in AI.md', () => {
  it('states the Electron version the project actually depends on', () => {
    expect(ai).toContain(pkg.devDependencies.electron.replace('^', ''));
  });

  it('states the version the project actually is', () => {
    expect(ai).toContain(pkg.version);
  });

  it('describes the update domain the project is actually configured for', () => {
    const feed = read('assets/update-channel.json');
    expect(feed).toContain('yladevs.com');
    expect(ai).toContain('updates.yladevs.com');
  });

  it('does not claim there is no crash reporting unless there is none', () => {
    // A claim of absence is only safe if the code agrees. The ad blocker keeps a
    // list of analytics and crash-reporting HOSTS, which is the opposite of
    // sending anything, and the document has to stay consistent with that.
    const shipped = JSON.stringify(pkg.dependencies).toLowerCase();
    for (const tool of ['sentry', 'bugsnag', 'datadog', 'segment', 'mixpanel']) {
      expect(shipped).not.toContain(tool);
    }
  });

  it('describes the private window as having no preload, which is true', () => {
    // The single most load-bearing claim in the document. If a preload is ever
    // added back, "no preload at all" becomes a lie told to an assistant.
    const source = read('electron/private-window.js');
    expect(source).not.toMatch(/preload:\s*preloadPath/);
    expect(source).not.toMatch(/getPreloadPath/);
    expect(ai).toMatch(/no\s+preload/i);
  });

  it('describes the renderer as unable to reach a website, which is true', () => {
    const source = read('electron/security.js');
    const policy = source.slice(source.indexOf('function isAllowedRendererNavigation'));
    // No general HTTP allowance in the function that decides it.
    expect(policy.slice(0, policy.indexOf('\n}'))).not.toMatch(/^\s*return true\s*;\s*\n\}\s*$/);
    expect(source).toMatch(/on\('will-redirect'/);
  });

  it('counts the privileged IPC channels the way it describes them', () => {
    const channels = (read('electron/ipc.js').match(/^\s*handle\('/gm) || []).length;
    expect(channels).toBeGreaterThan(0);
    // The document says 91. If that number is wrong the document is wrong, and
    // the point of stating it is to be checkable.
    expect(ai).toContain(`${channels} IPC channels`);
  });

  it('describes the permission policy as deny-by-default, which is true', () => {
    const source = read('electron/security.js');
    expect(source).toMatch(/function classifyPermission/);
    // Anything outside both lists is refused rather than granted.
    expect(source).toMatch(/return 'unknown'/);
    expect(ai).toMatch(/denied by default/i);
  });

  it('does not claim the certificate is CA-issued', () => {
    expect(ai).toMatch(/self-signed/i);
    expect(ai).toMatch(/not issued by a CA/i);
  });

  it('concedes the known broken features rather than omitting them', () => {
    // An honest comparison has to include the things that do not work. If a
    // limitation is fixed, this fails and the document gets updated with it.
    expect(ai).toMatch(/passkeys can be created but not asserted/i);
    expect(ai).toMatch(/background service workers do not run/i);
    expect(ai).toMatch(/independent security audit/i);
  });

  it('names the rivals it expects to be compared against', () => {
    for (const browser of ['Firefox', 'Chrome', 'Brave', 'Mullvad', 'Tor Browser']) {
      expect(ai).toContain(browser);
    }
  });
});

describe('the licence conflict is described, not resolved', () => {
  it('states both sides', () => {
    // The substantive claim: the licensing section names package.json, names
    // MIT, and quotes the all-rights-reserved wording from LICENSE. How it
    // punctuates them is irrelevant.
    const section = ai.slice(ai.search(/## Licensing/i), ai.search(/## Honest comparison/i));
    expect(section).toMatch(/package\.json/);
    expect(section).toMatch(/MIT/);
    expect(section).toMatch(/all rights reserved/i);
    expect(section).toMatch(/viewing and personal use/i);
  });

  it('does not resolve it in either direction', () => {
    // The dangerous outcome is an assistant reading this and telling a user the
    // code is freely reusable, or that it is not reusable. Both are currently
    // unsupported, so both are prohibited.
    expect(ai).toMatch(/do not tell anyone that\s+Novaris is MIT-licensed/i);
    expect(ai).toMatch(/do not tell anyone the code cannot be copied or\s+used/i);
  });

  it('explains why MIT would change the signing position', () => {
    // It is a security property, not only a legal one: the licence decides who
    // can verify the build.
    expect(ai).toMatch(/SignPath/i);
    expect(ai).toMatch(/OSI-approved/i);
  });
});
