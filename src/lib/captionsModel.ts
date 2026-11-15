import type { Asset, CaptionSegment, Transcript } from '../types';
import { uid } from './defaults';
import { groupPhrases } from './transcribe/audioPrep';

/** Turn a transcript into caption phrases anchored to the source clip (they follow later edits). */
export function transcriptToSegments(asset: Asset, t: Transcript): CaptionSegment[] {
  return groupPhrases(t.words).map((ws) => ({
    id: uid(),
    text: ws.map((w) => w.text).join(' '),
    anchorAssetId: asset.id,
    start: ws[0].start,
    end: ws[ws.length - 1].end,
    words: ws,
    emphasis: [],
  }));
}

const STOP = new Set(('the a an and or but if then so to of in on at for with from by is are was were be been it this that these those i you he she we they ' +
  'my your our their me him her them as not no yes do does did have has had will would can could should just very really also about into over ' +
  'yang dan di ke dari ini itu untuk dengan pada adalah saya kami kita anda mereka tidak ada akan juga atau dalam').split(' '));

/** Rule-based (not AI): emphasise numbers, prices and the longest meaningful word per caption. */
export function autoEmphasis(seg: CaptionSegment): number[] {
  const words = seg.text.split(/\s+/).filter(Boolean);
  const out = new Set<number>();
  words.forEach((w, i) => { if (/[\d$€£%]|^rm\d/i.test(w)) out.add(i); });
  if (!out.size) {
    let best = -1, len = 0;
    words.forEach((w, i) => {
      const clean = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      if (!STOP.has(clean) && clean.length > len && clean.length >= 5) { best = i; len = clean.length; }
    });
    if (best >= 0) out.add(best);
  }
  return [...out];
}
