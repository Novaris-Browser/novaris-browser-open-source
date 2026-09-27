const { globalShortcut } = require('electron');

function updateJumpList(app) {
  if (process.platform !== 'win32' || typeof app.setUserTasks !== 'function') return;
  const tasks = [
    { id: 'newtab', title: 'New tab', url: 'novaris://newtab', description: 'Open a fresh Novaris tab' },
    { id: 'bookmarks', title: 'Bookmarks', url: 'novaris://bookmarks', description: 'Open saved pages' },
    { id: 'history', title: 'History', url: 'novaris://history', description: 'Open browsing history' },
    { id: 'downloads', title: 'Downloads', url: 'novaris://downloads', description: 'Open downloads' },
  ].map((task) => ({
    program: process.execPath,
    arguments: task.url,
    title: task.title,
    description: task.description,
    iconPath: process.execPath,
    iconIndex: 0,
    workingDirectory: '',
  }));
  try { app.setUserTasks(tasks); } catch { /* Jump List is a Windows convenience feature. */ }
}

function installGlobalHotkey({ app, getWindow, getSettings }) {
  let registered = '';
  const update = () => {
    if (registered) {
      globalShortcut.unregister(registered);
      registered = '';
    }
    const settings = getSettings();
    if (settings.globalHotkeyEnabled && settings.globalHotkey) {
      try {
        const didRegister = globalShortcut.register(settings.globalHotkey, () => {
          const window = getWindow();
          if (!window) return;
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
        });
        if (didRegister) registered = settings.globalHotkey;
      } catch {
        globalShortcut.unregister(settings.globalHotkey);
      }
    }
  };
  update();
  app.on('will-quit', () => {
    if (registered) globalShortcut.unregister(registered);
  });
  return { update };
}

module.exports = { updateJumpList, installGlobalHotkey };
