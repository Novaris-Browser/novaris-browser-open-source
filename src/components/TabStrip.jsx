import { Globe2, Pin, PinOff, Plus, X } from 'lucide-react';
import { getFaviconFallback } from '../lib/url';
import { useState } from 'react';

function TabFavicon({ tab }) {
  const [failed, setFailed] = useState(false);
  if (tab.favicon && !failed) {
    return <img className="tab-favicon" src={tab.favicon} alt="" onError={() => setFailed(true)} />;
  }
  return (
    <span className={`tab-favicon tab-favicon-fallback${tab.isNewTab ? ' is-spark' : ''}`} aria-hidden="true">
      {tab.isNewTab ? <Globe2 size={13} /> : getFaviconFallback(tab.url)}
    </span>
  );
}

export default function TabStrip({ tabs, activeTabId, onActivate, onClose, onAdd, onReorder, onTogglePin, groups = [] }) {
  const [draggedId, setDraggedId] = useState(null);

  return (
    <nav className="tab-strip" aria-label="Browser tabs">
      <div className="tab-strip-inner">
        <div className="tabs-scroll" role="tablist">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <div
                className={`browser-tab${active ? ' is-active' : ''}${tab.loading ? ' is-loading' : ''}${tab.pinned ? ' is-pinned' : ''}`}
                style={tab.groupId ? { '--tab-group-color': groups.find((group) => group.id === tab.groupId)?.color || 'var(--accent)' } : undefined}
                key={tab.id}
                role="tab"
                aria-selected={active}
                tabIndex={0}
                draggable
                onClick={() => onActivate(tab.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onActivate(tab.id);
                  }
                }}
                onAuxClick={(event) => {
                  if (event.button === 1) onClose(tab.id);
                }}
                onDragStart={() => setDraggedId(tab.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  onReorder(draggedId, tab.id);
                  setDraggedId(null);
                }}
                onDragEnd={() => setDraggedId(null)}
              >
                <TabFavicon tab={tab} />
                <span className="tab-title">{tab.title || (tab.isNewTab ? 'New Tab' : 'Untitled')}</span>
                {tab.loading && <span className="tab-spinner" aria-label="Loading" />}
                <button className="tab-pin" type="button" onClick={(event) => { event.stopPropagation(); onTogglePin(tab.id); }} aria-label={tab.pinned ? `Unpin ${tab.title}` : `Pin ${tab.title}`} title={tab.pinned ? 'Unpin tab' : 'Pin tab'}>
                  {tab.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                </button>
                <button
                  className="tab-close"
                  type="button"
                  aria-label={`Close ${tab.title || 'tab'}`}
                  title="Close tab"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.id);
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
        <button className="new-tab-button" type="button" onClick={onAdd} aria-label="Open new tab" title="New tab (Ctrl + T)">
          <Plus size={17} />
        </button>
      </div>
    </nav>
  );
}
