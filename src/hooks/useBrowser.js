import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SETTINGS } from '../lib/defaults';
import { SIDES, addPane, normalizeSplit, removePane, resizePanes, setActivePane } from '../../electron/split-view';
import {
  NEW_TAB_URL,
  INTERNAL_PAGES,
  internalPageFromUrl,
  isInternalUrl,
  isWebUrl,
  normalizeAddress,
} from '../lib/url';
import {
  deleteWorkspace as deleteWorkspaceState,
  moveTab,
  targetWorkspaceFor,
} from '../lib/tabs';

const api = typeof window !== 'undefined' ? window.novaris : null;

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeTab(seed = {}) {
  const url = seed.url || NEW_TAB_URL;
  const isNewTab = url === NEW_TAB_URL;
  const isInternalPage = isInternalUrl(url);
  return {
    id: seed.id || makeId(),
    url,
    title: seed.title || (isNewTab ? 'New Tab' : isInternalPage ? 'Novaris' : 'Loading…'),
    favicon: seed.favicon || null,
    isNewTab,
    isInternalPage,
    internalPage: internalPageFromUrl(url),
    hasWebView: seed.hasWebView ?? (!isNewTab && !isInternalPage),
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    zoom: seed.zoom || 1,
    pinned: Boolean(seed.pinned),
    groupId: seed.groupId || '',
    // Carried through makeTab so a restored tab keeps its place in a workspace
    // rather than falling out of the strip.
    workspaceId: seed.workspaceId || '',
    muted: Boolean(seed.muted),
  };
}

function safeViewCall(view, method, fallback) {
  try {
    if (view && typeof view[method] === 'function') return view[method]();
  } catch {
    return fallback;
  }
  return fallback;
}

