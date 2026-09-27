const ENGINE_ID = 'electron-chromium';

function createEngineAdapter({ browserSession }) {
  return {
    id: ENGINE_ID,
    browserSession,
    extensionApi: browserSession?.extensions || browserSession,
    capabilities: getEngineCapabilities(),
  };
}

function getEngineCapabilities() {
  const electronVersion = typeof process !== 'undefined' ? process.versions.electron : '';
  const chromiumVersion = typeof process !== 'undefined' ? (process.versions.chrome || process.versions.chromium || '') : '';
  return {
    id: ENGINE_ID,
    name: 'Electron + Chromium',
    electronVersion,
    chromiumVersion,
    platform: typeof process !== 'undefined' ? process.platform : 'unknown',
    renderer: 'chromium',
    sessionPartition: 'persist:novaris',
    capabilities: {
      unpackedExtensions: true,
      importedCrxPackages: true,
      chromeWebStoreInstaller: false,
      fullChromeExtensionApi: false,
      nativeChromiumTabs: false,
    },
    migration: {
      phase: 'spike',
      target: 'CEF or Chromium host',
      status: 'design-and-readiness',
      blockers: [
        'A native Windows C++ toolchain and CEF SDK are required for a CEF host.',
        'Chrome does not expose a public consumer Chrome Web Store installation API.',
        'A CEF host still needs a custom extension distribution and update policy.',
      ],
    },
  };
}

module.exports = { ENGINE_ID, createEngineAdapter, getEngineCapabilities };
