import { useEffect, useState, type ReactNode } from 'react';
import { useEditor } from './store';
import { useUi, type Tab } from './uiState';
import { Preview } from './components/Preview';
import { Timeline } from './components/Timeline';
import { useImport } from './components/ClipStrip';
import { FormatPanel } from './components/Panels';
import { EditPanel } from './components/EditPanel';
import { ExportSheet } from './components/ExportSheet';
import { InfoSheet } from './components/InfoSheet';
import { Toasts } from './components/Toast';
import { IconExport, IconFilm, IconInfo, IconRedo, IconUndo, TabAI, TabAudio, TabCaptions, TabColor, TabEdit, TabFormat, TabText } from './components/Icons';
import { TAB_PANELS } from './components/tabs';

export function App() {
  const loading = useEditor((s) => s.loading);
  const clipsCount = useEditor((s) => s.project.clips.length);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const { undo, redo } = useEditor.getState();
  const [sheet, setSheet] = useState<'export' | 'info' | null>(null);
  const expanded = useUi((s) => s.expanded);

  // Keyboard shortcuts on desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setSheet('info')} aria-label="Studio settings and device check" data-testid="info"><IconInfo /></button>
        <div className="brand"><span className="brand-mark" aria-hidden>◆</span><span>Studio</span></div>
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
        <main className={`studio${expanded ? ' expanded' : ''}`}>
          <div className="stage-col"><Preview /></div>
          <div className="edit-col">
            <Timeline />
            <ToolArea />
          </div>
        </main>
      )}

      {sheet === 'export' && <ExportSheet onClose={() => setSheet(null)} />}
      {sheet === 'info' && <InfoSheet onClose={() => setSheet(null)} />}
      <Toasts />
    </div>
  );
}

function ToolArea() {
  const tab = useUi((s) => s.tab);
  const setTab = useUi((s) => s.setTab);
  const selection = useEditor((s) => s.selection);
  // Selecting something on the timeline opens the matching tool.
  useEffect(() => {
    if (!selection) return;
    const map: Record<string, Tab> = { clip: tab === 'color' ? 'color' : 'edit', overlay: 'text', caption: 'captions', audio: 'audio' };
    const want = map[selection.type];
    if (want && want !== tab && !(selection.type === 'clip' && tab === 'audio')) setTab(want);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);
  const panels: Partial<Record<Tab, ReactNode>> = { edit: <EditPanel />, format: <FormatPanel />, ...TAB_PANELS };
  const expanded = useUi((s) => s.expanded);
  const setExpanded = useUi((s) => s.setExpanded);
  return (
    <>
      <button className="panel-grabber" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} data-testid="panel-grabber">
        <span aria-hidden className="grab-bar" />{expanded ? 'Show timeline' : 'More space'}
      </button>
      <div className="panel-area" data-testid={`panel-${tab}`}>{panels[tab] ?? <EditPanel />}</div>
      <nav className="tabbar" aria-label="Editing tools">
        {TABS.filter((t) => t.id in panels).map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} aria-pressed={tab === t.id} data-testid={`tab-${t.id}`}>
            <t.icon width={21} height={21} className="tab-icon" />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

const TABS: { id: Tab; label: string; icon: typeof TabEdit }[] = [
  { id: 'edit', label: 'Edit', icon: TabEdit },
  { id: 'captions', label: 'Captions', icon: TabCaptions },
  { id: 'text', label: 'Graphics', icon: TabText },
  { id: 'color', label: 'Colour', icon: TabColor },
  { id: 'audio', label: 'Audio', icon: TabAudio },
  { id: 'ai', label: 'AI', icon: TabAI },
  { id: 'format', label: 'Format', icon: TabFormat },
];

function EmptyState() {
  const { open, input, status } = useImport();
  return (
    <main className="empty">
      <div className="empty-icon"><IconFilm width={44} height={44} /></div>
      <h1>Create your next video</h1>
      <p className="muted">Import videos or photos from Photos or Files. Everything stays on your device.</p>
      <button className="primary-btn big" onClick={open} data-testid="import-first">Import videos</button>
      {status && <div className="import-status" role="status"><span className="spinner" /> {status}</div>}
      <ol className="steps">
        <li><b>Import</b> clips, then trim, split and arrange them on the timeline</li>
        <li><b>Polish</b> with captions, colour, graphics, music and AI suggestions</li>
        <li><b>Export</b> a real MP4 and save it to Photos</li>
      </ol>
      {input}
    </main>
  );
}
