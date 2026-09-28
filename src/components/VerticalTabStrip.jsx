import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  Copy,
  FolderPlus,
  LayoutGrid,
  MoreVertical,
  Search,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { buildSearchRows, buildStripRows, workspaceTabCount } from '../lib/tabs';

function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Hover preview. Rendered once and positioned with fixed coordinates so it is
 * not clipped by the strip's overflow, and delayed so a cursor merely passing
 * over the list does not flash a card.
 */
function TabPreview({ tab, position }) {
  if (!tab) return null;
  return (
    <div className="tab-preview" style={{ top: position.top, left: position.left }} role="tooltip">
      <div className="tab-preview-head">
        {tab.favicon ? <img src={tab.favicon} alt="" className="tab-preview-favicon" /> : <LayoutGrid size={13} />}
        <strong>{tab.title || 'New Tab'}</strong>
      </div>
      <span className="tab-preview-host">{hostLabel(tab.url) || tab.url}</span>
      {tab.groupId ? <span className="tab-preview-tag">In a group</span> : null}
    </div>
  );
}

function TabRow({ tab, active, dragging, inSplit, onSelect, onClose, onDragStart, onDragOver, onDrop, onDragEnd, onHover, onLeave, onContextMenu }) {
  return (
    <div
      className={`vtab${active ? ' is-active' : ''}${dragging ? ' is-dragging' : ''}${inSplit ? ' is-in-split' : ''}${tab.pinned ? ' is-pinned' : ''}`}
      role="tab"
      aria-selected={active}
      draggable
      tabIndex={0}
      onClick={() => onSelect(tab.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(tab.id); }
      }}
      onDragStart={(event) => onDragStart(event, tab.id)}
      onDragOver={(event) => onDragOver(event, tab.id)}
      onDrop={(event) => onDrop(event, tab.id)}
      onDragEnd={onDragEnd}
      // onMouseOver rather than onMouseEnter: React synthesises mouseenter from a
      // mouseout/mouseover pair, which does not fire reliably for a pointer that
      // arrives without leaving somewhere else first. mouseover is a plain
      // bubbling event, so the card appears for a real hover.
      onMouseOver={(event) => onHover(event, tab)}
      onMouseOut={onLeave}
      onContextMenu={(event) => onContextMenu(event, tab)}
    >
      {tab.favicon ? <img src={tab.favicon} alt="" className="vtab-favicon" /> : <span className="vtab-favicon vtab-favicon-fallback" />}
      <span className="vtab-title">{tab.title || 'New Tab'}</span>
      {inSplit ? <Columns2 size={11} className="vtab-in-split" aria-label="In the side-by-side view" /> : null}
      {tab.muted ? <VolumeX size={11} className="vtab-muted" /> : null}
      <button
        className="vtab-close"
        type="button"
        aria-label={`Close ${tab.title || 'tab'}`}
        onClick={(event) => { event.stopPropagation(); onClose(tab.id); }}
      >
        <X size={12} />
      </button>
    </div>
  );
}

