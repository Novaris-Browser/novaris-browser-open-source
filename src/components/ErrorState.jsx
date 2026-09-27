import { AlertTriangle, ArrowLeft, Home, RotateCw } from 'lucide-react';

export default function ErrorState({ error, onRetry, onHome }) {
  return (
    <div className="error-state" role="alert">
      <div className="error-icon"><AlertTriangle size={25} /></div>
      <span className="eyebrow">Navigation interrupted</span>
      <h2>This page could not be opened.</h2>
      <p>{error || 'The site may be unavailable, or the connection may have been interrupted.'}</p>
      <div className="error-actions">
        <button className="primary-button" type="button" onClick={onRetry}><RotateCw size={15} />Try again</button>
        <button className="secondary-button" type="button" onClick={onHome}><Home size={15} />Go home</button>
      </div>
      <div className="error-hint"><ArrowLeft size={13} /> You can go back in tab history or enter a new address above.</div>
    </div>
  );
}
