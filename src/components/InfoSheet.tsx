import { useEffect, useState } from 'react';
import { checkCapabilities, type Capability } from '../lib/capabilities';
import { startNewProject } from '../lib/projectIO';
import { checkService, useService } from '../lib/ai/service';
import { Sheet } from './Sheet';

export function InfoSheet({ onClose }: { onClose: () => void }) {
  const [caps, setCaps] = useState<Capability[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { void checkCapabilities().then(setCaps); }, []);

  return (
    <Sheet title="Studio settings" onClose={onClose}>
      <div className="stack">
        <AiServer />

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
          Editing, colour, graphics, smart-edit analysis and exporting all happen on your device. Nothing is uploaded unless you
          connect your own AI server and agree to send clip audio (for captions) or transcript text (for hooks). Video is never uploaded.
        </p>

        <h3>Project</h3>
        {!confirm ? (
          <button className="secondary-btn" onClick={() => setConfirm(true)}>Start a new project…</button>
        ) : (
          <div className="stack">
            <p className="notice warn">This removes all clips and saved media from this app (your Photos are not touched). This can't be undone.</p>
            <div className="btn-row">
              <button className="secondary-btn" onClick={() => setConfirm(false)}>Keep project</button>
              <button className="danger-btn" onClick={async () => { await startNewProject(); onClose(); }}>Delete & start new</button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function AiServer() {
  const svc = useService();
  const [url, setUrl] = useState(svc.url);
  const [pass, setPass] = useState(svc.passcode);
  const [status, setStatus] = useState<string | null>(null);
  const test = async () => {
    svc.set({ url: url.trim(), passcode: pass });
    setStatus('Checking…');
    const r = await checkService();
    setStatus(r.ok
      ? `Connected ✓ · Transcription: ${r.transcription ? 'ready' : 'not set up'} · AI hooks: ${r.ai ? 'ready' : 'not set up'}`
      : r.message);
  };
  return (
    <div className="card" data-testid="ai-server">
      <div className="card-head"><h3>AI server (optional)</h3><span className="badge ai">Your keys</span></div>
      <p className="muted small">Needed only for cloud captions and AI hook writing. Deploy the free server in the <code>server/</code> folder (README → "AI server"), then paste its address and passcode here. Keys stay on the server.</p>
      <input className="text-input" placeholder="https://your-server.workers.dev" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="off" autoCorrect="off" aria-label="AI server address" data-testid="svc-url" />
      <input className="text-input" placeholder="Passcode" type="password" value={pass} onChange={(e) => setPass(e.target.value)} aria-label="AI server passcode" data-testid="svc-pass" />
      <button className="primary-btn sm" onClick={test} disabled={!url.trim()} data-testid="svc-test">Save & test connection</button>
      {status && <p className="small" data-testid="svc-status">{status}</p>}
      {(svc.consentAudio || svc.consentText) && (
        <button className="text-btn" onClick={() => svc.set({ consentAudio: false, consentText: false })}>Withdraw permission to send audio/text</button>
      )}
    </div>
  );
}
