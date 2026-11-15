import { useState } from 'react';
import { useEditor } from './store';
import { Preview } from './components/Preview';
import { ClipStrip, useImport } from './components/ClipStrip';
import { ClipPanel, FormatPanel } from './components/Panels';
import { ExportSheet } from './components/ExportSheet';
import { InfoSheet } from './components/InfoSheet';
import { Toasts } from './components/Toast';
import { IconExport, IconFilm, IconInfo, IconRedo, IconUndo } from './components/Icons';

export function App() {
  const loading = useEditor((s) => s.loading);
  const clipsCount = useEditor((s) => s.project.clips.length);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const selected = useEditor((s) => s.selectedClipId);
  const { undo, redo } = useEditor.getState();
  const [sheet, setSheet] = useState<'export' | 'info' | null>(null);

  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setSheet('info')} aria-label="Studio info and device check" data-testid="info">
          <IconInfo />
        </button>
        <div className="brand">
          <span className="brand-mark" aria-hidden>◆</span>
          <span>Video Studio</span>
        </div>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo" data-testid="undo"><IconUndo /></button>
          <button className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="Redo" data-testid="redo"><IconRedo /></button>
          <button className="export-btn" onClick={() => setSheet('export')} disabled={clipsCount === 0} data-testid="open-export">
            <IconExport width={18} height={18} /> Export
          </button>
        </div>
      </header>

      {loading ? (
        <div className="center-fill"><span className="spinner" /> Opening your project…</div>
      ) : clipsCount === 0 ? (
        <EmptyState />
      ) : (
        <main className="workspace">
          <Preview />
          <div className="editor-scroll">
            <ClipStrip />
            {selected ? <ClipPanel /> : <FormatPanel />}
          </div>
        </main>
      )}

      {sheet === 'export' && <ExportSheet onClose={() => setSheet(null)} />}
      {sheet === 'info' && <InfoSheet onClose={() => setSheet(null)} />}
      <Toasts />
    </div>
  );
}

function EmptyState() {
  const { open, input, status } = useImport();
  return (
    <main className="empty">
      <div className="empty-icon"><IconFilm width={44} height={44} /></div>
      <h1>Create your next video</h1>
      <p className="muted">Import clips from Photos or Files. Everything stays on your iPhone.</p>
      <button className="primary-btn big" onClick={open} data-testid="import-first">Import videos</button>
      {status && <div className="import-status" role="status"><span className="spinner" /> {status}</div>}
      <ol className="steps">
        <li><b>Import</b> one or more clips</li>
        <li><b>Arrange</b> them and pick a shape (9:16 for Reels/TikTok)</li>
        <li><b>Export</b> a real MP4 and save it to Photos</li>
      </ol>
      {input}
    </main>
  );
}
