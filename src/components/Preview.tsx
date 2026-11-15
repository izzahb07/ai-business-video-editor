import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import { player, usePlayer } from '../lib/player';
import { aspectValue, totalDuration } from '../lib/timeline';
import { fmtTime } from '../lib/capabilities';
import { useUi } from '../uiState';
import { IconPause, IconPlay } from './Icons';

export function Preview() {
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const selection = useEditor((s) => s.selection);
  const time = usePlayer((s) => s.time);
  const playing = usePlayer((s) => s.playing);
  const compare = useUi((s) => s.compare);
  const setCompare = useUi((s) => s.setCompare);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const ar = aspectValue(project.settings.aspect);
  const duration = totalDuration(project.clips);

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
  useEffect(() => { player.setProject(project, assets); }, [project, assets]);
  useEffect(() => { player.compare = compare; player.redraw(); }, [compare]);

  // Drag on the video to move the selected graphic or the captions; pinch to resize a graphic.
  const gesture = useRef<{ x0: number; y0: number; ox: number; oy: number; moved: boolean; d0?: number; s0?: number } | null>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const target = () => {
    const st = useEditor.getState();
    if (st.selection?.type === 'overlay') {
      const o = st.project.overlays.find((x) => x.id === st.selection!.id);
      if (o) return { kind: 'overlay' as const, o };
    }
    if (st.selection?.type === 'caption') return { kind: 'caption' as const };
    return null;
  };
  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const tg = target();
    if (pts.current.size === 2 && tg?.kind === 'overlay') {
      const [a, b] = [...pts.current.values()];
      gesture.current = { ...(gesture.current ?? { x0: 0, y0: 0, ox: 0, oy: 0 }), moved: true, d0: Math.hypot(a.x - b.x, a.y - b.y), s0: tg.o.scale };
      return;
    }
    const st = useEditor.getState();
    if (tg) st.checkpoint();
    const ox = tg?.kind === 'overlay' ? tg.o.x : 0.5;
    const oy = tg?.kind === 'overlay' ? tg.o.y : st.project.captions.style.y;
    gesture.current = { x0: e.clientX, y0: e.clientY, ox, oy, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || !pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const tg = target();
    if (!tg) return;
    const st = useEditor.getState();
    if (pts.current.size === 2 && g.d0 && tg.kind === 'overlay') {
      const [a, b] = [...pts.current.values()];
      st.patchOverlay(tg.o.id, { scale: Math.max(0.1, Math.min(6, (g.s0 ?? 1) * Math.hypot(a.x - b.x, a.y - b.y) / g.d0)) }, { history: false });
      return;
    }
    const dx = (e.clientX - g.x0) / box.w, dy = (e.clientY - g.y0) / box.h;
    if (Math.abs(dx) + Math.abs(dy) > 0.01) g.moved = true;
    if (!g.moved) return;
    if (tg.kind === 'overlay') st.patchOverlay(tg.o.id, { x: g.ox + dx, y: g.oy + dy }, { history: false });
    else st.setCaptions({ style: { ...st.project.captions.style, y: Math.max(0.05, Math.min(0.95, g.oy + dy)) } }, { history: false });
  };
  const onUp = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    const g = gesture.current;
    if (pts.current.size > 0) return;
    gesture.current = null;
    if (g && !g.moved && project.clips.length) player.toggle();
  };

  const empty = project.clips.length === 0;
  const dragHint = selection?.type === 'overlay' ? 'Drag to move · pinch to resize' : selection?.type === 'caption' ? 'Drag up/down to move captions' : null;

  return (
    <section className="preview">
      <div className="preview-stage" ref={wrapRef}>
        <div
          className="preview-frame"
          style={{ width: box.w, height: box.h }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          role="button"
        >
          <canvas ref={canvasRef} data-testid="preview-canvas" />
          {empty && <div className="preview-empty">Your video preview appears here</div>}
          {!empty && !playing && !dragHint && <div className="preview-playhint" aria-hidden><IconPlay width={30} height={30} /></div>}
          {dragHint && <div className="preview-hint">{dragHint}</div>}
          {compare != null && (
            <>
              <div className="compare-line" style={{ left: `${compare * 100}%` }} aria-hidden />
              <span className="compare-tag left">Before</span>
              <span className="compare-tag right">After</span>
            </>
          )}
        </div>
      </div>
      <div className="transport">
        <button className="play-btn" onClick={() => player.toggle()} disabled={empty} aria-label={playing ? 'Pause' : 'Play'} data-testid="play">
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <span className="tc" data-testid="timecode">{fmtTime(time, true)}</span>
        <input
          className="scrubber" type="range" min={0} max={Math.max(0.01, duration)} step={0.01}
          value={Math.min(time, duration)} disabled={empty} aria-label="Playhead position"
          onPointerDown={() => player.pause()}
          onChange={(e) => void player.seek(Number(e.target.value))}
          style={{ ['--pct' as string]: `${duration ? (Math.min(time, duration) / duration) * 100 : 0}%` }}
        />
        <span className="tc tc-dim">{fmtTime(duration, true)}</span>
        {compare != null && (
          <button className="mini-btn" onClick={() => setCompare(null)} aria-label="Turn off before/after">B/A ✕</button>
        )}
      </div>
    </section>
  );
}
