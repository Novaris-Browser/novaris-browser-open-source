import { useState } from 'react';
import { KeyRound, ShieldAlert, X } from 'lucide-react';

// Shown when a page on an unrelated host asks for a password while using a
// well-known account provider's name. Cookies cannot be read across origins by
// Chromium, so the real danger is the credential the user is about to type.
export default function CredentialWarning({ threat, onDismiss }) {
  const [checked, setChecked] = useState(false);
  if (!threat) return null;
  const high = threat.severity === 'high';

  return (
    <div className="safety-block-screen" role="alertdialog" aria-modal="true" aria-label="Possible fake sign-in page">
      <div className="safety-block-card">
        <button className="safety-block-close" type="button" onClick={onDismiss} aria-label="Close warning"><X size={15} /></button>
        <div className="safety-block-icon"><ShieldAlert size={26} /></div>
        <span className="eyebrow">Possible fake sign-in page</span>
        <h1>{high ? 'Do not enter your password here' : 'This does not look like the real site'}</h1>
        <p className="safety-block-reason"><KeyRound size={14} />{threat.reason}</p>
        <code className="safety-block-url">{threat.host}</code>

        <div className="credential-warning-facts">
          <p><strong>{threat.provider}</strong> sign-in only ever happens on the provider&apos;s own domains. A page on <code>{threat.host}</code> cannot read your {threat.provider} cookies, because browsers keep each site&apos;s cookies separate.</p>
          <p>What these pages actually do is capture whatever you type. If you already entered a password here, change it on the real {threat.provider} site and sign out of other sessions.</p>
        </div>

        {!checked ? (
          <div className="safety-block-actions">
            <button className="secondary-button" type="button" onClick={onDismiss}>Go back</button>
            <button className="danger-button" type="button" onClick={() => setChecked(true)}>I understand</button>
          </div>
        ) : (
          <div className="safety-confirm">
            <strong>Still not {threat.provider}?</strong>
            <span>Only continue if you are certain this site is the real {threat.provider} and you reached it yourself.</span>
            <div className="safety-block-actions">
              <button className="secondary-button" type="button" onClick={onDismiss}>Go back</button>
              <button className="danger-button" type="button" onClick={onDismiss}>Continue anyway</button>
            </div>
          </div>
        )}

        <small className="credential-warning-note">Novaris will also refuse to fill saved passwords on this page.</small>
      </div>
    </div>
  );
}
