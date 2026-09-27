import { useState } from 'react';
import { Check, Globe2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { SEARCH_ENGINES } from '../lib/url';

function makeId() {
  return `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function SearchEngineManager({ settings, onUpdate }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', url: '', keyword: '' });
  const [error, setError] = useState('');

  const openNew = () => {
    setEditing('new');
    setForm({ name: '', url: 'https://www.example.com/search?q={query}', keyword: '' });
    setError('');
  };

  const openEdit = (engine) => {
    setEditing(engine.id);
    setForm({ name: engine.name, url: engine.url, keyword: engine.keyword || '' });
    setError('');
  };

  const close = () => {
    setEditing(null);
    setError('');
  };

  const save = (event) => {
    event.preventDefault();
    const name = form.name.trim();
    const url = form.url.trim();
    const keyword = form.keyword.trim().toLowerCase();
    let validUrl = false;
    try {
      const parsed = new URL(url.replaceAll('{query}', 'query'));
      validUrl = (parsed.protocol === 'http:' || parsed.protocol === 'https:') && url.includes('{query}');
    } catch {
      validUrl = false;
    }
    if (!name || !validUrl) {
      setError('Use an HTTP or HTTPS URL containing {query}.');
      return;
    }
    const next = settings.customSearchEngines || [];
    if (editing === 'new') {
      onUpdate({ customSearchEngines: [...next, { id: makeId(), name, url, keyword, enabled: true }] });
    } else {
      onUpdate({ customSearchEngines: next.map((engine) => engine.id === editing ? { ...engine, name, url, keyword } : engine) });
    }
    close();
  };

  const remove = (id) => onUpdate({ customSearchEngines: (settings.customSearchEngines || []).filter((engine) => engine.id !== id) });

  return (
    <div className="search-engine-manager">
      <div className="engine-builtins">
        <div className="engine-manager-heading"><span>Built-in providers</span><small>Six ready-to-use choices</small></div>
        <div className="builtin-engine-list">{Object.entries(SEARCH_ENGINES).map(([id, engine]) => <div className="builtin-engine" key={id}><span className="engine-letter">{engine.label[0]}</span><span><strong>{engine.label}</strong><small>{engine.searchUrl}</small></span>{settings.searchEngine === id && <Check size={14} />}</div>)}</div>
      </div>
      <div className="custom-engine-section">
        <div className="engine-manager-heading"><span>Custom providers</span><button className="tiny-action" type="button" onClick={openNew} aria-label="Add custom search engine"><Plus size={14} /></button></div>
        {(settings.customSearchEngines || []).length === 0 && !editing && <div className="engine-empty"><Search size={15} /><span>Add a search provider with a keyword shortcut.</span></div>}
        {(settings.customSearchEngines || []).map((engine) => <div className="custom-engine-row" key={engine.id}><span className="engine-letter"><Globe2 size={13} /></span><span><strong>{engine.name}</strong><small>{engine.keyword ? `${engine.keyword} ` : ''}{engine.url}</small></span><button className="row-action" type="button" onClick={() => openEdit(engine)} aria-label={`Edit ${engine.name}`}><Pencil size={13} /></button><button className="row-action" type="button" onClick={() => remove(engine.id)} aria-label={`Remove ${engine.name}`}><Trash2 size={13} /></button></div>)}
        {editing && <form className="custom-engine-form" onSubmit={save}><div className="engine-manager-heading"><span>{editing === 'new' ? 'New provider' : 'Edit provider'}</span><button className="tiny-action" type="button" onClick={close} aria-label="Close search engine form"><X size={14} /></button></div><label><span>Name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="My search" /></label><label><span>URL template</span><input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://search.example/?q={query}" /></label><label><span>Keyword (optional)</span><input value={form.keyword} onChange={(event) => setForm({ ...form, keyword: event.target.value })} placeholder="s" /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit"><Check size={14} />Save provider</button></form>}
      </div>
    </div>
  );
}
