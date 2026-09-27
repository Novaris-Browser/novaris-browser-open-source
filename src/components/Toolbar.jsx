import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  BookMarked,
  Download,
  Globe2,
  Home,
  KeyRound,
  LockKeyhole,
  Menu,
  MoreVertical,
  PanelLeft,
  RotateCw,
  Search,
  Settings2,
  Star,
  X,
} from 'lucide-react';
import { NEW_TAB_URL, displayUrl, isSecureUrl } from '../lib/url';
import TrustCard from './TrustCard';

export default function Toolbar({
  activeTab,
  currentIsBookmarked,
  currentIsReadingListed,
  readerOpen,
  addressFocusToken,
  downloadCount,
  onBack,
  onForward,
  onReload,
  onStop,
  onHome,
  onNavigate,
  onToggleBookmark,
  onToggleReadingList,
  onToggleReader,
  onOpenPasswords,
  onOpenSidebar,
  onOpenSettings,
  onOpenMenu,
  suggestions = [],
}) {
  const [value, setValue] = useState(displayUrl(activeTab?.url));
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);
  const isNewTab = !activeTab || activeTab.url === NEW_TAB_URL || activeTab.isInternalPage;
  const secure = isSecureUrl(activeTab?.url);
  const suggestionItems = suggestions
    .filter((item) => {
      const query = value.trim().toLowerCase();
      if (!query) return true;
      return `${item.title || ''} ${item.url || ''}`.toLowerCase().includes(query);
    })
    .slice(0, 8);

  useEffect(() => {
    if (!editing) setValue(displayUrl(activeTab?.url));
  }, [activeTab?.url, editing]);

  useEffect(() => {
    if (addressFocusToken > 0 && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [addressFocusToken]);

  const submit = (event) => {
    event.preventDefault();
    const nextValue = value.trim();
    if (!nextValue) return;
    onNavigate(nextValue);
    setEditing(false);
    inputRef.current?.blur();
  };

  return (
    <div className="toolbar">
      <div className="toolbar-navigation">
        <button className="icon-button" type="button" onClick={onBack} disabled={!activeTab?.canGoBack} aria-label="Go back" title="Back (Alt + ←)">
          <ArrowLeft size={17} />
        </button>
        <button className="icon-button" type="button" onClick={onForward} disabled={!activeTab?.canGoForward} aria-label="Go forward" title="Forward (Alt + →)">
          <ArrowRight size={17} />
        </button>
        <button className="icon-button" type="button" onClick={activeTab?.loading ? onStop : onReload} aria-label={activeTab?.loading ? 'Stop loading' : 'Reload page'} title={activeTab?.loading ? 'Stop' : 'Reload (Ctrl + R)'}>
          {activeTab?.loading ? <X size={17} /> : <RotateCw size={16} />}
        </button>
        <button className="icon-button home-button" type="button" onClick={onHome} aria-label="Go home" title="Home">
          <Home size={16} />
        </button>
      </div>

      <form className={`address-bar${editing ? ' is-editing' : ''}`} onSubmit={submit}>
        <div className="address-leading" aria-hidden="true">
          {secure ? <LockKeyhole size={14} /> : <Globe2 size={14} />}
        </div>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setValue(displayUrl(activeTab?.url));
              setEditing(false);
              event.currentTarget.blur();
            }
          }}
          placeholder="Search or enter website address"
          aria-label="Address and search bar"
          autoComplete="off"
          list="novaris-address-suggestions"
          spellCheck="false"
        />
        <datalist id="novaris-address-suggestions">
          {suggestionItems.map((item) => <option value={item.url} key={item.id || item.url}>{item.title || item.url}</option>)}
        </datalist>
        {value && editing && (
          <button className="address-clear" type="button" onClick={() => { setValue(''); inputRef.current?.focus(); }} aria-label="Clear address bar">
            <X size={14} />
          </button>
        )}
        <div className="address-hint" aria-hidden="true"><kbd>Ctrl</kbd><kbd>L</kbd></div>
      </form>

      <div className="toolbar-actions">
        <TrustCard activeUrl={activeTab?.url} isNewTab={isNewTab} isInternalPage={activeTab?.isInternalPage} />
        <button className={`icon-button star-button${currentIsBookmarked ? ' is-selected' : ''}`} type="button" onClick={onToggleBookmark} disabled={isNewTab} aria-label={currentIsBookmarked ? 'Remove bookmark' : 'Bookmark page'} title={currentIsBookmarked ? 'Remove bookmark (Ctrl + D)' : 'Bookmark page (Ctrl + D)'}>
          <Star size={17} fill={currentIsBookmarked ? 'currentColor' : 'none'} />
        </button>
        <button className={`icon-button reading-button${currentIsReadingListed ? ' is-selected' : ''}`} type="button" onClick={onToggleReadingList} disabled={isNewTab} aria-label={currentIsReadingListed ? 'Remove from reading list' : 'Add to reading list'} title="Reading list">
          <BookOpen size={16} />
        </button>
        <button className={`icon-button reader-button${readerOpen ? ' is-selected' : ''}`} type="button" onClick={onToggleReader} disabled={isNewTab || activeTab?.isInternalPage} aria-label={readerOpen ? 'Close reader mode' : 'Open reader mode'} title="Reader mode">
          <BookMarked size={16} />
        </button>
        <button className="icon-button password-button" type="button" onClick={onOpenPasswords} aria-label="Open saved passwords" title="Saved passwords">
          <KeyRound size={16} />
        </button>
        <button className="icon-button download-button" type="button" onClick={onOpenSidebar} aria-label="Open downloads" title="Downloads">
          <Download size={17} />
          {downloadCount > 0 && <span className="button-badge">{downloadCount > 9 ? '9+' : downloadCount}</span>}
        </button>
        <span className="toolbar-divider" aria-hidden="true" />
        <button className="icon-button" type="button" onClick={onOpenSidebar} aria-label="Toggle sidebar" title="Toggle sidebar">
          <PanelLeft size={17} />
        </button>
        <button className="icon-button" type="button" onClick={onOpenSettings} aria-label="Open settings" title="Settings">
          <Settings2 size={17} />
        </button>
        <button className="icon-button" type="button" onClick={onOpenMenu} aria-label="More browser actions" title="More actions">
          <MoreVertical size={17} />
        </button>
      </div>
    </div>
  );
}
