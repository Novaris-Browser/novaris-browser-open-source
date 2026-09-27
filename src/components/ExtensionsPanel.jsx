import { useEffect, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, FolderOpen, Info, Package, Power, RefreshCw, Save, ShieldAlert, ShieldCheck, Trash2, Upload } from 'lucide-react';

export default function ExtensionsPanel({ extensions, adblock, onChoose, onOpenStore, onImportPackage, onToggle, onRemove, onRestoreBuiltin, onUpdateAdblock, onRefresh, onResetStats }) {
  const [storeValue, setStoreValue] = useState('');
  const [filterDraft, setFilterDraft] = useState(() => (adblock?.filters || []).join('\n'));
  const [busy, setBusy] = useState('');
  const builtin = extensions.find((extension) => extension.builtinId === 'adblock');

  useEffect(() => {
    setFilterDraft((adblock?.filters || []).join('\n'));
  }, [adblock?.filters]);

  const run = async (key, action) => {
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy('');
    }
  };
  const openStore = () => run('store', () => onOpenStore(storeValue));
  const importPackage = () => run('import', () => onImportPackage(storeValue));
  const saveFilters = () => run('filters', () => onUpdateAdblock({ filters: filterDraft.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) }));

  return (
    <div className="extensions-panel">
      <div className="extension-store-assistant"><div className="extension-store-assistant-icon"><ShieldCheck size={18} /></div><div><strong>Novaris Ad Blocker</strong><span>First-party protection is installed for every new profile. Toggle it, add your own filters, or remove it permanently.</span></div>{builtin ? <button className={`extension-toggle${builtin.enabled ? ' is-on' : ''}`} type="button" onClick={() => onToggle(builtin.id, !builtin.enabled)} aria-label={`${builtin.enabled ? 'Disable' : 'Enable'} Novaris Ad Blocker`}><Power size={13} /></button> : <button className="secondary-button" type="button" onClick={() => run('restore-builtin', onRestoreBuiltin)} disabled={Boolean(busy)}>Restore</button>}</div>
      {builtin && adblock && <>
        <div className="adblock-stats"><div className="adblock-stat"><strong>{adblock.blockedRequests ?? 0}</strong><span>Requests blocked</span></div><div className="adblock-stat"><strong>{(adblock.filters || []).length}</strong><span>Custom rules</span></div><div className="adblock-stat"><strong>{adblock.trackingProtection === false ? 'Off' : 'On'}</strong><span>Tracker blocking</span></div><button className="text-action" type="button" onClick={() => run('stats', onResetStats)} disabled={Boolean(busy)}>Reset counter</button></div>
        <div className="adblock-modes">
          <button className={`extension-toggle${adblock.trackingProtection !== false ? ' is-on' : ''}`} type="button" onClick={() => onUpdateAdblock({ trackingProtection: adblock.trackingProtection === false })} aria-label="Toggle tracker blocking"><span>Trackers</span></button>
          <button className={`extension-toggle${adblock.strictMode ? ' is-on' : ''}`} type="button" onClick={() => onUpdateAdblock({ strictMode: !adblock.strictMode })} aria-label="Toggle strict blocking" title="Blocks extra analytics and session-replay hosts. Some sites may not load correctly."><span>Strict</span></button>
        </div>
        {Boolean(adblock.topBlockedHosts?.length) && <div className="adblock-top-hosts">{adblock.topBlockedHosts.map((entry) => <span key={entry.host}><code>{entry.host}</code> {entry.count}</span>)}</div>}
        <div className="adblock-filters"><div className="engine-manager-heading"><span>Custom filter list</span><small>One rule per line</small></div><textarea value={filterDraft} onChange={(event) => setFilterDraft(event.target.value)} placeholder={'||ads.example.com^\n/example/banner\n##.ad-banner'} aria-label="Custom ad blocker filters" /><div className="adblock-filter-actions"><span>Use <code>||domain^</code> for a site, <code>/text/</code> for a URL fragment, or <code>##.selector</code> to hide ad boxes. Prefix a rule with <code>@@</code> to allow it.</span><button className="secondary-button" type="button" onClick={saveFilters} disabled={Boolean(busy)}><Save size={12} />{busy === 'filters' ? 'Saving…' : 'Save filters'}</button></div></div>
      </>}
      <div className="extensions-intro"><div className="extensions-intro-icon"><Package size={19} /></div><div><strong>Chrome Web Store-assisted installs</strong><span>Paste an official store link or extension ID, open the listing in your system browser, then import the CRX/ZIP package you obtained there. Novaris never bypasses or scrapes the store.</span></div></div>
      <div className="extension-store-row"><input value={storeValue} onChange={(event) => setStoreValue(event.target.value)} placeholder="https://chromewebstore.google.com/detail/... or extension ID" aria-label="Chrome Web Store extension URL or ID" /><button className="secondary-button" type="button" onClick={openStore} disabled={Boolean(busy)}><ExternalLink size={13} />{busy === 'store' ? 'Opening…' : 'Open listing'}</button></div>
      <div className="extensions-toolbar"><button className="primary-button" type="button" onClick={() => run('unpacked', onChoose)} disabled={Boolean(busy)}><FolderOpen size={14} />Install unpacked</button><button className="secondary-button" type="button" onClick={importPackage} disabled={Boolean(busy)}><Upload size={13} />{busy === 'import' ? 'Reviewing…' : 'Import CRX/ZIP'}</button><button className="secondary-button" type="button" onClick={onRefresh} disabled={Boolean(busy)}><RefreshCw size={13} />Refresh</button></div>
      <div className="extensions-list">{extensions.length === 0 ? <div className="vault-empty"><div className="empty-icon"><Package size={18} /></div><strong>No extensions installed</strong><span>Open a store listing or choose an unpacked extension folder to review it before enabling.</span></div> : extensions.map((extension) => {
        const compat = extension.compatibility;
        const reasons = Array.isArray(compat?.reasons) ? compat.reasons : [];
        const level = compat?.level || 'ok';
        return (
          <div className="extension-row" key={extension.id}>
            <div className="extension-icon">{extension.builtinId === 'adblock' ? <ShieldCheck size={15} /> : <Package size={15} />}</div>
            <div className="extension-copy">
              <strong>{extension.name}</strong>
              <small>
                Version {extension.version} · {extension.loaded ? 'Loaded' : extension.enabled ? 'Starting' : 'Disabled'}
                {extension.builtinId === 'adblock' ? ' · Built-in' : extension.source === 'chrome-web-store-import' ? ' · Store import' : ''}
                {extension.manifestVersion ? ` · MV${extension.manifestVersion}` : ''}
              </small>
              {level !== 'ok' && (
                <div className={`extension-compat is-${level}`}>
                  <div className="extension-compat-head">
                    {level === 'unsupported' ? <AlertTriangle size={12} /> : <Info size={12} />}
                    <span>{level === 'unsupported' ? 'Will not work in Novaris' : 'Limited support'}</span>
                  </div>
                  {reasons.map((reason) => (
                    <p key={`${reason.title}-${reason.detail}`}>
                      {reason.detail}
                      {reason.fix && <em>{reason.fix}</em>}
                    </p>
                  ))}
                </div>
              )}
              <code>{extension.path}</code>
            </div>
            <div className="extension-actions">
              {level !== 'ok' && <span className={`extension-compat-badge is-${level}`}>{level === 'unsupported' ? 'No' : 'Partial'}</span>}
              {extension.storeUrl && <button className="row-action" type="button" onClick={() => onOpenStore(extension.storeUrl)} aria-label={`Open store listing for ${extension.name}`} title="Open store listing"><ExternalLink size={13} /></button>}
              <button className={`extension-toggle${extension.enabled ? ' is-on' : ''}`} type="button" onClick={() => onToggle(extension.id, !extension.enabled)} aria-label={`${extension.enabled ? 'Disable' : 'Enable'} ${extension.name}`}><Power size={13} /></button>
              <button className="row-action" type="button" onClick={() => onRemove(extension.id)} aria-label={`Remove ${extension.name}`} title="Remove"><Trash2 size={13} /></button>
            </div>
          </div>
        );
      })}</div>
      <div className="extensions-warning"><ShieldAlert size={14} /><span>Imported packages are not signature-verified by Novaris. Only import a package you obtained from the official listing, and review the permissions dialog before continuing. Extensions can read and modify pages they are allowed to touch.</span></div>
      <div className="extensions-explainer">
        <strong>About Manifest V3 extensions</strong>
        <span>Most current Chrome extensions run their background logic in a service worker. Novaris cannot run extension service workers, so a V3 extension can install and then do nothing at all. Novaris checks every manifest and labels anything affected, so you are never left guessing. A Manifest V2 release of the same extension usually works.</span>
      </div>
    </div>
  );
}
