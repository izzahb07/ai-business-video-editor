import { useEffect, type ReactNode } from 'react';
import { IconClose } from './Icons';

/** iOS-style bottom sheet. */
export function Sheet({ title, onClose, children, dismissable = true }: {
  title: string; onClose: () => void; children: ReactNode; dismissable?: boolean;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div className="sheet-backdrop" onClick={() => dismissable && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grabber" />
        <div className="sheet-head">
          <h2>{title}</h2>
          {dismissable && (
            <button className="icon-btn" onClick={onClose} aria-label="Close"><IconClose /></button>
          )}
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string; sub?: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          <span>{o.label}</span>
          {o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  );
}
