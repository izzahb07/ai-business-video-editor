import { useEditor } from '../store';
import type { Asset } from '../types';
import { newProject, normalizeAsset, normalizeProject } from './defaults';
import { decodeAudio, probeFile } from './media';
import { clearRegistry, loadImage, setAudio, setAudioPending, setFile, setLut } from './registry';
import { clearAll, loadFile, loadLut, loadState, requestPersistence, saveFile, saveState } from './storage';
import { toast } from '../components/Toast';
import { player } from './player';
import type { LutData } from '../engine/grade';

/** Background decode of an asset's audio (used for preview, export and analysis). */
function startAudioDecode(asset: Asset, file: Blob) {
  if (asset.kind === 'image') return;
  const p = decodeAudio(file)
    .then((buf) => {
      setAudio(asset.id, buf);
      useEditor.getState().patchAsset(asset.id, { hasAudio: !!buf });
      player.redraw();
      return buf;
    })
    .catch((err) => {
      console.warn('Audio decode failed', err);
      setAudio(asset.id, null);
      return null;
    });
  setAudioPending(asset.id, p);
}

/** Register a file as an asset (stored on device). Does not add it to the timeline. */
export async function addMediaFile(f: Blob, name: string, extra: Partial<Asset> = {}): Promise<Asset> {
  const asset = { ...(await probeFile(f, name)), ...extra };
  setFile(asset.id, f);
  useEditor.getState().addAsset(asset);
  startAudioDecode(asset, f);
  if (asset.kind === 'image') void loadImage(asset.id);
  void requestPersistence();
  saveFile(asset.id, f)
    .then(() => useEditor.getState().patchAsset(asset.id, { stored: true }))
    .catch((err) => {
      console.warn('Could not store file', err);
      toast(`"${asset.name}" is too big to keep after closing Safari. Finish editing in one session.`, 'warn');
    });
  return asset;
}

/** Import videos/photos onto the main track (in order). */
export async function importFiles(files: File[], onStatus?: (msg: string) => void): Promise<number> {
  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onStatus?.(`Importing ${i + 1} of ${files.length}: ${f.name}`);
    try {
      const asset = await addMediaFile(f, f.name || `Clip ${i + 1}`);
      if (asset.kind === 'audio') {
        toast(`"${asset.name}" is audio — add it from the Audio tab as music.`, 'warn');
        continue;
      }
      useEditor.getState().appendClipForAsset(asset);
      ok++;
    } catch (err) {
      console.error(err);
      toast(`Could not import "${f.name}": ${(err as Error).message}`, 'error');
    }
  }
  return ok;
}

export async function restoreSession(): Promise<void> {
  const st = useEditor.getState();
  try {
    const saved = await loadState();
    if (saved && saved.project) {
      const project = normalizeProject(saved.project);
      const assets: Record<string, Asset> = {};
      const missing: string[] = [];
      for (const raw of Object.values(saved.assets || {})) {
        const a = normalizeAsset(raw);
        const blob = await loadFile(a.id).catch(() => undefined);
        if (blob) {
          setFile(a.id, blob);
          assets[a.id] = { ...a, stored: true };
          startAudioDecode(a, blob);
          if (a.kind === 'image') void loadImage(a.id);
        } else {
          missing.push(a.name);
        }
      }
      for (const l of project.luts) {
        const data = await loadLut<LutData>(l.id).catch(() => undefined);
        if (data) setLut(l.id, data);
      }
      const clips = project.clips.filter((c) => assets[c.assetId]);
      const overlays = project.overlays.filter((o) => !o.assetId || assets[o.assetId]);
      const items = project.audio.items.filter((i) => assets[i.assetId]);
      st.load({ ...project, clips, overlays, audio: { ...project.audio, items } }, assets);
      if (missing.length) toast(`${missing.length} file(s) could not be restored and were removed.`, 'warn');
    }
  } catch (err) {
    console.warn('Restore failed', err);
  } finally {
    useEditor.getState().setLoading(false);
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
export function startAutosave() {
  useEditor.subscribe((s, prev) => {
    if (s.loading) return;
    if (s.project === prev.project && s.assets === prev.assets) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const { project, assets } = useEditor.getState();
      saveState({ project, assets }).catch((err) => console.warn('Autosave failed', err));
    }, 400);
  });
}

export async function startNewProject() {
  player.pause();
  await clearAll().catch(() => {});
  clearRegistry();
  useEditor.getState().load(newProject(), {});
  await player.seek(0);
}
