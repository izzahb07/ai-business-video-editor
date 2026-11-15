import { useEditor } from '../store';
import type { AspectRatio } from '../types';
import { clipDuration } from '../lib/timeline';
import { fmtBytes, fmtTime } from '../lib/capabilities';
import { Segmented } from './Sheet';
import { IconCopy, IconLeft, IconMute, IconRight, IconTrash, IconVolume } from './Icons';

export function ClipPanel() {
  const id = useEditor((s) => s.selectedClipId);
  const clips = useEditor((s) => s.project.clips);
  const assets = useEditor((s) => s.assets);
  const { moveClip, removeClip, duplicateClip, patchClip, checkpoint, select } = useEditor.getState();
  const idx = clips.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const clip = clips[idx];
  const a = assets[clip.assetId];

  return (
    <section className="panel" aria-label="Selected clip" data-testid="clip-panel">
      <div className="panel-head">
        <div>
          <h3>Clip {idx + 1}</h3>
          <p className="muted small ellipsis">
            {a?.name} · {fmtTime(clipDuration(clip), true)} · {a ? `${a.width}×${a.height}` : ''} {a ? `· ${fmtBytes(a.size)}` : ''}
          </p>
        </div>
        <button className="text-btn" onClick={() => select(null)}>Done</button>
      </div>

      <div className="btn-row">
        <button className="tool-btn" onClick={() => moveClip(clip.id, -1)} disabled={idx === 0} aria-label="Move earlier">
          <IconLeft /><span>Earlier</span>
        </button>
        <button className="tool-btn" onClick={() => moveClip(clip.id, 1)} disabled={idx === clips.length - 1} aria-label="Move later">
          <IconRight /><span>Later</span>
        </button>
        <button className="tool-btn" onClick={() => duplicateClip(clip.id)} aria-label="Duplicate clip">
          <IconCopy /><span>Duplicate</span>
        </button>
        <button className="tool-btn danger" onClick={() => removeClip(clip.id)} aria-label="Delete clip" data-testid="delete-clip">
          <IconTrash /><span>Delete</span>
        </button>
      </div>

      <div className="field">
        <label>Framing</label>
        <Segmented
          label="Framing"
          value={clip.fit}
          onChange={(fit) => patchClip(clip.id, { fit })}
          options={[
            { value: 'fill', label: 'Fill', sub: 'Crop to fill screen' },
            { value: 'fit', label: 'Fit', sub: 'Show whole video' },
          ]}
        />
      </div>

      <div className="field">
        <label htmlFor="vol">
          Volume <span className="muted">{clip.muted ? 'Muted' : `${Math.round(clip.volume * 100)}%`}</span>
        </label>
        <div className="slider-row">
          <button
            className={`icon-btn${clip.muted ? ' on' : ''}`}
            onClick={() => patchClip(clip.id, { muted: !clip.muted })}
            aria-label={clip.muted ? 'Unmute clip' : 'Mute clip'}
            aria-pressed={clip.muted}
          >
            {clip.muted ? <IconMute /> : <IconVolume />}
          </button>
          <input
            id="vol"
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={clip.volume}
            disabled={clip.muted}
            onPointerDown={checkpoint}
            onChange={(e) => patchClip(clip.id, { volume: Number(e.target.value) }, { history: false })}
            style={{ ['--pct' as string]: `${(clip.volume / 2) * 100}%` }}
          />
        </div>
        {!a?.hasAudio && <p className="muted small">This clip has no sound.</p>}
      </div>
    </section>
  );
}

const ASPECTS: { value: AspectRatio; label: string; sub: string }[] = [
  { value: '9:16', label: '9:16', sub: 'TikTok · Reels' },
  { value: '1:1', label: '1:1', sub: 'Square' },
  { value: '4:5', label: '4:5', sub: 'Feed post' },
  { value: '16:9', label: '16:9', sub: 'YouTube' },
];

export function FormatPanel() {
  const settings = useEditor((s) => s.project.settings);
  const setSettings = useEditor((s) => s.setSettings);
  return (
    <section className="panel" aria-label="Video format">
      <div className="panel-head"><h3>Format</h3></div>
      <div className="field">
        <label>Shape</label>
        <Segmented label="Aspect ratio" value={settings.aspect} options={ASPECTS} onChange={(aspect) => setSettings({ aspect })} />
      </div>
      <div className="field">
        <label>Background for "Fit" clips</label>
        <Segmented
          label="Background"
          value={settings.background}
          onChange={(background) => setSettings({ background })}
          options={[
            { value: 'blur', label: 'Blurred' },
            { value: 'black', label: 'Black' },
          ]}
        />
      </div>
    </section>
  );
}
