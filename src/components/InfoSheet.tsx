import { useEffect, useState } from 'react';
import { checkCapabilities, type Capability } from '../lib/capabilities';
import { startNewProject } from '../lib/projectIO';
import { Sheet } from './Sheet';

export function InfoSheet({ onClose }: { onClose: () => void }) {
  const [caps, setCaps] = useState<Capability[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { void checkCapabilities().then(setCaps); }, []);

  return (
    <Sheet title="Studio" onClose={onClose}>
      <div className="stack">
        <h3>Device check</h3>
        <ul className="caps" data-testid="caps">
          {caps === null && <li className="muted">Checking…</li>}
          {caps?.map((c) => (
            <li key={c.label}>
              <span className={`dot ${c.ok ? 'ok' : 'bad'}`} aria-hidden />
              <div><b>{c.label}</b><span className="muted small">{c.detail}</span></div>
            </li>
          ))}
        </ul>

        <h3>Privacy</h3>
        <p className="muted small">
          Your videos never leave your iPhone. Editing and exporting happen inside Safari, and your project is saved
          on this device so you can come back later.
        </p>

        <h3>Project</h3>
        {!confirm ? (
          <button className="secondary-btn" onClick={() => setConfirm(true)}>Start a new project…</button>
        ) : (
          <div className="stack">
            <p className="notice warn">This removes all clips and saved videos from this app (your Photos are not touched). This can't be undone.</p>
            <div className="btn-row">
              <button className="secondary-btn" onClick={() => setConfirm(false)}>Keep project</button>
              <button className="danger-btn" onClick={async () => { await startNewProject(); onClose(); }}>Delete & start new</button>
            </div>
          </div>
        )}

        <h3>Coming next</h3>
        <p className="muted small">
          Trim & split, captions and text (Phase 2) · colour grading (Phase 3) · motion graphics & sound design (Phase 4) ·
          silence removal (Phase 5) · AI hooks & storytelling (Phase 6).
        </p>
      </div>
    </Sheet>
  );
}
