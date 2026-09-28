import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Command,
  Download,
  FilePlus2,
  Globe2,
  History,
  KeyRound,
  LockKeyhole,
  Maximize2,
  RotateCcw,
  Search,
  Settings2,
  Star,
} from 'lucide-react';
import BootScreen from './components/BootScreen';
import ContextMenu from './components/ContextMenu';
import CommandPalette from './components/CommandPalette';
import ErrorState from './components/ErrorState';
import ExtensionActionBar from './components/ExtensionActionBar';
import OnboardingPage from './components/OnboardingPage';
import FindBar from './components/FindBar';
import InternalPage from './components/InternalPage';
import NewTabPage from './components/NewTabPage';
import ReaderView from './components/ReaderView';
import SafetyBlockScreen from './components/SafetyBlockScreen';
import VaultLockGate from './components/VaultLockGate';
import UpdatePrompt from './components/UpdatePrompt';
import UpdateSummary from './components/UpdateSummary';
import CredentialWarning from './components/CredentialWarning';
import SettingsPage from './components/SettingsPage';
import Sidebar from './components/Sidebar';
import TabStrip from './components/TabStrip';
import TitleBar from './components/TitleBar';
import Toast from './components/Toast';
import Toolbar from './components/Toolbar';
import WebviewSurface from './components/WebviewSurface';
import { suspendedTabCount } from './lib/gaming';
import VerticalTabStrip from './components/VerticalTabStrip';
import AppRail from './components/AppRail';
import MediaBar from './components/MediaBar';
import TabTransferPanel from './components/TabTransferPanel';
import { useBrowser } from './hooks/useBrowser';
import { displayUrl, isSecureUrl } from './lib/url';

function useSystemTheme() {
  const [systemDark, setSystemDark] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  ));

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const onChange = (event) => setSystemDark(event.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  return systemDark;
}

function StatusBar({ activeTab, zoom, onZoomOut, onZoomIn, onResetZoom }) {
  const secure = isSecureUrl(activeTab?.url);
  const label = activeTab?.isNewTab ? 'Ready for a new page' : activeTab?.isInternalPage ? 'Novaris page' : activeTab?.loading ? 'Loading page' : secure ? 'Secure connection' : 'Web connection';

  return (
    <footer className="status-bar">
      <div className="status-left">
        <span className={`status-secure${secure ? ' is-secure' : ''}`}>
          {secure ? <LockKeyhole size={12} /> : <Globe2 size={12} />}
        </span>
        <span className="status-label">{label}</span>
        {activeTab && !activeTab.isNewTab && !activeTab.isInternalPage && <span className="status-url">{displayUrl(activeTab.url)}</span>}
      </div>
      <div className="status-right">
        <span className="status-zoom-label">Zoom</span>
        <button className="zoom-button" type="button" onClick={onZoomOut} aria-label="Zoom out" title="Zoom out">−</button>
        <button className="zoom-value" type="button" onClick={onResetZoom} title="Reset zoom">{Math.round(zoom * 100)}%</button>
        <button className="zoom-button" type="button" onClick={onZoomIn} aria-label="Zoom in" title="Zoom in">+</button>
      </div>
    </footer>
  );
}

