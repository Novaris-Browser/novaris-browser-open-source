import { useState } from 'react';
import { KeyRound, LockKeyhole, TriangleAlert, X } from 'lucide-react';

// A configured browser password is a hard lock. There is deliberately no
// "skip" path: the password is the only thing that can decrypt the vault, and a
// bypass would make the lock decorative. A forgotten password cannot be
// recovered, so the only remaining action is to reset the browser, which
// destroys the vault rather than opening it.
export default function VaultLockGate({ onUnlock, onResetBrowser, onClose }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgotten, setForgotten] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!password) { setError('Enter your vault password.'); return; }
    setBusy(true);
    setError('');
    const result = await onUnlock(password);
    setBusy(false);
    if (!result) setError('That password did not unlock the vault.');
  };

  return <div className="vault-lock-gate"><div className="vault-lock-gate-card"><button className="vault-lock-gate-close" type="button" onClick={onClose} aria-label="Close Novaris"><X size={16} /></button><div className="vault-lock-gate-icon"><LockKeyhole size={27} /></div><span className="eyebrow">Novaris is locked</span><h1>Unlock your vault</h1><p>Enter the browser password you set. Novaris cannot skip this check, and the password is the only thing that can decrypt your saved credentials.</p><form onSubmit={submit}><input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Vault password" aria-label="Vault password" />{error && <span className="form-error">{error}</span>}<button className="primary-button" type="submit" disabled={busy}><KeyRound size={14} />{busy ? 'Unlocking…' : 'Unlock Novaris'}</button></form><button className="text-action vault-forgot" type="button" onClick={() => setForgotten((value) => !value)}>{forgotten ? 'Hide' : 'I forgot my password'}</button>{forgotten && <div className="vault-forgot-detail"><TriangleAlert size={14} /><div><p>Your password cannot be recovered or reset, because Novaris never stores it.</p><p>Your only option is to reset the browser, which deletes the vault and every other profile item, then start first-run setup again.</p>{onResetBrowser && <button className="danger-button" type="button" onClick={onResetBrowser}>Reset browser and delete the vault</button>}</div></div>}</div></div>;
}
