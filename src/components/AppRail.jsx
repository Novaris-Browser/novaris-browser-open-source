import { useEffect, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { allApps } from '../../electron/sidebar-layout';

/**
 * The apps rail. Each app is a real sandboxed webview rather than an embedded
 * site, because Discord, Spotify and Canvas all refuse to load inside an iframe.
 *
 * Only one app is attached at a time. Keeping eleven webviews alive to render an
 * eleven-icon rail would cost far more memory than the feature is worth, so the
 * rail loads the app you are actually looking at and unloads the rest.
 */
export default function AppRail({ open, apps: savedApps = [], activeAppId, onSelectApp, onClose }) {
  const apps = allApps(savedApps);
  const [loading, setLoading] = useState(false);
  const viewRef = useRef(null);

  const active = apps.find((app) => app.id === activeAppId) || null;
  const isInternal = active?.url?.startsWith('novaris://');

  useEffect(() => {
    if (!open || !active || isInternal) return;
    const element = viewRef.current;
    if (!element) return;
    const target = active.url;
    try {
      if (typeof element.getURL === 'function' && element.getURL() !== target) element.loadURL(target);
    } catch { /* The webview attaches a moment later and picks up src. */ }
    setLoading(true);
  }, [active, open, isInternal]);

  if (!open) return null;

  return (
    <aside className="app-rail" aria-label="Apps">
      <div className="app-rail-icons">
        {apps.map((app) => (
          <button
            key={app.id}
            className={`app-rail-icon${app.id === activeAppId ? ' is-active' : ''}`}
            type="button"
            style={{ '--app-color': app.color }}
            onClick={() => onSelectApp(app.id === activeAppId ? '' : app.id)}
            title={app.name}
            aria-label={app.name}
            aria-pressed={app.id === activeAppId}
          >
            {app.name.slice(0, 1).toUpperCase()}
          </button>
        ))}
      </div>

      <div className="app-rail-body">
        {!active && (
          <div className="app-rail-empty">
            <strong>No app open</strong>
            <span>Pick one from the column on the left. Each app loads in its own sandboxed view, without taking a tab.</span>
          </div>
        )}

        {active && isInternal && (
          <div className="app-rail-notes">
            <h2>Novaris Notes</h2>
            <p>A scratchpad that stays on this device. Nothing here is uploaded and nothing is sent anywhere.</p>
            <textarea className="app-rail-notepad" defaultValue="" placeholder="Write something…" spellCheck="true" />
          </div>
        )}

        {active && !isInternal && (
          <>
            <div className="app-rail-head">
              <strong>{active.name}</strong>
              <div className="app-rail-head-actions">
                <button type="button" onClick={() => onSelectApp('')} aria-label="Close app" title="Close app"><X size={13} /></button>
                <a className="app-rail-open" href={active.url} onClick={(event) => event.preventDefault()} aria-label={`Open ${active.name} in a tab`} title="Open in a tab" onMouseDown={(event) => event.preventDefault()}>
                  <ExternalLink size={13} />
                </a>
              </div>
            </div>
            {loading ? <div className="app-rail-loading">Loading {active.name}…</div> : null}
            {/* A webview, not an iframe: these services block framing outright. */}
            <webview
              ref={viewRef}
              className="app-rail-view"
              src={active.url}
              partition="persist:novaris-apps"
              webpreferences="contextIsolation=yes, nodeIntegration=no, sandbox=yes, webSecurity=yes"
              allowpopups="false"
              onDidStopLoading={() => setLoading(false)}
              onDidFailLoad={() => setLoading(false)}
            />
          </>
        )}
      </div>
    </aside>
  );
}
