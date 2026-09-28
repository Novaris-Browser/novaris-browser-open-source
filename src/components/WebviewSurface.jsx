import { createElement, useEffect, useRef } from 'react';
import { NEW_TAB_URL, isInternalUrl } from '../lib/url';
import { shouldSuspendTab } from '../lib/gaming';

const WEBVIEW_EVENTS = [
  'did-attach',
  'did-start-loading',
  'did-stop-loading',
  'did-navigate',
  'did-navigate-in-page',
  'did-fail-load',
  'dom-ready',
  'page-title-updated',
  'page-favicon-updated',
  'new-window',
  'will-navigate',
  'found-in-page',
];

function currentUrl(view) {
  try {
    return typeof view?.getURL === 'function' ? view.getURL() : '';
  } catch {
    return '';
  }
}

export default function WebviewSurface({
  tab,
  active,
  onEvent,
  registerRef,
  developerTools,
  gamingMode,
  backgroundAudio = false,
  secondary = false,
}) {
  const localRef = useRef(null);
  const eventRef = useRef(onEvent);
  const suspended = shouldSuspendTab({ gamingMode, active, hasWebView: tab.hasWebView });
  const realUrl = tab.hasWebView && !isInternalUrl(tab.url)
    ? (tab.url === NEW_TAB_URL ? 'about:blank' : tab.url)
    : 'about:blank';
  // A suspended tab is unloaded rather than hidden. Hiding alone would leave the
  // page rendered and holding memory, which is the thing Gaming Mode exists to
  // avoid. The real URL stays in tab.url, so returning to the tab reloads it.
  const targetUrl = suspended ? 'about:blank' : realUrl;

  useEffect(() => {
    eventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const element = localRef.current;
    if (!element) return undefined;
    registerRef(tab.id, element);

    const listeners = WEBVIEW_EVENTS.map((type) => {
      const listener = (event) => eventRef.current(tab.id, type, event, element);
      element.addEventListener(type, listener);
      return { type, listener };
    });

    return () => {
      for (const { type, listener } of listeners) element.removeEventListener(type, listener);
      registerRef(tab.id, null);
    };
  }, [registerRef, tab.id]);

  useEffect(() => {
    const element = localRef.current;
    if (!element || !tab.hasWebView) return;
    const existing = currentUrl(element);
    if (existing !== targetUrl && typeof element.loadURL === 'function') {
      try { element.loadURL(targetUrl); } catch { /* The webview will retry when it attaches. */ }
    }
  }, [tab.hasWebView, targetUrl]);

  // Background audio. A tab that is not on screen keeps playing when the user
  // has asked for that, because following a recipe or a call while reading
  // something else is the normal case, not an edge case. Gaming Mode still
  // silences everything unconditionally, since a suspended page making noise at
  // nobody is exactly what it is for. A suspended tab is silent either way.
  useEffect(() => {
    const element = localRef.current;
    if (!element || typeof element.setAudioMuted !== 'function') return;
    const silent = gamingMode === true || suspended || !(active || backgroundAudio);
    try {
      element.setAudioMuted(silent);
    } catch { /* Muting is best effort. */ }
  }, [active, backgroundAudio, gamingMode, suspended, secondary]);

  // Chromium throttles timers in a webview it cannot see, and a throttled guest
  // stops producing audio. When the user has asked for background audio the
  // guest must stay unthrottled or the setting silently does nothing, so the
  // preference follows it. Novaris does its own suspension for Gaming Mode.
  const webPreferences = [
    'contextIsolation=yes',
    'nodeIntegration=no',
    'sandbox=yes',
    'webSecurity=yes',
    `backgroundThrottling=${backgroundAudio ? 'no' : 'yes'}`,
  ].join(', ');

  return createElement('webview', {
    ref: localRef,
    src: targetUrl,
    partition: 'persist:novaris',
    webpreferences: webPreferences,
    allowpopups: 'false',
    className: `webview-surface${active ? ' is-active' : ' is-hidden'}${suspended ? ' is-suspended' : ''}`,
    'aria-hidden': active ? 'false' : 'true',
    'data-suspended': suspended ? 'true' : 'false',
    'data-developer-tools': developerTools ? 'enabled' : 'disabled',
  });
}
