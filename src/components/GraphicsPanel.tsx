import { useEffect } from 'react';
import { useEditor } from '../store';
import type { AnimType, LoopType, Overlay, ShapeType, TextStyle } from '../types';
import { FONTS } from '../lib/defaults';
import { player, usePlayer } from '../lib/player';
import { totalDuration } from '../lib/timeline';
import { addMediaFile } from '../lib/projectIO';
import { loadFont } from '../lib/fonts';
import { editTransform, enableKeyframes, transformAt } from '../lib/overlayEdit';
import { STICKERS, imageOverlay, introCard, outroCard, pipOverlay, shapeOverlay, stickerOverlay, textOverlay, type TextPreset } from '../lib/overlayTemplates';
import { pickFiles } from './ClipStrip';
import { Chips, ColorField, Section, Slider, Toggle, secs } from './ui';
import { toast } from './Toast';
import { IconCopy, IconTrash } from './Icons';

const ANIM_IN: { value: AnimType; label: string }[] = [
  { value: 'none', label: 'None' }, { value: 'fade', label: 'Fade' }, { value: 'pop', label: 'Pop' }, { value: 'zoom', label: 'Zoom' },
  { value: 'slide-up', label: 'Slide up' }, { value: 'slide-down', label: 'Slide down' }, { value: 'slide-left', label: 'Slide ←' },
  { value: 'slide-right', label: 'Slide →' }, { value: 'bounce', label: 'Bounce' }, { value: 'typewriter', label: 'Typewriter' }, { value: 'draw', label: 'Draw on' },
];
const LOOPS: { value: LoopType; label: string }[] = [
  { value: 'none', label: 'None' }, { value: 'pulse', label: 'Pulse' }, { value: 'float', label: 'Float' }, { value: 'wiggle', label: 'Wiggle' }, { value: 'spin', label: 'Spin' },
];

export function GraphicsPanel() {
  const selection = useEditor((s) => s.selection);
  const overlays = useEditor((s) => s.project.overlays);
  const o = selection?.type === 'overlay' ? overlays.find((x) => x.id === selection.id) : undefined;
  return o ? <OverlayInspector o={o} /> : <GraphicsLibrary />;
}

