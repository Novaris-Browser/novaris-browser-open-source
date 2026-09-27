import {
  ArrowUpRight,
  Bookmark,
  Clock3,
  Download,
  FileText,
  KeyRound,
  Package,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { INTERNAL_PAGES, getDomain } from '../lib/url';

function PageHeader({ page }) {
  const config = INTERNAL_PAGES[page] || INTERNAL_PAGES.about;
  const Icon = page === 'bookmarks' ? Bookmark : page === 'history' ? Clock3 : page === 'downloads' ? Download : page === 'passwords' ? KeyRound : page === 'extensions' ? Package : page === 'settings' ? Settings2 : page === 'reading-list' ? FileText : Sparkles;
  return <div className="internal-page-header"><div className="internal-page-icon"><Icon size={22} /></div><div><span className="eyebrow">Novaris page</span><h1>{config.label}</h1><p>{config.description}</p></div></div>;
}

function ItemList({ items, onOpen, empty }) {
  if (!items.length) return <div className="internal-empty">{empty}</div>;
  return <div className="internal-item-list">{items.map((item) => <button className="internal-item" type="button" key={item.id || item.url} onClick={() => onOpen(item.url)}><span className="internal-item-mark">{String(item.title || getDomain(item.url) || '•').slice(0, 1).toUpperCase()}</span><span><strong>{item.title || getDomain(item.url)}</strong><small>{item.url}</small></span><ArrowUpRight size={14} /></button>)}</div>;
}

export default function InternalPage({ page, bookmarks, history, readingList, downloads, credentials, extensions = [], vaultStatus, onOpenUrl, onOpenSettings, onOpenPasswords, onOpenExtensions }) {
  const config = INTERNAL_PAGES[page] || INTERNAL_PAGES.about;
  if (page === 'newtab') return null;
  if (page === 'settings') return <section className="internal-page"><PageHeader page={page} /><div className="internal-action-card"><Settings2 size={20} /><div><strong>Open Novaris Settings</strong><span>Startup, search, privacy, performance, downloads, and vault controls.</span></div><button className="primary-button" type="button" onClick={onOpenSettings}>Open settings</button></div></section>;
  if (page === 'about') return <section className="internal-page"><PageHeader page={page} /><div className="internal-about-grid"><div className="internal-action-card"><ShieldCheck size={20} /><div><strong>Secure web engine</strong><span>Pages run in isolated Chromium webviews with no Node.js access.</span></div></div><div className="internal-action-card"><KeyRound size={20} /><div><strong>Local vault</strong><span>{vaultStatus?.available ? `${credentials.length} encrypted login${credentials.length === 1 ? '' : 's'} available.` : 'Windows encryption is unavailable.'}</span></div></div></div></section>;
  if (page === 'downloads') return <section className="internal-page"><PageHeader page={page} /><div className="internal-stat-grid"><div><strong>{downloads.length}</strong><span>Files in history</span></div><div><strong>{downloads.filter((item) => item.state === 'progressing' || item.state === 'paused').length}</strong><span>Active transfers</span></div></div><div className="internal-action-card"><Download size={20} /><div><strong>Download manager</strong><span>Open the sidebar shelf to open, show, or clear files.</span></div></div></section>;
  if (page === 'extensions') return <section className="internal-page"><PageHeader page={page} /><div className="internal-action-card"><Package size={20} /><div><strong>{extensions.length} installed extension{extensions.length === 1 ? '' : 's'}</strong><span>Manage trusted unpacked Chromium-compatible tools from the Extensions section in Settings.</span></div><button className="primary-button" type="button" onClick={onOpenExtensions}>Manage extensions</button></div></section>;
  if (page === 'passwords') return <section className="internal-page"><PageHeader page={page} /><div className="internal-action-card"><KeyRound size={20} /><div><strong>{credentials.length} saved {credentials.length === 1 ? 'login' : 'logins'}</strong><span>{vaultStatus?.available ? 'Encrypted by Windows and stored only on this device.' : 'Windows encryption is unavailable.'}</span></div><button className="primary-button" type="button" onClick={onOpenPasswords} disabled={!vaultStatus?.available}>Open vault</button></div></section>;

  const items = page === 'bookmarks' ? bookmarks : page === 'history' ? history : readingList;
  const empty = page === 'bookmarks' ? 'No bookmarks saved yet.' : page === 'history' ? 'No browsing history yet.' : 'Your reading list is empty.';
  return <section className="internal-page"><PageHeader page={page} /><ItemList items={items} onOpen={onOpenUrl} empty={empty} /></section>;
}
