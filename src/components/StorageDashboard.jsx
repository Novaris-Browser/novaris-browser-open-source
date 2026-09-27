import { Database, HardDrive, RefreshCw, Trash2 } from 'lucide-react';
import { formatBytes } from '../lib/format';

function originFor(value) {
  try { return new URL(value).origin; } catch { return ''; }
}

export default function StorageDashboard({ overview, activeUrl, onRefresh, onClearSite }) {
  const origin = originFor(activeUrl);
  return (
    <div className="storage-dashboard">
      <div className="storage-overview"><div className="storage-overview-icon"><Database size={19} /></div><div><strong>Storage overview</strong><span>Local usage for Novaris and Chromium site data.</span></div><button className="secondary-button" type="button" onClick={onRefresh}><RefreshCw size={13} />Refresh</button></div>
      <div className="storage-stat-grid"><div><HardDrive size={14} /><strong>{formatBytes(overview?.totalBytes || 0)}</strong><span>User data</span></div><div><Database size={14} /><strong>{formatBytes(overview?.partitionBytes || 0)}</strong><span>Site partitions</span></div><div><strong>{formatBytes(overview?.vaultBytes || 0)}</strong><span>Encrypted vault</span></div><div><strong>{formatBytes(overview?.memoryBytes || 0)}</strong><span>Working memory</span></div></div>
      <div className="storage-counts"><span>{overview?.bookmarkCount || 0} bookmarks</span><span>{overview?.historyEntries || 0} history entries</span><span>{overview?.downloadCount || 0} downloads</span></div>
      {origin && <div className="storage-site"><div><span className="eyebrow">Current site</span><strong>{origin}</strong></div><button className="danger-button" type="button" onClick={() => onClearSite(origin)}><Trash2 size={13} />Clear site data</button></div>}
    </div>
  );
}
