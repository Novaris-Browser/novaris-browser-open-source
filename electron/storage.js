const fs = require('node:fs');
const path = require('node:path');

function directorySize(directory) {
  if (!directory || !fs.existsSync(directory)) return 0;
  let total = 0;
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else {
        try { total += fs.statSync(fullPath).size; } catch { /* File may be changing. */ }
      }
    }
  }
  return total;
}

function storageOverview({ app, store, vault }) {
  const userData = app.getPath('userData');
  const partitions = path.join(userData, 'Partitions');
  const vaultPath = vault?.filePath || path.join(userData, 'novaris-vault.bin');
  const dataBytes = directorySize(userData);
  const partitionBytes = directorySize(partitions);
  const vaultBytes = fs.existsSync(vaultPath) ? fs.statSync(vaultPath).size : 0;
  const metrics = app.getAppMetrics?.() || [];
  const memory = metrics.reduce((sum, item) => sum + ((Number(item.memory?.workingSetSize) || 0) * 1024), 0);
  return {
    totalBytes: dataBytes,
    partitionBytes,
    vaultBytes,
    historyEntries: store.snapshot().history.length,
    bookmarkCount: store.snapshot().bookmarks.length,
    downloadCount: store.snapshot().downloads.length,
    memoryBytes: memory,
    generatedAt: Date.now(),
  };
}

module.exports = { directorySize, storageOverview };
