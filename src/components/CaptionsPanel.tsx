import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import type { CaptionAnim, CaptionSegment, CaptionStyle } from '../types';
import { CAPTION_TEMPLATES, FONTS, captionStyleFromTemplate, uid } from '../lib/defaults';
import { player, usePlayer } from '../lib/player';
import { fmtTime } from '../lib/capabilities';
import { resolveCaptions, toSrt } from '../engine/captions';
import { autoEmphasis, transcriptToSegments } from '../lib/captionsModel';
import { ON_DEVICE_MODELS, transcribeAsset, type Engine, type Lang, type TranscribeProgress } from '../lib/transcribe/transcribe';
import { serviceConfigured, useService } from '../lib/ai/service';
import { downloadText } from './ExportSheet';
import { Chips, ColorField, Section, Slider, Toggle } from './ui';
import { toast } from './Toast';
import { loadFont } from '../lib/fonts';

const ANIMS: { value: CaptionAnim; label: string }[] = [
  { value: 'none', label: 'Static' }, { value: 'fade', label: 'Fade' }, { value: 'pop', label: 'Pop' },
  { value: 'karaoke', label: 'Karaoke' }, { value: 'word', label: 'Word by word' }, { value: 'bounce', label: 'Bounce' },
  { value: 'typewriter', label: 'Typewriter' },
];

export function CaptionsPanel() {
  const captions = useEditor((s) => s.project.captions);
  const setCaptions = useEditor((s) => s.setCaptions);
  const st = captions.style;
  const setStyle = (patch: Partial<CaptionStyle>, live = false) => setCaptions({ style: { ...st, ...patch } }, { history: !live });

  useEffect(() => { void loadFont(st.font, st.weight).then(() => player.redraw()); }, [st.font, st.weight]);

  return (
    <div className="panel-stack" data-testid="captions-panel">
      <AutoCaptions />
      <Toggle label="Show captions in video" checked={captions.enabled} onChange={(enabled) => setCaptions({ enabled })} testId="captions-enabled" />

      <Section title="Caption style">
        <div className="grid-cards">
          {CAPTION_TEMPLATES.map((t) => (
            <button key={t.id} className={`card-btn${st.template === t.id ? ' on' : ''}`}
              onClick={() => setCaptions({ style: { ...captionStyleFromTemplate(t.id, st.y) } })}
              style={{ fontFamily: `"${t.style.font}"`, fontWeight: t.style.weight }} data-testid={`template-${t.id}`}>
              <span style={{ color: t.style.activeColor, textTransform: t.style.uppercase ? 'uppercase' : 'none' }}>Aa</span>
              <span>{t.name}</span>
            </button>
          ))}
        </div>
        <label className="field-label">Animation</label>
        <Chips label="Caption animation" value={st.animation} options={ANIMS} onChange={(animation) => setStyle({ animation })} />
        <label className="field-label">Font</label>
        <select className="select" value={st.font} onChange={(e) => setStyle({ font: e.target.value, weight: FONTS.find((f) => f.family === e.target.value)!.weights.slice(-1)[0] })}>
          {FONTS.map((f) => <option key={f.family} value={f.family}>{f.label}</option>)}
        </select>
        <Slider label="Size" value={st.size} min={30} max={140} onChange={(v, l) => setStyle({ size: v }, l)} />
        <Slider label="Position (top ↔ bottom)" value={st.y * 100} min={8} max={92} format={(v) => `${Math.round(v)}%`} onChange={(v, l) => setStyle({ y: v / 100 }, l)} testId="caption-y" />
        <Slider label="Words per caption" value={st.maxWords} min={1} max={12} onChange={(v, l) => setStyle({ maxWords: Math.round(v) }, l)} />
        <Chips label="Alignment" value={st.align} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]} onChange={(align) => setStyle({ align })} />
        <Toggle label="UPPERCASE" checked={st.uppercase} onChange={(uppercase) => setStyle({ uppercase })} />
        <ColorField label="Text colour" value={st.color} onChange={(color) => setStyle({ color })} />
        <ColorField label="Spoken-word colour" value={st.activeColor} onChange={(activeColor) => setStyle({ activeColor })} />
        <ColorField label="Highlighted-word colour" value={st.emphasisColor} onChange={(emphasisColor) => setStyle({ emphasisColor })} />
        <Toggle label="Background box" checked={st.bg.on} onChange={(on) => setStyle({ bg: { ...st.bg, on } })} />
        {st.bg.on && (
          <>
            <ColorField label="Box colour" value={st.bg.color} onChange={(color) => setStyle({ bg: { ...st.bg, color } })} />
            <Slider label="Box opacity" value={st.bg.opacity * 100} min={10} max={100} format={(v) => `${Math.round(v)}%`} onChange={(v, l) => setStyle({ bg: { ...st.bg, opacity: v / 100 } }, l)} />
          </>
        )}
        <Toggle label="Outline" checked={st.outline.on} onChange={(on) => setStyle({ outline: { ...st.outline, on } })} />
        {st.outline.on && (
          <>
            <ColorField label="Outline colour" value={st.outline.color} onChange={(color) => setStyle({ outline: { ...st.outline, color } })} />
            <Slider label="Outline width" value={st.outline.width} min={1} max={16} onChange={(v, l) => setStyle({ outline: { ...st.outline, width: v } }, l)} />
          </>
        )}
        <Toggle label="Shadow" checked={st.shadow.on} onChange={(on) => setStyle({ shadow: { ...st.shadow, on, blur: st.shadow.blur || 14 } })} />
      </Section>

      <CaptionList />
    </div>
  );
}

