import { beforeEach, describe, expect, it } from 'vitest';
import { newProject, useEditor } from './store';
import type { Asset } from './types';

const asset = (id: string, d = 4): Asset => ({ id, name: id, size: 1, mime: 'video/mp4', duration: d, width: 1080, height: 1920, codec: 'avc', hasAudio: true, webCodecsDecodable: true, thumb: '', stored: false });

describe('editor store', () => {
  beforeEach(() => useEditor.getState().load(newProject(), {}));

  it('adds, reorders, duplicates, deletes with undo/redo', () => {
    const s = () => useEditor.getState();
    s().appendClipForAsset(asset('a'));
    s().appendClipForAsset(asset('b', 2));
    expect(s().project.clips.map((c) => c.assetId)).toEqual(['a', 'b']);
    const bId = s().project.clips[1].id;
    s().moveClip(bId, -1);
    expect(s().project.clips.map((c) => c.assetId)).toEqual(['b', 'a']);
    s().duplicateClip(bId);
    expect(s().project.clips.map((c) => c.assetId)).toEqual(['b', 'b', 'a']);
    s().removeClip(bId);
    expect(s().project.clips.map((c) => c.assetId)).toEqual(['b', 'a']);
    s().undo();
    expect(s().project.clips).toHaveLength(3);
    s().undo(); s().undo();
    expect(s().project.clips.map((c) => c.assetId)).toEqual(['a', 'b']);
    s().redo();
    expect(s().project.clips.map((c) => c.assetId)).toEqual(['b', 'a']);
    // A new edit clears the redo stack
    s().setSettings({ aspect: '16:9' });
    expect(s().future).toHaveLength(0);
  });

  it('slider drags create a single undo step', () => {
    const s = () => useEditor.getState();
    s().appendClipForAsset(asset('a'));
    const id = s().project.clips[0].id;
    const before = s().past.length;
    s().checkpoint();
    for (const v of [0.9, 0.7, 0.5]) s().patchClip(id, { volume: v }, { history: false });
    expect(s().past.length).toBe(before + 1);
    s().undo();
    expect(s().project.clips[0].volume).toBe(1);
  });

  it('ignores invalid moves', () => {
    const s = () => useEditor.getState();
    s().appendClipForAsset(asset('a'));
    const n = s().past.length;
    s().moveClip(s().project.clips[0].id, -1);
    expect(s().past.length).toBe(n);
  });
});
