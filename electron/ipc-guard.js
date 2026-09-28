// Who is allowed to ask the main process to do something.
//
// Every privileged operation Novaris has lives in the main process: reading the
// vault, filling a password, importing a bookmark, moving a file, resetting the
// profile. The renderer is the only thing that may request them, and it is
// trusted because of where it came from, not because of what it says.
//
// Without a check like this, a script running in a webview could reach a
// privileged channel. The preload script is the intended path, and it is
// attached to the renderer only, but "the preload was the intended path" is not
// a security boundary on its own. The check below is.

/** WebContents types that may never call a privileged channel. */
const DENIED_TYPES = new Set(['webview', 'browserView', 'remote', 'webContents']);

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Is this a file:// URL inside the installed application?
 *
 * The renderer is loaded from disk, so the set of files that count as the
 * application is knowable. A file:// URL anywhere else on the machine is a
 * local HTML file someone opened, and must not inherit the privileges of the
 * browser's own interface.
 */
function isRendererFileUrl(value, appRoot) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { fileURLToPath } = require('node:url');
  try {
    const parsed = new URL(String(value));
    if (parsed.protocol !== 'file:') return false;
    if (!appRoot) return false;
    const filePath = path.resolve(fileURLToPath(parsed));
    const relative = path.relative(path.resolve(appRoot), filePath);
    // An empty relative path means the root itself, which is allowed.
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

/**
 * Decides whether an IPC message may be handled.
 *
 * Four things have to hold, and each closes a different hole:
 *   1. the sender is one of our own window contents, not a guest page
 *   2. the message came from the top frame, not from an iframe inside the UI
 *   3. the frame is running our own renderer, by URL
 *   4. a development server origin is allowed only in development
 *
 * Returns a reason string when it must be refused, or null when it may proceed.
 */
function validateIpcSender(event, { appRoot = '', devServerUrl = '' } = {}) {
  if (!event || !event.sender) {
    return 'The message had no sender.';
  }

  const sender = event.sender;

  // A webview guest is a hostile-by-default page. It has its own webContents
  // and must never be able to invoke a privileged channel directly.
  if (typeof sender.getType === 'function' && DENIED_TYPES.has(sender.getType())) {
    return `Pages of type "${sender.getType()}" may not call application channels.`;
  }

  const frame = event.senderFrame;
  if (!frame) {
    // Older Electron, or a message with no frame. There is no way to tell where
    // it came from, so it is refused rather than assumed safe.
    return 'The message did not identify a frame, so its origin is unknown.';
  }

  // An iframe inside our own interface is still a document we did not write.
  if (frame.parent) {
    return 'Messages from nested frames are not accepted.';
  }

  const url = String(frame.url || '');
  if (!url) {
    return 'The sender frame reported no URL.';
  }

  if (isRendererFileUrl(url, appRoot)) return null;

  if (devServerUrl) {
    try {
      const origin = new URL(devServerUrl).origin;
      if (url.startsWith(origin)) return null;
    } catch {
      // A malformed dev server value must not widen the rule.
    }
  }

  if (isHttpUrl(url)) {
    return 'Application channels may only be called by Novaris itself, not by a web page.';
  }

  return `Unexpected sender URL: ${url.slice(0, 120)}`;
}

/**
 * Wraps a listener so it only runs for a validated sender. The refusal is an
 * Error, so the renderer's promise rejects and the caller sees why rather than
 * getting undefined and assuming success.
 */
function guardIpcListener(listener, options) {
  return async (event, ...args) => {
    const reason = validateIpcSender(event, options);
    if (reason) {
      throw new Error(`Blocked: ${reason}`);
    }
    return listener(event, ...args);
  };
}

module.exports = {
  DENIED_TYPES,
  guardIpcListener,
  isRendererFileUrl,
  validateIpcSender,
};
