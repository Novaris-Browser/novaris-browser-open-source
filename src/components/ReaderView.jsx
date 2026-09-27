import { ArrowLeft, ExternalLink, Minus, Plus, Type } from 'lucide-react';

export default function ReaderView({ content, settings, onClose, onOpenOriginal, onFontSize }) {
  return (
    <section className="reader-view" style={{ '--reader-size': `${settings.readerFontSize}px`, '--reader-leading': settings.readerLineHeight }}>
      <header className="reader-header"><div className="reader-brand"><span className="reader-brand-mark"><Type size={16} /></span><div><span className="eyebrow">Novaris reader</span><strong>{content?.title || 'Reader view'}</strong></div></div><div className="reader-actions"><button className="icon-button" type="button" onClick={() => onFontSize(-1)} aria-label="Decrease reader text size"><Minus size={15} /></button><button className="icon-button" type="button" onClick={() => onFontSize(1)} aria-label="Increase reader text size"><Plus size={15} /></button><button className="secondary-button" type="button" onClick={onOpenOriginal}><ExternalLink size={13} />Original</button><button className="icon-button" type="button" onClick={onClose} aria-label="Close reader mode"><ArrowLeft size={16} /></button></div></header>
      <article className="reader-article"><span className="eyebrow">{content?.url || 'Current page'}</span><h1>{content?.title || 'Reader view'}</h1><div className="reader-text">{content?.text || ''}</div></article>
    </section>
  );
}
