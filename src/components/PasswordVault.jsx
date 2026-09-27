import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Mail,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  WandSparkles,
  X,
} from 'lucide-react';
import { getDomain } from '../lib/url';

const PASSWORD_SYMBOLS = '!@#$%^&*()-_=+[]{}';

function randomIndex(max) {
  const limit = Math.floor(0x100000000 / max) * max;
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % max;
}

function generatePassword(length = 22) {
  const groups = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    PASSWORD_SYMBOLS,
  ];
  const characters = groups.map((group) => group[randomIndex(group.length)]);
  const alphabet = groups.join('');
  while (characters.length < length) characters.push(alphabet[randomIndex(alphabet.length)]);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomIndex(index + 1);
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  return characters.join('');
}

function generateUsername() {
  const prefixes = ['nova', 'quiet', 'orbit', 'pixel', 'meadow', 'north', 'studio'];
  return `${prefixes[randomIndex(prefixes.length)]}.${String(randomIndex(9000) + 1000)}`;
}

function CredentialRow({ item, activeUrl, onCopy, onFill, onRemove }) {
  const domain = getDomain(item.url);
  return (
    <div className="credential-row">
      <div className="credential-row-icon"><KeyRound size={15} /></div>
      <div className="credential-row-copy">
        <strong>{item.title || domain || 'Saved login'}</strong>
        <small>{item.url || 'Identity entry'}</small>
        <div className="credential-identity">
          {item.username && <span><UserRound size={11} />{item.username}</span>}
          {item.email && <span><Mail size={11} />{item.email}</span>}
        </div>
      </div>
      <div className="credential-actions">
        {activeUrl && <button className="credential-action primary" type="button" onClick={() => onFill(item.id)} title="Fill on current page"><ExternalLink size={13} />Fill</button>}
        {item.username && <button className="credential-action" type="button" onClick={() => onCopy(item.id, 'username')} title="Copy username"><Copy size={13} /></button>}
        <button className="credential-action" type="button" onClick={() => onCopy(item.id, 'password')} title="Copy password"><Copy size={13} /></button>
        <button className="credential-action danger" type="button" onClick={() => onRemove(item.id)} title="Delete login"><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

export default function PasswordVault({
  credentials,
  status,
  activeUrl,
  onSave,
  onRemove,
  onCopy,
  onFill,
  onRefresh,
}) {
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ title: '', url: '', username: '', email: '', password: '', notes: '' });

  useEffect(() => {
    if (showForm && activeUrl) {
      setForm((current) => ({ ...current, url: current.url || activeUrl, title: current.title || getDomain(activeUrl) }));
    }
  }, [activeUrl, showForm]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return credentials;
    return credentials.filter((item) => `${item.title || ''} ${item.url || ''} ${item.username || ''} ${item.email || ''}`.toLowerCase().includes(needle));
  }, [credentials, query]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const reset = () => setForm({ title: '', url: '', username: '', email: '', password: '', notes: '' });
  const startCurrentSave = () => {
    if (activeUrl) setForm({ title: getDomain(activeUrl), url: activeUrl, username: '', email: '', password: '', notes: '' });
    setShowForm(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    const saved = await onSave(form);
    setSaving(false);
    if (saved) {
      reset();
      setShowForm(false);
    }
  };

  return (
    <div className="vault-panel">
      <div className="vault-intro">
        <div className="vault-intro-icon"><ShieldCheck size={20} /></div>
        <div><strong>Windows-protected vault</strong><span>Passwords are encrypted by Windows and stay on this device.</span></div>
        <span className={`vault-status ${status?.locked ? 'is-locked' : status?.available ? 'is-ready' : 'is-unavailable'}`}>{status?.locked ? 'Locked' : status?.available ? 'Ready' : 'Unavailable'}</span>
      </div>

      <div className="vault-toolbar">
        <div className="vault-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search logins" aria-label="Search saved logins" /></div>
        {activeUrl && <button className="secondary-button" type="button" onClick={startCurrentSave} disabled={status?.locked}><KeyRound size={13} />Save current</button>}
        <button className="secondary-button" type="button" onClick={onRefresh} title="Refresh vault"><Check size={14} />Sync</button>
        <button className="primary-button" type="button" onClick={() => setShowForm((value) => !value)} disabled={status?.locked}><Plus size={14} />Add login</button>
      </div>

      {showForm && (
        <form className="vault-form" onSubmit={submit}>
          <div className="vault-form-heading"><div><span className="eyebrow">New credential</span><h3>Save a login or identity</h3></div><button className="icon-button subtle" type="button" onClick={() => setShowForm(false)} aria-label="Close login form"><X size={15} /></button></div>
          <div className="vault-form-grid">
            <label><span>Name</span><input value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="Example account" /></label>
            <label><span>Website</span><input value={form.url} onChange={(event) => update('url', event.target.value)} placeholder="https://example.com" /></label>
            <label><span>Username</span><div className="field-with-action"><input value={form.username} onChange={(event) => update('username', event.target.value)} placeholder="username" /><button type="button" onClick={() => update('username', generateUsername())} title="Generate username"><WandSparkles size={13} /></button></div></label>
            <label><span>Email</span><input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="you@example.com" /></label>
            <label className="wide"><span>Password</span><div className="field-with-action"><input type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => update('password', event.target.value)} placeholder="Generate or type a password" /><button type="button" onClick={() => setShowPassword((value) => !value)} title={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={13} /> : <Eye size={13} />}</button><button type="button" onClick={() => update('password', generatePassword())} title="Generate strong password"><WandSparkles size={13} /></button></div></label>
            <label className="wide"><span>Notes</span><textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Optional recovery notes" rows="2" /></label>
          </div>
          <div className="vault-form-footer"><span><KeyRound size={12} />Never synced or uploaded</span><button className="primary-button" type="submit" disabled={saving || !status?.available || status?.locked}>{saving ? 'Saving…' : 'Save securely'}</button></div>
        </form>
      )}

      <div className="vault-list">
        {filtered.length > 0 ? filtered.map((item) => <CredentialRow key={item.id} item={item} activeUrl={activeUrl} onCopy={onCopy} onFill={onFill} onRemove={onRemove} />) : (
          <div className="vault-empty"><div className="empty-icon"><KeyRound size={18} /></div><strong>{status?.locked ? 'Vault locked' : status?.available ? 'No saved logins' : 'Vault unavailable'}</strong><span>{status?.locked ? 'Unlock the master password from Settings to view or edit saved logins.' : status?.available ? 'Save a login manually or add one from a current website.' : status?.error || 'Windows encryption is not available.'}</span></div>
        )}
      </div>

      <div className="vault-footnote"><Globe2 size={13} /><span>Fill is always user-triggered. Novaris never reads or submits form fields in the background.</span></div>
    </div>
  );
}
