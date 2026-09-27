import { CheckCircle2, Info, X, XCircle } from 'lucide-react';

export default function Toast({ toast, onClose }) {
  if (!toast) return null;
  const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? XCircle : Info;
  return (
    <div className={`toast toast-${toast.tone || 'neutral'}`} role="status">
      <Icon size={16} />
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss notification"><X size={14} /></button>
    </div>
  );
}
