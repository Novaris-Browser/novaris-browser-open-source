import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Code2,
  Database,
  Download,
  Eye,
  Gamepad2,
  Gauge,
  Globe2,
  HardDrive,
  KeyRound,
  Keyboard,
  Laptop,
  Monitor,
  Moon,
  Palette,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Timer,
  Trash2,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import { SEARCH_ENGINES } from '../lib/url';
import SearchEngineManager from './SearchEngineManager';
import PermissionsPanel from './PermissionsPanel';
import ExtensionsPanel from './ExtensionsPanel';
import StorageDashboard from './StorageDashboard';
import VaultSecurityControls from './VaultSecurityControls';

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (!value) return '';
  const mb = value / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(0)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
}

function updateDescription(state) {
  if (!state) return 'Checks whether a newer Novaris build has been published.';
  if (state.status === 'current') return `You are running the latest version (${state.currentVersion}).`;
  if (state.status === 'unconfigured') return 'This build has no update channel configured, so nothing is checked.';
  if (state.status === 'unavailable') return 'Updates are only checked in an installed build.';
  if (state.status === 'available') {
    const size = formatBytes(state.totalBytes);
    return `Version ${state.availableVersion} is available${size ? `, about ${size} to download` : ''}.`;
  }
  if (state.status === 'downloading') {
    const size = formatBytes(state.totalBytes);
    return `Downloading version ${state.availableVersion || ''} (${state.progress}%)${size ? ` of ${size}` : ''}.`;
  }
  if (state.status === 'downloaded') return `Version ${state.availableVersion} is ready to install.`;
  if (state.status === 'error') return 'The last update check did not complete.';
  return 'Checks whether a newer Novaris build has been published.';
}

const SECTIONS = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, description: 'Startup and navigation' },
  { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Theme and glass surfaces' },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck, description: 'Data and permissions' },
  { id: 'storage', label: 'Storage', icon: HardDrive, description: 'Disk and site usage' },
  { id: 'permissions', label: 'Site permissions', icon: Globe2, description: 'Per-site access controls' },
  { id: 'passwords', label: 'Passwords', icon: KeyRound, description: 'Encrypted local vault' },
  { id: 'extensions', label: 'Extensions', icon: Package, description: 'User-installed tools' },
  { id: 'downloads', label: 'Downloads', icon: Download, description: 'Files and location' },
  { id: 'performance', label: 'Performance', icon: Zap, description: 'Speed, memory, and motion' },
  { id: 'advanced', label: 'Advanced', icon: Gauge, description: 'Developer and hardware tools' },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard, description: 'Keyboard reference' },
];

function Toggle({ checked, onChange, label, description, disabled = false }) {
  return (
    <div className={`setting-toggle-row${disabled ? ' is-disabled' : ''}`}>
      <div><strong>{label}</strong>{description && <span>{description}</span>}</div>
      <button className={`toggle${checked ? ' is-on' : ''}`} type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => !disabled && onChange(!checked)} disabled={disabled}>
        <span />
      </button>
    </div>
  );
}

