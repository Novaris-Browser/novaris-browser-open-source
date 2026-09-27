import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search, X } from 'lucide-react';

export default function CommandPalette({ open, onClose, actions }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter((action) => `${action.label} ${action.hint || ''}`.toLowerCase().includes(needle));
  }, [actions, query]);

  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  const runActive = () => {
    const action = filtered[activeIndex];
    if (!action) return;
    action.onClick();
    onClose();
  };

  return (
    <div className="command-palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="command-palette-search"><Search size={17} /><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((value) => Math.max(0, Math.min(filtered.length - 1, value + 1))); } else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((value) => Math.max(0, value - 1)); } else if (event.key === 'Enter') { event.preventDefault(); runActive(); } }} placeholder="Type a command or search Novaris…" aria-label="Search commands" /><button className="command-palette-close" type="button" onClick={onClose} aria-label="Close command palette"><X size={15} /></button></div>
        <div className="command-palette-list" role="listbox">{filtered.length ? filtered.map((action, index) => { const Icon = action.icon; return <button className={`command-palette-item${index === activeIndex ? ' is-active' : ''}`} type="button" role="option" aria-selected={index === activeIndex} key={action.id} onMouseEnter={() => setActiveIndex(index)} onClick={() => { action.onClick(); onClose(); }}><span className="command-palette-icon"><Icon size={15} /></span><span>{action.label}</span>{action.hint && <kbd>{action.hint}</kbd>}</button>; }) : <div className="command-palette-empty">No matching commands.</div>}</div>
        <div className="command-palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span><span className="command-palette-footer-mark"><CornerDownLeft size={12} /> Novaris commands</span></div>
      </div>
    </div>
  );
}
