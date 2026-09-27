import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bookmark,
  Clock3,
  Download,
  Globe2,
  Info,
  KeyRound,
  Package,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { formatClock, formatDate, formatRelativeTime } from '../lib/format';
import { getFaviconFallback, getDomain, INTERNAL_PAGES } from '../lib/url';

function QuickSite({ item, onOpen }) {
  return (
    <button className="quick-site" type="button" onClick={() => onOpen(item.url)}>
      <span className="quick-site-icon">{getFaviconFallback(item.url)}</span>
      <span className="quick-site-copy">
        <strong>{item.title || getDomain(item.url)}</strong>
        <small>{getDomain(item.url)}</small>
      </span>
      <ArrowUpRight size={14} className="quick-site-arrow" />
    </button>
  );
}

export default function NewTabPage({ settings, bookmarks, history, onNavigate }) {
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const quickSites = useMemo(() => {
    const seen = new Set();
    const combined = [...bookmarks, ...history];
    return combined.filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    }).slice(0, 4);
  }, [bookmarks, history]);

  const recentSites = useMemo(() => {
    const seen = new Set();
    return history.filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    }).slice(0, 5);
  }, [history]);

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const submit = (event) => {
    event.preventDefault();
    if (query.trim()) onNavigate(query.trim());
  };

  return (
    <section className={`new-tab-page new-tab-canvas-${settings.newTabBackground}`} aria-label="New tab">
      <div className="new-tab-aurora aurora-one" />
      <div className="new-tab-aurora aurora-two" />
      <div className="new-tab-grid" />
      <div className="new-tab-content">
        <div className="new-tab-topline">
          <div className="new-tab-date-block">
            <span className="eyebrow">{greeting}</span>
            <h1>Make space for<br /><em>the next idea.</em></h1>
          </div>
          <div className="new-tab-clock" aria-label={`Current time ${formatClock(now)}`}>
            <strong>{formatClock(now)}</strong>
            <span>{formatDate(now)}</span>
          </div>
        </div>

        <form className="new-tab-search" onSubmit={submit}>
          <Search size={21} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the web or enter an address"
            aria-label="Search the web or enter an address"
            autoFocus
          />
          <span className="new-tab-search-shortcut">Ctrl L</span>
        </form>

        <div className="new-tab-section-heading">
          <div><Sparkles size={15} /><span>Quick access</span></div>
          <small>Your saved corners of the web</small>
        </div>

        {quickSites.length > 0 ? (
          <div className="quick-sites-grid">
            {quickSites.map((item) => <QuickSite key={item.id || item.url} item={item} onOpen={onNavigate} />)}
          </div>
        ) : (
          <div className="new-tab-empty-card">
            <Bookmark size={18} />
            <span>Bookmark a page to keep it close at hand.</span>
          </div>
        )}

        <div className="new-tab-internal-heading"><div><Sparkles size={14} /><span>Novaris pages</span></div><small>Local, fast, private</small></div>
        <div className="internal-shortcuts">
          {[
            { page: 'bookmarks', icon: Bookmark },
            { page: 'history', icon: Clock3 },
            { page: 'downloads', icon: Download },
            { page: 'passwords', icon: KeyRound },
            { page: 'extensions', icon: Package },
            { page: 'settings', icon: Settings2 },
            { page: 'about', icon: Info },
          ].map(({ page, icon: Icon }) => <button type="button" key={page} onClick={() => onNavigate(INTERNAL_PAGES[page].url)}><Icon size={14} /><span>{INTERNAL_PAGES[page].label}</span><ArrowUpRight size={12} /></button>)}
        </div>

        <div className="new-tab-lower-grid">
          <div className="new-tab-recent">
            <div className="new-tab-section-heading compact">
              <div><Clock3 size={14} /><span>Recent pages</span></div>
            </div>
            {recentSites.length > 0 ? recentSites.map((item) => (
              <button className="recent-row" type="button" key={`${item.id}-${item.visitedAt}`} onClick={() => onNavigate(item.url)}>
                <span className="recent-favicon">{getFaviconFallback(item.url)}</span>
                <span><strong>{item.title || getDomain(item.url)}</strong><small>{formatRelativeTime(item.visitedAt)}</small></span>
                <ArrowUpRight size={13} />
              </button>
            )) : <span className="new-tab-muted">Your browsing history will appear here.</span>}
          </div>
          <div className="new-tab-privacy-card">
            <div className="privacy-card-icon"><ShieldCheck size={18} /></div>
            <div><strong>Protected by design</strong><span>Web pages run in an isolated Chromium view with no Node.js access.</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}
