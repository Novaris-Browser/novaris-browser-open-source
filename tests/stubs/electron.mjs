// Stands in for the `electron` module during tests. Only the pieces the main
// process touches are implemented, with behaviour that matches the real API.
import { Buffer } from 'node:buffer';

const OBFUSCATION = 0x5a;
const ENC_PREFIX = 'enc:';

let encryptionAvailable = true;
// Linux only. Electron returns the keyring actually in use, and 'basic_text' is
// the one that encrypts with a hardcoded password published in Chromium's
// source. The default here is a real keyring so existing tests are unaffected.
let storageBackend = 'gnome_libsecret';

export const safeStorage = {
  isEncryptionAvailable: () => encryptionAvailable,
  setEncryptionAvailable: (value) => { encryptionAvailable = Boolean(value); },
  getSelectedStorageBackend: () => storageBackend,
  setStorageBackend: (value) => { storageBackend = String(value); },
  encryptString(value) {
    if (!encryptionAvailable) throw new Error('Encryption is not available.');
    const bytes = Buffer.from(String(value), 'utf8');
    const body = Buffer.alloc(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) body[i] = bytes[i] ^ OBFUSCATION;
    return Buffer.concat([Buffer.from(ENC_PREFIX, 'utf8'), body]);
  },
  decryptString(value) {
    const body = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'binary');
    const start = body.indexOf(ENC_PREFIX);
    if (start === -1) throw new Error('Not an encrypted value.');
    const payload = body.subarray(start + ENC_PREFIX.length);
    const plain = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i += 1) plain[i] = payload[i] ^ OBFUSCATION;
    return plain.toString('utf8');
  },
};

export const app = {
  getPath: () => '.',
  getVersion: () => '0.0.0-test',
  isPackaged: false,
  on: () => {},
  whenReady: () => Promise.resolve(),
};

export const ipcMain = { handle: () => {} };
export const shell = { openExternal: async () => {} };
export const clipboard = { writeText: () => {} };
export const session = { fromPartition: () => ({}) };
export const BrowserWindow = class { static fromWebContents() { return null; } static getAllWindows() { return []; } };
export const dialog = {};
export const webContents = { fromId: () => null };
export const Menu = { buildFromTemplate: () => ({ popup: () => {} }), setApplicationMenu: () => {} };

export default { safeStorage, app, ipcMain, shell, clipboard, session, BrowserWindow, dialog, webContents, Menu };
