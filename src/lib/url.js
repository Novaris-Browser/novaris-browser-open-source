export const NEW_TAB_URL = 'novaris://newtab';

export const INTERNAL_PAGES = Object.freeze({
  newtab: { url: NEW_TAB_URL, label: 'New Tab', description: 'A quiet starting point for the next idea.' },
  bookmarks: { url: 'novaris://bookmarks', label: 'Bookmarks', description: 'Pages you chose to keep close.' },
  history: { url: 'novaris://history', label: 'History', description: 'Pages visited on this device.' },
  downloads: { url: 'novaris://downloads', label: 'Downloads', description: 'Files saved by Novaris.' },
  'reading-list': { url: 'novaris://reading-list', label: 'Reading list', description: 'Pages saved for later.' },
  passwords: { url: 'novaris://passwords', label: 'Passwords', description: 'Your Windows-protected local vault.' },
  extensions: { url: 'novaris://extensions', label: 'Extensions', description: 'Manage trusted unpacked tools.' },
  settings: { url: 'novaris://settings', label: 'Settings', description: 'Make Novaris feel like yours.' },
  about: { url: 'novaris://about', label: 'About Novaris', description: 'A serious browser with a quiet surface.' },
});

export function internalPageFromUrl(value) {
  if (typeof value !== 'string') return null;
  return Object.entries(INTERNAL_PAGES).find(([, page]) => page.url === value)?.[0] || null;
}

export function isInternalUrl(value) {
  return Boolean(internalPageFromUrl(value));
}

export const SEARCH_ENGINES = Object.freeze({
  duckduckgo: {
    label: 'DuckDuckGo',
    searchUrl: 'https://duckduckgo.com/?q=',
  },
  google: {
    label: 'Google',
    searchUrl: 'https://www.google.com/search?q=',
  },
  bing: {
    label: 'Bing',
    searchUrl: 'https://www.bing.com/search?q=',
  },
  brave: {
    label: 'Brave Search',
    searchUrl: 'https://search.brave.com/search?q=',
  },
  startpage: {
    label: 'Startpage',
    searchUrl: 'https://www.startpage.com/sp/search?query=',
  },
  ecosia: {
    label: 'Ecosia',
    searchUrl: 'https://www.ecosia.org/search?q=',
  },
});

function parseHttpUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isWebUrl(value) {
  return Boolean(parseHttpUrl(value));
}

export function isLikelyHost(value) {
  const candidate = String(value || '').trim();
  if (!candidate || /\s/.test(candidate)) return false;
  if (/^localhost(?::\d+)?(?:[/?#].*)?$/i.test(candidate)) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#].*)?$/.test(candidate)) return true;
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(candidate);
}

export function normalizeAddress(value, searchEngine = 'duckduckgo', customSearchEngines = []) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Enter a website or search term.');
  const keywordEngine = customSearchEngines.find((engine) => engine.enabled !== false && engine.keyword && raw.toLowerCase().startsWith(`${engine.keyword.toLowerCase()} `));
  if (keywordEngine) {
    const query = raw.slice(keywordEngine.keyword.length).trim();
    return keywordEngine.url.replace('{query}', encodeURIComponent(query));
  }
  if (isInternalUrl(raw)) return raw;

  const hasExplicitScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
    || /^(?:javascript|data|file|about|mailto|ftp|novaris):/i.test(raw);
  if (hasExplicitScheme) {
    const direct = parseHttpUrl(raw);
    if (direct) return direct.toString();
    throw new Error('Only HTTP and HTTPS addresses are supported.');
  }

  if (isLikelyHost(raw)) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(raw);
    const candidate = `${local ? 'http' : 'https'}://${raw}`;
    const parsed = parseHttpUrl(candidate);
    if (parsed) return parsed.toString();
  }

  const customEngine = customSearchEngines.find((engine) => engine.id === searchEngine && engine.enabled !== false);
  if (customEngine) return customEngine.url.replace('{query}', encodeURIComponent(raw));

  const engine = SEARCH_ENGINES[searchEngine] || SEARCH_ENGINES.duckduckgo;
  return `${engine.searchUrl}${encodeURIComponent(raw)}`;
}

export function displayUrl(value) {
  if (!value || value === NEW_TAB_URL) return '';
  const parsed = parseHttpUrl(value);
  if (!parsed) return value;
  const withoutScheme = parsed.toString().replace(/^https?:\/\//i, '');
  return withoutScheme.length > 4 ? withoutScheme.replace(/\/$/, '') : withoutScheme;
}

export function getDomain(value) {
  const parsed = parseHttpUrl(value);
  return parsed ? parsed.hostname.replace(/^www\./i, '') : '';
}

export function getFaviconFallback(value) {
  const domain = getDomain(value);
  return domain ? domain[0].toUpperCase() : '•';
}

export function isSecureUrl(value) {
  const parsed = parseHttpUrl(value);
  return parsed?.protocol === 'https:';
}

export function searchEngineLabel(value) {
  return SEARCH_ENGINES[value]?.label || SEARCH_ENGINES.duckduckgo.label;
}
