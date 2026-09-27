import { AlertTriangle, Download, RefreshCw, ShieldCheck, X } from 'lucide-react';

const COPY = {
  checking: { title: 'Checking for updates…', body: 'Novaris is looking for a newer version.' },
  current: { title: 'Novaris is up to date', body: 'You are running the latest version.' },
  available: { title: 'A Novaris update is ready', body: 'Download it now?' },
  downloading: { title: 'Downloading update…', body: 'Keep Novaris open until the download finishes.' },
  downloaded: { title: 'Update downloaded', body: 'Restart now to finish installing it.' },
  installing: { title: 'Installing update…', body: 'Novaris will close and reopen automatically.' },
  unconfigured: { title: 'No update channel', body: 'This build has no update feed configured.' },
  unavailable: { title: 'Updates unavailable', body: 'Updates are only checked in an installed build.' },
  error: { title: 'Update problem', body: 'Something went wrong while checking for updates.' },
};

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (!value) return '';
  const mb = value / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

export default function UpdatePrompt({ state, onCheck, onDownload, onInstall, onDismiss }) {
  if (!state) return null;
  const { status } = state;
  const copy = COPY[status] || COPY.current;
  const isUpdate = status === 'available' || status === 'downloading' || status === 'downloaded' || status === 'installing';

  // A successful check is reported in Settings rather than as an interruption.
  if (status === 'idle' || status === 'current' || status === 'unconfigured' || status === 'unavailable') return null;

  return (
    <div className="update-prompt" role="dialog" aria-modal="true" aria-label="Novaris update">
      <div className="update-prompt-card">
        {isUpdate && (
          <button className="update-prompt-close" type="button" onClick={onDismiss} aria-label="Dismiss update prompt">
            <X size={15} />
          </button>
        )}
        <div className="update-prompt-icon">
          {status === 'error' ? <AlertTriangle size={22} /> : <ShieldCheck size={22} />}
        </div>
        <span className="eyebrow">Novaris update</span>
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>

        {state.availableVersion && (
          <p className="update-prompt-version">
            Installed <code>{state.currentVersion}</code> &rarr; available <code>{state.availableVersion}</code>
            {state.totalBytes > 0 && <span className="update-prompt-size">Download {formatBytes(state.totalBytes)}</span>}
          </p>
        )}

        {state.releaseNotes && (
          <pre className="update-prompt-notes">{state.releaseNotes}</pre>
        )}

        {status === 'downloading' && (
          <div className="update-prompt-progress" aria-label={`Download ${state.progress}%`}>
            <span style={{ width: `${Math.max(2, state.progress)}%` }} />
          </div>
        )}

        {state.error && <p className="form-error">{state.error}</p>}

        <div className="update-prompt-actions">
          {status === 'available' && (
            <>
              <button className="secondary-button" type="button" onClick={onDismiss}>Not now</button>
              <button className="primary-button" type="button" onClick={onDownload}><Download size={14} />Download update</button>
            </>
          )}
          {status === 'downloaded' && (
            <>
              <button className="secondary-button" type="button" onClick={onDismiss}>Later</button>
              <button className="primary-button" type="button" onClick={onInstall}><RefreshCw size={14} />Restart and start fresh</button>
            </>
          )}
          {(status === 'checking' || status === 'downloading' || status === 'installing') && (
            <span className="update-prompt-busy"><RefreshCw size={13} />Working…</span>
          )}
          {status === 'error' && (
            <button className="primary-button" type="button" onClick={onCheck}><RefreshCw size={14} />Try again</button>
          )}
        </div>

        {status === 'downloaded' && (
          <small className="update-prompt-note">
            Installing resets the profile: your bookmarks, history, passwords, cookies, and settings are deleted and first-run setup starts again.
          </small>
        )}
      </div>
    </div>
  );
}
