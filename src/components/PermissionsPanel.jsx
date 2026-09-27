import { useMemo } from 'react';
import { Camera, Clipboard, Download, Globe2, MapPin, Mic, RefreshCw, ShieldCheck, Volume2 } from 'lucide-react';

const PERMISSIONS = [
  { key: 'camera', label: 'Camera', icon: Camera },
  { key: 'microphone', label: 'Microphone', icon: Mic },
  { key: 'notifications', label: 'Notifications', icon: Volume2 },
  { key: 'geolocation', label: 'Location', icon: MapPin },
  { key: 'clipboardRead', label: 'Clipboard read', icon: Clipboard },
  { key: 'downloads', label: 'Downloads', icon: Download },
];

function originFor(value) {
  try { return new URL(value).origin; } catch { return ''; }
}

export default function PermissionsPanel({ activeUrl, permissions, onSet, onReset }) {
  const currentOrigin = useMemo(() => originFor(activeUrl), [activeUrl]);
  const savedOrigins = Object.keys(permissions || {});
  const current = currentOrigin ? permissions?.[currentOrigin] || {} : {};

  return (
    <div className="permissions-panel">
      <div className="permissions-current"><div className="permissions-site-icon"><Globe2 size={18} /></div><div><span className="eyebrow">Current website</span><strong>{currentOrigin || 'No website selected'}</strong><small>{currentOrigin ? 'Choose what this site can access.' : 'Open a web page to manage site permissions.'}</small></div></div>
      {currentOrigin && <div className="permission-list">{PERMISSIONS.map(({ key, label, icon: Icon }) => <div className="permission-row" key={key}><span className="permission-icon"><Icon size={14} /></span><strong>{label}</strong><div className="permission-choice"><button className={current[key] === 'allow' ? 'is-allow' : ''} type="button" onClick={() => onSet(currentOrigin, key, 'allow')}>Allow</button><button className={!current[key] || current[key] === 'block' ? 'is-block' : ''} type="button" onClick={() => onSet(currentOrigin, key, 'block')}>Block</button></div></div>)}<button className="reset-permissions" type="button" onClick={() => onReset(currentOrigin)}><RefreshCw size={12} />Reset this site</button></div>}
      <div className="permissions-saved"><div className="engine-manager-heading"><span>Saved site policies</span><small>{savedOrigins.length}</small></div>{savedOrigins.length === 0 ? <p>No site has a custom permission policy yet.</p> : savedOrigins.map((origin) => <div className="saved-permission-row" key={origin}><span>{origin}</span><button type="button" onClick={() => onReset(origin)}><RefreshCw size={12} /></button></div>)}</div>
      <div className="permissions-note"><ShieldCheck size={14} /><span>Novaris denies sensitive requests by default. A policy applies only to the exact website origin shown above.</span></div>
    </div>
  );
}
