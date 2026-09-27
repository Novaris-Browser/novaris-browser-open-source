import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, ExternalLink, ShieldAlert, X } from 'lucide-react';

export default function SafetyBlockScreen({ site, onCancel, onContinue }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [site?.url]);
  if (!site) return null;
  return (
    <div className="safety-block-screen" role="alertdialog" aria-modal="true" aria-label="Unsafe site warning">
      <div className="safety-block-card">
        <button className="safety-block-close" type="button" onClick={onCancel} aria-label="Close warning"><X size={15} /></button>
        <div className="safety-block-icon"><ShieldAlert size={26} /></div>
        <span className="eyebrow">Novaris safety protection</span>
        <h1>This site is unsafe</h1>
        <p className="safety-block-reason"><AlertTriangle size={14} />{site.reason || 'This site matches a scam, malware, or fraud risk list.'}</p>
        <code className="safety-block-url">{site.url}</code>
        {!confirming ? <><p className="safety-block-copy">Novaris blocked this navigation before the page loaded. Only continue if you understand the risk and trust the site owner.</p><div className="safety-block-actions"><button className="secondary-button" type="button" onClick={onCancel}><ArrowLeft size={14} />Go back</button><button className="danger-button" type="button" onClick={() => setConfirming(true)}><ExternalLink size={14} />Continue anyway</button></div></> : <div className="safety-confirm"><strong>Are you sure?</strong><span>This site may steal credentials, deliver malware, or run a scam. Continue only once.</span><div className="safety-block-actions"><button className="secondary-button" type="button" onClick={() => setConfirming(false)}>Cancel</button><button className="danger-button" type="button" onClick={onContinue}>Yes, continue once</button></div></div>}
      </div>
    </div>
  );
}