function safeFavicon(value) {
  const favicon = Array.isArray(value) ? value[0] : value;
  if (typeof favicon !== 'string' || favicon.length > 1000) return null;
  if (/^https?:\/\//i.test(favicon) || /^data:image\//i.test(favicon)) return favicon;
  return null;
}

export function useBrowser() {
  const initialTab = useMemo(() => makeTab(), []);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [platform, setPlatform] = useState('unknown');
  const [version, setVersion] = useState('');
  const [engineCapabilities, setEngineCapabilities] = useState(null);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [bookmarks, setBookmarks] = useState([]);
  const [history, setHistory] = useState([]);
  const [readingList, setReadingList] = useState([]);
  const [downloads, setDownloads] = useState([]);
  const [storageOverview, setStorageOverview] = useState(null);
  const [sitePermissions, setSitePermissions] = useState({});
  const [extensions, setExtensions] = useState([]);
  const [adblock, setAdblock] = useState({ enabled: true, filters: [] });
  const [tabGroups, setTabGroups] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [sessionReady, setSessionReady] = useState(false);
  const [credentials, setCredentials] = useState([]);
  const [vaultStatus, setVaultStatus] = useState({ available: false, count: 0, error: 'Vault is starting.' });
  const [closedTabs, setClosedTabs] = useState([]);
  const [downloadDirectory, setDownloadDirectory] = useState('');
  const [tabs, setTabs] = useState(() => [initialTab]);
  const [activeTabId, setActiveTabId] = useState(initialTab.id);
  const [windowState, setWindowState] = useState({ maximized: false, fullScreen: false });
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResult, setFindResult] = useState({ active: 0, total: 0 });
  const [addressFocusToken, setAddressFocusToken] = useState(0);
  const [findFocusToken, setFindFocusToken] = useState(0);
  const [readerOpen, setReaderOpen] = useState(false);
  const [readerContent, setReaderContent] = useState(null);
  const [commandPaletteToken, setCommandPaletteToken] = useState(0);
  const [blockedSite, setBlockedSite] = useState(null);
  // A side-by-side view, shaped like Zen's: up to four panes, each with its own
  // width, any of which can be focused or taken out. Null when none is open.
  const [split, setSplit] = useState(null);

  /** Opens or changes the split. `next` is the value split-view.js produced. */
  const applySplit = useCallback((produce) => {
    setSplit((current) => {
      const next = produce(current);
      if (next && next.rejected) return current;
      return next || null;
    });
  }, []);

  const openSplit = useCallback((tabId) => {
    applySplit((current) => addPane(current, tabId, { atIndex: 0, side: SIDES.right }));
  }, [applySplit]);

  /**
   * Drops a tab into the pane at `index`, on the given side of it. When there is
   * no split yet the page currently on screen becomes the first pane, because
   * dropping something "beside this page" has to leave this page where it is. A
   * split of one pane would render nothing at all and the user would be left
   * staring at an empty area.
   */
  const addTabToSplit = useCallback((tabId, index, side) => {
    if (tabId === activeTabId) return;
    applySplit((current) => {
      // The seed is one pane, so its single weight is a whole share. Giving it
      // half would make the first split lopsided.
      const seed = current && current.tabIds.length ? current : { tabIds: [activeTabId], weights: [1], activeIndex: 0 };
      if (!seed.tabIds.includes(activeTabId)) return seed;
      return addPane(seed, tabId, { atIndex: index, side });
    });
  }, [activeTabId, applySplit]);

  const removeFromSplit = useCallback((tabId) => {
    applySplit((current) => removePane(current, tabId));
  }, [applySplit]);

  const focusSplitPane = useCallback((index) => {
    applySplit((current) => setActivePane(current, index));
  }, [applySplit]);

  const resizeSplit = useCallback((dividerIndex, delta) => {
    applySplit((current) => resizePanes(current, dividerIndex, delta));
  }, [applySplit]);

  const closeSplit = useCallback(() => setSplit(null), []);

  // A split needs two panes to be one. One pane is just the page view again.
  const isSplitOpen = (split?.tabIds?.length || 0) >= 2;

  // Closing a tab that is in a pane, or turning it into a panel, has to take the
  // pane with it or the layout points at a page that is not there.
  useEffect(() => {
    if (!split) return;
    setSplit((current) => normalizeSplit(current, tabs));
  }, [tabs, split]);

  const [credentialThreat, setCredentialThreat] = useState(null);
  const [updateState, setUpdateState] = useState(null);
  const [updateSummary, setUpdateSummary] = useState(null);
  const [toast, setToast] = useState(null);

  const webviewRefs = useRef(new Map());
  const tabsRef = useRef(tabs);
  const settingsRef = useRef(settings);
  const activeTabIdRef = useRef(activeTabId);
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  const workspacesRef = useRef(workspaces);
  const lastHistoryVisit = useRef(new Map());
  const toastTimer = useRef(null);
  const sessionSaveTimer = useRef(null);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const dismissToast = useCallback(() => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  const notify = useCallback((message, tone = 'neutral') => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const updateTab = useCallback((id, patch) => {
    setTabs((current) => current.map((tab) => (
      tab.id === id ? { ...tab, ...patch } : tab
    )));
  }, []);

  const registerWebview = useCallback((id, element) => {
    if (element) webviewRefs.current.set(id, element);
    else webviewRefs.current.delete(id);
  }, []);

  const applyTabPerformance = useCallback((tabId, active) => {
    if (!api?.setTabPerformance) return;
    const view = webviewRefs.current.get(tabId);
    const webContentsId = safeViewCall(view, 'getWebContentsId', 0);
    if (Number.isInteger(webContentsId) && webContentsId > 0) {
      void api.setTabPerformance({ id: webContentsId, active });
    }
  }, []);

  useEffect(() => {
    tabs.forEach((tab) => applyTabPerformance(tab.id, tab.id === activeTabId));
  }, [activeTabId, applyTabPerformance, settings.backgroundThrottling, settings.performanceMode, settings.suspendBackgroundTabs, tabs]);

  const recordVisit = useCallback((url, title) => {
    if (!isWebUrl(url)) return;
    const previous = lastHistoryVisit.current.get(url) || 0;
    const now = Date.now();
    if (now - previous < 1200) return;
    lastHistoryVisit.current.set(url, now);
    if (!api) return;

    void api.recordHistory({ url, title: title || '' })
      .then((nextHistory) => {
        if (Array.isArray(nextHistory)) setHistory(nextHistory);
      })
      .catch(() => {
        // History persistence is best-effort and must never interrupt browsing.
      });
  }, []);

  const syncView = useCallback((tabId, view) => {
    if (!view) return;
    const current = tabsRef.current.find((tab) => tab.id === tabId);
    if (!current) return;

    const url = safeViewCall(view, 'getURL', current.url);
    const title = safeViewCall(view, 'getTitle', current.title);
    const canGoBack = Boolean(safeViewCall(view, 'canGoBack', false));
    const canGoForward = Boolean(safeViewCall(view, 'canGoForward', false));
    const zoom = Number(safeViewCall(view, 'getZoomFactor', current.zoom)) || current.zoom;

    if (isWebUrl(url)) {
      const patch = {
        url,
        title: title || new URL(url).hostname,
        isNewTab: false,
        isInternalPage: false,
        internalPage: null,
        hasWebView: true,
        canGoBack,
        canGoForward,
        zoom,
        error: null,
      };
      updateTab(tabId, patch);
      recordVisit(url, patch.title);
    } else if (current.isNewTab) {
      updateTab(tabId, { canGoBack, canGoForward, zoom, loading: false });
    }
  }, [recordVisit, updateTab]);

  // did-navigate fires when the navigation commits, which can be before the
  // sign-in form has been parsed, so the page is re-checked once the DOM has
  // had a moment to settle.
  const scanCredentialPage = useCallback((view) => {
    if (!api?.scanCredentialPage) return;
    const contentsId = safeViewCall(view, 'getWebContentsId', 0);
    if (!Number.isInteger(contentsId) || contentsId < 1) return;
    let cancelled = false;
    const attempt = (delay) => setTimeout(() => {
      if (cancelled) return;
      void api.scanCredentialPage(contentsId)
        .then((threat) => {
          if (cancelled) return;
          if (threat) setCredentialThreat(threat);
          else if (delay < 1600) attempt(delay + 900);
        })
        .catch(() => { /* The page may have navigated away already. */ });
    }, delay);
    attempt(700);
    return () => { cancelled = true; };
  }, [api]);

  const handleWebviewEvent = useCallback((tabId, type, event, view) => {
    if (type === 'did-attach') {
      applyTabPerformance(tabId, tabId === activeTabId);
      return;
    }

    if (type === 'did-start-loading') {
      updateTab(tabId, { loading: true, error: null });
      return;
    }

    if (type === 'did-stop-loading' || type === 'dom-ready') {
      syncView(tabId, view);
      if (type === 'did-stop-loading') updateTab(tabId, { loading: false });
      return;
    }

    if (type === 'page-title-updated') {
      const title = typeof event.title === 'string' ? event.title : '';
      if (title) updateTab(tabId, { title: title.slice(0, 240) });
      return;
    }

    if (type === 'page-favicon-updated') {
      updateTab(tabId, { favicon: safeFavicon(event.favicons) });
      return;
    }

    if (type === 'did-navigate' || type === 'did-navigate-in-page') {
      const url = event.url || safeViewCall(view, 'getURL', '');
      if (isWebUrl(url)) {
        const title = safeViewCall(view, 'getTitle', new URL(url).hostname);
        updateTab(tabId, {
          url,
          title: title || new URL(url).hostname,
          isNewTab: false,
          isInternalPage: false,
          internalPage: null,
          hasWebView: true,
          error: null,
        });
        recordVisit(url, title);
        if (type === 'did-navigate') scanCredentialPage(view);
      }
      return;
    }

    if (type === 'did-fail-load') {
      if (Number(event.errorCode) === -3) return;
      updateTab(tabId, {
        loading: false,
        error: event.errorDescription || 'The page could not be loaded.',
      });
      return;
    }

    if (type === 'new-window') {
      event.preventDefault?.();
      if (isWebUrl(event.url) && api) {
        void api.openExternal(event.url);
        notify('External link opened in your system browser.', 'info');
      }
      return;
    }

    if (type === 'will-navigate') {
      const url = event.url || '';
      if (url !== 'about:blank' && !isWebUrl(url)) event.preventDefault?.();
      return;
    }

    if (type === 'found-in-page') {
      const result = event.result || {};
      setFindResult({
        active: Number(result.activeMatchOrdinal) || 0,
        total: Number(result.matches) || 0,
      });
    }
  }, [activeTabId, applyTabPerformance, notify, recordVisit, scanCredentialPage, syncView, updateTab]);

  // The main process owns the unsafe-site list, so the renderer asks it rather
  // than keeping a second copy of the rules that could drift.
  const classifySiteUrl = useCallback(async (url) => {
    if (!api?.classifySite) return null;
    try {
      return (await api.classifySite(url)) || null;
    } catch {
      return null;
    }
  }, [api]);

  const navigate = useCallback(async (tabId, value) => {
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (!tab) return;

    let destination;
    try {
      destination = normalizeAddress(value, settingsRef.current.searchEngine, settingsRef.current.customSearchEngines);
    } catch (error) {
      notify(error.message || 'That address cannot be opened.', 'error');
      return;
    }

    // webContents.loadURL never emits will-navigate, so the unsafe-site check
    // has to run here before the guest is ever told to navigate.
    if (isWebUrl(destination)) {
      const threat = await classifySiteUrl(destination);
      if (threat) {
        setBlockedSite({ url: destination, ...threat });
        return;
      }
    }

    if (destination === NEW_TAB_URL) {
      updateTab(tabId, {
        url: NEW_TAB_URL,
        title: 'New Tab',
        isNewTab: true,
        isInternalPage: true,
        internalPage: 'newtab',
        loading: false,
        error: null,
      });
      const view = webviewRefs.current.get(tabId);
      if (view && typeof view.loadURL === 'function') {
        try { view.loadURL('about:blank'); } catch { /* The hidden view can be replaced later. */ }
      }
      return;
    }

    if (isInternalUrl(destination)) {
      const page = internalPageFromUrl(destination);
      updateTab(tabId, {
        url: destination,
        title: INTERNAL_PAGES[page]?.label || 'Novaris',
        isNewTab: false,
        isInternalPage: true,
        internalPage: page,
        loading: false,
        error: null,
      });
      const view = webviewRefs.current.get(tabId);
      if (view && typeof view.loadURL === 'function') {
        try { view.loadURL('about:blank'); } catch { /* The internal page is rendered by the shell. */ }
      }
      return;
    }

    updateTab(tabId, {
      url: destination,
      title: 'Loading…',
      isNewTab: false,
      isInternalPage: false,
      internalPage: null,
      hasWebView: true,
      loading: true,
      error: null,
    });

    const view = webviewRefs.current.get(tabId);
    if (view && typeof view.loadURL === 'function') {
      try { view.loadURL(destination); } catch { /* React will retry through the src attribute. */ }
    }
  }, [classifySiteUrl, notify, updateTab]);

  const navigateActive = useCallback((value) => navigate(activeTabId, value), [activeTabId, navigate]);

  const addTab = useCallback((seed = {}) => {
    // A tab opened straight to an unsafe URL must be stopped before the guest
    // webview is attached with that address, so the tab stays on the new tab page.
    const unsafeTarget = isWebUrl(seed.url) ? seed.url : '';
    if (unsafeTarget) {
      void classifySiteUrl(unsafeTarget).then((threat) => {
        if (threat) setBlockedSite({ url: unsafeTarget, ...threat });
      });
    }
    const tab = makeTab(unsafeTarget
      ? { ...seed, url: NEW_TAB_URL, title: 'New Tab', isNewTab: true, isInternalPage: true, internalPage: 'newtab', hasWebView: false }
      : seed);
    // A new tab lands in the workspace the user is currently looking at, unless
    // a specific one was asked for.
    const workspace = targetWorkspaceFor({
      workspaces: workspacesRef.current,
      activeWorkspaceId: activeWorkspaceIdRef.current,
      requested: seed.workspaceId,
    });
    tab.workspaceId = workspace;
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    return tab.id;
  }, [classifySiteUrl]);

  const activateTab = useCallback((id) => {
    if (tabsRef.current.some((tab) => tab.id === id)) setActiveTabId(id);
  }, []);

  const closeTab = useCallback((id) => {
    const tab = tabsRef.current.find((item) => item.id === id);
    if (!tab) return;

    if (isWebUrl(tab.url)) {
      setClosedTabs((current) => [
        { id: tab.id, title: tab.title, url: tab.url, closedAt: Date.now() },
        ...current.filter((item) => item.url !== tab.url),
      ].slice(0, 30));
      if (api) void api.addClosedTab({ url: tab.url, title: tab.title });
    }

    setTabs((current) => {
      if (current.length === 1) {
        const replacement = makeTab();
        setActiveTabId(replacement.id);
        return [replacement];
      }

      const closingIndex = current.findIndex((item) => item.id === id);
      const remaining = current.filter((item) => item.id !== id);
      if (id === activeTabId) {
        setActiveTabId(remaining[Math.min(closingIndex, remaining.length - 1)].id);
      } else if (!remaining.some((item) => item.id === activeTabId)) {
        setActiveTabId(remaining[0].id);
      }
      return remaining;
    });
  }, [activeTabId]);

  const reopenClosedTab = useCallback(async () => {
    if (!api) return;
    const closed = await api.consumeClosedTab();
    if (!closed) {
      notify('No recently closed tabs to reopen.', 'info');
      return;
    }
    setClosedTabs((current) => current.filter((item) => item.id !== closed.id));
    addTab({ url: closed.url, title: closed.title, hasWebView: true });
  }, [addTab, notify]);

  const reorderTabs = useCallback((draggedId, targetId) => {
    if (!draggedId || !targetId || draggedId === targetId) return;
    setTabs((current) => {
      const from = current.findIndex((tab) => tab.id === draggedId);
      const to = current.findIndex((tab) => tab.id === targetId);
      if (from === -1 || to === -1) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const goBack = useCallback(() => {
    const view = webviewRefs.current.get(activeTabId);
    if (view && typeof view.goBack === 'function') view.goBack();
  }, [activeTabId]);

  const goForward = useCallback(() => {
    const view = webviewRefs.current.get(activeTabId);
    if (view && typeof view.goForward === 'function') view.goForward();
  }, [activeTabId]);

  const reload = useCallback(() => {
    const view = webviewRefs.current.get(activeTabId);
    if (view && typeof view.reload === 'function') view.reload();
  }, [activeTabId]);

  const stop = useCallback(() => {
    const view = webviewRefs.current.get(activeTabId);
    if (view && typeof view.stop === 'function') view.stop();
  }, [activeTabId]);

  const goHome = useCallback(() => {
    const homepage = settingsRef.current.homepage;
    if (homepage) navigate(activeTabId, homepage);
  }, [activeTabId, navigate]);

  const setZoom = useCallback((value) => {
    const zoom = Math.min(2, Math.max(0.5, Number(value) || 1));
    const view = webviewRefs.current.get(activeTabId);
    if (view && typeof view.setZoomFactor === 'function') {
      try { view.setZoomFactor(zoom); } catch { /* The view may still be initializing. */ }
    }
    updateTab(activeTabId, { zoom });
  }, [activeTabId, updateTab]);

  const zoomIn = useCallback(() => setZoom((tabsRef.current.find((tab) => tab.id === activeTabId)?.zoom || 1) + 0.1), [activeTabId, setZoom]);
  const zoomOut = useCallback(() => setZoom((tabsRef.current.find((tab) => tab.id === activeTabId)?.zoom || 1) - 0.1), [activeTabId, setZoom]);
  const resetZoom = useCallback(() => setZoom(1), [setZoom]);

  const importBookmarks = useCallback(async () => {
    if (!api?.importBookmarks) return null;
    try {
      const result = await api.importBookmarks();
      if (!result) return null;
      setBookmarks(Array.isArray(result.bookmarks) ? result.bookmarks : []);
      notify(result.added ? `Imported ${result.added} bookmark${result.added === 1 ? '' : 's'}.` : 'No new bookmarks were found.', result.added ? 'success' : 'info');
      return result;
    } catch (error) {
      notify(error.message || 'Could not import bookmarks.', 'error');
      return null;
    }
  }, [notify]);

  const toggleBookmark = useCallback(async () => {
    const tab = tabsRef.current.find((item) => item.id === activeTabId);
    if (!tab || !isWebUrl(tab.url) || !api) return;
    try {
      const next = await api.toggleBookmark({ url: tab.url, title: tab.title });
      setBookmarks(Array.isArray(next) ? next : []);
      const saved = next.some((item) => item.url === tab.url);
      notify(saved ? 'Saved to bookmarks.' : 'Removed from bookmarks.', 'success');
    } catch {
      notify('Could not update bookmarks.', 'error');
    }
  }, [activeTabId, notify]);

  const togglePinnedTab = useCallback((id) => {
    setTabs((current) => {
      const tab = current.find((item) => item.id === id);
      if (!tab) return current;
      const updated = { ...tab, pinned: !tab.pinned };
      if (!tab.pinned) return [updated, ...current.filter((item) => item.id !== id)];
      return current.map((item) => item.id === id ? updated : item);
    });
  }, []);

  const assignTabToGroup = useCallback((id, groupId) => {
    updateTab(id, { groupId: groupId || '' });
  }, [updateTab]);

  const saveTabGroups = useCallback(async (groups) => {
    if (!api?.setTabGroups) return [];
    try {
      const next = await api.setTabGroups(groups);
      setTabGroups(Array.isArray(next) ? next : []);
      return next;
    } catch (error) {
      notify(error.message || 'Could not save that tab group.', 'error');
      return tabGroups;
    }
  }, [notify, tabGroups]);

  const saveWorkspaces = useCallback(async (list) => {
    if (!api?.setWorkspaces) return [];
    try {
      const next = await api.setWorkspaces(list);
      setWorkspaces(Array.isArray(next) ? next : []);
      return next;
    } catch (error) {
      notify(error.message || 'Could not save that workspace.', 'error');
      return workspaces;
    }
  }, [notify, workspaces]);

  const createTabGroup = useCallback(async (name, color = '#7c8cff', workspaceId = activeWorkspaceId) => {
    const group = { id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, color, workspaceId: workspaceId || '' };
    const next = await saveTabGroups([...tabGroups, group]);
    return next.find((item) => item.id === group.id) || group;
  }, [saveTabGroups, tabGroups, activeWorkspaceId]);

  const renameTabGroup = useCallback(async (id, patch = {}) => {
    const next = tabGroups.map((group) => group.id === id ? { ...group, ...patch } : group);
    return saveTabGroups(next);
  }, [saveTabGroups, tabGroups]);

  // Collapsing is a view state that has to survive a restart, so it is stored
  // with the group rather than kept only in the component.
  const toggleTabGroup = useCallback(async (id) => {
    const group = tabGroups.find((item) => item.id === id);
    if (!group) return tabGroups;
    return saveTabGroups(tabGroups.map((item) => (item.id === id ? { ...item, collapsed: !item.collapsed } : item)));
  }, [saveTabGroups, tabGroups]);

  const deleteTabGroup = useCallback(async (id) => {
    setTabs((current) => current.map((tab) => tab.groupId === id ? { ...tab, groupId: '' } : tab));
    return saveTabGroups(tabGroups.filter((group) => group.id !== id));
  }, [saveTabGroups, tabGroups]);

  // --- Workspaces ---------------------------------------------------------
  // A workspace is the top level container: it holds groups, and tabs sit in it
  // directly or inside one of its groups.

  const selectWorkspace = useCallback((workspaceId) => {
    setActiveWorkspaceId(workspaceId || '');
    // Landing on a workspace should land on a tab that is actually in it.
    const inWorkspace = tabsRef.current.filter((tab) => (tab.workspaceId || '') === (workspaceId || ''));
    if (inWorkspace.length && !inWorkspace.some((tab) => tab.id === activeTabIdRef.current)) {
      setActiveTabId(inWorkspace[0].id);
    }
  }, []);

  const createWorkspace = useCallback(async (name = 'Workspace') => {
    const workspace = { id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, color: '#7c8cff', createdAt: Date.now() };
    const next = await saveWorkspaces([...workspaces, workspace]);
    const saved = next.find((item) => item.id === workspace.id) || workspace;
    setActiveWorkspaceId(saved.id);
    return saved;
  }, [saveWorkspaces, workspaces]);

  const deleteWorkspaceById = useCallback(async (workspaceId) => {
    const result = deleteWorkspaceState({ workspaces, groups: tabGroups, tabs: tabsRef.current, workspaceId });
    setWorkspaces(result.workspaces);
    await saveWorkspaces(result.workspaces);
    await saveTabGroups(result.groups);
    setTabs(result.tabs);
    if (activeWorkspaceIdRef.current === workspaceId) setActiveWorkspaceId('');
    return result;
  }, [workspaces, tabGroups, saveWorkspaces, saveTabGroups]);

  const moveTabToWorkspace = useCallback(async (tabId, workspaceId) => {
    // Moving between workspaces clears the group, because the group belonged to
    // the workspace the tab just left and would otherwise not exist here.
    setTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, workspaceId: workspaceId || '', groupId: '' } : tab)));
  }, []);

  // --- Vertical strip actions --------------------------------------------

  const moveTabInStrip = useCallback(({ tabId, targetTabId, groupId }) => {
    setTabs((current) => moveTab(current, { tabId, targetTabId, groupId }));
  }, []);

  const duplicateTab = useCallback((tabId) => {
    const source = tabsRef.current.find((tab) => tab.id === tabId);
    if (!source) return null;
    return addTab({ url: source.url, title: source.title, groupId: source.groupId, workspaceId: source.workspaceId });
  }, [addTab]);

  const toggleTabMute = useCallback((tabId) => {
    setTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, muted: !tab.muted } : tab)));
  }, []);

  const setSitePermission = useCallback(async (origin, permission, value) => {
    if (!api?.setSitePermission) return sitePermissions;
    try {
      const next = await api.setSitePermission(origin, permission, value);
      setSitePermissions(next || {});
      return next || {};
    } catch (error) {
      notify(error.message || 'Could not update site permission.', 'error');
      return sitePermissions;
    }
  }, [notify, sitePermissions]);

  const resetSitePermission = useCallback(async (origin) => {
    if (!api?.resetSitePermission) return sitePermissions;
    try {
      const next = await api.resetSitePermission(origin);
      setSitePermissions(next || {});
      return next || {};
    } catch (error) {
      notify(error.message || 'Could not reset that site policy.', 'error');
      return sitePermissions;
    }
  }, [notify, sitePermissions]);

  const refreshStorage = useCallback(async () => {
    if (!api?.storageOverview) return null;
    try {
      const overview = await api.storageOverview();
      setStorageOverview(overview);
      return overview;
    } catch {
      return null;
    }
  }, []);

  const clearSiteStorage = useCallback(async (origin) => {
    if (!api?.clearSiteStorage) return null;
    try {
      const overview = await api.clearSiteStorage(origin);
      setStorageOverview(overview);
      notify('Site data cleared.', 'success');
      return overview;
    } catch (error) {
      notify(error.message || 'Could not clear that site.', 'error');
      return null;
    }
  }, [notify]);

  const removeBookmark = useCallback(async (id) => {
    if (!api) return;
    const next = await api.removeBookmark(id);
    setBookmarks(Array.isArray(next) ? next : []);
  }, []);

  const toggleReadingList = useCallback(async (item) => {
    if (!api || !item?.url || !isWebUrl(item.url)) return;
    try {
      const next = await api.toggleReadingList(item);
      setReadingList(Array.isArray(next) ? next : []);
      notify('Reading list updated.', 'success');
    } catch {
      notify('Could not update the reading list.', 'error');
    }
  }, [notify]);

  const clearHistory = useCallback(async () => {
    if (!api) return;
    const next = await api.clearHistory();
    setHistory(Array.isArray(next) ? next : []);
    notify('Browsing history cleared.', 'success');
  }, [notify]);

  const clearDownloads = useCallback(async () => {
    if (!api) return;
    const next = await api.clearDownloads();
    setDownloads(Array.isArray(next) ? next : []);
    notify('Download list cleared.', 'success');
  }, [notify]);

  const controlDownload = useCallback(async (action, id) => {
    if (!api?.[`${action}Download`]) return false;
    try {
      const result = await api[`${action}Download`](id);
      if (result) {
        const labels = { pause: 'paused', resume: 'resumed', cancel: 'cancelled', retry: 'queued for retry' };
        notify(`Download ${labels[action] || `${action} requested`}.`, 'success');
      }
      return result;
    } catch (error) {
      notify(error.message || `Could not ${action} that download.`, 'error');
      return false;
    }
  }, [notify]);

  const clearBrowsingData = useCallback(async (options) => {
    if (!api) return null;
    try {
      const result = await api.clearBrowsingData(options);
      if (result) {
        if (Array.isArray(result.history)) setHistory(result.history);
        if (Array.isArray(result.downloads)) setDownloads(result.downloads);
      }
      notify('Selected browsing data was cleared.', 'success');
      return result;
    } catch {
      notify('Some browsing data could not be cleared.', 'error');
      return null;
    }
  }, [notify]);

  const openDownload = useCallback(async (id) => {
    if (!api) return;
    const opened = await api.openDownload(id);
    if (!opened) notify('The downloaded file is no longer available.', 'error');
  }, [notify]);

  const showDownload = useCallback(async (id) => {
    if (!api) return;
    const shown = await api.showDownload(id);
    if (!shown) notify('The downloaded file is no longer available.', 'error');
  }, [notify]);

  const refreshEngineCapabilities = useCallback(async () => {
    if (!api?.engineCapabilities) return null;
    try {
      const capabilities = await api.engineCapabilities();
      setEngineCapabilities(capabilities);
      return capabilities;
    } catch {
      return null;
    }
  }, []);

  const updateSettings = useCallback(async (patch) => {
    if (!api) return null;
    try {
      const next = await api.updateSettings(patch);
      if (next) setSettings((current) => ({ ...current, ...next }));
      return next;
    } catch {
      notify('Could not save that setting.', 'error');
      return null;
    }
  }, [notify]);

  const chooseDownloadDirectory = useCallback(async () => {
    if (!api) return null;
    const next = await api.chooseDownloadDirectory();
    if (next) {
      setSettings((current) => ({ ...current, ...next }));
      setDownloadDirectory(next.downloadDirectory || '');
    }
    return next;
  }, []);

  const makeDefaultBrowser = useCallback(async () => {
    if (!api?.makeDefaultBrowser) return { supported: false, opened: false };
    try {
      return await api.makeDefaultBrowser();
    } catch {
      notify('Windows could not open Default Apps settings.', 'error');
      return { supported: true, opened: false };
    }
  }, [notify]);

  const refreshVault = useCallback(async () => {
    if (!api?.vaultStatus) return;
    try {
      const status = await api.vaultStatus();
      setVaultStatus(status || { available: false, count: 0 });
      if (status?.locked) {
        setCredentials([]);
        return;
      }
      const list = await api.vaultList();
      setCredentials(Array.isArray(list) ? list : []);
    } catch (error) {
      if (String(error?.message || '').includes('locked')) {
        setVaultStatus((current) => ({ ...current, available: true, locked: true, error: null }));
        setCredentials([]);
      } else {
        setVaultStatus({ available: false, count: 0, error: 'The encrypted vault is unavailable.', reason: 'The encrypted vault is unavailable.' });
      }
    }
  }, []);

  const refreshExtensions = useCallback(async () => {
    if (!api?.listExtensions) return;
    try {
      const next = await api.listExtensions();
      setExtensions(Array.isArray(next) ? next : []);
    } catch {
      setExtensions((current) => current);
    }
  }, []);

  const updateAdblock = useCallback(async (patch) => {
    if (!api?.updateAdblock) return null;
    try {
      const next = await api.updateAdblock(patch);
      setAdblock(next || { enabled: true, filters: [] });
      await refreshExtensions();
      return next;
    } catch (error) {
      notify(error.message || 'Could not update the ad blocker.', 'error');
      return null;
    }
  }, [notify, refreshExtensions]);

  const checkForUpdates = useCallback(async () => {
    if (!api?.checkForUpdates) return null;
    try {
      const next = await api.checkForUpdates();
      setUpdateState(next);
      if (next?.status === 'current') notify('Novaris is up to date.', 'success');
      if (next?.status === 'unconfigured' || next?.status === 'unavailable') notify(next.error || 'Updates are not available in this build.', 'info');
      return next;
    } catch (error) {
      notify(error.message || 'Could not check for updates.', 'error');
      return null;
    }
  }, [api, notify]);

  const downloadUpdate = useCallback(async () => {
    if (!api?.downloadUpdate) return null;
    try {
      const next = await api.downloadUpdate();
      setUpdateState(next);
      return next;
    } catch (error) {
      notify(error.message || 'Could not download the update.', 'error');
      return null;
    }
  }, [api]);

  const installUpdate = useCallback(async () => {
    if (!api?.installUpdate) return null;
    try {
      return await api.installUpdate();
    } catch (error) {
      notify(error.message || 'Could not install the update.', 'error');
      return null;
    }
  }, [api]);

  const dismissUpdatePrompt = useCallback(() => setUpdateState(null), []);

  // Full reset: the profile is wiped on the next launch, which is the only safe
  // moment while Chromium is holding the files open.
  const resetProfile = useCallback(async () => {
    if (!api?.resetProfile) return null;
    try {
      return await api.resetProfile('manual');
    } catch (error) {
      notify(error.message || 'Could not reset the browser.', 'error');
      return null;
    }
  }, [api, notify]);

  const continueAfterUpdate = useCallback(() => setUpdateSummary(null), []);

  const resetAdblockStats = useCallback(async () => {
    if (!api?.resetAdblockStats) return null;
    try {
      const next = await api.resetAdblockStats();
      setAdblock(next || { enabled: true, filters: [] });
      return next;
    } catch (error) {
      notify(error.message || 'Could not reset the ad blocker counter.', 'error');
      return null;
    }
  }, [notify]);

  const restoreBuiltinExtension = useCallback(async () => {
    if (!api?.restoreBuiltinExtension) return null;
    try {
      const extension = await api.restoreBuiltinExtension();
      await refreshExtensions();
      notify('Novaris Ad Blocker restored.', 'success');
      return extension;
    } catch (error) {
      notify(error.message || 'Could not restore the ad blocker.', 'error');
      return null;
    }
  }, [notify, refreshExtensions]);

  const chooseExtension = useCallback(async () => {
    if (!api?.chooseExtension) return null;
    try {
      const extension = await api.chooseExtension();
      if (extension) {
        await refreshExtensions();
        notify(`${extension.name} installed.`, 'success');
      }
      return extension;
    } catch (error) {
      notify(error.message || 'Could not load that extension.', 'error');
      return null;
    }
  }, [notify, refreshExtensions]);

  const openExtensionStore = useCallback(async (value) => {
    if (!api?.openExtensionStore) return null;
    try {
      const url = await api.openExtensionStore(value);
      notify('Chrome Web Store listing opened in your system browser.', 'info');
      return url;
    } catch (error) {
      notify(error.message || 'Enter a valid Chrome Web Store URL or extension ID.', 'error');
      return null;
    }
  }, [notify]);

  const importExtensionPackage = useCallback(async (storeUrl = '') => {
    if (!api?.importExtensionPackage) return null;
    try {
      const extension = await api.importExtensionPackage(storeUrl);
      if (extension) {
        await refreshExtensions();
        notify(`${extension.name} imported.`, 'success');
      }
      return extension;
    } catch (error) {
      notify(error.message || 'Could not import that extension package.', 'error');
      return null;
    }
  }, [notify, refreshExtensions]);

  const toggleExtension = useCallback(async (id, enabled) => {
    if (!api?.toggleExtension) return;
    try {
      await api.toggleExtension(id, enabled);
      await refreshExtensions();
    } catch (error) {
      notify(error.message || 'Could not update that extension.', 'error');
    }
  }, [notify, refreshExtensions]);

  const openExtensionAction = useCallback(async (id) => {
    if (!api?.openExtensionAction) return null;
    try {
      const result = await api.openExtensionAction(id);
      if (result?.opened) return result;
      notify('This extension does not provide a popup action.', 'info');
      return result;
    } catch (error) {
      notify(error.message || 'Could not open that extension action.', 'error');
      return null;
    }
  }, [notify]);

  const removeExtension = useCallback(async (id) => {
    if (!api?.removeExtension) return;
    try {
      await api.removeExtension(id);
      await refreshExtensions();
      notify('Extension removed.', 'success');
    } catch (error) {
      notify(error.message || 'Could not remove that extension.', 'error');
    }
  }, [notify, refreshExtensions]);

  const setupVaultMaster = useCallback(async (password) => {
    if (!api?.vaultSetupMaster) return null;
    try {
      const status = await api.vaultSetupMaster(password);
      setVaultStatus(status);
      await refreshVault();
      notify('Your vault password is ready.', 'success');
      return status;
    } catch (error) {
      notify(error.message || 'Could not set up your vault password.', 'error');
      return null;
    }
  }, [notify, refreshVault]);

  const changeVaultMaster = useCallback(async (currentPassword, newPassword) => {
    if (!api?.vaultChangeMaster) return null;
    try {
      const status = await api.vaultChangeMaster(currentPassword, newPassword);
      setVaultStatus(status);
      notify('Your vault password was changed.', 'success');
      return status;
    } catch (error) {
      notify(error.message || 'Could not change your vault password.', 'error');
      return null;
    }
  }, [notify]);

  const disableVaultMaster = useCallback(async (password) => {
    if (!api?.vaultDisableMaster) return null;
    try {
      const status = await api.vaultDisableMaster(password);
      setVaultStatus(status);
      notify('The vault lock was removed.', 'success');
      return status;
    } catch (error) {
      notify(error.message || 'Could not remove the vault lock.', 'error');
      return null;
    }
  }, [notify]);

  const setVaultMaster = useCallback(async (password) => {
    if (!api?.vaultSetMaster) return null;
    try {
      const status = await api.vaultSetMaster(password);
      setVaultStatus(status);
      setCredentials([]);
      notify('Master lock enabled. The vault is now locked.', 'success');
      return status;
    } catch (error) {
      notify(error.message || 'Could not enable the vault lock.', 'error');
      return null;
    }
  }, [notify]);

  const unlockVault = useCallback(async (password) => {
    if (!api?.vaultUnlock) return null;
    try {
      const status = await api.vaultUnlock(password);
      setVaultStatus(status);
      await refreshVault();
      return status;
    } catch (error) {
      notify(error.message || 'Incorrect master password.', 'error');
      return null;
    }
  }, [notify, refreshVault]);

  const lockVault = useCallback(async () => {
    if (!api?.vaultLock) return null;
    const status = await api.vaultLock();
    setVaultStatus(status);
    setCredentials([]);
    notify('Password vault locked.', 'success');
    return status;
  }, [notify]);

  const exportVault = useCallback(async () => {
    if (!api?.vaultExport) return null;
    try {
      const path = await api.vaultExport();
      if (path) notify('Encrypted vault exported.', 'success');
      return path;
    } catch (error) {
      notify(error.message || 'Could not export the vault.', 'error');
      return null;
    }
  }, [notify]);

  const importPasswordsCsv = useCallback(async () => {
    if (!api?.vaultImportCsv) return null;
    try {
      const result = await api.vaultImportCsv();
      if (result) {
        await refreshVault();
        notify(result.imported ? `Imported ${result.imported} password${result.imported === 1 ? '' : 's'}.` : 'No passwords were imported.', result.imported ? 'success' : 'info');
      }
      return result;
    } catch (error) {
      notify(error.message || 'Could not import passwords.', 'error');
      return null;
    }
  }, [notify, refreshVault]);

  const importVault = useCallback(async () => {
    if (!api?.vaultImport) return null;
    try {
      const status = await api.vaultImport();
      if (status) {
        setVaultStatus(status);
        await refreshVault();
        notify('Encrypted vault imported.', 'success');
      }
      return status;
    } catch (error) {
      notify(error.message || 'Could not import the vault.', 'error');
      return null;
    }
  }, [notify, refreshVault]);

  const saveCredential = useCallback(async (credential) => {
    if (!api?.vaultSave) return null;
    try {
      await api.vaultSave(credential);
      await refreshVault();
      notify('Login saved to the Windows-protected vault.', 'success');
      return true;
    } catch (error) {
      notify(error.message || 'Could not save this login.', 'error');
      return false;
    }
  }, [notify, refreshVault]);

  const removeCredential = useCallback(async (id) => {
    if (!api?.vaultRemove) return;
    try {
      await api.vaultRemove(id);
      await refreshVault();
      notify('Login removed from the vault.', 'success');
    } catch (error) {
      notify(error.message || 'Could not remove this login.', 'error');
    }
  }, [notify, refreshVault]);

  const copyCredentialSecret = useCallback(async (id, field) => {
    if (!api?.vaultCopySecret) return false;
    try {
      const copied = await api.vaultCopySecret(id, field);
      notify(copied ? 'Copied to the Windows clipboard.' : 'That value is empty.', copied ? 'success' : 'info');
      return copied;
    } catch (error) {
      notify(error.message || 'Could not copy that value.', 'error');
      return false;
    }
  }, [notify]);

  const fillCredential = useCallback(async (id) => {
    const view = webviewRefs.current.get(activeTabId);
    const webContentsId = safeViewCall(view, 'getWebContentsId', 0);
    if (!api?.vaultFill || !Number.isInteger(webContentsId) || webContentsId < 1) {
      notify('Open a website tab before filling a login.', 'info');
      return false;
    }
    try {
      const filled = await api.vaultFill(id, webContentsId);
      notify(filled ? 'Login filled on the page.' : 'No matching form was filled.', filled ? 'success' : 'info');
      return filled;
    } catch (error) {
      notify(error.message || 'Could not fill this login.', 'error');
      return false;
    }
  }, [activeTabId, notify]);

  const toggleReaderMode = useCallback(async () => {
    if (readerOpen) {
      setReaderOpen(false);
      return false;
    }
    const view = webviewRefs.current.get(activeTabId);
    const webContentsId = safeViewCall(view, 'getWebContentsId', 0);
    if (!api?.extractReader || !Number.isInteger(webContentsId) || webContentsId < 1) {
      notify('Reader mode is available on website tabs.', 'info');
      return false;
    }
    try {
      const content = await api.extractReader(webContentsId);
      if (!content?.text) {
        notify('No readable article text was found on this page.', 'info');
        return false;
      }
      setReaderContent(content);
      setReaderOpen(true);
      return true;
    } catch (error) {
      notify(error.message || 'Could not create reader view.', 'error');
      return false;
    }
  }, [activeTabId, notify, readerOpen]);

  const dismissBlockedSite = useCallback(() => setBlockedSite(null), []);

  const dismissCredentialThreat = useCallback(() => setCredentialThreat(null), []);

  const continueUnsafeSite = useCallback(async () => {
    if (!blockedSite?.url || !api?.allowUnsafeSite) return false;
    const allowed = await api.allowUnsafeSite(blockedSite.url);
    if (!allowed) return false;
    const url = blockedSite.url;
    setBlockedSite(null);
    navigateActive(url);
    return true;
  }, [api, blockedSite, navigateActive]);

  const closeReader = useCallback(() => {
    setReaderOpen(false);
    setReaderContent(null);
  }, []);

  useEffect(() => {
    if (readerOpen) {
      setReaderOpen(false);
      setReaderContent(null);
    }
  }, [activeTabId]);

  useEffect(() => {
    const currentUrl = tabsRef.current.find((tab) => tab.id === activeTabId)?.url;
    if (readerOpen && readerContent?.url && currentUrl !== readerContent.url) closeReader();
  }, [activeTabId, closeReader, readerContent?.url, readerOpen]);

  const findInPage = useCallback((text, mode = 'initial') => {
    const view = webviewRefs.current.get(activeTabId);
    if (!view || typeof view.findInPage !== 'function') return;
    if (!text.trim()) {
      view.stopFindInPage?.('clearSelection');
      setFindResult({ active: 0, total: 0 });
      return;
    }
    const findNext = mode === 'next' || mode === 'previous';
    const forward = mode !== 'previous';
    view.findInPage(text, { forward, findNext });
  }, [activeTabId]);

  const closeFind = useCallback(() => {
    const view = webviewRefs.current.get(activeTabId);
    view?.stopFindInPage?.('clearSelection');
    setFindOpen(false);
    setFindResult({ active: 0, total: 0 });
  }, [activeTabId]);

  const focusAddress = useCallback(() => setAddressFocusToken((value) => value + 1), []);
  const focusFind = useCallback(() => {
    setFindOpen(true);
    setFindFocusToken((value) => value + 1);
  }, []);

  const toggleFullscreen = useCallback(() => api?.toggleFullscreenWindow?.(), []);

  const openDeveloperTools = useCallback(() => {
    if (!settingsRef.current.developerTools) return;
    const view = webviewRefs.current.get(activeTabId);
    view?.openDevTools?.();
  }, [activeTabId]);

  const runShortcut = useCallback((action) => {
    switch (action) {
      case 'focus-address': focusAddress(); break;
      case 'new-tab': addTab(); break;
      case 'close-tab': closeTab(activeTabId); break;
      case 'reopen-tab': void reopenClosedTab(); break;
      case 'reload': reload(); break;
      case 'find': focusFind(); break;
      case 'bookmark': void toggleBookmark(); break;
      case 'zoom-in': zoomIn(); break;
      case 'zoom-out': zoomOut(); break;
      case 'zoom-reset': resetZoom(); break;
      case 'back': goBack(); break;
      case 'forward': goForward(); break;
      case 'developer-tools': openDeveloperTools(); break;
      case 'command-palette': setCommandPaletteToken((value) => value + 1); break;
      case 'clear-data': void clearBrowsingData({ cookies: true, cache: true, history: true }); break;
      default: break;
    }
  }, [
    activeTabId,
    addTab,
    clearBrowsingData,
    closeTab,
    focusAddress,
    focusFind,
    goBack,
    goForward,
    openDeveloperTools,
    reload,
    reopenClosedTab,
    resetZoom,
    toggleBookmark,
    zoomIn,
    zoomOut,
  ]);

  useEffect(() => {
    let mounted = true;
    if (!api) {
      setBooting(false);
      return undefined;
    }

    api.getBootstrap()
      .then((data) => {
        if (!mounted) return;
        const nextSettings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
        setSettings(nextSettings);
        setBookmarks(Array.isArray(data.bookmarks) ? data.bookmarks : []);
        setHistory(Array.isArray(data.history) ? data.history : []);
        setReadingList(Array.isArray(data.readingList) ? data.readingList : []);
        setDownloads(Array.isArray(data.downloads) ? data.downloads : []);
        setClosedTabs(Array.isArray(data.closedTabs) ? data.closedTabs : []);
        setSitePermissions(data.sitePermissions || {});
        setExtensions(Array.isArray(data.extensions) ? data.extensions : []);
        setAdblock(data.adblock || { enabled: true, filters: [] });
        setTabGroups(Array.isArray(data.tabGroups) ? data.tabGroups : []);
        setWorkspaces(Array.isArray(data.workspaces) ? data.workspaces : []);
        setActiveWorkspaceId(typeof data.session?.activeWorkspaceId === 'string' ? data.session.activeWorkspaceId : '');
        setDownloadDirectory(data.downloadDirectory || '');
        setVaultStatus(data.vault || { available: false, count: 0 });
        if (api.listExtensions) void refreshExtensions();
        if (api.storageOverview) void refreshStorage();
        if (api.vaultList) {
          void api.vaultList()
            .then((items) => setCredentials(Array.isArray(items) ? items : []))
            .catch(() => setCredentials([]));
        }
        setPlatform(data.platform || 'unknown');
        setVersion(data.version || '');
        setEngineCapabilities(data.engine || null);
        if (api.updateSummary) {
          void api.updateSummary()
            .then((summary) => { if (mounted && summary) setUpdateSummary(summary); })
            .catch(() => { /* No reset happened on this launch. */ });
        }

        const savedSession = data.session || {};
        if (nextSettings.restoreSession && Array.isArray(savedSession.tabs) && savedSession.tabs.length) {
          const restoredTabs = savedSession.tabs.map((tab) => makeTab(tab));
          const restoredActive = restoredTabs.some((tab) => tab.id === savedSession.activeTabId)
            ? savedSession.activeTabId
            : restoredTabs[0].id;
          setTabs(restoredTabs);
          setActiveTabId(restoredActive);
        } else if (nextSettings.startupBehavior === 'homepage' && isWebUrl(nextSettings.homepage)) {
          const homeTab = makeTab({ url: nextSettings.homepage, title: 'Home', hasWebView: true });
          setTabs([homeTab]);
          setActiveTabId(homeTab.id);
        }
        setSessionReady(true);
      })
      .catch(() => {
        if (mounted) setBootError('Some browser services could not be initialized.');
      })
      .finally(() => {
        if (mounted) setBooting(false);
      });

    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!sessionReady || !api?.saveSession) return undefined;
    if (sessionSaveTimer.current) window.clearTimeout(sessionSaveTimer.current);
    sessionSaveTimer.current = window.setTimeout(() => {
      const sessionTabs = tabs.map((tab) => ({
        id: tab.id,
        url: tab.url,
        title: tab.title,
        favicon: tab.favicon,
        pinned: tab.pinned,
        groupId: tab.groupId,
        workspaceId: tab.workspaceId,
        muted: tab.muted,
        zoom: tab.zoom,
      }));
      void api.saveSession({ tabs: sessionTabs, activeTabId, activeWorkspaceId, savedAt: Date.now() }).catch(() => {
        // Session persistence is best-effort and must not interrupt browsing.
      });
    }, 450);
    return () => {
      if (sessionSaveTimer.current) window.clearTimeout(sessionSaveTimer.current);
    };
  }, [activeTabId, activeWorkspaceId, api, sessionReady, tabs]);

  useEffect(() => {
    if (!api?.saveSession || !sessionReady) return undefined;
    const saveBeforeUnload = () => {
      void api.saveSession({
        tabs: tabs.map((tab) => ({ id: tab.id, url: tab.url, title: tab.title, favicon: tab.favicon, pinned: tab.pinned, groupId: tab.groupId, workspaceId: tab.workspaceId, muted: tab.muted, zoom: tab.zoom })),
        activeTabId,
        activeWorkspaceId,
        savedAt: Date.now(),
      }).catch(() => {
        // The last debounced snapshot remains the recovery point if this write fails.
      });
    };
    window.addEventListener('beforeunload', saveBeforeUnload);
    window.addEventListener('pagehide', saveBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', saveBeforeUnload);
      window.removeEventListener('pagehide', saveBeforeUnload);
    };
  }, [activeTabId, activeWorkspaceId, api, sessionReady, tabs]);

  useEffect(() => {
    if (!api) return undefined;
    const removeDownloads = api.onDownloadsChanged((nextDownloads) => {
      if (Array.isArray(nextDownloads)) setDownloads(nextDownloads);
    });
    const removeWindowState = api.onWindowStateChanged((nextState) => {
      if (nextState) setWindowState(nextState);
    });
    const removeProtocol = api.onProtocolUrl ? api.onProtocolUrl((url) => {
      if (isInternalUrl(url)) addTab({ url });
    }) : () => {};
    const removeOpenLink = api.onOpenLink ? api.onOpenLink((url) => {
      if (isWebUrl(url)) addTab({ url, title: 'Loading…', hasWebView: true });
    }) : () => {};
    const removeSiteBlocked = api.onSiteBlocked ? api.onSiteBlocked((site) => {
      if (site?.url) setBlockedSite(site);
    }) : () => {};
    const removeUpdateState = api.onUpdateState ? api.onUpdateState((next) => {
      if (next) setUpdateState(next);
    }) : () => {};
    const removeShortcut = api.onShortcut((action) => runShortcut(action));
    return () => {
      removeDownloads();
      removeWindowState();
      removeProtocol();
      removeOpenLink();
      removeSiteBlocked();
      removeUpdateState();
      removeShortcut();
    };
  }, [addTab, runShortcut]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const command = event.ctrlKey || event.metaKey;
      if (!command) {
        if (event.key === 'Escape' && findOpen) closeFind();
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'l' && !event.shiftKey) runShortcut('focus-address');
      else if (key === 't' && event.shiftKey) runShortcut('reopen-tab');
      else if (key === 't') runShortcut('new-tab');
      else if (key === 'w') runShortcut('close-tab');
      else if (key === 'r') runShortcut('reload');
      else if (key === 'f') runShortcut('find');
      else if (key === 'k' && event.shiftKey) runShortcut('command-palette');
      else if (key === 'd' && !event.shiftKey) runShortcut('bookmark');
      else if ((key === '=' || key === '+') && !event.shiftKey) runShortcut('zoom-in');
      else if (key === '-' && !event.shiftKey) runShortcut('zoom-out');
      else if (key === '0') runShortcut('zoom-reset');
      else return;
      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeFind, findOpen, runShortcut]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];
  const currentIsBookmarked = useMemo(
    () => Boolean(activeTab && isWebUrl(activeTab.url) && bookmarks.some((item) => item.url === activeTab.url)),
    [activeTab, bookmarks],
  );
  const currentIsReadingListed = useMemo(
    () => Boolean(activeTab && isWebUrl(activeTab.url) && readingList.some((item) => item.url === activeTab.url)),
    [activeTab, readingList],
  );

  return {
    api,
    booting,
    bootError,
    platform,
    version,
    engineCapabilities,
    refreshEngineCapabilities,
    settings,
    updateSettings,
    chooseDownloadDirectory,
    bookmarks,
    importBookmarks,
    toggleBookmark,
    removeBookmark,
    history,
    clearHistory,
    readingList,
    toggleReadingList,
    downloads,
    clearDownloads,
    controlDownload,
    openDownload,
    showDownload,
    sitePermissions,
    setSitePermission,
    resetSitePermission,
    storageOverview,
    refreshStorage,
    clearSiteStorage,
    extensions,
    adblock,
    updateAdblock,
    // Workspaces and vertical strip actions
    workspaces,
    activeWorkspaceId,
    selectWorkspace,
    createWorkspace,
    deleteWorkspaceById,
    moveTabToWorkspace,
    createTabGroup,
    // Side-by-side view
    split,
    isSplitOpen,
    openSplit,
    addTabToSplit,
    removeFromSplit,
    focusSplitPane,
    resizeSplit,
    closeSplit,
    renameTabGroup,
    deleteTabGroup,
    toggleTabGroup,
    assignTabToGroup,
    moveTabInStrip,
    duplicateTab,
    toggleTabMute,
    resetAdblockStats,
    restoreBuiltinExtension,
    refreshExtensions,
    chooseExtension,
    openExtensionStore,
    importExtensionPackage,
    toggleExtension,
    openExtensionAction,
    removeExtension,
    tabGroups,
    saveTabGroups,
    createTabGroup,
    renameTabGroup,
    deleteTabGroup,
    assignTabToGroup,
    togglePinnedTab,
    credentials,
    vaultStatus,
    refreshVault,
    setupVaultMaster,
    changeVaultMaster,
    disableVaultMaster,
    setVaultMaster,
    unlockVault,
    lockVault,
    exportVault,
    importVault,
    importPasswordsCsv,
    saveCredential,
    removeCredential,
    copyCredentialSecret,
    fillCredential,
    readerOpen,
    readerContent,
    commandPaletteToken,
    blockedSite,
    updateState,
    updateSummary,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    dismissUpdatePrompt,
    resetProfile,
    continueAfterUpdate,
    dismissBlockedSite,
    credentialThreat,
    dismissCredentialThreat,
    continueUnsafeSite,
    toggleReaderMode,
    closeReader,
    makeDefaultBrowser,
    closedTabs,
    tabs,
    activeTab,
    activeTabId,
    addTab,
    closeTab,
    reopenClosedTab,
    reorderTabs,
    activateTab,
    navigate,
    navigateActive,
    goBack,
    goForward,
    reload,
    stop,
    goHome,
    zoom: activeTab?.zoom || 1,
    zoomIn,
    zoomOut,
    resetZoom,
    currentIsBookmarked,
    currentIsReadingListed,
    webviewRefs,
    registerWebview,
    handleWebviewEvent,
    findOpen,
    setFindOpen,
    findQuery,
    setFindQuery,
    findResult,
    findInPage,
    closeFind,
    focusFind,
    focusAddress,
    findFocusToken,
    addressFocusToken,
    windowState,
    toggleFullscreen,
    notify,
    dismissToast,
    toast,
  };
}
