import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function ContextMenu({ open, onClose, actions }) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) onClose();
    };
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="context-menu" ref={menuRef} role="menu">
      <div className="context-menu-heading"><span>Novaris actions</span><button type="button" onClick={onClose} aria-label="Close menu"><X size={14} /></button></div>
      {actions.map(({ id, label, hint, icon: Icon, onClick }) => (
        <button className="context-menu-item" type="button" role="menuitem" key={id} onClick={() => { onClick(); onClose(); }}>
          <span className="context-menu-icon"><Icon size={15} /></span>
          <span>{label}</span>
          {hint && <kbd>{hint}</kbd>}
        </button>
      ))}
    </div>
  );
}
