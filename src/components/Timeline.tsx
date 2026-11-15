import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useEditor, type Selection } from '../store';
import { layoutClips, totalDuration } from '../lib/timeline';
import { player, usePlayer } from '../lib/player';
import { getFilmstrip, drawWaveform, type Filmstrip } from '../lib/filmstrip';
import { getAudio } from '../lib/registry';
import { analyzeBuffer, HOP } from '../engine/audio';
import { resolveCaptions } from '../engine/captions';
import { fmtTime } from '../lib/capabilities';
import type { Asset, Clip } from '../types';

const MIN_PPS = 6, MAX_PPS = 480;

interface Bar { id: string; start: number; end: number; label: string; lane: number }
function packLanes<T extends { id: string; start: number; end: number }>(items: T[], maxLanes = 3): (T & { lane: number })[] {
  const ends: number[] = [];
  return [...items].sort((a, b) => a.start - b.start).map((it) => {
    let lane = ends.findIndex((e) => e <= it.start + 1e-3);
    if (lane < 0) lane = ends.length < maxLanes ? ends.length : maxLanes - 1;
    ends[lane] = Math.max(ends[lane] ?? 0, it.end);
    return { ...it, lane };
  });
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const selection = useEditor((s) => s.selection);
  const setSelection = useEditor((s) => s.setSelection);
  const time = usePlayer((s) => s.time);
  const playing = usePlayer((s) => s.playing);
  const [pps, setPps] = useState(60);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(360);
  const ignoreScroll = useRef(false);
  const ppsRef = useRef(pps);
  ppsRef.current = pps;

  const placed = useMemo(() => layoutClips(project.clips), [project.clips]);
  const duration = totalDuration(project.clips);
  const half = vw / 2;
  const innerW = duration * pps + vw;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVw(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the playhead (centre) at the current time.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const want = time * pps;
    if (Math.abs(el.scrollLeft - want) > 1) {
      ignoreScroll.current = true;
      el.scrollLeft = want;
    }
  }, [time, pps, vw]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (ignoreScroll.current) { ignoreScroll.current = false; return; }
    if (player.isPlaying()) player.pause();
    void player.seek(el.scrollLeft / ppsRef.current);
  };

  // Pinch-zoom (touch) and ctrl/⌘+wheel (desktop).
  const pointers = useRef(new Map<number, number>());
  const pinchStart = useRef<{ d: number; pps: number } | null>(null);
  const onPointerDown = (e: RPointerEvent) => {
    pointers.current.set(e.pointerId, e.clientX);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { d: Math.abs(a - b) || 1, pps };
    }
  };
  const onPointerMove = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, e.clientX);
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.abs(a - b) || 1;
      setPps(Math.max(MIN_PPS, Math.min(MAX_PPS, pinchStart.current.pps * (d / pinchStart.current.d))));
    }
  };
  const onPointerUp = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setPps((p) => Math.max(MIN_PPS, Math.min(MAX_PPS, p * Math.exp(-e.deltaY * 0.01))));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const overlayBars = packLanes(project.overlays.map((o) => ({ id: o.id, start: o.start, end: o.start + o.duration, label: o.name, kind: o.kind })));
  const overlayLanes = overlayBars.length ? Math.max(...overlayBars.map((b) => b.lane)) + 1 : 0;
  const capCards = project.captions.enabled ? resolveCaptions(project) : [];
  // One bar per caption segment occurrence (merge its cards).
  const capBars: Bar[] = [];
  for (const c of capCards) {
    const last = capBars[capBars.length - 1];
    if (last && last.id === c.segmentId && c.start - last.end < 0.05) last.end = c.end;
    else capBars.push({ id: c.segmentId, start: c.start, end: c.end, label: c.words.map((w) => w.text).join(' '), lane: 0 });
  }
  const audioBars = packLanes(project.audio.items.map((a) => ({
    id: a.id, start: a.start, end: a.start + a.length, label: assets[a.assetId]?.name ?? 'Audio', kind: a.kind,
  })), 2);
  const audioLanes = audioBars.length ? Math.max(...audioBars.map((b) => b.lane)) + 1 : 0;

  const isSel = (type: NonNullable<Selection>['type'], id: string) => selection?.type === type && selection.id === id;

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="tl-toolbar">
        <span className="tc" data-testid="tl-time">{fmtTime(time, true)} / {fmtTime(duration, true)}</span>
        <div className="tl-zoom">
          <button className="mini-btn" onClick={() => setPps((p) => Math.max(MIN_PPS, p / 1.5))} aria-label="Zoom out timeline">−</button>
          <button className="mini-btn" onClick={() => setPps((p) => Math.min(MAX_PPS, p * 1.5))} aria-label="Zoom in timeline">+</button>
        </div>
      </div>
      <div
        className="tl-scroll"
        ref={scrollRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid="timeline"
      >
        <div className="tl-inner" style={{ width: innerW }}>
          <Ruler duration={duration} pps={pps} offset={half} />
          {/* Video track */}
          <div className="tl-row tl-video">
            <span className="tl-label">Video</span>
            {placed.map((p) => (
              <ClipBox
                key={p.clip.id}
                clip={p.clip}
                asset={assets[p.clip.assetId]}
                left={half + p.start * pps}
                width={(p.end - p.start) * pps}
                pps={pps}
                index={p.index}
                count={placed.length}
                selected={isSel('clip', p.clip.id)}
                onSelect={() => setSelection(isSel('clip', p.clip.id) ? null : { type: 'clip', id: p.clip.id })}
                placedStarts={placed.map((q) => ({ start: q.start, end: q.end }))}
                disabled={playing}
              />
            ))}
          </div>
          {/* Original clip audio */}
          <div className="tl-row tl-clipaudio">
            <span className="tl-label">Audio</span>
            {placed.map((p) => (
              <ClipWave key={p.clip.id} clip={p.clip} left={half + p.start * pps} width={(p.end - p.start) * pps} />
            ))}
          </div>
          {overlayLanes > 0 && (
            <div className="tl-row tl-bars" style={{ height: overlayLanes * 28 + 4 }}>
              <span className="tl-label">Graphics</span>
              {overlayBars.map((b) => (
                <ItemBar key={b.id} kind="overlay" id={b.id} label={b.label} start={b.start} end={b.end} lane={b.lane} pps={pps} offset={half}
                  cls={`bar-overlay bar-${b.kind}`} selected={isSel('overlay', b.id)} />
              ))}
            </div>
          )}
          {capBars.length > 0 && (
            <div className="tl-row tl-bars" style={{ height: 30 }}>
              <span className="tl-label">Captions</span>
              {capBars.map((b, i) => (
                <button key={b.id + i} className={`tl-bar bar-caption${isSel('caption', b.id) ? ' selected' : ''}`}
                  style={{ left: half + b.start * pps, width: Math.max(4, (b.end - b.start) * pps), top: 2 }}
                  onClick={() => setSelection({ type: 'caption', id: b.id })} data-testid="caption-bar">
                  <span>{b.label}</span>
                </button>
              ))}
            </div>
          )}
          {audioLanes > 0 && (
            <div className="tl-row tl-bars" style={{ height: audioLanes * 28 + 4 }}>
              <span className="tl-label">Music · SFX</span>
              {audioBars.map((b) => (
                <ItemBar key={b.id} kind="audio" id={b.id} label={b.label} start={b.start} end={b.end} lane={b.lane} pps={pps} offset={half}
                  cls={b.kind === 'music' ? 'bar-music' : 'bar-sfx'} selected={isSel('audio', b.id)}
                  wave={project.audio.items.find((i) => i.id === b.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="tl-playhead" aria-hidden />
    </section>
  );
}

function Ruler({ duration, pps, offset }: { duration: number; pps: number; offset: number }) {
  const step = pps > 160 ? 0.5 : pps > 60 ? 1 : pps > 25 ? 2 : pps > 12 ? 5 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(t);
  return (
    <div className="tl-ruler">
      {ticks.map((t) => (
        <span key={t} style={{ left: offset + t * pps }}>{fmtTime(t)}</span>
      ))}
    </div>
  );
}

function ClipBox({ clip, asset, left, width, pps, index, count, selected, onSelect, placedStarts, disabled }: {
  clip: Clip; asset: Asset | undefined; left: number; width: number; pps: number; index: number; count: number;
  selected: boolean; onSelect: () => void; placedStarts: { start: number; end: number }[]; disabled: boolean;
}) {
  const [strip, setStrip] = useState<Filmstrip | null>(null);
  const [drag, setDrag] = useState<{ dx: number } | null>(null);
  const { trimClip, checkpoint, reorderClip } = useEditor.getState();
  useEffect(() => {
    if (asset) void getFilmstrip(asset).then(setStrip);
  }, [asset]);

  const bg = (() => {
    if (!asset) return {};
    if (asset.kind === 'image' || !strip) return { backgroundImage: asset.thumb ? `url(${asset.thumb})` : undefined, backgroundSize: 'auto 100%' };
    const full = asset.duration * pps;
    return {
      backgroundImage: `url(${strip.url})`,
      backgroundSize: `${full}px 100%`,
      backgroundPosition: `${-clip.in * pps}px 0`,
      backgroundRepeat: 'no-repeat',
    };
  })();

  // Trim with edge handles.
  const startTrim = (edge: 'in' | 'out') => (e: RPointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    checkpoint();
    const x0 = e.clientX, in0 = clip.in, out0 = clip.out;
    const move = (ev: PointerEvent) => {
      const ds = (ev.clientX - x0) / pps;
      if (edge === 'in') trimClip(clip.id, in0 + ds, out0, { history: false });
      else trimClip(clip.id, in0, out0 + ds, { history: false });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // Drag a selected clip to reorder.
  const startMove = (e: RPointerEvent) => {
    if (!selected || count < 2) return;
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 6) moved = true;
      if (moved) setDrag({ dx });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDrag(null);
      if (!moved) return;
      const centre = placedStarts[index].start + (placedStarts[index].end - placedStarts[index].start) / 2 + (ev.clientX - x0) / pps;
      let to = placedStarts.findIndex((p) => centre < p.start + (p.end - p.start) / 2);
      if (to < 0) to = count - 1;
      else if (to > index) to -= 1;
      if (to !== index) reorderClip(clip.id, to);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <div
      className={`tl-clip${selected ? ' selected' : ''}${drag ? ' dragging' : ''}`}
      style={{ left, width: Math.max(6, width), transform: drag ? `translateX(${drag.dx}px)` : undefined, ...bg }}
      onClick={(e) => { e.stopPropagation(); if (!drag) onSelect(); }}
      onPointerDown={startMove}
      role="button"
      aria-label={`Clip ${index + 1}${asset ? ': ' + asset.name : ''}`}
      aria-pressed={selected}
      data-testid="clip-card"
    >
      <span className="tl-clip-num">{index + 1}</span>
      {clip.transition.type !== 'none' && index > 0 && <span className="tl-trans" title={`Transition: ${clip.transition.type}`}>⧓</span>}
      {clip.muted && <span className="tl-mute">MUTED</span>}
      {selected && !disabled && (
        <>
          <span className="tl-handle left" onPointerDown={startTrim('in')} aria-label="Trim start" role="slider" aria-valuenow={clip.in} data-testid="trim-in" />
          <span className="tl-handle right" onPointerDown={startTrim('out')} aria-label="Trim end" role="slider" aria-valuenow={clip.out} data-testid="trim-out" />
        </>
      )}
    </div>
  );
}

function ClipWave({ clip, left, width }: { clip: Clip; left: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const assets = useEditor((s) => s.assets);
  const hasAudio = assets[clip.assetId]?.hasAudio;
  useEffect(() => {
    const c = ref.current;
    const buf = getAudio(clip.assetId);
    if (!c || !buf) return;
    c.width = Math.max(2, Math.min(4096, Math.round(width)));
    c.height = 40;
    drawWaveform(c, analyzeBuffer(buf).peaks, HOP, clip.in, clip.out, clip.muted ? '#555' : '#2dd4bf');
  }, [clip.assetId, clip.in, clip.out, clip.muted, width, hasAudio]);
  return <canvas ref={ref} className="tl-wave" style={{ left, width: Math.max(6, width) }} aria-hidden />;
}

function ItemBar({ kind, id, label, start, end, lane, pps, offset, cls, selected, wave }: {
  kind: 'overlay' | 'audio'; id: string; label: string; start: number; end: number; lane: number; pps: number; offset: number;
  cls: string; selected: boolean; wave?: { assetId: string; in: number; length: number; loop: boolean };
}) {
  const waveRef = useRef<HTMLCanvasElement>(null);
  const width = Math.max(8, (end - start) * pps);
  useEffect(() => {
    const c = waveRef.current;
    const buf = wave ? getAudio(wave.assetId) : null;
    if (!c || !buf || !wave) return;
    c.width = Math.max(2, Math.min(4096, Math.round(width)));
    c.height = 26;
    drawWaveform(c, analyzeBuffer(buf).peaks, HOP, wave.in, wave.in + Math.min(wave.length, buf.duration - wave.in), 'rgba(255,255,255,0.35)');
  }, [wave?.assetId, wave?.in, wave?.length, width]); // eslint-disable-line react-hooks/exhaustive-deps
  const { setSelection, checkpoint, patchOverlay, patchAudioItem } = useEditor.getState();
  const patch = (p: { start?: number; length?: number }, hist: boolean) => {
    if (kind === 'overlay') patchOverlay(id, { ...(p.start != null ? { start: p.start } : {}), ...(p.length != null ? { duration: p.length } : {}) }, { history: hist });
    else patchAudioItem(id, p, { history: hist });
  };
  const drag = (mode: 'move' | 'in' | 'out') => (e: RPointerEvent) => {
    if (!selected) return;
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    checkpoint();
    const x0 = e.clientX, s0 = start, l0 = end - start;
    const move = (ev: PointerEvent) => {
      const ds = (ev.clientX - x0) / pps;
      if (mode === 'move') patch({ start: Math.max(0, s0 + ds) }, false);
      else if (mode === 'out') patch({ length: Math.max(0.2, l0 + ds) }, false);
      else {
        const ns = Math.max(0, Math.min(s0 + l0 - 0.2, s0 + ds));
        patch({ start: ns, length: l0 - (ns - s0) }, false);
      }
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <div
      className={`tl-bar ${cls}${selected ? ' selected' : ''}`}
      style={{ left: offset + start * pps, width: Math.max(8, (end - start) * pps), top: 2 + lane * 28 }}
      onClick={(e) => { e.stopPropagation(); setSelection(selected ? null : { type: kind, id } as Selection); }}
      onPointerDown={drag('move')}
      role="button"
      aria-pressed={selected}
      data-testid={`${kind}-bar`}
    >
      {wave && <canvas ref={waveRef} className="bar-wave" aria-hidden />}
      <span>{label}</span>
      {selected && (
        <>
          <span className="tl-handle left" onPointerDown={drag('in')} aria-label="Trim start" />
          <span className="tl-handle right" onPointerDown={drag('out')} aria-label="Trim end" />
        </>
      )}
    </div>
  );
}
