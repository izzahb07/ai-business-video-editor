import { useEditor } from '../store';
import type { Clip, TransitionType } from '../types';
import { clipDuration, layoutClips } from '../lib/timeline';
import { player, usePlayer } from '../lib/player';
import { fmtBytes, fmtTime } from '../lib/capabilities';
import { defaultTransform } from '../lib/defaults';
import { Segmented } from './Sheet';
import { Chips, Empty, Section, Slider, Toggle, secs } from './ui';
import { IconCopy, IconLeft, IconPlay, IconRight, IconTrash } from './Icons';
import { toast } from './Toast';
import { useImport } from './ClipStrip';
import { useUi } from '../uiState';

const TRANSITIONS: { value: TransitionType; label: string }[] = [
  { value: 'none', label: 'Cut' },
  { value: 'fade', label: 'Fade black' },
  { value: 'flash', label: 'Flash' },
  { value: 'zoom', label: 'Zoom punch' },
  { value: 'whip', label: 'Whip' },
  { value: 'blur', label: 'Blur' },
];

export function SplitButton() {
  const splitAt = useEditor((s) => s.splitAt);
  return (
    <button
      className="tool-btn"
      onClick={() => {
        player.pause();
        if (!splitAt(player.getTime())) toast('Move the playhead inside a clip (not at its edge) to split.', 'warn');
        else toast('Clip split', 'success', 1500);
      }}
      data-testid="split"
      aria-label="Split clip at playhead"
    >
      <span className="glyph" aria-hidden>✂︎</span><span>Split</span>
    </button>
  );
}

export function EditPanel() {
  const selection = useEditor((s) => s.selection);
  const clips = useEditor((s) => s.project.clips);
  const { open, input, status } = useImport();
  const clip = selection?.type === 'clip' ? clips.find((c) => c.id === selection.id) : undefined;

  if (!clip) {
    return (
      <div className="panel-stack">
        <div className="btn-row">
          <button className="tool-btn" onClick={open} data-testid="add-clips"><span className="glyph">＋</span><span>Add media</span></button>
          <SplitButton />
        </div>
        {status && <div className="import-status" role="status"><span className="spinner" /> {status}</div>}
        <button className="primary-btn" onClick={() => useUi.getState().setTab('ai')} data-testid="goto-auto">✨ Let AI edit it for me</button>
        <Empty>Tap a clip on the timeline to trim, crop, rotate, reposition or add a transition. Drag a selected clip to reorder it, or drag its yellow edges to trim.</Empty>
        {input}
      </div>
    );
  }
  return <ClipInspector clip={clip} />;
}