function GraphicsLibrary() {
  const { addOverlay, update, setSelection } = useEditor.getState();
  const project = useEditor((s) => s.project);
  const at = () => Math.min(player.getTime(), Math.max(0, totalDuration(project.clips) - 0.5));
  const addMany = (list: Overlay[]) => {
    update((p) => ({ ...p, overlays: [...p.overlays, ...list] }));
    setSelection({ type: 'overlay', id: list[0].id });
  };
  const addImage = async (kind: 'image' | 'video') => {
    const [f] = await pickFiles(kind === 'image' ? 'image/*' : 'video/*');
    if (!f) return;
    try {
      const a = await addMediaFile(f, f.name);
      if (kind === 'image' && a.kind !== 'image') throw new Error('Please choose an image (PNG with transparency works best for logos).');
      if (kind === 'video' && a.kind !== 'video') throw new Error('Please choose a video.');
      addOverlay(kind === 'image' ? imageOverlay(a, 0, Math.max(1, totalDuration(project.clips))) : pipOverlay(a, at()));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const text = (k: TextPreset) => addOverlay(textOverlay(k, k === 'hook' ? 0 : at()));
  const shape = (s: ShapeType) => addOverlay(shapeOverlay(s, at()));

  return (
    <div className="panel-stack" data-testid="graphics-library">
      <Section title="Text">
        <div className="grid-cards">
          <button className="card-btn" onClick={() => text('text')} data-testid="add-text"><span className="big">Aa</span>Text</button>
          <button className="card-btn" onClick={() => text('title')} data-testid="add-title"><span className="big" style={{ fontFamily: 'Bebas Neue' }}>TITLE</span>Title</button>
          <button className="card-btn" onClick={() => text('hook')} data-testid="add-hook"><span className="big">⚡</span>Hook (0–3 s)</button>
          <button className="card-btn" onClick={() => text('lower-third')}><span className="big">▭</span>Lower third</button>
          <button className="card-btn" onClick={() => text('cta')}><span className="big">👉</span>Call to action</button>
          <button className="card-btn" onClick={() => text('label')}><span className="big">🏷</span>Label</button>
        </div>
      </Section>
      <Section title="Shapes & callouts">
        <div className="grid-cards">
          <button className="card-btn" onClick={() => shape('arrow')} data-testid="add-arrow"><span className="big">➜</span>Arrow</button>
          <button className="card-btn" onClick={() => shape('circle')} data-testid="add-circle"><span className="big">◯</span>Circle</button>
          <button className="card-btn" onClick={() => shape('rect')}><span className="big">▢</span>Highlight box</button>
          <button className="card-btn" onClick={() => shape('underline')}><span className="big">⌣</span>Underline</button>
          <button className="card-btn" onClick={() => shape('callout')}><span className="big">⊙</span>Callout</button>
        </div>
      </Section>
      <Section title="Stickers" defaultOpen={false}>
        <div className="sticker-grid">
          {STICKERS.map((e) => <button key={e} onClick={() => addOverlay(stickerOverlay(e, at()))} aria-label={`Add sticker ${e}`}>{e}</button>)}
        </div>
      </Section>
      <Section title="Logo, picture-in-picture, intro & outro">
        <div className="grid-cards">
          <button className="card-btn" onClick={() => void addImage('image')} data-testid="add-logo"><span className="big">🖼</span>Logo / image</button>
          <button className="card-btn" onClick={() => void addImage('video')} data-testid="add-pip"><span className="big">⧉</span>Picture-in-picture</button>
          <button className="card-btn" onClick={() => addMany(introCard(0))} data-testid="add-intro"><span className="big">▶</span>Intro card</button>
          <button className="card-btn" onClick={() => addMany(outroCard(Math.max(0, totalDuration(project.clips) - 3)))}><span className="big">■</span>Outro / CTA card</button>
        </div>
      </Section>
      <p className="muted small">Graphics appear at the playhead. Tap one on the timeline to edit it; drag it on the video to move it, pinch to resize.</p>
    </div>
  );
}

function OverlayInspector({ o }: { o: Overlay }) {
  const { patchOverlay, removeOverlay, duplicateOverlay, moveOverlayLayer, setSelection } = useEditor.getState();
  const time = usePlayer((s) => s.time);
  const set = (patch: Partial<Overlay>, live = false) => patchOverlay(o.id, patch, { history: !live });
  const tf = transformAt(o, time);
  const setTf = (patch: Parameters<typeof editTransform>[1], live: boolean) => set(editTransform(o, patch, player.getTime()), live);
  const st = o.style;
  const setStyle = (patch: Partial<TextStyle>, live = false) => st && set({ style: { ...st, ...patch } }, live);
  const inRange = time >= o.start && time < o.start + o.duration;
  useEffect(() => { if (st) void loadFont(st.font, st.weight).then(() => player.redraw()); }, [st?.font, st?.weight]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="panel-stack" data-testid="overlay-panel">
      <div className="panel-head">
        <div><h3 className="ellipsis">{o.name}</h3><p className="muted small">{secs(o.start)} → {secs(o.start + o.duration)}</p></div>
        <button className="text-btn" onClick={() => setSelection(null)}>Done</button>
      </div>
      <div className="btn-row">
        <button className="tool-btn" onClick={() => duplicateOverlay(o.id)}><IconCopy /><span>Copy</span></button>
        <button className="tool-btn" onClick={() => moveOverlayLayer(o.id, 1)}><span className="glyph">⬆︎</span><span>Forward</span></button>
        <button className="tool-btn" onClick={() => moveOverlayLayer(o.id, -1)}><span className="glyph">⬇︎</span><span>Back</span></button>
        <button className="tool-btn danger" onClick={() => removeOverlay(o.id)} data-testid="delete-overlay"><IconTrash /><span>Delete</span></button>
      </div>

      {o.kind === 'text' && st && (
        <Section title="Text">
          <textarea className="text-area" value={o.text ?? ''} onChange={(e) => set({ text: e.target.value }, true)} aria-label="Text" data-testid="overlay-text"
            onFocus={() => useEditor.getState().checkpoint()} />
          <p className="muted small">Tip: wrap words in *stars* to highlight them.</p>
          <select className="select" value={st.font} aria-label="Font" onChange={(e) => setStyle({ font: e.target.value, weight: FONTS.find((f) => f.family === e.target.value)!.weights.slice(-1)[0] })}>
            {FONTS.map((f) => <option key={f.family} value={f.family}>{f.label}</option>)}
          </select>
          <Slider label="Size" value={st.size} min={20} max={240} onChange={(v, l) => setStyle({ size: v }, l)} testId="text-size" />
          <Chips label="Alignment" value={st.align} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]} onChange={(align) => setStyle({ align })} />
          <Toggle label="UPPERCASE" checked={st.uppercase} onChange={(uppercase) => setStyle({ uppercase })} />
          <ColorField label="Colour" value={st.color} onChange={(color) => setStyle({ color })} />
          <ColorField label="Highlight colour" value={st.highlightColor} onChange={(highlightColor) => setStyle({ highlightColor })} />
          <Toggle label="Background box" checked={st.bg.on} onChange={(on) => setStyle({ bg: { ...st.bg, on } })} />
          {st.bg.on && <ColorField label="Box colour" value={st.bg.color} onChange={(color) => setStyle({ bg: { ...st.bg, color } })} />}
          <Toggle label="Outline" checked={st.outline.on} onChange={(on) => setStyle({ outline: { ...st.outline, on } })} />
          <Toggle label="Shadow" checked={st.shadow.on} onChange={(on) => setStyle({ shadow: { ...st.shadow, on, blur: st.shadow.blur || 14 } })} />
        </Section>
      )}

      {o.kind === 'shape' && (
        <Section title="Shape">
          <Chips label="Shape" value={o.shape!} onChange={(shape) => set({ shape })}
            options={[{ value: 'arrow', label: 'Arrow' }, { value: 'circle', label: 'Circle' }, { value: 'rect', label: 'Box' }, { value: 'underline', label: 'Underline' }, { value: 'callout', label: 'Callout' }]} />
          {o.shape === 'callout' && <input className="text-input" value={o.label ?? ''} onChange={(e) => set({ label: e.target.value }, true)} aria-label="Callout label" />}
          <ColorField label="Colour" value={o.color ?? '#ffd84d'} onChange={(color) => set({ color })} />
          <Slider label="Line width" value={o.strokeWidth ?? 10} min={2} max={30} onChange={(v, l) => set({ strokeWidth: v }, l)} />
          <Slider label="Width" value={(o.w ?? 0.3) * 100} min={5} max={100} format={(v) => `${Math.round(v)}%`} onChange={(v, l) => set({ w: v / 100 }, l)} />
          <Slider label="Height" value={(o.h ?? 0.15) * 100} min={2} max={100} format={(v) => `${Math.round(v)}%`} onChange={(v, l) => set({ h: v / 100 }, l)} />
          {(o.shape === 'rect' || o.shape === 'circle') && <Toggle label="Filled" checked={!!o.fill} onChange={(fill) => set({ fill })} />}
        </Section>
      )}

      {o.kind === 'sticker' && (
        <Section title="Sticker">
          <div className="sticker-grid">{STICKERS.map((e) => <button key={e} className={o.sticker === e ? 'on' : ''} onClick={() => set({ sticker: e, name: `Sticker ${e}` })}>{e}</button>)}</div>
        </Section>
      )}

      {(o.kind === 'image' || o.kind === 'video') && (
        <Section title={o.kind === 'image' ? 'Image' : 'Picture-in-picture'}>
          <Slider label="Size" value={(o.w ?? 0.4) * 100} min={5} max={100} format={(v) => `${Math.round(v)}%`} onChange={(v, l) => set({ w: v / 100 }, l)} />
          <Slider label="Rounded corners" value={o.radius ?? 0} min={0} max={120} onChange={(v, l) => set({ radius: v }, l)} />
          <Toggle label="Border" checked={!!o.border?.on} onChange={(on) => set({ border: { color: '#ffffff', width: 6, ...o.border, on } })} />
          {o.kind === 'video' && <Toggle label="Play this video's sound" checked={!o.muted} onChange={(v) => set({ muted: !v })} />}
        </Section>
      )}

      <Section title="Timing">
        <Slider label="Starts at" value={o.start} min={0} max={Math.max(o.start, totalDuration(useEditor.getState().project.clips))} step={0.05} format={secs} onChange={(v, l) => set({ start: v }, l)} />
        <Slider label="Duration" value={o.duration} min={0.3} max={Math.max(20, o.duration)} step={0.05} format={secs} onChange={(v, l) => set({ duration: v }, l)} testId="overlay-duration" />
        <button className="secondary-btn sm" onClick={() => set({ start: player.getTime() })}>Start at playhead</button>
      </Section>

      <Section title="Animation">
        <label className="field-label">In</label>
        <Chips label="Animation in" value={o.animIn.type} options={ANIM_IN} onChange={(type) => set({ animIn: { ...o.animIn, type } })} />
        <Slider label="In speed" value={o.animIn.duration} min={0.1} max={2} step={0.05} format={secs} onChange={(v, l) => set({ animIn: { ...o.animIn, duration: v } }, l)} />
        <label className="field-label">Out</label>
        <Chips label="Animation out" value={o.animOut.type} options={ANIM_IN} onChange={(type) => set({ animOut: { ...o.animOut, type } })} />
        <label className="field-label">Continuous motion</label>
        <Chips label="Loop animation" value={o.loop} options={LOOPS} onChange={(loop) => set({ loop })} />
      </Section>

      <Section title={`Position & keyframes${o.keyframes.length ? ` (${o.keyframes.length})` : ''}`}>
        {o.keyframes.length > 0 && <p className="notice small">Keyframes on: changes below (or dragging on the video) set a keyframe at the playhead{inRange ? '' : ' — move the playhead inside this graphic first'}.</p>}
        <Slider label="Left ↔ right" value={tf.x * 100} min={-20} max={120} format={(v) => `${Math.round(v)}%`} onChange={(v, l) => setTf({ x: v / 100 }, l)} testId="overlay-x" />
        <Slider label="Up ↕ down" value={tf.y * 100} min={-20} max={120} format={(v) => `${Math.round(v)}%`} onChange={(v, l) => setTf({ y: v / 100 }, l)} testId="overlay-y" />
        <Slider label="Scale" value={tf.scale * 100} min={10} max={400} format={(v) => `${Math.round(v)}%`} onChange={(v, l) => setTf({ scale: v / 100 }, l)} testId="overlay-scale" />
        <Slider label="Rotation" value={tf.rotation} min={-180} max={180} format={(v) => `${Math.round(v)}°`} onChange={(v, l) => setTf({ rotation: v }, l)} />
        <Slider label="Opacity" value={tf.opacity * 100} min={0} max={100} format={(v) => `${Math.round(v)}%`} onChange={(v, l) => setTf({ opacity: v / 100 }, l)} testId="overlay-opacity" />
        {!o.keyframes.length ? (
          <button className="secondary-btn sm" onClick={() => set(enableKeyframes(o, player.getTime()))} data-testid="enable-keyframes">Animate with keyframes</button>
        ) : (
          <>
            <div className="list">
              {o.keyframes.map((k, i) => (
                <div key={i} className="list-item">
                  <button className="grow tc" style={{ textAlign: 'left' }} onClick={() => void player.seek(o.start + k.t)}>◆ {secs(k.t)}</button>
                  <span className="muted small">x{Math.round(k.x * 100)} y{Math.round(k.y * 100)} {Math.round(k.scale * 100)}%</span>
                  <button className="mini-btn" aria-label="Delete keyframe" onClick={() => set({ keyframes: o.keyframes.filter((_, j) => j !== i) })}>✕</button>
                </div>
              ))}
            </div>
            <button className="text-btn" onClick={() => set({ keyframes: [], ...transformAt(o, player.getTime()) })}>Remove all keyframes</button>
          </>
        )}
      </Section>
    </div>
  );
}
