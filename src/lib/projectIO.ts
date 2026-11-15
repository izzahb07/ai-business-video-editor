import { useEditor, newProject } from '../store';
import type { Asset } from '../types';
import { decodeAudio, probeFile } from './media';
import { clearRegistry, setAudio, setAudioPending, setFile } from './registry';
import { clearAll, loadFile, loadState, requestPersistence, saveFile, saveState } from './storage';
import { toast } from '../components/Toast';
import { player } from './player';

/** Background decode of an asset's audio (used for preview + export). */
function startAudioDecode(asset: Asset, file: Blob) {
  const p = decodeAudio(file)
    .then((buf) => {
      setAudio(asset.id, buf);
      useEditor.getState().patchAsset(asset.id, { hasAudio: !!buf });
      return buf;
    })
    .catch((err) => {
      console.warn('Audio decode failed', err);
      setAudio(asset.id, null);
      return null;
    });
  setAudioPending(asset.id, p);
}

export async function importFiles(files: File[], onStatus?: (msg: string) => void): Promise<number> {
  let ok = 0;
  void requestPersistence();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onStatus?.(`Importing ${i + 1} of ${files.length}: ${f.name}`);
    try {
      const asset = await probeFile(f, f.name || `Clip ${i + 1}`);
      setFile(asset.id, f);
      const st = useEditor.getState();
      st.addAsset(asset);
      st.appendClipForAsset(asset);
      startAudioDecode(asset, f);
      ok++;
      // Save the original on the device so a Safari reload doesn't lose it.
      saveFile(asset.id, f)
        .then(() => useEditor.getState().patchAsset(asset.id, { stored: true }))
        .catch((err) => {
          console.warn('Could not store file', err);
          toast(`"${asset.name}" is too big to keep after closing Safari. Finish editing in one session.`, 'warn');
        });
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
      const assets: Record<string, Asset> = {};
      const missing: string[] = [];
      for (const a of Object.values(saved.assets || {})) {
        const blob = await loadFile(a.id).catch(() => undefined);
        if (blob) {
          setFile(a.id, blob);
          assets[a.id] = { ...a, stored: true };
          startAudioDecode(a, blob);
        } else {
          missing.push(a.name);
        }
      }
      const clips = saved.project.clips.filter((c) => assets[c.assetId]);
      st.load({ ...saved.project, clips }, assets);
      if (missing.length) toast(`${missing.length} clip(s) could not be restored and were removed.`, 'warn');
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
