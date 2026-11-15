import { useState } from 'react';
import { useEditor } from '../store';
import { analyzeProject, type SilenceSettings, type Suggestion } from '../lib/analysis/smart';
import { player } from '../lib/player';
import { totalDuration } from '../lib/timeline';
import { fmtTime } from '../lib/capabilities';
import { textOverlay } from '../lib/overlayTemplates';
import { editTranscript, generateHooks, templateHooks, STYLE_LABEL, type HooksResult, type Objective } from '../lib/ai/hooks';
import { serviceConfigured, useService } from '../lib/ai/service';
import { Chips, Section, Slider, Toggle } from './ui';
import { toast } from './Toast';

export function AIPanel() {
  return (
    <div className="panel-stack" data-testid="ai-panel">
      <SmartEdit />
      <HookWriter />
    </div>
  );
}

// ---------------------------------------------------------------- smart editing
function SmartEdit() {
  const project = useEditor((s) => s.project);
  const update = useEditor((s) => s.update);
  const [settings, setSettings] = useState<SilenceSettings>({ thresholdDb: null, minPause: 0.5, padding: 0.12 });
  const [busy, setBusy] = useState<{ msg: string; p: number } | null>(null);
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [rejected, setRejected] = useState<Set<string>>(new Set());

  const run = async (silence = settings) => {
    setBusy({ msg: 'Listening to the audio…', p: 0 });
    try {
      const s = await analyzeProject(useEditor.getState().project, useEditor.getState().assets, { silence, onProgress: (msg, p) => setBusy({ msg, p }) });
      setList(s);
      return s;
    } catch (err) {
      toast(`Analysis failed: ${(err as Error).message}`, 'error');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const accept = async (s: Suggestion) => {
    update(s.apply);
    toast(`Applied: ${s.title}`, 'success', 2000);
    await run(); // re-analyse the new edit so remaining suggestions stay accurate
  };

  const visible = (list ?? []).filter((s) => !rejected.has(s.key));
  const cuts = visible.filter((s) => s.type === 'silence' || s.type === 'deadair');
  const totalSave = cuts.reduce((n, s) => n + (s.saves ?? 0), 0);

  const acceptAllCuts = async () => {
    // Apply from the end of the timeline backwards so earlier positions stay valid.
    const ordered = [...cuts].sort((a, b) => b.at - a.at);
    update((p) => ordered.reduce((acc, s) => s.apply(acc), p));
    toast(`Removed ${ordered.length} silent section${ordered.length === 1 ? '' : 's'} (${totalSave.toFixed(1)} s)`, 'success', 2500);
    await run();
  };

  return (
    <div className="card" data-testid="smart-edit">
      <div className="card-head"><h3>Smart editing</h3><span className="badge">On-device analysis</span></div>
      <p className="muted small">Measures your clips' sound and pictures to find pauses, dead air, scene changes, repeated shots and your strongest moments. Nothing is uploaded. You approve every change, and Undo always works.</p>
      <Section title="Silence settings" defaultOpen={false}>
        <Toggle label="Automatic threshold" hint="Adapts to each clip's background noise" checked={settings.thresholdDb == null}
          onChange={(auto) => setSettings({ ...settings, thresholdDb: auto ? null : -40 })} />
        {settings.thresholdDb != null && (
          <Slider label="Silence below" value={settings.thresholdDb} min={-70} max={-15} format={(v) => `${Math.round(v)} dB`} onChange={(v) => setSettings({ ...settings, thresholdDb: v })} />
        )}
        <Slider label="Shortest pause to cut" value={settings.minPause} min={0.2} max={3} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => setSettings({ ...settings, minPause: v })} testId="min-pause" />
        <Slider label="Keep around words" value={settings.padding} min={0} max={0.4} step={0.01} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => setSettings({ ...settings, padding: v })} />
      </Section>
      {busy ? (
        <div className="stack" data-testid="analyze-progress">
          <div className="progress-head"><b>Analysing…</b><span className="muted small">{busy.msg}</span></div>
          <div className="progress-bar"><div style={{ width: `${Math.round(busy.p * 100)}%` }} /></div>
        </div>
      ) : (
        <button className="primary-btn sm" onClick={() => void run()} disabled={!project.clips.length} data-testid="analyze">
          {list ? 'Analyse again' : 'Analyse my video'}
        </button>
      )}

      {list && !busy && (
        <>
          {cuts.length > 1 && (
            <button className="secondary-btn sm" onClick={() => void acceptAllCuts()} data-testid="accept-all-cuts">
              Remove all {cuts.length} silences (saves {totalSave.toFixed(1)} s)
            </button>
          )}
          {!visible.length && <p className="muted small" data-testid="no-suggestions">No suggestions — your edit already looks tight. ✓</p>}
          <div className="list">
            {visible.map((s) => (
              <div key={s.key} className="sugg" data-testid={`sugg-${s.type}`}>
                <div className="cap-row">
                  <span className="badge">{s.basis}</span>
                  <span className="grow" />
                  <button className="tc cap-time" onClick={() => void player.seek(s.at)}>{fmtTime(s.at, true)}</button>
                </div>
                <b>{s.title}</b>
                <span className="muted small">{s.detail}</span>
                <div className="btn-row two">
                  <button className="secondary-btn sm" onClick={() => setRejected(new Set([...rejected, s.key]))} data-testid="reject">Reject</button>
                  <button className="primary-btn sm" onClick={() => void accept(s)} data-testid="accept">Accept</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- hooks
function HookWriter() {
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const { addOverlay } = useEditor.getState();
  const svc = useService();
  const [objective, setObjective] = useState<Objective>('engagement');
  const [lang, setLang] = useState<'auto' | 'en' | 'ms'>('auto');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HooksResult | null>(null);
  const [needConsent, setNeedConsent] = useState(false);
  const [topic, setTopic] = useState('');
  const transcript = editTranscript(project, assets);

  const addHookText = (text: string) => {
    const o = textOverlay('hook', 0);
    addOverlay({ ...o, text });
    toast('Hook added to the first 3 seconds — edit it in Graphics', 'success', 2500);
  };

  const run = async () => {
    if (!serviceConfigured()) { toast('Connect your AI server first: Studio settings (ⓘ) → AI server.', 'warn', 6000); return; }
    if (!useService.getState().consentText) { setNeedConsent(true); return; }
    if (!transcript && !description.trim()) { toast('Describe your video (or generate captions first) so the AI has something to work from.', 'warn', 5000); return; }
    setBusy(true);
    try {
      setResult(await generateHooks({ transcript, description, objective, language: lang, durationSec: totalDuration(project.clips) }));
    } catch (err) {
      toast((err as Error).message, 'error', 8000);
    } finally {
      setBusy(false);
    }
  };

  const copy = (t: string) => { void navigator.clipboard?.writeText(t).then(() => toast('Copied', 'success', 1200)); };

  return (
    <div className="card" data-testid="hook-writer">
      <div className="card-head"><h3>Hooks & structure</h3><span className="badge ai">AI · Claude</span></div>
      <label className="field-label">Goal of this video</label>
      <Chips label="Objective" value={objective} onChange={setObjective} options={[
        { value: 'sales', label: 'Sales' }, { value: 'awareness', label: 'Awareness' }, { value: 'education', label: 'Education' },
        { value: 'engagement', label: 'Engagement' }, { value: 'storytelling', label: 'Storytelling' }]} />
      <label className="field-label">Language</label>
      <Chips label="Hook language" value={lang} onChange={setLang} options={[{ value: 'auto', label: 'Same as video' }, { value: 'en', label: 'English' }, { value: 'ms', label: 'Bahasa Melayu' }]} />
      <textarea className="text-area" placeholder="What is this video about? Who is it for? (facts only — the AI won't invent claims)" value={description}
        onChange={(e) => setDescription(e.target.value)} aria-label="Video description" data-testid="hook-description" />
      <p className="muted small">{transcript ? `Uses your captions (${transcript.split(/\s+/).length} words) + this description.` : 'Tip: generate captions first so hooks are based on what you actually say.'}</p>
      {needConsent && (
        <div className="notice warn">
          <p style={{ margin: '0 0 8px' }}><b>Allow sending text?</b> Your description and caption text (no video or audio) will be sent to <b>{svc.url}</b>, which asks Claude for ideas.</p>
          <div className="btn-row two">
            <button className="secondary-btn sm" onClick={() => setNeedConsent(false)}>Cancel</button>
            <button className="primary-btn sm" onClick={() => { svc.set({ consentText: true }); setNeedConsent(false); void run(); }} data-testid="consent-text">Allow</button>
          </div>
        </div>
      )}
      <button className="primary-btn sm" onClick={() => void run()} disabled={busy} data-testid="generate-hooks">
        {busy ? 'Writing hooks…' : 'Generate 10 hooks + structure'}
      </button>
      {!serviceConfigured() && <p className="muted small">Needs your AI server (README → "AI server"). Offline templates are below.</p>}

      {result && (
        <div className="stack" data-testid="hook-results">
          {result.claimsToVerify?.length > 0 && (
            <div className="notice warn"><b>Check before posting:</b> {result.claimsToVerify.join(' · ')}</div>
          )}
          <div className="list">
            {result.hooks.map((h, i) => (
              <div key={i} className={`sugg${i === result.bestHookIndex ? ' best' : ''}`} data-testid="hook-item">
                <div className="cap-row"><span className="badge ai">{STYLE_LABEL[h.style] ?? h.style}</span>{i === result.bestHookIndex && <span className="badge">Best opener</span>}</div>
                <b>{h.text}</b>
                <span className="muted small">Say: “{h.spoken}” · Show: {h.openingVisual}</span>
                <div className="btn-row two">
                  <button className="secondary-btn sm" onClick={() => copy(h.text)}>Copy</button>
                  <button className="primary-btn sm" onClick={() => addHookText(h.text)} data-testid="use-hook">Use as hook text</button>
                </div>
              </div>
            ))}
          </div>
          <Section title="Video structure">
            {result.structure.map((s, i) => (
              <div key={i} className="list-item" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                <b>{i + 1}. {s.part}</b><span className="small">{s.guidance}</span>{s.onScreenText && <span className="muted small">On screen: “{s.onScreenText}”</span>}
              </div>
            ))}
          </Section>
          <Section title="Retention tips & pattern interrupts" defaultOpen={false}>
            <ul className="small">{result.retentionTips.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </Section>
          <Section title="Titles, caption & call to action" defaultOpen={false}>
            {result.titles.map((t, i) => <button key={i} className="list-item" onClick={() => copy(t)}>{t}</button>)}
            <button className="list-item" onClick={() => copy(result.caption + '\n\n' + result.hashtags.join(' '))}>{result.caption} <span className="muted">{result.hashtags.join(' ')}</span></button>
            <button className="list-item" onClick={() => copy(result.description)}>{result.description}</button>
            <button className="secondary-btn sm" onClick={() => {
              const end = totalDuration(project.clips);
              addOverlay({ ...textOverlay('cta', Math.max(0, end - 3)), text: result.cta });
            }}>Add CTA “{result.cta}” at the end</button>
          </Section>
        </div>
      )}

      <Section title="Offline hook templates (not AI)" defaultOpen={false}>
        <input className="text-input" placeholder="Topic, e.g. office cleaning" value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic" />
        <div className="list">
          {templateHooks(topic, lang === 'ms' ? 'ms' : 'en').map((h, i) => (
            <div key={i} className="list-item">
              <span className="badge">{STYLE_LABEL[h.style]}</span>
              <span className="grow">{h.text}</span>
              <button className="mini-btn" onClick={() => addHookText(h.text)} aria-label="Use this hook">Use</button>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
