function backgroundThrottlingEnabled(settings = {}) {
  return settings.performanceMode !== 'speed' && settings.backgroundThrottling !== false;
}

function tabThrottlingEnabled(settings = {}, active = false) {
  if (!backgroundThrottlingEnabled(settings)) return false;
  return active || settings.suspendBackgroundTabs !== true;
}

module.exports = {
  backgroundThrottlingEnabled,
  tabThrottlingEnabled,
};
