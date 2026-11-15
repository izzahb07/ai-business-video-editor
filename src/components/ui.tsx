import { useState, type ReactNode } from 'react';
import { useEditor } from '../store';

/** Slider that creates ONE undo step per drag. */
export function Slider({ label, value, min, max, step = 1, onChange, format, testId, disabled }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number, live: boolean) => void;
  format?: (v: number) => string; testId?: string; disabled?: boolean;
}) {
  const checkpoint = useEditor((s) => s.checkpoint);
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={`slider${disabled ? ' disabled' : ''}`}>
      <div className="slider-head">
        <label>{label}</label>
        <span className="slider-val">{format ? format(value) : Math.round(value * 100) / 100}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        aria-label={label} data-testid={testId}
        onPointerDown={checkpoint}
        onKeyDown={checkpoint}
        onChange={(e) => onChange(Number(e.target.value), true)}
        onDoubleClick={() => { checkpoint(); onChange(min < 0 && max > 0 ? 0 : value, false); }}
        style={{ ['--pct' as string]: `${pct}%` }}
      />
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint, testId }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testId?: string;
}) {
  return (
    <label className="toggle-row">
      <div><span>{label}</span>{hint && <small className="muted">{hint}</small>}</div>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span className="switch" aria-hidden />
    </label>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="color-field">
      <span>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </label>
  );
}

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`section${open ? ' open' : ''}`}>
      <button className="section-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{title}</span>
        {right}
        <span className="chev" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="panel-empty">{children}</p>;
}

export const pct = (v: number) => `${Math.round(v)}`;
export const secs = (v: number) => `${v.toFixed(1)}s`;
