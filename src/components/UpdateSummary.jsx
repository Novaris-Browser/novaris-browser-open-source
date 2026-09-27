import { ArrowRight, Check, RotateCcw, Sparkles } from 'lucide-react';

// Shown once, immediately after a full reset, so the user knows why the
// browser looks brand new and what changed in this version.
export default function UpdateSummary({ summary, currentVersion, onContinue }) {
  if (!summary) return null;
  const wasUpdate = summary.reason === 'update';
  const notes = String(summary.releaseNotes || '').trim();

  return (
    <div className="update-summary-screen">
      <div className="update-summary-card">
        <div className="update-summary-icon">
          {wasUpdate ? <Sparkles size={26} /> : <RotateCcw size={24} />}
        </div>
        <span className="eyebrow">We&apos;ve made an update</span>
        <h1>{wasUpdate ? `Novaris is now ${summary.toVersion || currentVersion}` : 'Novaris has been reset'}</h1>
        <p className="update-summary-lede">
          {wasUpdate
            ? `Novaris updated from ${summary.fromVersion || 'the previous version'} and started clean, so you get a genuine first-run setup instead of your old profile.`
            : 'Everything was removed and Novaris restarted, so you get a genuine first-run setup instead of your old profile.'}
        </p>

        <div className="update-summary-what">
          <h2>What happened</h2>
          <ul>
            <li><Check size={13} />Your bookmarks, history, reading list, downloads, cookies, site data, and passwords were deleted.</li>
            <li><Check size={13} />Extensions, ad blocker rules, and site permissions were removed and reinstalled at their defaults.</li>
            <li><Check size={13} />The vault lock was removed, so you can set a new browser password in the next step.</li>
            <li><Check size={13} />First-run setup runs next, exactly like a new installation.</li>
          </ul>
        </div>

        {notes && (
          <div className="update-summary-notes">
            <h2>What&apos;s new in {summary.toVersion || currentVersion}</h2>
            <pre>{notes}</pre>
          </div>
        )}

        <button className="primary-button update-summary-continue" type="button" onClick={onContinue}>
          Continue to setup <ArrowRight size={14} />
        </button>
        <small className="update-summary-note">This message appears only once.</small>
      </div>
    </div>
  );
}
