import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import type { ExportSettings } from '../types';
import { estimateFileSize, outputSize, totalDuration, videoBitrate } from '../lib/timeline';
import { canEncodeVideo } from 'mediabunny';
import { toSrt } from '../engine/captions';
import { fmtBytes, fmtTime } from '../lib/capabilities';
import { ExportCancelled, exportProject, type ExportProgress, type ExportResult } from '../lib/export/exporter';
import { player } from '../lib/player';
import { Segmented, Sheet } from './Sheet';
import { IconCheck, IconExport } from './Icons';

type State =
  | { kind: 'setup' }
  | { kind: 'running'; progress: ExportProgress }
  | { kind: 'done'; result: ExportResult; url: string }
  | { kind: 'error'; message: string };

const PREFS_KEY = 'export-settings-v2';
function loadPrefs(): ExportSettings {
  const def: ExportSettings = { resolution: 1080, fps: 30, quality: 'medium', audioBitrate: 192000 };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '');
    if (p && [720, 1080, 2160].includes(p.resolution) && [24, 25, 30, 60].includes(p.fps) &&
      ['high', 'medium', 'low'].includes(p.quality) && [128000, 192000, 256000].includes(p.audioBitrate)) return p;
  } catch { /* ignore */ }
  return def;
}

export function downloadText(text: string, name: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Above this, iPhone Safari may run out of memory while building the file. */
const SIZE_WARN = 450 * 1024 * 1024;

export function ExportSheet({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const [settings, setSettingsState] = useState<ExportSettings>(loadPrefs);
  const [state, setState] = useState<State>({ kind: 'setup' });
  const [hiddenWarning, setHiddenWarning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const setSettings = (patch: Partial<ExportSettings>) => {
    const next = { ...settings, ...patch };
    setSettingsState(next);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const duration = totalDuration(project.clips);
  const { width, height } = outputSize(project.settings.aspect, settings.resolution);
  const est = estimateFileSize(duration, videoBitrate(width, height, settings.fps, settings.quality), settings.audioBitrate);
  const [can4k, setCan4k] = useState<boolean | null>(null);
  useEffect(() => {
    const s4 = outputSize(project.settings.aspect, 2160);
    canEncodeVideo('avc', { width: s4.width, height: s4.height, bitrate: videoBitrate(s4.width, s4.height, 30, 'medium') })
      .then(setCan4k).catch(() => setCan4k(false));
  }, [project.settings.aspect]);
  const hasCaptions = project.captions.segments.length > 0;

  // Release the exported file's memory when the sheet closes.
  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);
  useEffect(() => {
    if (state.kind === 'done') return () => URL.revokeObjectURL(state.url);
  }, [state]);

  const start = async () => {
    player.pause();
    const ac = new AbortController();
    abortRef.current = ac;
    setHiddenWarning(false);
    setState({ kind: 'running', progress: { phase: 'preparing', progress: 0, framesDone: 0, framesTotal: 1, speed: 0 } });

    let wakeLock: { release: () => Promise<void> } | null = null;
    try {
      wakeLock = await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } })
        .wakeLock?.request('screen') ?? null;
    } catch { /* not supported */ }
    let wentHidden = false;
    const onVis = () => { if (document.hidden) { wentHidden = true; setHiddenWarning(true); } };
    document.addEventListener('visibilitychange', onVis);

    try {
      const result = await exportProject(project, assets, settings, (progress) => {
        if (!ac.signal.aborted) setState({ kind: 'running', progress });
      }, ac.signal);
      setState({ kind: 'done', result, url: URL.createObjectURL(result.blob) });
    } catch (err) {
      if (err instanceof ExportCancelled || ac.signal.aborted) {
        setState({ kind: 'setup' });
      } else {
        console.error(err);
        let message = (err as Error)?.message || String(err);
        if (document.hidden || wentHidden) {
          message += ' — Safari was put in the background, which stops video encoding. Keep Safari open and try again.';
        }
        setState({ kind: 'error', message });
      }
    } finally {
      document.removeEventListener('visibilitychange', onVis);
      void wakeLock?.release().catch(() => {});
    }
  };

  const running = state.kind === 'running';

  return (
    <Sheet title="Export video" onClose={onClose} dismissable={!running}>
      {state.kind === 'setup' && (
        <div className="stack">
          <div className="field">
            <label>Resolution</label>
            <Segmented
              label="Resolution"
              value={settings.resolution}
              onChange={(resolution) => setSettings({ resolution })}
              options={[
                { value: 720, label: '720p', sub: 'Fast · small' },
                { value: 1080, label: '1080p', sub: 'Best for social' },
                ...(can4k ? [{ value: 2160 as const, label: '4K', sub: 'Large file' }] : []),
              ]}
            />
          </div>
          <div className="field">
            <label>Frame rate</label>
            <Segmented
              label="Frame rate"
              value={settings.fps}
              onChange={(fps) => setSettings({ fps })}
              options={[
                { value: 24, label: '24', sub: 'Cinematic' },
                { value: 25, label: '25' },
                { value: 30, label: '30', sub: 'Standard' },
                { value: 60, label: '60', sub: 'Smooth' },
              ]}
            />
          </div>
          <div className="field">
            <label>Quality</label>
            <Segmented
              label="Quality"
              value={settings.quality}
              onChange={(quality) => setSettings({ quality })}
              options={[
                { value: 'high', label: 'High', sub: 'Bitrate' },
                { value: 'medium', label: 'Medium', sub: 'Bitrate' },
                { value: 'low', label: 'Low', sub: 'Bitrate' },
              ]}
            />
          </div>
          <div className="field">
            <label>Audio quality (AAC)</label>
            <Segmented
              label="Audio quality"
              value={settings.audioBitrate}
              onChange={(audioBitrate) => setSettings({ audioBitrate })}
              options={[
                { value: 128000, label: '128k' },
                { value: 192000, label: '192k', sub: 'Recommended' },
                { value: 256000, label: '256k' },
              ]}
            />
          </div>
          {can4k === false && <p className="muted small">4K is not available: this browser can't encode 4K H.264.</p>}
          <div className="summary">
            <div><span className="muted">Output</span><b>{width}×{height} · MP4 (H.264 + AAC)</b></div>
            <div><span className="muted">Length</span><b>{fmtTime(duration, true)}</b></div>
            <div><span className="muted">Estimated size</span><b data-testid="est-size">≈ {fmtBytes(est)}</b></div>
            <div><span className="muted">Included</span><b>{[
              project.captions.enabled && hasCaptions ? 'captions' : '',
              project.overlays.length ? `${project.overlays.length} graphic(s)` : '',
              project.audio.items.length ? `${project.audio.items.length} audio item(s)` : '',
              project.clips.some((c) => c.transition.type !== 'none') ? 'transitions' : '',
            ].filter(Boolean).join(', ') || 'clips only'}</b></div>
          </div>
          {est > SIZE_WARN && (
            <p className="notice warn">
              This is a large file for iPhone Safari's memory. If the export fails, choose 720p or Low bitrate.
            </p>
          )}
          <p className="notice">Keep Safari open with the screen on while exporting. Everything is processed on your iPhone — nothing is uploaded.</p>
          <button className="primary-btn" onClick={start} disabled={project.clips.length === 0} data-testid="start-export">
            <IconExport /> Export MP4
          </button>
          {hasCaptions && (
            <button className="secondary-btn" onClick={() => downloadText(toSrt(project), `${project.name || 'captions'}.srt`, 'application/x-subrip')} data-testid="download-srt">
              Download subtitles (.srt)
            </button>
          )}
        </div>
      )}

      {state.kind === 'running' && <Progress p={state.progress} hidden={hiddenWarning} onCancel={() => abortRef.current?.abort()} />}

      {state.kind === 'done' && <Done result={state.result} url={state.url} onAgain={() => setState({ kind: 'setup' })} />}

      {state.kind === 'error' && (
        <div className="stack">
          <p className="notice error" data-testid="export-error"><b>Export failed.</b> {state.message}</p>
          <p className="muted small">No file was created. Tips: try 720p or Low bitrate, close other apps, and keep Safari in front.</p>
          <button className="primary-btn" onClick={() => setState({ kind: 'setup' })}>Back to settings</button>
        </div>
      )}
    </Sheet>
  );
}

function Progress({ p, hidden, onCancel }: { p: ExportProgress; hidden: boolean; onCancel: () => void }) {
  const pct = Math.round(p.progress * 100);
  const remaining = p.speed > 0 ? (p.framesTotal - p.framesDone) / p.speed : NaN;
  const label = {
    preparing: 'Preparing…',
    rendering: 'Rendering frames',
    finishing: 'Finishing file…',
    verifying: 'Verifying file…',
  }[p.phase];
  return (
    <div className="stack" data-testid="export-progress">
      <div className="progress-head">
        <b>{label}</b>
        <span className="big-pct">{pct}%</span>
      </div>
      <div className="progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${pct}%` }} />
      </div>
      <p className="muted small">
        {p.phase === 'rendering'
          ? `Frame ${p.framesDone} of ${p.framesTotal}${p.speed ? ` · ${p.speed.toFixed(0)} fps` : ''}${isFinite(remaining) ? ` · about ${fmtTime(remaining)} left` : ''}`
          : p.note}
        {p.phase === 'rendering' && p.note ? ` · ${p.note}` : ''}
      </p>
      {hidden && <p className="notice warn">Safari went to the background. If progress stops, keep Safari open and try again.</p>}
      <p className="notice">Keep this screen open until it finishes.</p>
      <button className="secondary-btn" onClick={onCancel}>Cancel export</button>
    </div>
  );
}

function Done({ result, url, onAgain }: { result: ExportResult; url: string; onAgain: () => void }) {
  const file = new File([result.blob], result.fileName, { type: 'video/mp4' });
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  const share = async () => {
    try {
      await navigator.share({ files: [file] });
      setShareMsg(null);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setShareMsg(`Sharing failed: ${(err as Error).message}. Use Download instead.`);
    }
  };

  return (
    <div className="stack" data-testid="export-done">
      <p className="notice success"><IconCheck width={18} height={18} /> <b>Export complete and verified.</b></p>
      <video className="result-video" src={url} controls playsInline />
      <div className="summary">
        <div><span className="muted">File</span><b className="ellipsis">{result.fileName}</b></div>
        <div><span className="muted">Size</span><b data-testid="export-size">{fmtBytes(result.blob.size)}</b></div>
        <div><span className="muted">Format</span><b>{result.width}×{result.height} · {result.fps} fps · {fmtTime(result.duration, true)}{result.hasAudio ? ' · with sound' : ' · no sound'}</b></div>
        <div><span className="muted">Took</span><b>{fmtTime(result.seconds)}</b></div>
      </div>
      {canShare && (
        <button className="primary-btn" onClick={share} data-testid="share">
          <IconExport /> Save to Photos / Share
        </button>
      )}
      <a className={canShare ? 'secondary-btn' : 'primary-btn'} href={url} download={result.fileName} data-testid="download">
        Download to Files
      </a>
      {shareMsg && <p className="notice warn">{shareMsg}</p>}
      <p className="muted small">
        {canShare ? 'In the share menu, tap "Save Video" to put it in your Photos.' : 'After downloading, open the Files app → Downloads, then share it to Photos.'}
      </p>
      <button className="text-btn" onClick={onAgain}>Export again with different settings</button>
    </div>
  );
}
