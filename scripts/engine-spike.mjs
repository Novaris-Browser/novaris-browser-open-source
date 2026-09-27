import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function commandVersion(command, args = ['--version']) {
  try {
    const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) return null;
    return String(result.stdout || result.stderr || '').trim().split(/\r?\n/)[0];
  } catch {
    return null;
  }
}

function hasCefSdk(root) {
  if (!root) return { configured: false, usable: false, root: '' };
  const resolved = path.resolve(root);
  const candidates = [
    path.join(resolved, 'Release', 'libcef.dll'),
    path.join(resolved, 'Release', 'chrome_elf.dll'),
    path.join(resolved, 'libcef.dll'),
  ];
  return {
    configured: true,
    usable: candidates.every((candidate) => fs.existsSync(candidate)),
    root: resolved,
    checked: candidates,
  };
}

const cef = hasCefSdk(process.env.CEF_ROOT);
const report = {
  platform: process.platform,
  node: process.version,
  electron: process.versions.electron || null,
  tools: {
    git: commandVersion('git'),
    cmake: commandVersion('cmake'),
    ninja: commandVersion('ninja'),
    msbuild: commandVersion('msbuild', ['-version']),
    cl: commandVersion('cl'),
  },
  cef,
  readyForCefBuild: Boolean(cef.usable && commandVersion('cmake') && (commandVersion('msbuild', ['-version']) || commandVersion('cl'))),
  recommendation: 'Install a Windows C++ toolchain and a matching CEF SDK before attempting the CEF host. Keep using the current Electron build until the adapter passes the migration acceptance tests.',
};

console.log(JSON.stringify(report, null, 2));
