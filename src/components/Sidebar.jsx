import {
  AlertCircle,
  BookOpen,
  Bookmark,
  CheckCircle2,
  ChevronRight,
  Clock3,
  DownloadCloud,
  ExternalLink,
  FolderOpen,
  Globe2,
  History,
  KeyRound,
  ListTodo,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { formatBytes, formatRelativeTime } from '../lib/format';
import { getFaviconFallback } from '../lib/url';
import PasswordVault from './PasswordVault';
import TabGroupsPanel from './TabGroupsPanel';

function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="sidebar-empty">
      <div className="empty-icon"><Icon size={18} /></div>
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function SidebarRow({ item, onOpen, action }) {
  return (
    <div className="sidebar-row">
      <button className="sidebar-row-main" type="button" onClick={() => onOpen(item.url)}>
        <span className="sidebar-row-icon">{getFaviconFallback(item.url)}</span>
        <span className="sidebar-row-copy">
          <strong>{item.title || item.url}</strong>
          <small>{item.url.replace(/^https?:\/\//i, '').replace(/\/$/, '')}</small>
        </span>
      </button>
      {action}
    </div>
  );
}

function DownloadRow({ item, onOpen, onShow, onControl }) {
  const total = Number(item.totalBytes) || 0;
  const received = Number(item.receivedBytes) || 0;
  const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : item.state === 'completed' ? 100 : 0;
  const complete = item.state === 'completed';
  const failed = item.state === 'cancelled' || item.state === 'interrupted';

  return (
    <div className="download-row">
      <button className="download-row-main" type="button" onClick={() => onOpen(item.id)} disabled={!complete}>
        <span className={`download-status ${failed ? 'is-failed' : ''}`}>
          {failed ? <AlertCircle size={15} /> : complete ? <CheckCircle2 size={15} /> : <DownloadCloud size={15} />}
        </span>
        <span className="download-row-copy">
          <strong>{item.filename || 'Download'}</strong>
          <small>{complete ? formatBytes(total || received) : failed ? 'Download stopped' : `${formatBytes(received)}${total ? ` of ${formatBytes(total)}` : ''}`}</small>
          {!complete && !failed && <span className="download-progress"><span style={{ width: `${percent}%` }} /></span>}
        </span>
      </button>
      <div className="download-actions">
        {item.state === 'progressing' && <button className="row-action" type="button" onClick={() => onControl('pause', item.id)} aria-label="Pause download" title="Pause"><Pause size={13} /></button>}
        {item.state === 'paused' && <button className="row-action" type="button" onClick={() => onControl('resume', item.id)} aria-label="Resume download" title="Resume"><Play size={13} /></button>}
        {(item.state === 'cancelled' || item.state === 'interrupted') && /^https?:\/\//i.test(item.url || '') && <button className="row-action" type="button" onClick={() => onControl('retry', item.id)} aria-label="Retry download" title="Retry"><RotateCcw size={13} /></button>}
        {(item.state === 'progressing' || item.state === 'paused') && <button className="row-action" type="button" onClick={() => onControl('cancel', item.id)} aria-label="Cancel download" title="Cancel"><X size={13} /></button>}
        <button className="row-action" type="button" onClick={() => onShow(item.id)} aria-label={`Show ${item.filename} in folder`} title="Show in folder"><FolderOpen size={14} /></button>
      </div>
    </div>
  );
}

export default function Sidebar({
  open,
  activeView,
  onViewChange,
  onClose,
  bookmarks,
  history,
  downloads,
  readingList,
  credentials = [],
  vaultStatus,
  activeUrl,
  onSaveCredential,
  onRemoveCredential,
  onCopyCredential,
  onFillCredential,
  onRefreshVault,
  tabs,
  activeTabId,
  onNavigate,
  onActivateTab,
  onRemoveBookmark,
  onToggleReading,
  onClearHistory,
  onClearDownloads,
  onOpenDownload,
  onShowDownload,
  onControlDownload,
  tabGroups = [],
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onAssignTabToGroup,
  onBookmarkCurrent,
}) {
  if (!open) return null;

  const navItems = [
    { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark, count: bookmarks.length },
    { id: 'history', label: 'History', icon: History, count: history.length },
    { id: 'downloads', label: 'Downloads', icon: DownloadCloud, count: downloads.length },
    { id: 'reading', label: 'Reading list', icon: ListTodo, count: readingList.length },
    { id: 'passwords', label: 'Passwords', icon: KeyRound, count: credentials.length },
    { id: 'tabs', label: 'Open tabs', icon: Globe2, count: tabs.length },
  ];

  return (
    <aside className="sidebar" aria-label="Browser sidebar">
      <div className="sidebar-header">
        <div>
          <span className="eyebrow">Workspace</span>
          <h2>Library</h2>
        </div>
        <button className="icon-button subtle" type="button" onClick={onClose} aria-label="Close sidebar" title="Close sidebar"><X size={16} /></button>
      </div>

      <nav className="sidebar-nav" aria-label="Library sections">
        {navItems.map(({ id, label, icon: Icon, count }) => (
          <button className={`sidebar-nav-item${activeView === id ? ' is-active' : ''}`} type="button" key={id} onClick={() => onViewChange(id)}>
            <Icon size={16} />
            <span>{label}</span>
            {count > 0 && <em>{count > 99 ? '99+' : count}</em>}
          </button>
        ))}
      </nav>

      <div className="sidebar-content">
        {activeView === 'bookmarks' && (
          <>
            <div className="sidebar-section-heading">
              <span>Saved pages</span>
              <button className="tiny-action" type="button" onClick={onBookmarkCurrent} title="Bookmark current page"><Plus size={14} /></button>
            </div>
            {bookmarks.length === 0 ? (
              <EmptyState icon={Star} title="No bookmarks yet" description="Save a page with the star icon or Ctrl + D." />
            ) : bookmarks.map((item) => (
              <SidebarRow
                key={item.id}
                item={item}
                onOpen={onNavigate}
                action={<button className="row-action" type="button" onClick={() => onRemoveBookmark(item.id)} aria-label={`Remove ${item.title} bookmark`} title="Remove bookmark"><Trash2 size={14} /></button>}
              />
            ))}
          </>
        )}

        {activeView === 'history' && (
          <>
            <div className="sidebar-section-heading">
              <span>Recent pages</span>
              {history.length > 0 && <button className="text-action" type="button" onClick={onClearHistory}>Clear</button>}
            </div>
            {history.length === 0 ? (
              <EmptyState icon={History} title="No history yet" description="Pages you visit will appear here." />
            ) : history.map((item) => (
              <SidebarRow key={`${item.id}-${item.visitedAt}`} item={{ ...item, title: `${item.title} · ${formatRelativeTime(item.visitedAt)}` }} onOpen={onNavigate} />
            ))}
          </>
        )}

        {activeView === 'downloads' && (
          <>
            <div className="sidebar-section-heading">
              <span>Recent downloads</span>
              {downloads.length > 0 && <button className="text-action" type="button" onClick={onClearDownloads}>Clear</button>}
            </div>
            {downloads.length === 0 ? (
              <EmptyState icon={DownloadCloud} title="No downloads" description="Files you download will appear here." />
            ) : downloads.map((item) => (
              <DownloadRow key={item.id} item={item} onOpen={onOpenDownload} onShow={onShowDownload} onControl={onControlDownload} />
            ))}
          </>
        )}

        {activeView === 'reading' && (
          <>
            <div className="sidebar-section-heading"><span>For later</span></div>
            {readingList.length === 0 ? (
              <EmptyState icon={BookOpen} title="Reading list is empty" description="Use the book icon in the toolbar to save a page." />
            ) : readingList.map((item) => (
              <SidebarRow
                key={item.id}
                item={item}
                onOpen={onNavigate}
                action={<button className="row-action" type="button" onClick={() => onToggleReading(item)} aria-label={`Remove ${item.title} from reading list`} title="Remove from reading list"><Trash2 size={14} /></button>}
              />
            ))}
          </>
        )}

        {activeView === 'passwords' && (
          <PasswordVault
            credentials={credentials}
            status={vaultStatus}
            activeUrl={activeUrl}
            onSave={onSaveCredential}
            onRemove={onRemoveCredential}
            onCopy={onCopyCredential}
            onFill={onFillCredential}
            onRefresh={onRefreshVault}
          />
        )}

        {activeView === 'tabs' && (
          <>
            <div className="sidebar-section-heading"><span>Open windows</span></div>
            <TabGroupsPanel groups={tabGroups} tabs={tabs} onCreateGroup={onCreateGroup} onRenameGroup={onRenameGroup} onDeleteGroup={onDeleteGroup} onAssignTabToGroup={onAssignTabToGroup} />
            <div className="sidebar-tabs-list">
              {tabs.map((tab) => (
                <button className={`sidebar-tab-row${tab.id === activeTabId ? ' is-active' : ''}`} type="button" key={tab.id} onClick={() => onActivateTab(tab.id)}>
                  <span className="sidebar-row-icon">{getFaviconFallback(tab.url)}</span>
                  <span className="sidebar-row-copy"><strong>{tab.title || 'Untitled'}</strong><small>{tab.isNewTab ? 'New Tab' : tab.url.replace(/^https?:\/\//i, '')}</small></span>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="sidebar-footer">
        <Clock3 size={13} />
        <span>Saved browser data stays on this device</span>
      </div>
    </aside>
  );
}
