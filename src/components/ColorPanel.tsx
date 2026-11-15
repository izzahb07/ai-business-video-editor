import { useEditor } from '../store';
import type { Grade } from '../types';
import { defaultGrade, uid } from '../lib/defaults';
import { layoutClips, locate } from '../lib/timeline';
import { usePlayer } from '../lib/player';
import { GRADE_PRESETS, parseCube } from '../engine/grade';
import { setLut } from '../lib/registry';
import { saveLut } from '../lib/storage';
import { useUi } from '../uiState';
import { pickFiles } from './ClipStrip';
import { Section, Slider, Toggle } from './ui';
import { toast } from './Toast';

const SLIDERS: { key: keyof Grade; label: string; min: number; max: number }[] = [
  { key: 'exposure', label: 'Exposure', min: -100, max: 100 },
  { key: 'brightness', label: 'Brightness', min: -100, max: 100 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
  { key: 'whites', label: 'Whites', min: -100, max: 100 },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100 },
  { key: 'temperature', label: 'Temperature (cool ↔ warm)', min: -100, max: 100 },
  { key: 'tint', label: 'Tint (green ↔ magenta)', min: -100, max: 100 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 100 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 100 },
  { key: 'fade', label: 'Film fade', min: 0, max: 100 },
];

export function ColorPanel() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const { patchClip, update } = useEditor.getState();
  const time = usePlayer((s) => s.time);
  const compare = useUi((s) => s.compare);
  const setCompare = useUi((s) => s.setCompare);

  // Grade the selected clip, or the clip under the playhead.
  const selClip = selection?.type === 'clip' ? project.clips.find((c) => c.id === selection.id) : undefined;
  const clip = selClip ?? locate(layoutClips(project.clips), time)?.placed.clip;
  if (!clip) return <p className="panel-empty">Add a clip to start grading.</p>;
  const idx = project.clips.findIndex((c) => c.id === clip.id);
  const g = clip.grade;
  const setGrade = (patch: Partial<Grade>, live = false) => patchClip(clip.id, { grade: { ...g, ...patch } }, { history: !live });
  const activePreset = GRADE_PRESETS.find((p) => Object.entries({ ...defaultGrade(), ...p.grade, lutId: g.lutId, lutMix: g.lutMix }).every(([k, v]) => g[k as keyof Grade] === v));

  const importLut = async () => {
    const [f] = await pickFiles('.cube,text/plain');
    if (!f) return;
    try {
      const data = parseCube(await f.text());
      const id = uid();
      setLut(id, data);
      await saveLut(id, data).catch(() => toast('LUT works now but could not be saved for next time.', 'warn'));
      update((p) => ({ ...p, luts: [...p.luts, { id, name: f.name.replace(/\.cube$/i, ''), size: data.size }] }));
      setGrade({ lutId: id, lutMix: 100 });
      toast(`LUT "${f.name}" applied (${data.size}³)`, 'success', 2500);
    } catch (err) {
      toast(`Could not use this LUT: ${(err as Error).message}`, 'error', 6000);
    }
  };

  return (
    <div className="panel-stack" data-testid="color-panel">
      <div className="panel-head">
        <div>
          <h3>Colour · Clip {idx + 1}</h3>
          <p className="muted small">{selClip ? 'Selected clip' : 'Clip under the playhead — tap a clip to choose another'}</p>
        </div>
      </div>
      <Toggle label="Before / after split view" checked={compare != null} onChange={(on) => setCompare(on ? 0.5 : null)} testId="compare" />
      {compare != null && (
        <Slider label="Split position" value={compare * 100} min={5} max={95} format={(v) => `${Math.round(v)}%`} onChange={(v) => setCompare(v / 100)} />
      )}

      <Section title="Cinematic presets">
        <div className="grid-cards">
          <button className={`card-btn${!activePreset && Object.entries(defaultGrade()).every(([k, v]) => k === 'lutMix' || g[k as keyof Grade] === v) ? ' on' : ''}`}
            onClick={() => setGrade({ ...defaultGrade(), lutId: g.lutId, lutMix: g.lutMix })}>
            <span className="swatch" style={{ background: 'linear-gradient(135deg,#6b7280,#d1d5db)' }} />Original
          </button>
          {GRADE_PRESETS.map((p) => (
            <button key={p.id} className={`card-btn${activePreset?.id === p.id ? ' on' : ''}`} data-testid={`preset-${p.id}`}
              onClick={() => setGrade({ ...defaultGrade(), ...p.grade, lutId: g.lutId, lutMix: g.lutMix })}>
              <span className="swatch" style={{ background: swatch(p.grade) }} />{p.name}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Adjust">
        {SLIDERS.map((s) => (
          <Slider key={s.key} label={s.label} value={g[s.key] as number} min={s.min} max={s.max} format={(v) => (v > 0 && s.min < 0 ? `+${Math.round(v)}` : `${Math.round(v)}`)}
            onChange={(v, l) => setGrade({ [s.key]: v }, l)} testId={`grade-${s.key}`} />
        ))}
      </Section>

      <Section title="LUT (.cube)" defaultOpen={!!g.lutId}>
        <p className="muted small">Import a 3D LUT from your Files app (for example a log-to-Rec.709 or film-emulation LUT).</p>
        <div className="list">
          <button className={`list-item${!g.lutId ? ' on' : ''}`} onClick={() => setGrade({ lutId: null })}>None</button>
          {project.luts.map((l) => (
            <button key={l.id} className={`list-item${g.lutId === l.id ? ' on' : ''}`} onClick={() => setGrade({ lutId: l.id })}>
              <span className="grow ellipsis">{l.name}</span><span className="badge">{l.size}³</span>
            </button>
          ))}
        </div>
        {g.lutId && <Slider label="LUT strength" value={g.lutMix} min={0} max={100} format={(v) => `${Math.round(v)}%`} onChange={(v, l) => setGrade({ lutMix: v }, l)} />}
        <button className="secondary-btn sm" onClick={importLut} data-testid="import-lut">Import .cube LUT</button>
      </Section>

      <div className="btn-row two">
        <button className="secondary-btn sm" onClick={() => setGrade({ ...defaultGrade() })}>Reset clip</button>
        <button className="secondary-btn sm" data-testid="grade-all" onClick={() => {
          update((p) => ({ ...p, clips: p.clips.map((c) => ({ ...c, grade: { ...g } })) }));
          toast('Grade copied to every clip', 'success', 2000);
        }}>Apply to all clips</button>
      </div>
    </div>
  );
}

/** Tiny visual hint of what a preset does. */
function swatch(p: Partial<Grade>): string {
  const warm = (p.temperature ?? 0) / 100, sat = 1 + (p.saturation ?? 0) / 100, ex = (p.exposure ?? 0) / 100;
  const base = (r: number, gg: number, b: number) => {
    const l = 0.3 * r + 0.59 * gg + 0.11 * b;
    const m = (v: number) => Math.round(Math.max(0, Math.min(255, (l + (v - l) * sat) * (1 + ex))));
    return `rgb(${m(r + 40 * warm)},${m(gg)},${m(b - 40 * warm)})`;
  };
  return `linear-gradient(135deg, ${base(40, 70, 110)}, ${base(200, 150, 110)})`;
}
