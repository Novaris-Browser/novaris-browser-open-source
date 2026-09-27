import { useState } from 'react';
import { Download, KeyRound, Lock, Pencil, Trash2, Unlock, Upload } from 'lucide-react';

export default function VaultSecurityControls({ status, onSetMaster, onChangeMaster, onDisableMaster, onUnlock, onLock, onExport, onImport }) {
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  const submitMaster = async (event) => {
    event.preventDefault();
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    const result = await onSetMaster(password);
    if (result) { setPassword(''); setConfirm(''); setError(''); }
  };
  const submitChange = async (event) => {
    event.preventDefault();
    if (!currentPassword || password.length < 8) { setError('Enter your current password and a new password of at least 8 characters.'); return; }
    if (password !== confirm) { setError('New passwords do not match.'); return; }
    const result = await onChangeMaster(currentPassword, password);
    if (result) { setEditing(false); setCurrentPassword(''); setPassword(''); setConfirm(''); setError(''); }
  };
  const removeLock = async () => {
    const result = await onDisableMaster(currentPassword || password);
    if (result) { setEditing(false); setCurrentPassword(''); setPassword(''); setError(''); }
  };

  if (status?.locked) {
    return <div className="vault-security-controls"><div className="vault-lock-banner"><Lock size={16} /><div><strong>Vault locked</strong><span>Enter the master password to use saved credentials.</span></div></div><div className="vault-unlock-row"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Master password" aria-label="Vault master password" /><button className="primary-button" type="button" onClick={() => onUnlock(password)}><Unlock size={13} />Unlock</button></div></div>;
  }

  return <div className="vault-security-controls"><div className="vault-action-row"><button className="secondary-button" type="button" onClick={onExport}><Download size={13} />Export encrypted</button><button className="secondary-button" type="button" onClick={onImport}><Upload size={13} />Import encrypted</button>{status?.masterConfigured && <><button className="secondary-button" type="button" onClick={() => setEditing((value) => !value)}><Pencil size={13} />Change password</button><button className="secondary-button" type="button" onClick={onLock}><Lock size={13} />Lock vault</button></>}</div>{status?.masterConfigured && !editing && <button className="text-action vault-remove-lock" type="button" onClick={removeLock}><Trash2 size={12} />Remove vault lock</button>}{status?.masterConfigured && editing && <form className="vault-master-form" onSubmit={submitChange}><div className="engine-manager-heading"><span><KeyRound size={12} /> Change vault password</span></div><div className="vault-master-inputs"><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Current password" aria-label="Current vault password" /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" aria-label="New vault password" /><input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Repeat new password" aria-label="Repeat new vault password" /></div><div className="vault-action-row"><button className="primary-button" type="submit">Save password</button><button className="secondary-button" type="button" onClick={() => { setEditing(false); setError(''); }}>Cancel</button><button className="text-action" type="button" onClick={removeLock}><Trash2 size={12} />Remove lock</button></div>{error && <p className="form-error">{error}</p>}</form>}{!status?.masterConfigured && <form className="vault-master-form" onSubmit={submitMaster}><div className="engine-manager-heading"><span><KeyRound size={12} /> Optional master lock</span></div><div className="vault-master-inputs"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New master password" aria-label="New master password" /><input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Confirm password" aria-label="Confirm master password" /><button className="primary-button" type="submit">Enable</button></div>{error && <p className="form-error">{error}</p>}</form>}</div>;
}
