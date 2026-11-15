import { describe, expect, it } from 'vitest';
import { resolveCaptions, toSrt } from './captions';
import { newClip, newProject } from '../lib/defaults';
import { cleanWords, groupPhrases } from '../lib/transcribe/audioPrep';
import { autoEmphasis } from '../lib/captionsModel';
import type { Asset, CaptionSegment, Project } from '../types';

const asset = { id: 'a1', kind: 'video', duration: 10 } as Asset;
const seg = (over: Partial<CaptionSegment>): CaptionSegment => ({ id: 's' + Math.random(), text: '', anchorAssetId: 'a1', start: 0, end: 0, words: [], emphasis: [], ...over });

function project(clips = [newClip(asset)], segments: CaptionSegment[] = []): Project {
  const p = newProject();
  return { ...p, clips, captions: { ...p.captions, segments, style: { ...p.captions.style, maxWords: 3 } } };
}

describe('captions', () => {
  const words = [
    { text: 'One', start: 1, end: 1.3 }, { text: 'two', start: 1.3, end: 1.6 }, { text: 'three', start: 1.6, end: 2 },
    { text: 'four', start: 2, end: 2.4 }, { text: 'five.', start: 2.4, end: 2.8 },
  ];
  const s = seg({ text: 'One two three four five.', start: 1, end: 2.8, words });

  it('splits phrases into cards of maxWords', () => {
    const cards = resolveCaptions(project(undefined, [s]));
    expect(cards.map((c) => c.words.map((w) => w.text).join(' '))).toEqual(['One two three', 'four five.']);
    expect(cards[0].start).toBe(1);
    expect(cards[1].start).toBe(2);
  });

  it('follows trims and splits of the anchored clip', () => {
    const c = newClip(asset);
    const left = { ...c, id: 'L', in: 0, out: 1.5 };
    const right = { ...c, id: 'R', in: 2.0, out: 10 }; // 0.5 s removed between them
    const cards = resolveCaptions(project([left, right], [s]));
    const texts = cards.flatMap((k) => k.words.map((w) => `${w.text}@${w.start.toFixed(2)}`));
    // 'One' (1.0) stays at 1.0; 'two' (1.3) at 1.3; 'three' (1.6–2.0) was cut out; 'four' (2.0) → 1.5
    expect(texts).toEqual(['One@1.00', 'two@1.30', 'four@1.50', 'five.@1.90']);
  });

  it('keeps edited text and falls back to even timing when word count changes', () => {
    const edited = { ...s, text: 'Totally new words' };
    const cards = resolveCaptions(project(undefined, [edited]));
    expect(cards[0].words.map((w) => w.text)).toEqual(['Totally', 'new', 'words']);
    expect(cards[0].start).toBeCloseTo(1);
  });

  it('writes valid SRT', () => {
    const srt = toSrt(project(undefined, [s]));
    expect(srt).toContain('1\n00:00:01,000 --> 00:00:02,000\nOne two three\n');
    expect(srt).toContain('2\n00:00:02,000 --> 00:00:02,800\nfour five.\n');
  });

  it('cleans whisper tokens and groups phrases at sentence ends and pauses', () => {
    const cw = cleanWords([{ text: ' Hello', start: 0, end: 0.3 }, { text: ',', start: 0.3, end: 0.31 }, { text: ' world', start: 0.4, end: 0.7 }, { text: '.', start: 0.7, end: 0.72 },
      { text: ' Next', start: 2, end: 2.3 }]);
    expect(cw.map((w) => w.text)).toEqual(['Hello,', 'world.', 'Next']);
    expect(groupPhrases(cw).map((g) => g.length)).toEqual([2, 1]);
  });

  it('rule-based emphasis picks numbers first, else the strongest word', () => {
    expect(autoEmphasis(seg({ text: 'Save 50% on cleaning today' }))).toEqual([1]);
    expect(autoEmphasis(seg({ text: 'We make floors sparkle' }))).toEqual([3]);
    expect(autoEmphasis(seg({ text: 'Kami bersihkan pejabat anda' }))).toEqual([1]);
  });
});
