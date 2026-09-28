import { useCallback, useEffect, useRef, useState } from 'react';
import { Columns2, GripVertical, X } from 'lucide-react';
import WebviewSurface from './WebviewSurface';
import { SIDES } from '../../electron/split-view';

// The left and right strips a dragged tab is dropped onto to join a pane beside
// it. Zen works this way: you aim at an edge, not at the page.
const DROP_EDGE_FRACTION = 0.28;

function edgeFor(event, element) {
  const rect = element.getBoundingClientRect();
  if (!rect.width) return SIDES.right;
  return (event.clientX - rect.left) / rect.width < DROP_EDGE_FRACTION ? SIDES.left : SIDES.right;
}

/**
 * The drop target shared by an existing pane and the single page area. Opening
 * the very first split is the case that is easy to miss: the panes do not exist
 * yet, so if the drop handling only lived inside a pane there would be nowhere
 * to drag to and the feature would only be reachable from the context menu.
 */
function useEdgeDrop({ draggingTabId, selfId, onDropTab, index }) {
  const [hoverEdge, setHoverEdge] = useState('');
  const elementRef = useRef(null);

  const onDragOver = useCallback((event) => {
    if (!draggingTabId || draggingTabId === selfId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setHoverEdge(edgeFor(event, elementRef.current || event.currentTarget));
  }, [draggingTabId, selfId]);

  const onDragLeave = useCallback((event) => {
    // Ignore the leave events fired while moving between children of the pane,
    // or the indicator flickers off every time the pointer crosses the page.
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setHoverEdge('');
  }, []);

  const onDrop = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    const dragged = event.dataTransfer.getData('text/novaris-tab');
    const side = edgeFor(event, elementRef.current || event.currentTarget);
    setHoverEdge('');
    if (dragged) onDropTab(dragged, index, side);
  }, [index, onDropTab]);

  return { elementRef, hoverEdge, onDragOver, onDragLeave, onDrop };
}

/**
 * Wraps the one page when no split is open, and offers the same left and right
 * edges a pane offers, so the first split is made by dragging rather than by
 * finding a menu item.
 */
export function SplitDropHost({ draggingTabId, onDropTab, children }) {
  const host = useEdgeDrop({ draggingTabId, selfId: '', onDropTab, index: 0 });
  return (
    <div
      ref={host.elementRef}
      className="split-pane split-drop-host"
      onDragOver={host.onDragOver}
      onDragLeave={host.onDragLeave}
      onDrop={host.onDrop}
    >
      {host.hoverEdge ? <span className={`split-drop-edge is-${host.hoverEdge}`} aria-hidden="true" /> : null}
      {children}
    </div>
  );
}

/**
 * One page in the split. Carries the handle and the unsplit control on its top
 * edge, which is where Zen puts them, and hosts the two drop edges.
 */
function SplitPane({
  tab,
  index,
  focused,
  width,
  draggingTabId,
  onDropTab,
  onUnsplit,
  onFocus,
  onEvent,
  registerRef,
  developerTools,
  gamingMode,
  backgroundAudio,
}) {
  const host = useEdgeDrop({ draggingTabId, selfId: tab.id, onDropTab, index });

  return (
    <div
      ref={host.elementRef}
      className={`split-pane${focused ? ' is-focused' : ''}`}
      style={width ? { width: `${width}px` } : undefined}
      onMouseDown={onFocus}
      onDragOver={host.onDragOver}
      onDragLeave={host.onDragLeave}
      onDrop={host.onDrop}
    >
      <div className="split-pane-head">
        <span className="split-pane-title" title={tab.url || ''}>{tab.title || 'New Tab'}</span>
        {focused ? (
          <span className="split-pane-controls">
            <span className="split-pane-grip" title="Drag to reorder" aria-hidden="true"><GripVertical size={12} /></span>
            <button
              className="split-pane-button"
              type="button"
              onClick={(event) => { event.stopPropagation(); onUnsplit(tab.id); }}
              aria-label={`Take ${tab.title || 'this tab'} out of the side-by-side view`}
              title="Take out of this view"
            >
              <X size={12} />
            </button>
          </span>
        ) : null}
      </div>
      {host.hoverEdge ? <span className={`split-drop-edge is-${host.hoverEdge}`} aria-hidden="true" /> : null}
      <WebviewSurface
        tab={tab}
        active
        secondary
        onEvent={onEvent}
        registerRef={registerRef}
        developerTools={developerTools}
        gamingMode={gamingMode}
        backgroundAudio={backgroundAudio}
      />
    </div>
  );
}

/**
 * The divider between two panes. Dragging it changes the widths of the pair it
 * sits between and nothing else.
 */
function SplitDivider({ index, onResize }) {
  const [dragging, setDragging] = useState(false);
  const last = useRef(0);

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (event) => {
      const delta = event.clientX - last.current;
      if (!delta) return;
      last.current = event.clientX;
      onResize(index, delta / Math.max(1, window.innerWidth));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, index, onResize]);

  return (
    <div
      className={`split-divider${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the panes"
      tabIndex={0}
      onMouseDown={(event) => { event.preventDefault(); setDragging(true); last.current = event.clientX; }}
      onKeyDown={(event) => {
        // Keyboard resizing, because a separator nobody can reach with a keyboard
        // is not really a control.
        if (event.key === 'ArrowLeft') { event.preventDefault(); onResize(index, -0.04); }
        if (event.key === 'ArrowRight') { event.preventDefault(); onResize(index, 0.04); }
      }}
    />
  );
}

export default function SplitView({
  split,
  tabs,
  widths,
  draggingTabId,
  onDropTab,
  onUnsplit,
  onFocusPane,
  onResize,
  onClose,
  onEvent,
  registerRef,
  developerTools,
  gamingMode,
  backgroundAudio,
}) {
  const panes = (split?.tabIds || []).map((id) => tabs.find((tab) => tab.id === id)).filter(Boolean);
  if (panes.length < 2) return null;

  return (
    <div className="split-view">
      {panes.map((tab, index) => (
        <div className="split-cell" key={tab.id}>
          <SplitPane
            tab={tab}
            index={index}
            focused={index === split.activeIndex}
            width={widths[index]}
            draggingTabId={draggingTabId}
            onDropTab={onDropTab}
            onUnsplit={onUnsplit}
            onFocus={() => onFocusPane(index)}
            onEvent={onEvent}
            registerRef={registerRef}
            developerTools={developerTools}
            gamingMode={gamingMode}
            backgroundAudio={backgroundAudio}
          />
          {index < panes.length - 1 ? <SplitDivider index={index} onResize={onResize} /> : null}
        </div>
      ))}
      <button className="split-view-close" type="button" onClick={onClose} aria-label="Close the side-by-side view" title="Close the side-by-side view">
        <Columns2 size={13} />
        <X size={11} />
      </button>
    </div>
  );
}
