import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import { player, usePlayer } from '../lib/player';
import { aspectValue, totalDuration } from '../lib/timeline';
import { fmtTime } from '../lib/capabilities';
import { IconPause, IconPlay } from './Icons';

export function Preview() {
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const time = usePlayer((s) => s.time);
  const playing = usePlayer((s) => s.playing);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const ar = aspectValue(project.settings.aspect);
  const duration = totalDuration(project.clips);

  // Fit the preview frame inside the available space at the project's aspect ratio.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const W = el.clientWidth, H = el.clientHeight;
      let w = W, h = W / ar;
      if (h > H) { h = H; w = H * ar; }
      setBox({ w: Math.floor(w), h: Math.floor(h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ar]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || box.w === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Cap preview resolution to keep iPhone GPU memory low.
    const scale = Math.min(dpr, 1080 / Math.max(1, Math.min(box.w, box.h)));
    c.width = Math.round(box.w * scale);
    c.height = Math.round(box.h * scale);
    player.attach(c);
  }, [box.w, box.h]);

  useEffect(() => () => player.detach(), []);

  useEffect(() => {
    player.setProject(project, assets);
  }, [project, assets]);

  const empty = project.clips.length === 0;

  return (
    <section className="preview">
      <div className="preview-stage" ref={wrapRef}>
        <div
          className="preview-frame"
          style={{ width: box.w, height: box.h }}
          onClick={() => !empty && player.toggle()}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          role="button"
        >
          <canvas ref={canvasRef} data-testid="preview-canvas" />
          {empty && <div className="preview-empty">Your video preview appears here</div>}
          {!empty && !playing && (
            <div className="preview-playhint" aria-hidden><IconPlay width={34} height={34} /></div>
          )}
        </div>
      </div>
      <div className="transport">
        <button
          className="play-btn"
          onClick={() => player.toggle()}
          disabled={empty}
          aria-label={playing ? 'Pause' : 'Play'}
          data-testid="play"
        >
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <span className="tc" data-testid="timecode">{fmtTime(time, true)}</span>
        <input
          className="scrubber"
          type="range"
          min={0}
          max={Math.max(0.01, duration)}
          step={0.01}
          value={Math.min(time, duration)}
          disabled={empty}
          aria-label="Playhead position"
          onPointerDown={() => player.pause()}
          onChange={(e) => void player.seek(Number(e.target.value))}
          style={{ ['--pct' as string]: `${duration ? (Math.min(time, duration) / duration) * 100 : 0}%` }}
        />
        <span className="tc tc-dim">{fmtTime(duration, true)}</span>
      </div>
    </section>
  );
}
