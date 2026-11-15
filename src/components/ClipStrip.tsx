import { useRef, useState } from 'react';
import { useEditor } from '../store';
import { clipDuration, layoutClips } from '../lib/timeline';
import { fmtTime } from '../lib/capabilities';
import { player, usePlayer } from '../lib/player';
import { importFiles } from '../lib/projectIO';
import { toast } from './Toast';
import { IconPlus } from './Icons';

export function useImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const open = () => inputRef.current?.click();
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="video/*,.mov,.mp4,.m4v"
      multiple
      hidden
      data-testid="file-input"
      onChange={async (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (!files.length) return;
        const n = await importFiles(files, setStatus);
        setStatus(null);
        if (n > 0) toast(`Added ${n} clip${n > 1 ? 's' : ''}`, 'success', 2500);
      }}
    />
  );
  return { open, input, status };
}

export function ClipStrip() {
  const clips = useEditor((s) => s.project.clips);
  const assets = useEditor((s) => s.assets);
  const selected = useEditor((s) => s.selectedClipId);
  const select = useEditor((s) => s.select);
  const time = usePlayer((s) => s.time);
  const { open, input, status } = useImport();
  const placed = layoutClips(clips);

  return (
    <section className="strip-wrap" aria-label="Clips in order">
      <div className="strip-head">
        <h3>Clips <span className="muted">· {clips.length}</span></h3>
        <span className="muted small">Tap a clip to edit it</span>
      </div>
      <div className="strip" data-testid="clip-strip">
        {placed.map((p, i) => {
          const a = assets[p.clip.assetId];
          const active = time >= p.start && time < p.end;
          return (
            <button
              key={p.clip.id}
              className={`clip-card${selected === p.clip.id ? ' selected' : ''}${active ? ' active' : ''}`}
              onClick={() => {
                select(selected === p.clip.id ? null : p.clip.id);
                void player.seek(p.start);
              }}
              aria-pressed={selected === p.clip.id}
              aria-label={`Clip ${i + 1}: ${a?.name}`}
              data-testid="clip-card"
            >
              <div className="clip-thumb" style={{ backgroundImage: a?.thumb ? `url(${a.thumb})` : undefined }}>
                <span className="clip-num">{i + 1}</span>
                {p.clip.muted && <span className="clip-flag">MUTED</span>}
              </div>
              <span className="clip-dur">{fmtTime(clipDuration(p.clip), true)}</span>
            </button>
          );
        })}
        <button className="clip-add" onClick={open} aria-label="Add videos" data-testid="add-clips">
          <IconPlus />
          <span>Add</span>
        </button>
      </div>
      {status && <div className="import-status" role="status"><span className="spinner" /> {status}</div>}
      {input}
    </section>
  );
}