function ClipInspector({ clip }: { clip: Clip }) {
  const clips = useEditor((s) => s.project.clips);
  const assets = useEditor((s) => s.assets);
  const { moveClip, removeClip, duplicateClip, patchClip, trimClip, setSelection } = useEditor.getState();
  const time = usePlayer((s) => s.time);
  const idx = clips.findIndex((c) => c.id === clip.id);
  const a = assets[clip.assetId];
  const placed = layoutClips(clips)[idx];
  const tr = clip.transform;
  const setTr = (patch: Partial<Clip['transform']>, live = false) => patchClip(clip.id, { transform: { ...tr, ...patch } }, { history: !live });
  const srcAtPlayhead = placed && time >= placed.start && time <= placed.end ? clip.in + (time - placed.start) : null;
  const maxDur = a?.kind === 'image' ? 60 : a?.duration ?? clip.out;

  return (
    <div className="panel-stack" data-testid="clip-panel">
      <div className="panel-head">
        <div>
          <h3>Clip {idx + 1}</h3>
          <p className="muted small ellipsis">{a?.name} · {fmtTime(clipDuration(clip), true)}{a?.width ? ` · ${a.width}×${a.height}` : ''}{a ? ` · ${fmtBytes(a.size)}` : ''}</p>
        </div>
        <button className="text-btn" onClick={() => setSelection(null)}>Done</button>
      </div>

      <div className="btn-row">
        <button className="tool-btn" onClick={() => placed && void player.playRange(placed.start, placed.end)} aria-label="Preview this clip"><IconPlay /><span>Preview</span></button>
        <SplitButton />
        <button className="tool-btn" onClick={() => moveClip(clip.id, -1)} disabled={idx === 0} aria-label="Move earlier"><IconLeft /><span>Earlier</span></button>
        <button className="tool-btn" onClick={() => moveClip(clip.id, 1)} disabled={idx === clips.length - 1} aria-label="Move later"><IconRight /><span>Later</span></button>
        <button className="tool-btn" onClick={() => duplicateClip(clip.id)} aria-label="Duplicate clip"><IconCopy /><span>Copy</span></button>
        <button className="tool-btn danger" onClick={() => removeClip(clip.id)} aria-label="Delete clip" data-testid="delete-clip"><IconTrash /><span>Delete</span></button>
      </div>

      <Section title="Trim & duration">
        <Slider label="Start (in)" value={clip.in} min={0} max={Math.max(0.1, clip.out - 0.1)} step={0.01} format={secs}
          onChange={(v, live) => trimClip(clip.id, v, clip.out, { history: !live })} testId="trim-in-slider" />
        <Slider label="End (out)" value={clip.out} min={clip.in + 0.1} max={maxDur} step={0.01} format={secs}
          onChange={(v, live) => trimClip(clip.id, clip.in, v, { history: !live })} testId="trim-out-slider" />
        <div className="btn-row two">
          <button className="secondary-btn sm" disabled={srcAtPlayhead == null} onClick={() => srcAtPlayhead != null && trimClip(clip.id, srcAtPlayhead, clip.out)}>Start here</button>
          <button className="secondary-btn sm" disabled={srcAtPlayhead == null} onClick={() => srcAtPlayhead != null && trimClip(clip.id, clip.in, srcAtPlayhead)}>End here</button>
        </div>
        <p className="muted small">Duration {fmtTime(clipDuration(clip), true)} {a?.kind === 'image' ? '(photo — drag the end to make it longer)' : `of ${fmtTime(a?.duration ?? 0, true)}`}</p>
      </Section>

      <Section title="Frame: crop, rotate, position">
        <Segmented label="Framing" value={clip.fit} onChange={(fit) => patchClip(clip.id, { fit })}
          options={[{ value: 'fill', label: 'Fill', sub: 'Crop to screen' }, { value: 'fit', label: 'Fit', sub: 'Show whole' }]} />
        <Slider label="Zoom" value={tr.scale} min={0.3} max={3} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v, l) => setTr({ scale: v }, l)} testId="clip-scale" />
        <Slider label="Move left / right" value={tr.x} min={-1} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}`} onChange={(v, l) => setTr({ x: v }, l)} />
        <Slider label="Move up / down" value={tr.y} min={-1} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}`} onChange={(v, l) => setTr({ y: v }, l)} />
        <Slider label="Rotate" value={tr.rotation} min={-180} max={180} step={0.5} format={(v) => `${Math.round(v)}°`} onChange={(v, l) => setTr({ rotation: v }, l)} testId="clip-rotate" />
        <div className="btn-row">
          <button className="secondary-btn sm" onClick={() => setTr({ rotation: ((tr.rotation + 90 + 180) % 360) - 180 })}>Rotate 90°</button>
          <button className="secondary-btn sm" onClick={() => setTr({ flipH: !tr.flipH })}>Flip</button>
          <button className="secondary-btn sm" onClick={() => setTr(defaultTransform())}>Reset</button>
        </div>
        <Slider label="Crop left" value={tr.cropX * 100} min={0} max={90} format={(v) => `${Math.round(v)}%`}
          onChange={(v, l) => setTr({ cropX: v / 100, cropW: Math.max(0.05, Math.min(tr.cropW, 1 - v / 100)) }, l)} testId="crop-left" />
        <Slider label="Crop right" value={(1 - tr.cropX - tr.cropW) * 100} min={0} max={90} format={(v) => `${Math.round(v)}%`}
          onChange={(v, l) => setTr({ cropW: Math.max(0.05, 1 - tr.cropX - v / 100) }, l)} />
        <Slider label="Crop top" value={tr.cropY * 100} min={0} max={90} format={(v) => `${Math.round(v)}%`}
          onChange={(v, l) => setTr({ cropY: v / 100, cropH: Math.max(0.05, Math.min(tr.cropH, 1 - v / 100)) }, l)} />
        <Slider label="Crop bottom" value={(1 - tr.cropY - tr.cropH) * 100} min={0} max={90} format={(v) => `${Math.round(v)}%`}
          onChange={(v, l) => setTr({ cropH: Math.max(0.05, 1 - tr.cropY - v / 100) }, l)} />
      </Section>

      {idx > 0 && (
        <Section title="Transition into this clip">
          <Chips label="Transition" value={clip.transition.type} options={TRANSITIONS}
            onChange={(type) => patchClip(clip.id, { transition: { ...clip.transition, type } })} />
          {clip.transition.type !== 'none' && (
            <Slider label="Length" value={clip.transition.duration} min={0.2} max={1.5} step={0.05} format={secs}
              onChange={(v, l) => patchClip(clip.id, { transition: { ...clip.transition, duration: v } }, { history: !l })} />
          )}
          <button className="text-btn" onClick={() => {
            useEditor.getState().update((p) => ({ ...p, clips: p.clips.map((c, i) => (i === 0 ? c : { ...c, transition: { ...clip.transition } })) }));
            toast('Transition applied to every cut', 'success', 1800);
          }}>Apply to all cuts</button>
        </Section>
      )}

      {a?.kind !== 'image' && (
        <Section title="Clip sound" defaultOpen={false}>
          <Toggle label="Mute this clip" checked={clip.muted} onChange={(muted) => patchClip(clip.id, { muted })} />
          <Slider label="Volume" value={clip.volume * 100} min={0} max={200} format={(v) => `${Math.round(v)}%`} disabled={clip.muted}
            onChange={(v, l) => patchClip(clip.id, { volume: v / 100 }, { history: !l })} />
          <Toggle label="Voice enhance" hint="Clearer speech: low-cut, presence EQ and compression" checked={clip.voice.enhance}
            onChange={(enhance) => patchClip(clip.id, { voice: { ...clip.voice, enhance } })} />
          <Toggle label="Reduce background noise" hint="Noise gate: quietens hiss and room noise between words" checked={clip.voice.denoise}
            onChange={(denoise) => patchClip(clip.id, { voice: { ...clip.voice, denoise } })} />
          {!a?.hasAudio && <p className="muted small">This clip has no sound.</p>}
        </Section>
      )}
    </div>
  );
}
