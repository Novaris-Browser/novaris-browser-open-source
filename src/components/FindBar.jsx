import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';

export default function FindBar({
  open,
  query,
  result,
  focusToken,
  onQueryChange,
  onFind,
  onPrevious,
  onNext,
  onClose,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && focusToken > 0) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusToken, open]);

  if (!open) return null;

  return (
    <div className="find-bar" role="search">
      <Search size={15} aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          }
          if (event.key === 'Escape') onClose();
        }}
        placeholder="Find on page"
        aria-label="Find on page"
      />
      <span className="find-count">{result.total ? `${result.active}/${result.total}` : query ? '0' : ''}</span>
      <button className="find-action" type="button" onClick={onPrevious} aria-label="Previous match" title="Previous match"><ChevronUp size={15} /></button>
      <button className="find-action" type="button" onClick={onNext} aria-label="Next match" title="Next match"><ChevronDown size={15} /></button>
      <button className="find-action" type="button" onClick={onClose} aria-label="Close find bar" title="Close"><X size={15} /></button>
    </div>
  );
}
