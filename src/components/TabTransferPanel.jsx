import { useEffect, useState } from 'react';
import { ArrowRight, Copy, Send, X } from 'lucide-react';
import { MIN_PASSPHRASE_LENGTH } from '../lib/tab-transfer';

function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url || '';
  }
}

/**
 * Sends the active tab to another device on the same network, and opens one that
 * arrives.
 *
 * There is no server in the middle. The sending device listens on the local
 * network and shows a pairing code; the receiving device types that code to
 * connect. The tab is encrypted on the sending device before it moves, so
 * nothing readable crosses the network even on a shared one.
 */
export default function TabTransferPanel({ tab, onServe, onStatus, onCancel, onReceive, onClose }) {
  const [mode, setMode] = useState('send');
  const [passphrase, setPassphrase] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [offered, setOffered] = useState(null);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(null);

  const tooShort = passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE_LENGTH;

  // While a transfer is waiting, keep the panel honest about whether it is
  // still available, so an expired code is not left on screen looking valid.
  useEffect(() => {
    if (!offered?.listening) return undefined;
    const timer = window.setInterval(() => {
      onStatus?.().then((state) => {
        if (!state?.listening) setOffered({ ...offered, listening: false, delivered: true });
      }).catch(() => {});
    }, 2000);
    return () => window.clearInterval(timer);
  }, [offered, onStatus]);

  const startSend = async () => {
    setBusy(true); setError('');
    try {
      setOffered(await onServe({ tab, passphrase }));
    } catch (e) {
      setError(e?.message || 'Could not start that transfer.');
    } finally {
      setBusy(false);
    }
  };

  const startReceive = async () => {
    setBusy(true); setError('');
    try {
      const outcome = await onReceive({ address, code, passphrase });
      setOpened(outcome.tab);
    } catch (e) {
      setError(e?.message || 'Could not open that transfer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="transfer-panel" role="dialog" aria-label="Tab transfer">
      <div className="transfer-panel-head">
        <strong>Send a tab to another device</strong>
        <span>Both devices need Novaris and to be on the same network. No server is involved.</span>
      </div>

      <div className="transfer-panel-modes">
        <button className={mode === 'send' ? 'is-active' : ''} type="button" onClick={() => { setMode('send'); setError(''); }}>Send</button>
        <button className={mode === 'receive' ? 'is-active' : ''} type="button" onClick={() => { setMode('receive'); setError(''); }}>Receive</button>
      </div>

      {mode === 'send' ? (
        <>
          <div className="transfer-panel-field">
            <span className="transfer-panel-label">Tab</span>
            <div className="transfer-panel-tab">
              <strong>{tab?.title || 'No tab selected'}</strong>
              <span>{hostLabel(tab?.url)}</span>
            </div>
          </div>

          {!offered?.listening ? (
            <>
              <div className="transfer-panel-field">
                <span className="transfer-panel-label">Passphrase</span>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  placeholder={`At least ${MIN_PASSPHRASE_LENGTH} characters`}
                  aria-label="Transfer passphrase"
                  autoComplete="off"
                />
                {tooShort ? <small className="transfer-panel-warn">Too short. Short passphrases protect nothing, so Novaris refuses them.</small> : null}
              </div>
              <p className="transfer-panel-note">
                The tab is encrypted on this PC before it is sent, so the passphrase never
                leaves this device and nothing readable crosses the network.
              </p>
              <button className="transfer-panel-go" type="button" onClick={startSend} disabled={busy || !tab || tooShort || !passphrase}>
                <Send size={13} />{busy ? 'Encrypting…' : 'Start transfer'}
              </button>
            </>
          ) : (
            <div className="transfer-panel-code">
              <span>On the other device, choose Receive and enter this code.</span>
              <code>{offered.code}</code>
              <button type="button" onClick={() => navigator.clipboard?.writeText(offered.code)}><Copy size={12} />Copy code</button>
              <div className="transfer-panel-ports">
                {(offered.addresses || []).map((entry) => (
                  <button key={entry} type="button" onClick={() => { setAddress(entry); setMode('receive'); setCode(offered.code); }}>
                    {entry === '127.0.0.1' ? 'This device' : entry}
                  </button>
                ))}
              </div>
              <span className="transfer-panel-expiry">Waiting. The code stops working after ten minutes, and the tab is sent once.</span>
              <button className="transfer-panel-cancel" type="button" onClick={() => { onCancel?.(); setOffered(null); }}>Cancel</button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="transfer-panel-field">
            <span className="transfer-panel-label">Pairing code</span>
            <input
              type="text"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
              aria-label="Pairing code"
              spellCheck="false"
            />
          </div>
          <div className="transfer-panel-field">
            <span className="transfer-panel-label">Device address</span>
            <input
              type="text"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="192.168.1.20"
              aria-label="Sending device address"
              spellCheck="false"
            />
            <small className="transfer-panel-warn">Only devices on this local network can be reached.</small>
          </div>
          <div className="transfer-panel-field">
            <span className="transfer-panel-label">Passphrase</span>
            <input
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder="The passphrase used to send it"
              aria-label="Transfer passphrase"
              autoComplete="off"
            />
          </div>
          <button className="transfer-panel-go" type="button" onClick={startReceive} disabled={busy || !code || !address}>
            <ArrowRight size={13} />{busy ? 'Receiving…' : 'Open this tab'}
          </button>
          {opened ? (
            <p className="transfer-panel-ok">
              {hostLabel(opened.url)} is open in a new tab.
              <button type="button" onClick={onClose}>Done</button>
            </p>
          ) : null}
        </>
      )}

      {error ? <p className="transfer-panel-error"><X size={12} />{error}</p> : null}
    </div>
  );
}