function AutoCaptions() {
  const clips = useEditor((s) => s.project.clips);
  const assets = useEditor((s) => s.assets);
  const captions = useEditor((s) => s.project.captions);
  const { setCaptions, patchAsset } = useEditor.getState();
  const service = useService();
  const [engine, setEngine] = useState<Engine>(serviceConfigured() ? 'cloud' : 'on-device');
  const [model, setModel] = useState(ON_DEVICE_MODELS[0].id);
  const [busy, setBusy] = useState<{ i: number; n: number; p: TranscribeProgress } | null>(null);
  const [needConsent, setNeedConsent] = useState(false);
  const speechAssets = [...new Set(clips.map((c) => c.assetId))].map((id) => assets[id]).filter((a) => a && a.kind === 'video' && a.hasAudio);

  const run = async () => {
    if (engine === 'cloud' && !serviceConfigured()) { toast('Connect your AI server first: Studio settings (ⓘ) → AI server.', 'warn', 6000); return; }
    if (engine === 'cloud' && !useService.getState().consentAudio) { setNeedConsent(true); return; }
    if (!speechAssets.length) { toast('None of your clips have sound to transcribe.', 'warn'); return; }
    player.pause();
    const newSegs: CaptionSegment[] = [];
    try {
      for (let i = 0; i < speechAssets.length; i++) {
        const a = speechAssets[i];
        setBusy({ i, n: speechAssets.length, p: { stage: 'preparing' } });
        const t = await transcribeAsset(a, engine, captions.language as Lang, model, (p) => setBusy({ i, n: speechAssets.length, p }));
        patchAsset(a.id, { transcript: t });
        newSegs.push(...transcriptToSegments(a, t));
      }
      // Replace auto captions of these clips; keep manual ones.
      const ids = new Set(speechAssets.map((a) => a.id));
      setCaptions({ enabled: true, segments: [...captions.segments.filter((s) => !s.anchorAssetId || !ids.has(s.anchorAssetId)), ...newSegs] });
      const words = newSegs.reduce((n, s) => n + s.words.length, 0);
      toast(words ? `Captions created: ${newSegs.length} lines, ${words} words` : 'No speech was detected.', words ? 'success' : 'warn', 4000);
    } catch (err) {
      console.error(err);
      toast(`Transcription failed: ${(err as Error).message}`, 'error', 8000);
    } finally {
      setBusy(null);
    }
  };

  const stageText = (p: TranscribeProgress) => ({
    preparing: 'Preparing audio…',
    'downloading-model': `Downloading speech model (one time)${p.detail ? ` · ${p.detail}` : ''}`,
    transcribing: 'Recognising speech…',
    uploading: `Sending audio to your server${p.detail ? ` · ${p.detail}` : ''}…`,
  }[p.stage]);

  return (
    <div className="card" data-testid="auto-captions">
      <div className="card-head"><h3>Auto captions</h3><span className="badge ai">Speech-to-text</span></div>
      <label className="field-label">Language spoken</label>
      <Chips label="Language" value={captions.language} onChange={(language) => setCaptions({ language })}
        options={[{ value: 'auto', label: 'Detect' }, { value: 'en', label: 'English' }, { value: 'ms', label: 'Bahasa Melayu' }]} />
      <label className="field-label">Engine</label>
      <Chips label="Engine" value={engine} onChange={setEngine}
        options={[{ value: 'on-device', label: 'On this device' }, { value: 'cloud', label: 'My AI server' }]} />
      {engine === 'on-device' ? (
        <>
          <select className="select" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Speech model">
            {ON_DEVICE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <p className="muted small">Free and private: audio never leaves your device. The model downloads once, then works offline. Slower on older iPhones; Bahasa Melayu is less accurate than with your server.</p>
        </>
      ) : (
        <p className="muted small">{serviceConfigured()
          ? 'Most accurate, including Bahasa Melayu. Sends only the clip audio (not video) to your server.'
          : 'Not connected. Set up your server (see README → "AI server"), then add it in Studio settings (ⓘ).'}</p>
      )}
      {needConsent && (
        <div className="notice warn">
          <p style={{ margin: '0 0 8px' }}><b>Allow sending audio?</b> The sound of your clips (no video) will be uploaded to <b>{service.url}</b> and passed to its speech-to-text provider. Nothing else is sent.</p>
          <div className="btn-row two">
            <button className="secondary-btn sm" onClick={() => setNeedConsent(false)}>Cancel</button>
            <button className="primary-btn sm" onClick={() => { service.set({ consentAudio: true }); setNeedConsent(false); void run(); }} data-testid="consent-audio">Allow</button>
          </div>
        </div>
      )}
      {busy ? (
        <div className="stack" data-testid="transcribe-progress">
          <div className="progress-head"><b>Clip {busy.i + 1} of {busy.n}</b><span className="muted small">{stageText(busy.p)}</span></div>
          <div className="progress-bar"><div style={{ width: `${Math.round((busy.p.progress ?? (busy.p.stage === 'transcribing' ? 0.5 : 0.05)) * 100)}%` }} /></div>
        </div>
      ) : (
        <button className="primary-btn sm" onClick={run} disabled={!speechAssets.length} data-testid="transcribe">
          {captions.segments.some((s) => s.anchorAssetId) ? 'Re-transcribe' : 'Generate captions'} ({speechAssets.length} clip{speechAssets.length === 1 ? '' : 's'})
        </button>
      )}
    </div>
  );
}

function CaptionList() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const { setCaptions, patchSegment, setSelection, checkpoint } = useEditor.getState();
  const time = usePlayer((s) => s.time);
  const listRef = useRef<HTMLDivElement>(null);
  const segs = project.captions.segments;
  const cards = resolveCaptions(project);
  const firstTimeOf = (id: string) => cards.find((c) => c.segmentId === id)?.start;
  const sorted = [...segs].sort((a, b) => (firstTimeOf(a.id) ?? a.start) - (firstTimeOf(b.id) ?? b.start));

  useEffect(() => {
    if (selection?.type === 'caption') listRef.current?.querySelector(`[data-seg="${selection.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selection]);

  const addAtPlayhead = () => {
    const seg: CaptionSegment = { id: uid(), text: 'New caption', anchorAssetId: null, start: time, end: time + 2, words: [], emphasis: [] };
    setCaptions({ enabled: true, segments: [...segs, seg] });
    setSelection({ type: 'caption', id: seg.id });
  };

  return (
    <Section title={`Edit captions (${segs.length})`} right={<span />}>
      <div className="btn-row two">
        <button className="secondary-btn sm" onClick={addAtPlayhead} data-testid="add-caption">+ Caption at playhead</button>
        <button className="secondary-btn sm" disabled={!segs.length} onClick={() => {
          setCaptions({ segments: segs.map((s) => ({ ...s, emphasis: autoEmphasis(s) })) });
          toast('Key words highlighted (numbers and important words)', 'success', 2500);
        }}>Highlight key words</button>
      </div>
      <div className="btn-row two">
        <button className="secondary-btn sm" disabled={!segs.length} onClick={() => downloadText(toSrt(project), `${project.name || 'captions'}.srt`, 'application/x-subrip')}>Download .srt</button>
        <button className="danger-btn sm" disabled={!segs.length} onClick={() => setCaptions({ segments: [] })}>Delete all</button>
      </div>
      {!segs.length && <p className="muted small">No captions yet. Generate them automatically above, or add one at the playhead.</p>}
      <div className="list" ref={listRef}>
        {sorted.map((s) => {
          const t0 = firstTimeOf(s.id);
          const on = selection?.type === 'caption' && selection.id === s.id;
          const words = s.text.split(/\s+/).filter(Boolean);
          const nudge = (field: 'start' | 'end', d: number) => {
            const v = Math.max(0, s[field] + d);
            if (field === 'start' && v >= s.end - 0.1) return;
            if (field === 'end' && v <= s.start + 0.1) return;
            patchSegment(s.id, { [field]: v });
          };
          return (
            <div key={s.id} data-seg={s.id} className={`cap-item${on ? ' on' : ''}`} data-testid="caption-item">
              <div className="cap-row">
                <button className="tc cap-time" onClick={() => { setSelection({ type: 'caption', id: s.id }); if (t0 != null) void player.seek(t0 + 0.01); }}>
                  {t0 != null ? fmtTime(t0, true) : 'not in edit'}
                </button>
                {s.anchorAssetId ? <span className="badge">Synced</span> : <span className="badge">Manual</span>}
                <span className="grow" />
                <button className="mini-btn" onClick={() => setCaptions({ segments: segs.filter((x) => x.id !== s.id) })} aria-label="Delete caption">✕</button>
              </div>
              <textarea className="text-area" rows={2} value={s.text} aria-label="Caption text" data-testid="caption-text"
                onFocus={() => { checkpoint(); setSelection({ type: 'caption', id: s.id }); }}
                onChange={(e) => patchSegment(s.id, { text: e.target.value }, { history: false })} />
              {on && (
                <>
                  <div className="cap-words" aria-label="Tap words to highlight them">
                    {words.map((w, i) => (
                      <button key={i} className={s.emphasis.includes(i) ? 'on' : ''}
                        onClick={() => patchSegment(s.id, { emphasis: s.emphasis.includes(i) ? s.emphasis.filter((x) => x !== i) : [...s.emphasis, i] })}>{w}</button>
                    ))}
                  </div>
                  <div className="cap-timing">
                    <span className="muted small">Start</span>
                    <button className="mini-btn" onClick={() => nudge('start', -0.1)}>−0.1s</button>
                    <button className="mini-btn" onClick={() => nudge('start', 0.1)}>+0.1s</button>
                    <span className="muted small">End</span>
                    <button className="mini-btn" onClick={() => nudge('end', -0.1)}>−0.1s</button>
                    <button className="mini-btn" onClick={() => nudge('end', 0.1)}>+0.1s</button>
                  </div>
                  <p className="muted small">{(s.end - s.start).toFixed(1)}s long{s.anchorAssetId ? ' · stays in sync when you trim or split clips' : ''}</p>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
