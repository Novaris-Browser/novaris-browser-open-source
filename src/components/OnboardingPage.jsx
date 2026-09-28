import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  Globe2,
  Home,
  KeyRound,
  LockKeyhole,
  Moon,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload,
} from 'lucide-react';
import { SEARCH_ENGINES } from '../lib/url';

const ENGINE_DESCRIPTIONS = {
  duckduckgo: 'Private, balanced results',
  google: 'Broad index and familiar search',
  bing: 'Microsoft search results',
  brave: 'Independent index with privacy focus',
  startpage: 'Classic web results with a lighter feel',
  ecosia: 'Search that supports environmental projects',
};

export default function OnboardingPage({
  settings,
  theme,
  style,
  windowState,
  onClose,
  onMinimize,
  onMaximize,
  onMakeDefault,
  onImportBookmarks,
  onImportPasswords,
  onSetupMaster,
  vaultStatus,
  platform,
  onComplete,
}) {
  const [step, setStep] = useState(1);
  const [searchEngine, setSearchEngine] = useState(settings.searchEngine || 'duckduckgo');
  const [startupBehavior, setStartupBehavior] = useState(settings.startupBehavior || 'newtab');
  const [themeChoice, setThemeChoice] = useState(settings.theme || 'system');
  const [privacyMode, setPrivacyMode] = useState(settings.clearOnExit ? 'clean' : 'persistent');
  const [defaultRequested, setDefaultRequested] = useState(false);
  const [defaultRegistered, setDefaultRegistered] = useState(false);
  const [defaultBusy, setDefaultBusy] = useState(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [bookmarkMessage, setBookmarkMessage] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [masterConfirm, setMasterConfirm] = useState('');
  const [masterError, setMasterError] = useState('');
  const [finishing, setFinishing] = useState(false);

  const makeDefault = async () => {
    setDefaultBusy(true);
    const result = await onMakeDefault();
    setDefaultRequested(Boolean(result?.opened));
    setDefaultRegistered(Boolean(result?.supported));
    setDefaultBusy(false);
  };

  const importBookmarks = async () => {
    if (!onImportBookmarks) return;
    setBookmarkBusy(true);
    const result = await onImportBookmarks();
    setBookmarkMessage(result?.added ? `${result.added} bookmark${result.added === 1 ? '' : 's'} imported.` : 'No new bookmarks found.');
    setBookmarkBusy(false);
  };

  const importPasswords = async () => {
    if (!onImportPasswords) return;
    setPasswordBusy(true);
    const result = await onImportPasswords();
    setPasswordMessage(result?.imported ? `${result.imported} password${result.imported === 1 ? '' : 's'} ready in your vault.` : 'No passwords were imported.');
    setPasswordBusy(false);
  };

  const finish = async () => {
    if (masterPassword && masterPassword.length < 8) {
      setMasterError('Use at least 8 characters for your vault password.');
      return;
    }
    if (masterPassword && masterPassword !== masterConfirm) {
      setMasterError('The vault passwords do not match.');
      return;
    }
    setMasterError('');
    setFinishing(true);
    if (masterPassword && onSetupMaster) {
      const result = await onSetupMaster(masterPassword);
      if (!result) {
        setFinishing(false);
        return;
      }
    }
    await onComplete({
      searchEngine,
      makeDefault: defaultRequested,
      startupBehavior,
      theme: themeChoice,
      clearOnExit: privacyMode === 'clean',
    });
    setFinishing(false);
  };

  const next = () => setStep((current) => Math.min(3, current + 1));
  const back = () => setStep((current) => Math.max(1, current - 1));
  const activeTheme = themeChoice === 'system' ? theme : themeChoice;

  return (
    <div className={`app-shell onboarding-shell ${activeTheme === 'dark' ? 'theme-dark' : 'theme-light'}`} style={style}>
      <div className="ambient-background" aria-hidden="true"><span className="ambient-orb orb-a" /><span className="ambient-orb orb-b" /><span className="ambient-orb orb-c" /></div>
      <header className="titlebar app-drag-region onboarding-titlebar">
        <div className="brand-lockup"><div className="brand-mark"><Sparkles size={15} /></div><div className="brand-copy"><span className="brand-name">Novaris</span><span className="brand-product">First-run setup</span></div></div>
        <div className="onboarding-step-label">Step {step} of 3</div>
        <div className="titlebar-actions no-drag-region"><button className="window-control" type="button" onClick={onMinimize} aria-label="Minimize"><span>—</span></button><button className="window-control" type="button" onClick={onMaximize} aria-label="Maximize"><span>{windowState.maximized ? '❐' : '□'}</span></button><button className="window-control window-control-close" type="button" onClick={onClose} aria-label="Close"><span>×</span></button></div>
      </header>

      <main className="onboarding-main">
        <div className="onboarding-progress"><span className={step >= 1 ? 'is-active' : ''} /><span className={step >= 2 ? 'is-active' : ''} /><span className={step >= 3 ? 'is-active' : ''} /></div>
        {step === 1 && (
          <section className="onboarding-card onboarding-welcome">
            <div className="onboarding-hero-icon"><Globe2 size={25} /></div>
            <span className="eyebrow">Welcome to Novaris</span>
            <h1>A calmer way<br /><em>to browse.</em></h1>
            <p className="onboarding-lead">Your data stays on this device. Novaris uses a real Chromium engine, isolated page views, and an operating-system-protected vault for the credentials you choose to save.</p>
            <div className="onboarding-benefits">
              <div><ShieldCheck size={17} /><span><strong>Private by architecture</strong><small>Pages never receive Node.js access.</small></span></div>
              <div><KeyRound size={17} /><span><strong>Your own local vault</strong><small>{platform === 'linux' ? 'Encrypted by your system keyring, never uploaded.' : 'Encrypted by Windows, never uploaded.'}</small></span></div>
            </div>
            <div className="default-browser-card">
              <div className="default-browser-icon"><Globe2 size={19} /></div>
              <div><strong>Make Novaris your default browser?</strong><span>{platform === 'linux' ? 'Your desktop settings will open so you can confirm.' : 'Windows will open its Default Apps settings for confirmation.'}</span></div>
              <button className="secondary-button" type="button" onClick={makeDefault} disabled={defaultBusy}>{defaultBusy ? 'Opening…' : defaultRequested ? 'Settings opened' : defaultRegistered ? 'Registered' : 'Make default'}</button>
            </div>
            <div className="onboarding-import-card"><div className="default-browser-icon"><Upload size={18} /></div><div><strong>Bring your bookmarks with you</strong><span>{bookmarkMessage || 'Import an exported Chrome, Edge, or Firefox bookmarks HTML file.'}</span></div><button className="secondary-button" type="button" onClick={importBookmarks} disabled={bookmarkBusy}>{bookmarkBusy ? 'Importing…' : 'Import HTML'}</button></div>
            <div className="onboarding-import-card"><div className="default-browser-icon"><LockKeyhole size={18} /></div><div><strong>Import passwords from Chrome or Edge?</strong><span>{passwordMessage || 'Use a CSV export you created. Novaris never reads another browser’s encrypted password database.'}</span></div><button className="secondary-button" type="button" onClick={importPasswords} disabled={passwordBusy}>{passwordBusy ? 'Importing…' : 'Import CSV'}</button></div>
            <div className="onboarding-actions"><button className="primary-button" type="button" onClick={next}>Continue <ArrowRight size={15} /></button><button className="text-action" type="button" onClick={next}>I’ll do this later</button></div>
          </section>
        )}

        {step === 2 && (
          <section className="onboarding-card onboarding-search-setup">
            <div className="onboarding-hero-icon search-icon"><Search size={24} /></div>
            <span className="eyebrow">Choose your search</span>
            <h1>Where should curiosity<br /><em>take you?</em></h1>
            <p className="onboarding-lead">Novaris will use this provider for phrases entered in the address bar. You can change it any time in Settings.</p>
            <div className="engine-grid">
              {Object.entries(SEARCH_ENGINES).map(([id, engine]) => (
                <button className={`engine-card${searchEngine === id ? ' is-selected' : ''}`} type="button" key={id} onClick={() => setSearchEngine(id)}>
                  <span className="engine-check">{searchEngine === id && <Check size={13} />}</span>
                  <span><strong>{engine.label}</strong><small>{ENGINE_DESCRIPTIONS[id]}</small></span>
                </button>
              ))}
            </div>
            <div className="onboarding-actions"><button className="secondary-button" type="button" onClick={back}><ArrowLeft size={15} />Back</button><button className="primary-button" type="button" onClick={next}>Continue <ArrowRight size={15} /></button></div>
          </section>
        )}

        {step === 3 && (
          <section className="onboarding-card onboarding-personalize">
            <div className="onboarding-hero-icon personalize-icon"><Sparkles size={24} /></div>
            <span className="eyebrow">Make it yours</span>
            <h1>Set the mood.<br /><em>Keep control.</em></h1>
            <p className="onboarding-lead">These choices are saved on this device and can be changed any time in Settings.</p>
            <div className="onboarding-choice-group"><span className="eyebrow">Appearance</span><div className="onboarding-choice-row">{[['system', 'Follow system', Sparkles], ['light', 'Light', Sun], ['dark', 'Dark', Moon]].map(([id, label, Icon]) => <button className={`onboarding-choice${themeChoice === id ? ' is-selected' : ''}`} type="button" key={id} onClick={() => setThemeChoice(id)}><Icon size={15} /><span>{label}</span>{themeChoice === id && <Check size={13} />}</button>)}</div></div>
            <div className="onboarding-choice-group"><span className="eyebrow">Opening Novaris</span><div className="onboarding-choice-row">{[['newtab', 'New Tab', Sparkles], ['homepage', 'My homepage', Home]].map(([id, label, Icon]) => <button className={`onboarding-choice${startupBehavior === id ? ' is-selected' : ''}`} type="button" key={id} onClick={() => setStartupBehavior(id)}><Icon size={15} /><span>{label}</span>{startupBehavior === id && <Check size={13} />}</button>)}</div></div>
            <div className="onboarding-choice-group"><span className="eyebrow">Privacy baseline</span><div className="onboarding-choice-row">{[['persistent', 'Keep data', Database], ['clean', 'Clear on exit', ShieldCheck]].map(([id, label, Icon]) => <button className={`onboarding-choice${privacyMode === id ? ' is-selected' : ''}`} type="button" key={id} onClick={() => setPrivacyMode(id)}><Icon size={15} /><span>{label}</span>{privacyMode === id && <Check size={13} />}</button>)}</div></div>
            <div className="onboarding-choice-group onboarding-master-group"><span className="eyebrow">Vault password (recommended)</span>{vaultStatus?.masterConfigured ? <div className="onboarding-master-ready"><Check size={14} /><span>Your vault lock is already configured.</span></div> : <><div className="onboarding-master-note"><LockKeyhole size={14} /><span>Optional, but recommended. It adds an application lock in front of system encryption. Novaris cannot recover a forgotten password.</span></div><div className="onboarding-master-inputs"><input type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} placeholder="Create vault password" aria-label="Create vault password" /><input type="password" value={masterConfirm} onChange={(event) => setMasterConfirm(event.target.value)} placeholder="Repeat password" aria-label="Repeat vault password" /></div>{masterError && <p className="form-error">{masterError}</p>}</>}</div>
            <div className="onboarding-actions"><button className="secondary-button" type="button" onClick={back}><ArrowLeft size={15} />Back</button><button className="primary-button" type="button" onClick={finish} disabled={finishing}>{finishing ? 'Preparing Novaris…' : 'Open my browser'} <ArrowRight size={15} /></button></div>
          </section>
        )}
      </main>
      <footer className="onboarding-footer"><span>{platform === 'linux' ? 'Novaris Browser for Linux' : 'Novaris Browser for Windows'}</span><span>Data directory: this device</span></footer>
    </div>
  );
}
