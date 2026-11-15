import { useState } from 'react';
import { useEditor } from '../store';
import { AUTO_STYLES, STEP_LABELS, runAutoEdit, type AutoStyle, type Step } from '../lib/autoEdit';
import { serviceConfigured, useService } from '../lib/ai/service';
import { player } from '../lib/player';
import { Toggle } from './ui';
import { toast } from './Toast';

export function AutoEditCard() {
  const language = useEditor((s) => s.project.captions.language);
  const svc = useService();
  const [style, setStyle] = useState<AutoStyle>('social');
  const [topic, setTopic] = useState('');
  const [opt, setOpt] = useState({ removeSilence: true, captions: true, colour: true, music: true, hook: true });
  const [useServer, setUseServer] = useState(serviceConfigured());
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    player.pause();
    if (useServer && serviceConfigured()) svc.set({ consentAudio: true, consentText: true });
    const init: Step[] = STEP_LABELS.map(([id, label]) => ({ id, label, status: 'pending' }));
    setSteps(init);
    setRunning(true);
    const onStep = (id: string, status: Step['status'], note?: string) =>
      setSteps((prev) => (prev ?? init).map((s) => (s.id === id ? { ...s, status, note } : s)));
    try {
      const n = await runAutoEdit({ style, topic, language, ...opt }, onStep);
      toast(n ? 'Auto edit done — press play to watch. Undo (↶) reverts everything.' : 'Nothing was changed.', n ? 'success' : 'warn', 5000);
      if (n) void player.seek(0);
    } finally {
      setRunning(false);
    }
  };

  const icon = (s: Step['status']) => ({ pending: '○', running: '◌', done: '✓', skipped: '–', failed: '✕' }[s]);

  return (
    <div className="card auto-card" data-testid="auto-edit">
      <div className="card-head"><h3>✨ Auto Edit</h3><span className="badge ai">One tap</span></div>
      <p className="muted small">Edits the whole video for you. You can still change anything afterwards, or tap Undo (↶) once to go back.</p>
      <div className="grid-cards">
        {(Object.keys(AUTO_STYLES) as AutoStyle[]).map((k) => (
          <button key={k} className={`card-btn${style === k ? ' on' : ''}`} onClick={() => setStyle(k)} data-testid={`auto-style-${k}`}>
            <b>{AUTO_STYLES[k].label}</b><span className="muted small">{AUTO_STYLES[k].sub}</span>
          </button>
        ))}
      </div>
      <input className="text-input" placeholder="What is this video about? e.g. office cleaning in KL" value={topic} onChange={(e) => setTopic(e.target.value)}
        aria-label="What is this video about" data-testid="auto-topic" />
      <details className="auto-options">
        <summary>What to include</summary>
        <Toggle label="Remove silences & dead air" checked={opt.removeSilence} onChange={(v) => setOpt({ ...opt, removeSilence: v })} />
        <Toggle label="Captions" hint={serviceConfigured() && useServer ? 'Using your AI server' : 'On this device (downloads a speech model the first time, use Wi-Fi)'} checked={opt.captions} onChange={(v) => setOpt({ ...opt, captions: v })} />
        <Toggle label="Colour grade" checked={opt.colour} onChange={(v) => setOpt({ ...opt, colour: v })} />
        <Toggle label="Music & whoosh effects" checked={opt.music} onChange={(v) => setOpt({ ...opt, music: v })} />
        <Toggle label="Hook text + call to action" checked={opt.hook} onChange={(v) => setOpt({ ...opt, hook: v })} />
        {serviceConfigured() && (
          <Toggle label="Use my AI server" hint="Sends clip audio and caption text (never video) for better captions and AI-written hooks" checked={useServer} onChange={setUseServer} />
        )}
      </details>
      <button className="primary-btn" onClick={() => void run()} disabled={running} data-testid="auto-run">
        {running ? 'Editing your video…' : '✨ Auto edit my video'}
      </button>
      {steps && (
        <ul className="auto-steps" data-testid="auto-steps">
          {steps.map((s) => (
            <li key={s.id} className={`st-${s.status}`} data-testid={`auto-step-${s.id}`} data-status={s.status}>
              <span className="st-icon" aria-hidden>{s.status === 'running' ? <span className="spinner" /> : icon(s.status)}</span>
              <div><b>{s.label}</b>{s.note && <span className="muted small">{s.note}</span>}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