export default function App() {
  const browser = useBrowser();
  const systemDark = useSystemTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarView, setSidebarView] = useState('bookmarks');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState('general');
  const [menuOpen, setMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  // Apps rail, and the media bar that follows whatever the active page is playing.
  const [appsOpen, setAppsOpen] = useState(false);
  const [activeAppId, setActiveAppId] = useState('');
  const [mediaVisible, setMediaVisible] = useState(true);
  const [transferOpen, setTransferOpen] = useState(false);

  // The media bridge lives in the page, so it has to be installed whenever the
  // active webview changes and torn down when it goes away.
  useEffect(() => {
    const id = browser.activeTab?.webviewId;
    if (!id || !window.novaris?.installMediaBridge) return undefined;
    window.novaris.installMediaBridge(id).catch(() => {});
    return () => {};
  }, [browser.activeTab?.webviewId]);

  const sendMediaCommand = useCallback((id, action, value) => {
    if (!window.novaris?.sendMediaCommand) return Promise.resolve(null);
    if (action === '__read') return window.novaris.readMedia(id);
    return window.novaris.sendMediaCommand(id, action, value);
  }, []);

  const serveTabTransfer = useCallback((payload) => window.novaris.serveTabTransfer(payload), []);

  const receiveTabTransfer = useCallback(async (payload) => {
    const outcome = await window.novaris.receiveTabTransfer(payload);
    if (outcome?.tab?.url) browser.addTab({ url: outcome.tab.url, title: outcome.tab.title, hasWebView: true });
    return outcome;
  }, [browser.addTab]);

  useEffect(() => {
    if (browser.commandPaletteToken > 0) setCommandOpen(true);
  }, [browser.commandPaletteToken]);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen]);

  const dark = browser.settings.theme === 'dark' || (browser.settings.theme === 'system' && systemDark);
  const activeTab = browser.activeTab;
  const openSettings = (section = 'general') => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };
  useEffect(() => {
    const page = activeTab?.internalPage;
    if (!page || page === 'newtab' || page === 'about') return;
    if (page === 'settings' || page === 'extensions') {
      openSettings(page === 'extensions' ? 'extensions' : 'general');
      return;
    }
    setSidebarView(page === 'reading-list' ? 'reading' : page);
    setSidebarOpen(true);
  }, [activeTab?.internalPage]);
  const modifierLabel = 'Ctrl';
  const downloadCount = browser.downloads.filter((item) => item.state === 'progressing' || item.state === 'paused').length;

  // One check per launch, a little after boot so it never delays the first paint.
  useEffect(() => {
    if (!browser.api?.checkForUpdates) return undefined;
    const timer = setTimeout(() => { void browser.checkForUpdates(); }, 4000);
    return () => clearTimeout(timer);
  }, [browser.api, browser.checkForUpdates]);
  const appStyle = {
    '--accent': browser.settings.accent,
    '--surface-alpha': browser.settings.transparency,
  };

  const openSidebar = (view = 'bookmarks') => {
    setSidebarView(view);
    setSidebarOpen(true);
  };

  const menuActions = useMemo(() => [
    { id: 'new-tab', label: 'New tab', hint: `${modifierLabel}T`, icon: FilePlus2, onClick: browser.addTab },
    { id: 'reopen', label: 'Reopen closed tab', hint: `${modifierLabel}⇧T`, icon: RotateCcw, onClick: browser.reopenClosedTab },
    { id: 'find', label: 'Find on page', hint: `${modifierLabel}F`, icon: Search, onClick: browser.focusFind },
    { id: 'bookmark', label: 'Bookmark this page', hint: `${modifierLabel}D`, icon: Star, onClick: browser.toggleBookmark },
    { id: 'reading', label: 'Add to reading list', icon: BookOpen, onClick: () => browser.toggleReadingList(activeTab) },
    { id: 'downloads', label: 'Open downloads', icon: Download, onClick: () => openSidebar('downloads') },
    { id: 'history', label: 'Open history', icon: History, onClick: () => openSidebar('history') },
    { id: 'passwords', label: 'Open saved passwords', icon: KeyRound, onClick: () => openSidebar('passwords') },
    { id: 'fullscreen', label: browser.windowState.fullScreen ? 'Exit full screen' : 'Enter full screen', icon: Maximize2, onClick: browser.toggleFullscreen },
    { id: 'command-palette', label: 'Command palette', hint: `${modifierLabel}⇧K`, icon: Command, onClick: () => setCommandOpen(true) },
    { id: 'settings', label: 'Settings', icon: Settings2, onClick: () => openSettings('general') },
  ], [activeTab, browser, browser.windowState.fullScreen, modifierLabel]);

  const commandActions = useMemo(() => [
    { id: 'new-tab', label: 'New tab', hint: `${modifierLabel}T`, icon: FilePlus2, onClick: browser.addTab },
    { id: 'reopen', label: 'Reopen closed tab', hint: `${modifierLabel}⇧T`, icon: RotateCcw, onClick: browser.reopenClosedTab },
    { id: 'address', label: 'Focus address bar', hint: `${modifierLabel}L`, icon: Search, onClick: browser.focusAddress },
    { id: 'bookmarks', label: 'Open bookmarks', icon: Star, onClick: () => openSidebar('bookmarks') },
    { id: 'history', label: 'Open history', icon: History, onClick: () => openSidebar('history') },
    { id: 'downloads', label: 'Open downloads', icon: Download, onClick: () => openSidebar('downloads') },
    { id: 'passwords', label: 'Open saved passwords', icon: KeyRound, onClick: () => openSidebar('passwords') },
    { id: 'extensions', label: 'Manage extensions', icon: Globe2, onClick: () => openSettings('extensions') },
    { id: 'reader', label: 'Toggle reader mode', icon: BookOpen, onClick: browser.toggleReaderMode },
    { id: 'find', label: 'Find on page', hint: `${modifierLabel}F`, icon: Search, onClick: browser.focusFind },
    { id: 'settings', label: 'Open settings', icon: Settings2, onClick: () => openSettings('general') },
  ], [activeTab, browser, modifierLabel]);

  if (browser.booting) return <BootScreen error={browser.bootError} />;

  if (browser.vaultStatus?.locked) {
    return (
      <VaultLockGate
        onUnlock={browser.unlockVault}
        onResetBrowser={async () => {
          const confirmed = window.confirm(
            'Reset Novaris?\n\nYour browser password cannot be recovered. Resetting deletes your saved passwords, bookmarks, history, and settings, then restarts Novaris into first-run setup.\n\nThis cannot be undone.',
          );
          if (confirmed) await browser.resetProfile();
        }}
        onClose={() => browser.api?.closeWindow()}
      />
    );
  }

  // After a full reset the user is told what happened and what changed before
  // the first-run setup starts again.
  if (browser.updateSummary) {
    return <UpdateSummary summary={browser.updateSummary} currentVersion={browser.version} onContinue={browser.continueAfterUpdate} />;
  }

  if (!browser.settings.onboardingCompleted) {
    return (
      <OnboardingPage
        settings={browser.settings}
        theme={dark ? 'dark' : 'light'}
        style={appStyle}
        windowState={browser.windowState}
        onClose={() => browser.api?.closeWindow()}
        onMinimize={() => browser.api?.minimizeWindow()}
        onMaximize={() => browser.api?.toggleMaximizeWindow()}
        onMakeDefault={browser.makeDefaultBrowser}
        onImportBookmarks={browser.importBookmarks}
        onImportPasswords={browser.importPasswordsCsv}
        onSetupMaster={browser.setupVaultMaster}
        vaultStatus={browser.vaultStatus}
        platform={browser.platform}
        onComplete={async ({ searchEngine, makeDefault, startupBehavior, theme: themeChoice, clearOnExit }) => {
          await browser.updateSettings({
            searchEngine,
            startupBehavior,
            theme: themeChoice,
            clearOnExit,
            clearCookiesOnExit: clearOnExit,
            clearCacheOnExit: clearOnExit,
            clearHistoryOnExit: clearOnExit,
            onboardingCompleted: true,
            defaultBrowserPrompted: true,
            defaultBrowserRequested: makeDefault,
          });
        }}
      />
    );
  }

  return (
    <div className={`app-shell ${dark ? 'theme-dark' : 'theme-light'}${browser.settings.reducedMotion ? ' reduce-motion' : ''}`} style={appStyle}>
      <div className="ambient-background" aria-hidden="true"><span className="ambient-orb orb-a" /><span className="ambient-orb orb-b" /><span className="ambient-orb orb-c" /><span className="ambient-noise" /></div>
      <TitleBar
        windowState={browser.windowState}
        onMenu={() => setMenuOpen((value) => !value)}
        onMinimize={() => browser.api?.minimizeWindow()}
        onMaximize={() => browser.api?.toggleMaximizeWindow()}
        onClose={() => browser.api?.closeWindow()}
      />
      <TabStrip
        tabs={browser.tabs}
        activeTabId={browser.activeTabId}
        onActivate={browser.activateTab}
        onClose={browser.closeTab}
        onAdd={() => browser.addTab()}
        onReorder={browser.reorderTabs}
        onTogglePin={browser.togglePinnedTab}
        groups={browser.tabGroups}
      />
      <Toolbar
        activeTab={activeTab}
        currentIsBookmarked={browser.currentIsBookmarked}
        currentIsReadingListed={browser.currentIsReadingListed}
        readerOpen={browser.readerOpen}
        addressFocusToken={browser.addressFocusToken}
        downloadCount={downloadCount}
        onBack={browser.goBack}
        onForward={browser.goForward}
        onReload={browser.reload}
        onStop={browser.stop}
        onHome={browser.goHome}
        onNavigate={browser.navigateActive}
        onToggleBookmark={browser.toggleBookmark}
        onToggleReadingList={() => browser.toggleReadingList(activeTab)}
        onToggleReader={browser.toggleReaderMode}
        onOpenPasswords={() => openSidebar('passwords')}
        onOpenSidebar={() => openSidebar('downloads')}
        onOpenSettings={() => openSettings('general')}
        onOpenMenu={() => setMenuOpen((value) => !value)}
        suggestions={[...browser.bookmarks, ...browser.history]}
      />
      <ExtensionActionBar extensions={browser.extensions} onOpenAction={browser.openExtensionAction} onToggleExtension={browser.toggleExtension} onOpenManager={() => openSettings('extensions')} />

      <div className="browser-workspace">
        <Sidebar
          open={sidebarOpen}
          activeView={sidebarView}
          onViewChange={setSidebarView}
          onClose={() => setSidebarOpen(false)}
          bookmarks={browser.bookmarks}
          history={browser.history}
          downloads={browser.downloads}
          readingList={browser.readingList}
          credentials={browser.credentials}
          vaultStatus={browser.vaultStatus}
          activeUrl={activeTab && !activeTab.isNewTab && !activeTab.isInternalPage ? activeTab.url : ''}
          onSaveCredential={browser.saveCredential}
          onRemoveCredential={browser.removeCredential}
          onCopyCredential={browser.copyCredentialSecret}
          onFillCredential={browser.fillCredential}
          onRefreshVault={browser.refreshVault}
          tabs={browser.tabs}
          activeTabId={browser.activeTabId}
          onNavigate={browser.navigateActive}
          onActivateTab={browser.activateTab}
          onRemoveBookmark={browser.removeBookmark}
          onToggleReading={browser.toggleReadingList}
          onClearHistory={browser.clearHistory}
          onClearDownloads={browser.clearDownloads}
          onOpenDownload={browser.openDownload}
          onShowDownload={browser.showDownload}
          onControlDownload={browser.controlDownload}
          tabGroups={browser.tabGroups}
          onCreateGroup={browser.createTabGroup}
          onRenameGroup={browser.renameTabGroup}
          onDeleteGroup={browser.deleteTabGroup}
          onAssignTabToGroup={browser.assignTabToGroup}
          onBookmarkCurrent={browser.toggleBookmark}
        />

        <main className="content-column">
          <FindBar
            open={browser.findOpen}
            query={browser.findQuery}
            result={browser.findResult}
            focusToken={browser.findFocusToken}
            onQueryChange={(value) => { browser.setFindQuery(value); browser.findInPage(value); }}
            onFind={() => browser.findInPage(browser.findQuery)}
            onPrevious={() => browser.findInPage(browser.findQuery, 'previous')}
            onNext={() => browser.findInPage(browser.findQuery, 'next')}
            onClose={browser.closeFind}
          />
          {mediaVisible && activeTab?.hasWebView && !activeTab?.isInternalPage && (
            <MediaBar
              active
              tabId={activeTab.webviewId}
              onSendCommand={sendMediaCommand}
              onClose={() => setMediaVisible(false)}
            />
          )}
          {transferOpen && (
            <TabTransferPanel
              tab={activeTab}
              onServe={serveTabTransfer}
              onStatus={() => window.novaris.tabTransferStatus()}
              onCancel={() => window.novaris.cancelTabTransfer()}
              onReceive={receiveTabTransfer}
              onClose={() => setTransferOpen(false)}
            />
          )}
          <div className={`content-viewport${activeTab?.isNewTab ? ' is-new-tab' : ''}`}>
            <VerticalTabStrip
              tabs={browser.tabs}
              groups={browser.tabGroups}
              workspaces={browser.workspaces}
              activeTabId={browser.activeTabId}
              activeWorkspaceId={browser.activeWorkspaceId}
              onSelectTab={browser.activateTab}
              onCloseTab={browser.closeTab}
              onMoveTab={browser.moveTabInStrip}
              onAssignGroup={browser.assignTabToGroup}
              onToggleGroup={browser.toggleTabGroup}
              onCreateGroup={async (workspaceId) => browser.createTabGroup('New group', '#7c8cff', workspaceId)}
              onSelectWorkspace={browser.selectWorkspace}
              onCreateWorkspace={() => browser.createWorkspace('Workspace')}
              onDeleteGroup={browser.deleteTabGroup}
              onDuplicateTab={browser.duplicateTab}
              onToggleMute={browser.toggleTabMute}
              onMoveToWorkspace={browser.moveTabToWorkspace}
            />
            <AppRail
              open={appsOpen}
              apps={browser.settings.sidebarApps}
              activeAppId={activeAppId}
              onSelectApp={setActiveAppId}
            />
            <div className="webview-layer" aria-hidden={activeTab?.isNewTab || activeTab?.isInternalPage ? 'true' : 'false'}>
              {browser.tabs.map((tab) => tab.hasWebView && (
                <WebviewSurface
                  key={tab.id}
                  tab={tab}
                  active={tab.id === browser.activeTabId && !tab.isNewTab && !tab.isInternalPage}
                  onEvent={browser.handleWebviewEvent}
                  registerRef={browser.registerWebview}
                  developerTools={browser.settings.developerTools}
                  gamingMode={browser.settings.gamingMode}
                />
              ))}
            </div>
            {activeTab?.isNewTab && (
              <NewTabPage
                settings={browser.settings}
                bookmarks={browser.bookmarks}
                history={browser.history}
                onNavigate={browser.navigateActive}
              />
            )}
            {activeTab?.isInternalPage && !activeTab?.isNewTab && (
              <InternalPage
                page={activeTab.internalPage}
                bookmarks={browser.bookmarks}
                history={browser.history}
                readingList={browser.readingList}
                downloads={browser.downloads}
                credentials={browser.credentials}
                extensions={browser.extensions}
                vaultStatus={browser.vaultStatus}
                onOpenUrl={browser.navigateActive}
                onOpenSettings={() => openSettings('general')}
                onOpenPasswords={() => openSidebar('passwords')}
                onOpenExtensions={() => openSettings('extensions')}
              />
            )}
            {browser.readerOpen && browser.readerContent && (
              <ReaderView
                content={browser.readerContent}
                settings={browser.settings}
                onClose={browser.closeReader}
                onOpenOriginal={() => { const url = browser.readerContent.url; browser.closeReader(); browser.navigateActive(url); }}
                onFontSize={(delta) => browser.updateSettings({ readerFontSize: browser.settings.readerFontSize + delta })}
              />
            )}
            {browser.blockedSite && <SafetyBlockScreen site={browser.blockedSite} onCancel={browser.dismissBlockedSite} onContinue={browser.continueUnsafeSite} />}
            {browser.credentialThreat && <CredentialWarning threat={browser.credentialThreat} onDismiss={browser.dismissCredentialThreat} />}
            {activeTab?.error && (
              <div className="error-overlay">
                <ErrorState error={activeTab.error} onRetry={browser.reload} onHome={browser.goHome} />
              </div>
            )}
            {activeTab?.loading && <div className="page-loading-line" aria-label="Page loading"><span /></div>}
          </div>
          <StatusBar activeTab={activeTab} zoom={browser.zoom} onZoomOut={browser.zoomOut} onZoomIn={browser.zoomIn} onResetZoom={browser.resetZoom} />
        </main>
      </div>

      {settingsOpen && (
        <div className="settings-overlay">
          <SettingsPage
            settings={browser.settings}
            engineCapabilities={browser.engineCapabilities}
            activeUrl={activeTab && !activeTab.isNewTab && !activeTab.isInternalPage ? activeTab.url : ''}
            sitePermissions={browser.sitePermissions}
            extensions={browser.extensions}
            adblock={browser.adblock}
            storageOverview={browser.storageOverview}
            downloadDirectory={browser.settings.downloadDirectory}
            vaultStatus={browser.vaultStatus}
            credentialCount={browser.credentials.length}
            suspendedTabs={suspendedTabCount(browser.tabs, browser.activeTabId, browser.settings.gamingMode)}
            initialSection={settingsSection}
            onUpdate={browser.updateSettings}
            onImportBookmarks={browser.importBookmarks}
            onImportPasswords={browser.importPasswordsCsv}
            platform={browser.platform}
            onChooseDownloadDirectory={browser.chooseDownloadDirectory}
            onClearBrowsingData={browser.clearBrowsingData}
            onSetSitePermission={browser.setSitePermission}
            onResetSitePermission={browser.resetSitePermission}
            onRefreshStorage={browser.refreshStorage}
            onClearSiteStorage={browser.clearSiteStorage}
            onChooseExtension={browser.chooseExtension}
            onOpenExtensionStore={browser.openExtensionStore}
            onImportExtensionPackage={browser.importExtensionPackage}
            onToggleExtension={browser.toggleExtension}
            onRemoveExtension={browser.removeExtension}
            onRestoreBuiltinExtension={browser.restoreBuiltinExtension}
            onUpdateAdblock={browser.updateAdblock}
            onRefreshExtensions={browser.refreshExtensions}
            onResetAdblockStats={browser.resetAdblockStats}
            onSetVaultMaster={browser.setVaultMaster}
            onChangeVaultMaster={browser.changeVaultMaster}
            onDisableVaultMaster={browser.disableVaultMaster}
            onUnlockVault={browser.unlockVault}
            onLockVault={browser.lockVault}
            onExportVault={browser.exportVault}
            onImportVault={browser.importVault}
            onOpenPasswords={() => { setSettingsOpen(false); openSidebar('passwords'); }}
            onMakeDefaultBrowser={async () => {
              const result = await browser.makeDefaultBrowser();
              if (result?.opened) await browser.updateSettings({ defaultBrowserPrompted: true, defaultBrowserRequested: true });
            }}
            onRunOnboarding={async () => {
              setSettingsOpen(false);
              await browser.updateSettings({ onboardingCompleted: false });
            }}
            onCheckForUpdates={browser.checkForUpdates}
            onDownloadUpdate={browser.downloadUpdate}
            onInstallUpdate={browser.installUpdate}
            onResetProfile={async () => {
              const confirmed = window.confirm(
                'Reset Novaris?\n\nThis permanently deletes your bookmarks, history, reading list, downloads, cookies, site data, saved passwords, extensions, ad blocker rules, and settings. Novaris will restart into first-run setup.\n\nThis cannot be undone.',
              );
              if (confirmed) await browser.resetProfile();
            }}
            updateState={browser.updateState}
            onClose={() => setSettingsOpen(false)}
            version={browser.version}
          />
        </div>
      )}

      <ContextMenu open={menuOpen} onClose={() => setMenuOpen(false)} actions={menuActions} />
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} actions={commandActions} />
      <UpdatePrompt
        state={browser.updateState}
        onCheck={browser.checkForUpdates}
        onDownload={browser.downloadUpdate}
        onInstall={browser.installUpdate}
        onDismiss={browser.dismissUpdatePrompt}
      />
      <Toast toast={browser.toast} onClose={browser.dismissToast} />
    </div>
  );
}
