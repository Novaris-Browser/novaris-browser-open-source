import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Package, Power, Settings2, ShieldCheck, SlidersHorizontal } from 'lucide-react';

function extensionInitial(extension) {
  return String(extension.name || '?').trim().charAt(0).toUpperCase();
}

export default function ExtensionActionBar({ extensions, onOpenAction, onToggleExtension, onOpenManager }) {
  const [adblockOpen, setAdblockOpen] = useState(false);
  const popoverRef = useRef(null);
  const enabled = extensions.filter((extension) => extension.enabled);
  const builtin = extensions.find((extension) => extension.builtinId === 'adblock');

  useEffect(() => {
    if (!adblockOpen) return undefined;
    const onPointerDown = (event) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) setAdblockOpen(false);
    };
    const onKeyDown = (event) => { if (event.key === 'Escape') setAdblockOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, [adblockOpen]);

  return (
    <div className="extension-action-bar" aria-label="Extension actions">
      <span className="extension-action-label"><SlidersHorizontal size={12} /> Extensions</span>
      {enabled.slice(0, 8).map((extension) => {
        const isBuiltin = extension.builtinId === 'adblock';
        return <div className="extension-action-wrap" key={extension.id} ref={isBuiltin ? popoverRef : undefined}><button className={`extension-action-button${isBuiltin ? ' is-builtin' : ''}`} type="button" onClick={() => isBuiltin ? setAdblockOpen((value) => !value) : onOpenAction(extension.id)} aria-label={`Open ${extension.name}`} title={extension.action?.defaultTitle || extension.name}>{isBuiltin ? <ShieldCheck size={14} /> : <span>{extensionInitial(extension)}</span>}</button>{isBuiltin && adblockOpen && <div className="extension-action-popover"><div className="extension-popover-heading"><div><strong>Novaris Ad Blocker</strong><span>{builtin.loaded ? 'Protecting this browsing session' : 'Starting protection'}</span></div><button type="button" onClick={() => onOpenManager()} aria-label="Open extension settings"><Settings2 size={14} /></button></div><div className="extension-popover-status"><span className={`status-dot ${builtin.enabled ? 'status-dot-live' : ''}`} /><strong>{builtin.enabled ? 'On' : 'Off'}</strong><span>{builtin.enabled ? 'Common ads are blocked' : 'No ad requests are being blocked'}</span></div><button className="extension-popover-toggle" type="button" onClick={() => onToggleExtension(builtin.id, !builtin.enabled)}><Power size={13} />{builtin.enabled ? 'Turn off' : 'Turn on'}</button><button className="extension-popover-manage" type="button" onClick={onOpenManager}>Custom filters and extension settings <ChevronDown size={13} /></button></div>}</div>;
      })}
      {enabled.length > 8 && <span className="extension-action-more">+{enabled.length - 8}</span>}
      <button className="extension-action-manager" type="button" onClick={onOpenManager} aria-label="Manage extensions" title="Manage extensions"><Package size={13} /></button>
    </div>
  );
}
