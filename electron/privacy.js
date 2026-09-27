const { session } = require('electron');
const { PERSISTENT_PARTITION } = require('./downloads');

function dataTypesForSettings(settings = {}) {
  const dataTypes = [];
  if (settings.clearCookiesOnExit !== false) {
    dataTypes.push('cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers');
  }
  if (settings.clearCacheOnExit !== false) dataTypes.push('cache');
  return [...new Set(dataTypes)];
}

async function clearConfiguredData(settings = {}) {
  const dataTypes = dataTypesForSettings(settings);
  if (!dataTypes.length) return;

  const browserSessions = new Set([
    session.defaultSession,
    session.fromPartition(PERSISTENT_PARTITION),
  ]);
  await Promise.all(
    [...browserSessions].map((browserSession) => {
      if (typeof browserSession.clearData === 'function') {
        return browserSession.clearData({ dataTypes });
      }
      return browserSession.clearBrowsingData({ all: true });
    }),
  );
}

function installExitPrivacy({ app, getStore }) {
  let handling = false;
  let allowNextQuit = false;

  app.on('before-quit', (event) => {
    if (allowNextQuit) return;
    const settings = getStore().snapshot().settings;
    const shouldClearHistory = settings.clearHistoryOnExit !== false;
    if (settings.clearOnExit !== true || (!settings.clearCookiesOnExit && !settings.clearCacheOnExit && !shouldClearHistory)) return;
    if (handling) {
      event.preventDefault();
      return;
    }

    handling = true;
    event.preventDefault();
    void clearConfiguredData(settings)
      .catch((error) => console.error('Novaris exit privacy cleanup failed:', error))
      .finally(() => {
        if (shouldClearHistory) getStore().clearHistory();
        handling = false;
        allowNextQuit = true;
        app.quit();
      });
  });
}

module.exports = {
  clearConfiguredData,
  dataTypesForSettings,
  installExitPrivacy,
};
