import { Copy, Maximize2, Minus, MoreHorizontal, Sparkles, X } from 'lucide-react';

export default function TitleBar({ windowState, onMenu, onMinimize, onMaximize, onClose }) {
  return (
    <header className="titlebar app-drag-region" onDoubleClick={(event) => {
      if (!event.target.closest('button')) onMaximize();
    }}>
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true"><Sparkles size={15} strokeWidth={2.3} /></div>
        <div className="brand-copy">
          <span className="brand-name">Novaris</span>
          <span className="brand-product">Browser</span>
        </div>
      </div>

      <div className="titlebar-center">
        <span className="titlebar-pill"><span className="status-dot status-dot-live" /> Secure workspace</span>
      </div>

      <div className="titlebar-actions no-drag-region">
        <button className="icon-button subtle" type="button" onClick={onMenu} aria-label="Open browser menu" title="Browser menu">
          <MoreHorizontal size={17} />
        </button>
        <div className="window-controls" aria-label="Window controls">
          <button className="window-control" type="button" onClick={onMinimize} aria-label="Minimize window" title="Minimize">
            <Minus size={15} />
          </button>
          <button className="window-control" type="button" onClick={onMaximize} aria-label={windowState.maximized ? 'Restore window' : 'Maximize window'} title={windowState.maximized ? 'Restore' : 'Maximize'}>
            {windowState.maximized ? <Copy size={13} /> : <Maximize2 size={13} />}
          </button>
          <button className="window-control window-control-close" type="button" onClick={onClose} aria-label="Close window" title="Close">
            <X size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}
