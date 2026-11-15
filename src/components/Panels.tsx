import { useEditor } from '../store';
import type { AspectRatio } from '../types';
import { Segmented } from './Sheet';

const ASPECTS: { value: AspectRatio; label: string; sub: string }[] = [
  { value: '9:16', label: '9:16', sub: 'TikTok · Reels' },
  { value: '1:1', label: '1:1', sub: 'Square' },
  { value: '4:5', label: '4:5', sub: 'Feed post' },
  { value: '16:9', label: '16:9', sub: 'YouTube' },
];

export function FormatPanel() {
  const settings = useEditor((s) => s.project.settings);
  const name = useEditor((s) => s.project.name);
  const setSettings = useEditor((s) => s.setSettings);
  const update = useEditor((s) => s.update);
  return (
    <div className="panel-stack" aria-label="Video format">
      <div className="field">
        <label htmlFor="pname">Project name (used for the file name)</label>
        <input id="pname" className="text-input" value={name} maxLength={60}
          onChange={(e) => update((p) => ({ ...p, name: e.target.value }), { history: false })} />
      </div>
      <div className="field">
        <label>Shape</label>
        <Segmented label="Aspect ratio" value={settings.aspect} options={ASPECTS} onChange={(aspect) => setSettings({ aspect })} />
      </div>
      <div className="field">
        <label>Background for "Fit" clips</label>
        <Segmented label="Background" value={settings.background} onChange={(background) => setSettings({ background })}
          options={[{ value: 'blur', label: 'Blurred' }, { value: 'black', label: 'Black' }]} />
      </div>
    </div>
  );
}