function SettingRow({ title, description, children }) {
  return (
    <div className="setting-row">
      <div className="setting-row-copy"><strong>{title}</strong>{description && <span>{description}</span>}</div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}

function SelectControl({ value, onChange, children, ariaLabel }) {
  return <select className="select-control" value={value} onChange={(event) => onChange(event.target.value)} aria-label={ariaLabel}>{children}</select>;
}

export default function SettingsPage({ settings, engineCapabilities, activeUrl, sitePermissions, extensions, adblock, storageOverview, downloadDirectory, vaultStatus, credentialCount, suspendedTabs = 0, initialSection = 'general', onUpdate, onImportBookmarks, onImportPasswords, onChooseDownloadDirectory, onClearBrowsingData, onSetSitePermission, onResetSitePermission, onRefreshStorage, onClearSiteStorage, onChooseExtension, onOpenExtensionStore, onImportExtensionPackage, onToggleExtension, onRemoveExtension, onRestoreBuiltinExtension, onUpdateAdblock, onRefreshExtensions, onResetAdblockStats, onSetVaultMaster, onChangeVaultMaster, onDisableVaultMaster, onUnlockVault, onLockVault, onExportVault, onImportVault, onOpenPasswords, onMakeDefaultBrowser, onRunOnboarding, onCheckForUpdates, onDownloadUpdate, onInstallUpdate, onResetProfile, updateState, onClose, version }) {
  const [section, setSection] = useState(initialSection || 'general');
  const [homepageDraft, setHomepageDraft] = useState(settings.homepage || '');
  const [hotkeyDraft, setHotkeyDraft] = useState(settings.globalHotkey || 'Control+Shift+Space');
  const [clearOptions, setClearOptions] = useState({ cookies: true, cache: true, history: true, downloads: false });
  const [clearing, setClearing] = useState(false);
  const [posture, setPosture] = useState(null);
  const [gaming, setGaming] = useState(null);
  const modifierLabel = 'Ctrl';

  useEffect(() => setHomepageDraft(settings.homepage || ''), [settings.homepage]);
  useEffect(() => setHotkeyDraft(settings.globalHotkey || 'Control+Shift+Space'), [settings.globalHotkey]);
  useEffect(() => {
    if (initialSection) setSection(initialSection);
  }, [initialSection]);

  // Read the measured posture from the main process rather than restating
  // Chromium's defaults, so the panel cannot claim protection that is not real.
  useEffect(() => {
    if (section !== 'privacy') return;
    if (!window.novaris?.privacyPosture) return;
    let active = true;
    window.novaris.privacyPosture().then((value) => {
      if (active) setPosture(value);
    }).catch(() => {
      if (active) setPosture(null);
    });
    return () => { active = false; };
  }, [section]);

  // Read Gaming Mode's real state from the main process, so the panel can never
  // describe an effect the process is not actually applying.
  useEffect(() => {
    if (section !== 'performance') return;
    if (!window.novaris?.gamingStatus) return;
    let active = true;
    window.novaris.gamingStatus().then((value) => {
      if (active) setGaming(value);
    }).catch(() => {
      if (active) setGaming(null);
    });
    return () => { active = false; };
  }, [section, settings.gamingMode]);

  const update = (patch) => onUpdate(patch);
  const clearData = async () => {
    setClearing(true);
    await onClearBrowsingData(clearOptions);
    setClearing(false);
  };

  return (
    <div className="settings-page">
      <aside className="settings-nav">
        <div className="settings-brand">
          <div className="brand-mark small"><span /></div>
          <div><span className="eyebrow">Novaris</span><strong>Settings</strong></div>
        </div>
        <nav aria-label="Settings sections">
          {SECTIONS.map(({ id, label, icon: Icon, description }) => (
            <button className={`settings-nav-item${section === id ? ' is-active' : ''}`} type="button" key={id} onClick={() => setSection(id)}>
              <span className="settings-nav-icon"><Icon size={16} /></span>
              <span><strong>{label}</strong><small>{description}</small></span>
              <ChevronRight size={14} />
            </button>
          ))}
        </nav>
        <div className="settings-version"><span>Novaris Browser</span><small>Version {version || '0.1.0'}</small></div>
      </aside>

      <main className="settings-main">
        <header className="settings-header">
          <div><span className="eyebrow">Preferences</span><h1>{SECTIONS.find((item) => item.id === section)?.label}</h1></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close settings" title="Close settings"><X size={18} /></button>
        </header>

        <div className="settings-scroll">
          {section === 'general' && (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="settings-card-heading"><div className="settings-card-icon"><Laptop size={17} /></div><div><h2>Startup</h2><p>Choose the fallback page when there is no restorable session.</p></div></div>
                <SettingRow title="Open on startup" description="New Tab keeps the workspace quiet; Homepage opens your configured site.">
                  <SelectControl value={settings.startupBehavior} onChange={(value) => update({ startupBehavior: value })} ariaLabel="Open on startup">
                    <option value="newtab">New Tab</option>
                    <option value="homepage">Homepage</option>
                  </SelectControl>
                </SettingRow>
                <SettingRow title="Homepage" description="Used by the home button and startup behavior.">
                  <div className="inline-input-wrap">
                    <input value={homepageDraft} onChange={(event) => setHomepageDraft(event.target.value)} onBlur={() => update({ homepage: homepageDraft })} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-label="Homepage URL" />
                    <button className="input-action" type="button" onClick={() => update({ homepage: homepageDraft })} aria-label="Save homepage"><Check size={14} /></button>
                  </div>
                </SettingRow>
                <SettingRow title="Default browser" description="Windows requires confirmation in its Default Apps settings.">
                  <button className="secondary-button" type="button" onClick={onMakeDefaultBrowser}>Set default</button>
                </SettingRow>
                <Toggle checked={settings.restoreSession} onChange={(value) => update({ restoreSession: value })} label="Restore session" description="Reopen your tabs and active tab after a restart or crash." />
                <SettingRow title="Import bookmarks" description="Bring bookmarks from an exported Chrome, Edge, or Firefox HTML file.">
                  <button className="secondary-button" type="button" onClick={onImportBookmarks}>Import HTML</button>
                </SettingRow>
                <SettingRow title="First-run setup" description="Ask for a default browser and search provider again.">
                  <button className="secondary-button" type="button" onClick={onRunOnboarding}>Run setup</button>
                </SettingRow>
              </div>

              <div className="settings-card">
                <div className="settings-card-heading"><div className="settings-card-icon"><RefreshCw size={17} /></div><div><h2>Updates</h2><p>Novaris never installs anything without asking you first.</p></div></div>
                <SettingRow title="Novaris Browser" description={updateDescription(updateState)}>
                  <button className="secondary-button" type="button" onClick={onCheckForUpdates} disabled={updateState?.status === 'checking'}>
                    {updateState?.status === 'checking' ? 'Checking…' : 'Check for updates'}
                  </button>
                </SettingRow>
                {updateState?.status === 'available' && (
                  <SettingRow title={`Version ${updateState.availableVersion} is ready`} description="Download it now, or ignore it until later.">
                    <button className="primary-button" type="button" onClick={onDownloadUpdate}><Download size={13} />Download update</button>
                  </SettingRow>
                )}
                {updateState?.status === 'downloaded' && (
                  <SettingRow title={`Version ${updateState.availableVersion} downloaded`} description="Restarting installs it and starts you on a clean profile.">
                    <button className="primary-button" type="button" onClick={onInstallUpdate}><RefreshCw size={13} />Restart and start fresh</button>
                  </SettingRow>
                )}
                {updateState?.error && <p className="form-error">{updateState.error}</p>}
                <div className="settings-danger">
                  <div><strong>Start fresh</strong><span>Deletes your profile and restarts Novaris into first-run setup. Bookmarks, history, passwords, cookies, extensions, and ad blocker rules are all removed.</span></div>
                  <button className="danger-button" type="button" onClick={onResetProfile}>Reset browser</button>
                </div>
              </div>

              <div className="settings-card">
                <div className="settings-card-heading"><div className="settings-card-icon"><Search size={17} /></div><div><h2>Search</h2><p>Terms entered in the address bar use this provider.</p></div></div>
                <SettingRow title="Default search engine" description="You can still enter a full URL at any time.">
                  <SelectControl value={settings.searchEngine} onChange={(value) => update({ searchEngine: value })} ariaLabel="Default search engine">
                    {Object.entries(SEARCH_ENGINES).map(([id, engine]) => <option value={id} key={id}>{engine.label}</option>)}
                    {(settings.customSearchEngines || []).filter((engine) => engine.enabled !== false).map((engine) => <option value={engine.id} key={engine.id}>{engine.name}</option>)}
                  </SelectControl>
                </SettingRow>
                <SearchEngineManager settings={settings} onUpdate={update} />
              </div>
            </div>
          )}

          {section === 'appearance' && (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="settings-card-heading"><div className="settings-card-icon"><Eye size={17} /></div><div><h2>Theme</h2><p>Novaris follows your system or stays in your chosen mood.</p></div></div>
                <div className="theme-options">
                  {[
                    { id: 'system', label: 'System', icon: Monitor },
                    { id: 'light', label: 'Light', icon: Sun },
                    { id: 'dark', label: 'Dark', icon: Moon },
                  ].map(({ id, label, icon: Icon }) => <button className={`theme-option${settings.theme === id ? ' is-active' : ''}`} type="button" key={id} onClick={() => update({ theme: id })}><Icon size={17} /><span>{label}</span>{settings.theme === id && <Check size={14} />}</button>)}
                </div>
                <SettingRow title="Glass transparency" description={`Surface opacity at ${Math.round(settings.transparency * 100)}%.`}>
                  <input className="range-control" type="range" min="0.45" max="0.92" step="0.01" value={settings.transparency} onChange={(event) => update({ transparency: Number(event.target.value) })} aria-label="Glass transparency" />
                </SettingRow>
                <SettingRow title="Accent color" description="Used for focus states, progress, and active controls.">
                  <div className="accent-picker">
                    {['#7c8cff', '#65d6c2', '#f49baf', '#f5bd69', '#b795ff'].map((color) => <button className={`accent-swatch${settings.accent === color ? ' is-active' : ''}`} style={{ '--swatch': color }} type="button" key={color} onClick={() => update({ accent: color })} aria-label={`Use accent ${color}`}><span /></button>)}
                    <input type="color" value={settings.accent} onChange={(event) => update({ accent: event.target.value })} aria-label="Custom accent color" />
                  </div>
                </SettingRow>
              </div>

              <div className="settings-card">
                <div className="settings-card-heading"><div className="settings-card-icon"><Palette size={17} /></div><div><h2>New tab canvas</h2><p>Choose a quiet backdrop for your starting point.</p></div></div>
                <div className="background-options">
                  {[
                    { id: 'aurora', label: 'Aurora', className: 'bg-aurora' },
                    { id: 'midnight', label: 'Midnight', className: 'bg-midnight' },
                    { id: 'sunrise', label: 'Sunrise', className: 'bg-sunrise' },
                    { id: 'forest', label: 'Forest', className: 'bg-forest' },
                  ].map((item) => <button className={`background-option${settings.newTabBackground === item.id ? ' is-active' : ''}`} type="button" key={item.id} onClick={() => update({ newTabBackground: item.id })}><span className={`background-preview ${item.className}`}><span /></span><strong>{item.label}</strong>{settings.newTabBackground === item.id && <Check size={14} />}</button>)}
                </div>
              </div>
            </div>
          )}

          {section === 'privacy' && (
            <div className="settings-stack">
              <div className="settings-card privacy-highlight">
                <div className="privacy-hero-icon"><ShieldCheck size={22} /></div>
                <div><h2>Privacy is a product feature.</h2><p>Novaris keeps the browser shell separate from page content. Webviews have no Node.js integration, and permission requests are denied by default.</p></div>
              </div>
              <div className="settings-card info-card persistent-data-card"><Database size={17} /><div><strong>Persistent browser data is enabled</strong><span>Bookmarks, history, settings, downloads, cookies, and the encrypted vault are stored in the Windows user-data directory. Novaris keeps a local metadata backup.</span></div><span className="vault-status is-ready">Saved</span></div>
              <div className="settings-card">
                <div className="settings-card-heading"><div className="settings-card-icon"><Trash2 size={17} /></div><div><h2>Clear browsing data</h2><p>Choose exactly what to remove from this device.</p></div></div>
                <div className="clear-options">
                  <label><input type="checkbox" checked={clearOptions.cookies} onChange={(event) => setClearOptions({ ...clearOptions, cookies: event.target.checked })} /><span>Cookies and site storage</span><small>Sessions and local website data</small></label>
                  <label><input type="checkbox" checked={clearOptions.cache} onChange={(event) => setClearOptions({ ...clearOptions, cache: event.target.checked })} /><span>Cached files</span><small>Speeds up future visits</small></label>
                  <label><input type="checkbox" checked={clearOptions.history} onChange={(event) => setClearOptions({ ...clearOptions, history: event.target.checked })} /><span>Novaris history</span><small>Visited pages in the sidebar</small></label>
                  <label><input type="checkbox" checked={clearOptions.downloads} onChange={(event) => setClearOptions({ ...clearOptions, downloads: event.target.checked })} /><span>Download records</span><small>Clears the list, not files on disk</small></label>
                </div>
                <button className="danger-button" type="button" onClick={clearData} disabled={clearing || !Object.values(clearOptions).some(Boolean)}><Trash2 size={15} />{clearing ? 'Clearing…' : 'Clear selected data'}</button>
              </div>
              <div className="settings-card">
                <div className="settings-card-heading"><div className="settings-card-icon"><Timer size={17} /></div><div><h2>Clear when Novaris closes</h2><p>Opt-in cleanup for cookies, cached data, and Novaris history.</p></div></div>
                <Toggle checked={settings.clearOnExit} onChange={(value) => update({ clearOnExit: value })} label="Clear selected data on exit" description="Runs during a normal Windows shutdown or window close. It cannot run after a crash or forced termination." />
                <Toggle checked={settings.clearCookiesOnExit} onChange={(value) => update({ clearCookiesOnExit: value })} label="Cookies and site storage" description="Removes website sessions and local storage." />
                <Toggle checked={settings.clearCacheOnExit} onChange={(value) => update({ clearCacheOnExit: value })} label="Cached website data" description="Keeps the next startup clean." />
                <Toggle checked={settings.clearHistoryOnExit} onChange={(value) => update({ clearHistoryOnExit: value })} label="Novaris history" description="Clears the visited-page list stored by Novaris." />
              </div>
              <div className="settings-card">
                <div className="settings-card-heading"><div className="settings-card-icon"><ShieldCheck size={17} /></div><div><h2>What Novaris actually protects</h2><p>Every line below was measured against this build, not copied from a claims page. Anything that is not protected is listed too.</p></div></div>
                {posture && posture.summary && (
                  <div className="posture-summary">
                    <span className="posture-count is-protected">{posture.summary.protected} protected</span>
                    {posture.summary.partial > 0 && <span className="posture-count is-partial">{posture.summary.partial} partial</span>}
                    {posture.summary.exposed > 0 && <span className="posture-count is-exposed">{posture.summary.exposed} not protected</span>}
                  </div>
                )}
                <div className="hardening-facts">
                  {(posture?.findings || []).map((fact) => (
                    <div className={`hardening-fact is-${fact.status}`} key={fact.id}>
                      <div className="hardening-fact-head">
                        <strong>{fact.title}</strong>
                        <span className="hardening-fact-value">{fact.value}</span>
                      </div>
                      <p>{fact.detail}</p>
                      <details className="posture-evidence">
                        <summary>How this was checked</summary>
                        <span>{fact.evidence}</span>
                      </details>
                    </div>
                  ))}
                </div>
                {posture?.engine?.chrome && (
                  <p className="hardening-note">
                    Engine: Chromium {posture.engine.chrome} on Electron {posture.engine.electron}. Novaris renders pages with the same engine as Chrome.
                  </p>
                )}
              </div>
              <div className="settings-card compact-card">
                <Toggle checked label="External links use the system browser" description="Novaris never opens arbitrary local files or unsafe protocols." disabled />
                <Toggle checked label="Secure context isolation" description="Managed by Electron; cannot be disabled from settings." disabled />
              </div>
            </div>
          )}

          {section === 'storage' && (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="settings-card-heading"><div className="settings-card-icon"><HardDrive size={17} /></div><div><h2>Storage dashboard</h2><p>See what Novaris and Chromium are keeping on this Windows device.</p></div></div>
                <StorageDashboard overview={storageOverview} activeUrl={activeUrl} onRefresh={onRefreshStorage} onClearSite={onClearSiteStorage} />
              </div>
            </div>
          )}

          {section === 'permissions' && (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="settings-card-heading"><div className="settings-card-icon"><ShieldCheck size={17} /></div><div><h2>Per-site permissions</h2><p>Allow only the access a website needs, and reset it whenever you want.</p></div></div>
                <PermissionsPanel activeUrl={activeUrl} permissions={sitePermissions} onSet={onSetSitePermission} onReset={onResetSitePermission} />
              </div>
            </div>
          )}

          {section === 'passwords' && (
            <div className="settings-stack">
              <div className="settings-card privacy-highlight vault-settings-highlight">
                <div className="privacy-hero-icon"><KeyRound size={22} /></div>
                <div><h2>Built-in Windows vault</h2><p>Save usernames, email addresses, and passwords locally. Secrets are encrypted with Windows before they touch disk.</p></div>
              </div>
              <div className="settings-card">
                <div className="settings-card-heading"><div className="settings-card-icon"><ShieldCheck size={17} /></div><div><h2>Vault status</h2><p>Novaris never syncs credentials to an account or external server.</p></div></div>
                <div className="vault-settings-status"><div><strong>{vaultStatus?.locked ? 'Vault locked' : vaultStatus?.available ? 'Encryption available' : 'Encryption unavailable'}</strong><span>{credentialCount || 0} saved {credentialCount === 1 ? 'login' : 'logins'} on this device</span></div><span className={`vault-status ${vaultStatus?.locked ? 'is-locked' : vaultStatus?.available ? 'is-ready' : 'is-unavailable'}`}>{vaultStatus?.locked ? 'Locked' : vaultStatus?.available ? 'Ready' : 'Unavailable'}</span></div>
                <SettingRow title="Open password manager" description="Save a current website, generate credentials, copy secrets, or fill a login.">
                  <button className="primary-button" type="button" onClick={onOpenPasswords} disabled={!vaultStatus?.available || vaultStatus?.locked}><KeyRound size={14} />Open vault</button>
                </SettingRow>
                <SettingRow title="Import passwords" description="Import a CSV export after reviewing it. Novaris never reads Chrome or Edge password databases directly.">
                  <button className="secondary-button" type="button" onClick={onImportPasswords} disabled={!vaultStatus?.available || vaultStatus?.locked}>Import CSV</button>
                </SettingRow>
                <VaultSecurityControls status={vaultStatus} onSetMaster={onSetVaultMaster} onChangeMaster={onChangeVaultMaster} onDisableMaster={onDisableVaultMaster} onUnlock={onUnlockVault} onLock={onLockVault} onExport={onExportVault} onImport={onImportVault} />
              </div>
              <div className="settings-card info-card"><UserRound size={17} /><div><strong>Manual save, deliberate fill</strong><span>Novaris does not scan page fields in the background. Saving and filling always start from an explicit action.</span></div></div>
            </div>
          )}

          {section === 'extensions' && (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="settings-card-heading"><div className="settings-card-icon"><Package size={17} /></div><div><h2>Extension manager</h2><p>Open an official Chrome Web Store listing, then import a package you obtained there. Novaris reviews the manifest before loading it.</p></div></div>
                <ExtensionsPanel extensions={extensions} adblock={adblock} onChoose={onChooseExtension} onOpenStore={onOpenExtensionStore} onImportPackage={onImportExtensionPackage} onToggle={onToggleExtension} onRemove={onRemoveExtension} onRestoreBuiltin={onRestoreBuiltinExtension} onUpdateAdblock={onUpdateAdblock} onRefresh={onRefreshExtensions} onResetStats={onResetAdblockStats} />
              </div>
            </div>
          )}

          {section === 'downloads' && (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="settings-card-heading"><div className="settings-card-icon"><HardDrive size={17} /></div><div><h2>Download location</h2><p>Files are handled by Chromium’s secure download pipeline.</p></div></div>
                <SettingRow title="Save files to" description={downloadDirectory || 'System Downloads folder'}>
                  <button className="secondary-button" type="button" onClick={onChooseDownloadDirectory}>Choose folder</button>
                </SettingRow>
                <Toggle checked={settings.askBeforeDownload} onChange={(value) => update({ askBeforeDownload: value })} label="Ask before downloading" description="Show a save dialog for each file." />
              </div>
              <div className="settings-card info-card"><Download size={17} /><div><strong>Safe by default</strong><span>Download names are sanitized and the renderer cannot choose arbitrary filesystem paths.</span></div></div>
            </div>
          )}

          {section === 'performance' && (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="settings-card-heading"><div className="settings-card-icon"><Zap size={17} /></div><div><h2>Performance profile</h2><p>Choose how Novaris balances page responsiveness and background resource use.</p></div></div>
                <div className="performance-options">
                  {[
                    { id: 'speed', label: 'Speed', description: 'Keeps background pages active for instant switching.', icon: Zap },
                    { id: 'balanced', label: 'Balanced', description: 'Chromium background throttling for everyday use.', icon: Gauge },
                    { id: 'memory', label: 'Memory saver', description: 'Reduces work in inactive tabs to protect memory.', icon: HardDrive },
                  ].map(({ id, label, description, icon: Icon }) => <button className={`performance-option${settings.performanceMode === id ? ' is-active' : ''}`} type="button" key={id} onClick={() => update({ performanceMode: id })}><span className="performance-icon"><Icon size={16} /></span><span><strong>{label}</strong><small>{description}</small></span>{settings.performanceMode === id && <Check size={14} />}</button>)}
                </div>
                <Toggle checked={settings.backgroundThrottling} onChange={(value) => update({ backgroundThrottling: value })} label="Throttle background tabs" description="Applies to page timers and animations in inactive tabs." />
                <Toggle checked={settings.suspendBackgroundTabs} onChange={(value) => update({ suspendBackgroundTabs: value })} label="Reduce inactive tab work" description="Recommended with Memory saver; active tabs remain responsive." />
                <Toggle checked={settings.reducedMotion} onChange={(value) => update({ reducedMotion: value })} label="Reduce interface motion" description="Disables non-essential glass and panel animations." />
                <Toggle checked={settings.globalHotkeyEnabled} onChange={(value) => update({ globalHotkeyEnabled: value })} label="Global focus hotkey" description={`Use ${settings.globalHotkey} to focus Novaris from another Windows app.`} />
                <SettingRow title="Hotkey combination" description="Use modifiers such as Ctrl, Alt, or Shift followed by one letter or number.">
                  <input className="hotkey-input" value={hotkeyDraft} onChange={(event) => setHotkeyDraft(event.target.value)} onBlur={() => update({ globalHotkey: hotkeyDraft })} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-label="Global focus hotkey combination" />
                </SettingRow>
              </div>
              <div className={`settings-card gaming-card${settings.gamingMode ? ' is-on' : ''}`}>
                <div className="settings-card-heading"><div className="settings-card-icon"><Gamepad2 size={17} /></div><div><h2>Gaming Mode</h2><p>Hand the CPU and memory to your game instead of to background tabs.</p></div></div>
                <Toggle checked={settings.gamingMode} onChange={(value) => update({ gamingMode: value })} label="Enable Gaming Mode" description="Unloads every tab you are not looking at, refuses all notifications, and stops the spellchecker." />
                {settings.gamingMode && (
                  <>
                    {suspendedTabs > 0 && (
                      <p className="gaming-status">
                        <Gamepad2 size={12} />
                        {suspendedTabs} tab{suspendedTabs === 1 ? '' : 's'} suspended right now. {gaming?.notificationsBlocked ? 'Notifications are refused.' : ''}{gaming && !gaming.spellcheckEnabled ? ' Spellchecker off.' : ''}
                      </p>
                    )}
                    <div className="gaming-effects">
                      {(gaming?.effects || []).map((effect) => (
                        <div className="gaming-effect" key={effect.id}>
                          <strong>{effect.title}</strong>
                          <span>{effect.detail}</span>
                        </div>
                      ))}
                    </div>
                    {gaming?.tradeoff && <p className="gaming-tradeoff"><AlertTriangle size={12} />{gaming.tradeoff}</p>}
                  </>
                )}
              </div>
              <div className="settings-card info-card"><Gauge size={17} /><div><strong>Applied safely</strong><span>Performance changes update existing webviews through the main process. Hardware acceleration changes still require a restart.</span></div></div>
            </div>
          )}

          {section === 'advanced' && (
            <div className="settings-stack">
              <div className="settings-card">
                <div className="settings-card-heading"><div className="settings-card-icon"><Code2 size={17} /></div><div><h2>Developer experience</h2><p>Tools for inspecting pages without changing the security boundary.</p></div></div>
                <Toggle checked={settings.developerTools} onChange={(value) => update({ developerTools: value })} label="Enable developer tools" description="Allows Ctrl + Shift + I on the active page." />
                <Toggle checked={settings.hardwareAcceleration} onChange={(value) => update({ hardwareAcceleration: value })} label="Hardware acceleration" description="Applied the next time Novaris starts." />
              </div>
              <div className="settings-card info-card"><Gauge size={17} /><div><strong>Windows baseline</strong><span>Novaris uses the Chromium GPU and process model, with explicit throttling controls in Performance.</span></div></div>
            </div>
          )}

          {section === 'advanced' && (
            <div className="settings-card info-card engine-capability-card"><Gauge size={17} /><div><strong>Browser engine</strong><span>{engineCapabilities?.name || 'Electron + Chromium'} · Chromium {engineCapabilities?.chromiumVersion || 'detected at runtime'}. Novaris is preparing a CEF/Chromium migration spike while this build remains fully usable.</span></div></div>
          )}

          {section === 'shortcuts' && (
            <div className="settings-card shortcuts-card">
              <div className="settings-card-heading"><div className="settings-card-icon"><Keyboard size={17} /></div><div><h2>Keyboard shortcuts</h2><p>Modifier mappings automatically follow your platform.</p></div></div>
              <div className="shortcut-list">
                {[
                  ['Focus address bar', modifierLabel, 'L'],
                  ['New tab', modifierLabel, 'T'],
                  ['Close tab', modifierLabel, 'W'],
                  ['Reopen closed tab', modifierLabel, 'Shift + T'],
                  ['Reload page', modifierLabel, 'R'],
                  ['Find on page', modifierLabel, 'F'],
                  ['Bookmark page', modifierLabel, 'D'],
                  ['Zoom in', modifierLabel, '+'],
                  ['Zoom out', modifierLabel, '−'],
                  ['Reset zoom', modifierLabel, '0'],
                  ['Developer tools', modifierLabel, 'Shift + I'],
                  ['Command palette', modifierLabel, 'Shift + K'],
                ].map(([label, modifier, key]) => <div className="shortcut-row" key={label}><span>{label}</span><span className="shortcut-combo"><kbd>{modifier}</kbd><kbd>{key}</kbd></span></div>)}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
