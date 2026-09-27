import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Globe2,
  LockKeyhole,
  Package,
  ShieldCheck,
  ShieldX,
  X,
} from 'lucide-react';

const VERDICT_ICON = {
  safe: CheckCircle2,
  caution: AlertTriangle,
  dangerous: ShieldX,
};

function hostLabel(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url || '';
  }
}

export default function TrustCard({ activeUrl, isInternalPage, isNewTab }) {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState(null);
  const wrapRef = useRef(null);

  // Ask the main process for the card rather than deriving it in the renderer,
  // so the verdict shown is the same one the rest of the browser used.
  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    if (!window.novaris?.trustCard) return undefined;
    window.novaris.trustCard({ url: activeUrl, isInternal: Boolean(isInternalPage) })
      .then((value) => { if (active) setCard(value); })
      .catch(() => { if (active) setCard(null); });
    return () => { active = false; };
  }, [open, activeUrl, isInternalPage]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    const onDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const disabled = isNewTab || isInternalPage || !activeUrl;
  const verdict = card?.verdict;
  const Icon = verdict ? (VERDICT_ICON[verdict.tone] || ShieldCheck) : ShieldCheck;

  return (
    <div className="trust-card-wrap" ref={wrapRef}>
      <button
        className={`icon-button trust-card-button${open ? ' is-open' : ''}${verdict?.tone === 'dangerous' ? ' is-dangerous' : ''}${verdict?.tone === 'caution' ? ' is-caution' : ''}`}
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-label="Website trust card"
        aria-expanded={open}
        title="Website trust card"
      >
        <Icon size={16} />
      </button>

      {open && card && (
        <div className="trust-card" role="dialog" aria-label="Website trust card">
          <div className="trust-card-head">
            <div className={`trust-card-verdict is-${verdict?.tone || 'none'}`}>
              <Icon size={18} />
            </div>
            <div>
              <strong>{card.headline || card.title}</strong>
              <span className="trust-card-host">
                {card.https ? <LockKeyhole size={11} /> : <Globe2 size={11} />}
                {hostLabel(card.url || card.host)}
              </span>
            </div>
            <button className="trust-card-close" type="button" onClick={() => setOpen(false)} aria-label="Close trust card">
              <X size={14} />
            </button>
          </div>

          {verdict?.detail && <p className="trust-card-detail">{verdict.detail}</p>}

          {card.onBlocklist && (
            <div className="trust-card-flag is-dangerous">
              <AlertTriangle size={13} />
              <span>On the reported scam and malware list. {card.blocklistReason}</span>
            </div>
          )}

          {card.blockedNote && (
            <div className="trust-card-flag is-dangerous">
              <AlertTriangle size={13} />
              <span>{card.blockedNote}</span>
            </div>
          )}

          <div className="trust-card-section">
            <span className="trust-card-label">Connection</span>
            <span className="trust-card-value">
              {card.https ? 'Encrypted (HTTPS)' : 'Not encrypted'}
            </span>
          </div>

          {Array.isArray(card.reasons) && card.reasons.length > 0 && (
            <div className="trust-card-section">
              <span className="trust-card-label">Why Novaris says this</span>
              <ul className="trust-card-reasons">
                {card.reasons.map((reason) => (
                  <li key={reason.id}>
                    <strong>{reason.title}</strong>
                    <span>{reason.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="trust-card-section">
            <span className="trust-card-label">This site can use</span>
            {card.permissions?.length ? (
              <div className="trust-card-chips">
                {card.permissions.map((permission) => (
                  <span className="trust-card-chip" key={permission.key}>{permission.label}</span>
                ))}
              </div>
            ) : (
              <span className="trust-card-value">No permissions granted</span>
            )}
          </div>

          <div className="trust-card-section">
            <span className="trust-card-label">Extensions that can read this page</span>
            {card.extensions?.length ? (
              <div className="trust-card-chips">
                {card.extensions.map((extension) => (
                  <span className="trust-card-chip" key={extension.id}>
                    {extension.builtin ? <ShieldCheck size={10} /> : <Package size={10} />}
                    {extension.name}
                  </span>
                ))}
              </div>
            ) : (
              <span className="trust-card-value">None</span>
            )}
          </div>

          <div className="trust-card-section">
            <span className="trust-card-label">Advertising and tracking</span>
            <span className="trust-card-value">
              {card.adblock?.enabled
                ? `Blocked on this device${card.adblock.blockedRequests ? ` · ${card.adblock.blockedRequests} requests stopped` : ''}`
                : 'Ad blocking is off'}
            </span>
          </div>

          <p className="trust-card-foot">
            Checked on this device. Novaris sends no address to anyone to produce this card.
          </p>
        </div>
      )}
    </div>
  );
}
