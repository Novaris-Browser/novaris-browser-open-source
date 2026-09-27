import { Sparkles } from 'lucide-react';

export default function BootScreen({ error }) {
  return (
    <div className="boot-screen">
      <div className="boot-orb"><Sparkles size={24} /></div>
      <span className="eyebrow">Novaris Browser</span>
      <h1>{error ? 'Starting in safe mode' : 'Preparing your workspace'}</h1>
      <p>{error || 'Securing tabs, restoring your library, and tuning the glass.'}</p>
      <div className="boot-loader"><span /></div>
    </div>
  );
}