export default function VerticalTabStrip({
  tabs,
  groups,
  workspaces,
  activeTabId,
  activeWorkspaceId,
  onSelectTab,
  onCloseTab,
  onMoveTab,
  onAssignGroup,
  onToggleGroup,
  onCreateGroup,
  onSelectWorkspace,
  onCreateWorkspace,
  onDeleteGroup,
  onDuplicateTab,
  splitTabIds = [],
  onDragStateChange = () => {},
  onSplitWith = () => {},
  onCloseSplit = () => {},
  onToggleMute,
  onMoveToWorkspace,
}) {
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState(null);
  const [menu, setMenu] = useState(null);
  const [dragging, setDragging] = useState('');
  const previewTimer = useRef(null);

  const searching = Boolean(query.trim());
  const rows = useMemo(
    () => (searching
      ? buildSearchRows({ tabs, groups, workspaceId: activeWorkspaceId, query })
      : buildStripRows({ tabs, groups, workspaceId: activeWorkspaceId })),
    [searching, query, tabs, groups, activeWorkspaceId],
  );

  useEffect(() => () => clearTimeout(previewTimer.current), []);

  // Hover preview is delayed, because a card flashing up on every pass over the
  // list is worse than no card at all. The rectangle is measured here, during
  // the event, because React clears event.currentTarget once the handler
  // returns and reading it inside the timer would throw.
  const startPreview = (event, tab) => {
    clearTimeout(previewTimer.current);
    const rect = event.currentTarget.getBoundingClientRect();
    previewTimer.current = setTimeout(() => {
      setPreview({ tab, position: { top: Math.min(rect.top, window.innerHeight - 120), left: rect.right + 10 } });
    }, 420);
  };
  const cancelPreview = (event) => {
    // mouseout also fires when the pointer moves from the title onto the close
    // button inside the same row, so only a move to a different row cancels it.
    const next = event?.relatedTarget;
    if (next && event.currentTarget.contains(next)) return;
    clearTimeout(previewTimer.current);
    setPreview(null);
  };

  const handleDrop = (event, targetTabId, groupId) => {
    event.preventDefault();
    const tabId = event.dataTransfer.getData('text/novaris-tab');
    if (tabId) onMoveTab({ tabId, targetTabId, groupId });
    setDragging('');
  };

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  return (
    <aside className="vstrip" aria-label="Tabs and workspaces">
      <div className="vstrip-workspaces">
        {workspaces.map((workspace) => (
          <button
            key={workspace.id}
            className={`vstrip-workspace${workspace.id === activeWorkspaceId ? ' is-active' : ''}`}
            type="button"
            style={{ '--workspace-color': workspace.color }}
            onClick={() => onSelectWorkspace(workspace.id)}
            title={`${workspace.name} · ${workspaceTabCount(tabs, workspace.id)} tabs`}
          >
            {workspace.name.slice(0, 1).toUpperCase()}
            <span className="vstrip-workspace-count">{workspaceTabCount(tabs, workspace.id)}</span>
          </button>
        ))}
        <button className="vstrip-workspace vstrip-workspace-add" type="button" onClick={onCreateWorkspace} aria-label="New workspace" title="New workspace">
          +
        </button>
      </div>

      <div className="vstrip-search">
        <Search size={12} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tabs"
          aria-label="Search open tabs"
          spellCheck="false"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="Clear tab search">
            <X size={12} />
          </button>
        )}
      </div>

      <div className="vstrip-list" onDragOver={(event) => event.preventDefault()}>
        {rows.map((row) => {
          const groupId = row.group?.id || '';
          return (
            <div className="vstrip-section" key={row.group?.id || 'loose'}>
              {row.group && (
                <div className="vstrip-group">
                  <button
                    className="vstrip-group-toggle"
                    type="button"
                    onClick={() => onToggleGroup(row.group.id)}
                    aria-label={`${row.collapsed ? 'Expand' : 'Collapse'} ${row.group.name}`}
                  >
                    {row.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    <span className="vstrip-group-name">{row.group.name}</span>
                    <span className="vstrip-group-count">{row.tabs.length}</span>
                  </button>
                  <button
                    className="vstrip-group-menu"
                    type="button"
                    aria-label={`Options for ${row.group.name}`}
                    onClick={(event) => { event.stopPropagation(); setMenu({ type: 'group', id: row.group.id, x: event.clientX, y: event.clientY }); }}
                  >
                    <MoreVertical size={12} />
                  </button>
                </div>
              )}
              {!row.collapsed && row.tabs.map((tab) => (
                <TabRow
                  key={tab.id}
                  tab={tab}
                  active={tab.id === activeTabId}
                  dragging={dragging === tab.id}
                  inSplit={splitTabIds.includes(tab.id)}
                  onSelect={onSelectTab}
                  onClose={onCloseTab}
                  onHover={startPreview}
                  onLeave={cancelPreview}
                  onContextMenu={(event, target) => { event.preventDefault(); setMenu({ type: 'tab', tab: target, x: event.clientX, y: event.clientY }); }}
                  onDragStart={(event, tabId) => {
                    event.dataTransfer.setData('text/novaris-tab', tabId);
                    event.dataTransfer.effectAllowed = 'copyMove';
                    setDragging(tabId);
                    // The panes need to know a tab is in flight so they can offer
                    // their drop edges. Zen works the same way: the sidebar is the
                    // source and the page area is the target.
                    onDragStateChange(tabId);
                  }}
                  onDragOver={(event, tabId) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
                  onDrop={(event, tabId) => handleDrop(event, tabId, tab.groupId || '')}
                  onDragEnd={() => { setDragging(''); onDragStateChange(''); cancelPreview(); }}
                />
              ))}
            </div>
          );
        })}

        {!rows.length && (
          <div className="vstrip-empty">
            {searching ? `No tab matches “${query.trim()}”` : 'No tabs in this workspace yet'}
          </div>
        )}

        <button className="vstrip-add" type="button" onClick={() => onCreateGroup?.(activeWorkspaceId)}>
          <FolderPlus size={13} />New group
        </button>
      </div>

      {preview && <TabPreview tab={preview.tab} position={preview.position} />}

      {menu?.type === 'tab' && (
        <div className="vstrip-menu" style={{ top: menu.y, left: menu.x }} onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => { onDuplicateTab(menu.tab.id); setMenu(null); }}><Copy size={12} />Duplicate</button>
          {splitTabIds.includes(menu.tab.id) ? (
            <button type="button" onClick={() => { onCloseSplit(); setMenu(null); }}><X size={12} />Close side-by-side</button>
          ) : (
            <button
              type="button"
              onClick={() => { onSplitWith(menu.tab.id); setMenu(null); }}
              title="Shows this page beside the one you are looking at"
            >
              <Columns2 size={12} />
              Open in split view
            </button>
          )}
          <button type="button" onClick={() => { onToggleMute(menu.tab.id); setMenu(null); }}>
            {menu.tab.muted ? <Volume2 size={12} /> : <VolumeX size={12} />}
            {menu.tab.muted ? 'Unmute tab' : 'Mute tab'}
          </button>
          <button type="button" onClick={() => { onCloseTab(menu.tab.id); setMenu(null); }}><X size={12} />Close tab</button>
          <div className="vstrip-menu-separator" />
          <span className="vstrip-menu-label">Move to group</span>
          <button type="button" onClick={() => { onAssignGroup(menu.tab.id, ''); setMenu(null); }}>No group</button>
          {groups.filter((group) => group.workspaceId === activeWorkspaceId).map((group) => (
            <button type="button" key={group.id} onClick={() => { onAssignGroup(menu.tab.id, group.id); setMenu(null); }}>{group.name}</button>
          ))}
          {workspaces.length > 1 && (
            <>
              <div className="vstrip-menu-separator" />
              <span className="vstrip-menu-label">Move to workspace</span>
              {workspaces.filter((workspace) => workspace.id !== activeWorkspaceId).map((workspace) => (
                <button type="button" key={workspace.id} onClick={() => { onMoveToWorkspace(menu.tab.id, workspace.id); setMenu(null); }}>{workspace.name}</button>
              ))}
            </>
          )}
        </div>
      )}

      {menu?.type === 'group' && (
        <div className="vstrip-menu" style={{ top: menu.y, left: menu.x }} onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => { onDeleteGroup(menu.id); setMenu(null); }}><X size={12} />Delete group</button>
          <p className="vstrip-menu-note">Tabs in this group are kept and moved out.</p>
        </div>
      )}
    </aside>
  );
}
