import { create } from 'zustand';

type Kind = 'info' | 'warn' | 'error' | 'success';
interface ToastItem { id: number; text: string; kind: Kind }
const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }));
let n = 0;

export function toast(text: string, kind: Kind = 'info', ms = 4500) {
  const id = ++n;
  useToasts.setState((s) => ({ items: [...s.items, { id, text, kind }] }));
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), ms);
}

export function Toasts() {
  const items = useToasts((s) => s.items);
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role="status">{t.text}</div>
      ))}
    </div>
  );
}
