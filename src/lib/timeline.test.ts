import { describe, expect, it } from 'vitest';
import { estimateFileSize, layoutClips, locate, outputSize, totalDuration, videoBitrate } from './timeline';
import type { Clip } from '../types';

import { newClip } from './defaults';
const clip = (id: string, inP: number, out: number): Clip => ({ ...newClip({ id: 'a' + id, duration: out } as never), id, in: inP, out });

describe('timeline', () => {
  const clips = [clip('1', 0, 3), clip('2', 1, 3), clip('3', 0.5, 2.5)];
  it('lays clips end to end', () => {
    const p = layoutClips(clips);
    expect(p.map((x) => [x.start, x.end])).toEqual([[0, 3], [3, 5], [5, 7]]);
    expect(totalDuration(clips)).toBe(7);
  });
  it('locates source time, boundaries belong to next clip', () => {
    const p = layoutClips(clips);
    expect(locate(p, 0)!.placed.clip.id).toBe('1');
    expect(locate(p, 2.999)!.placed.clip.id).toBe('1');
    const l = locate(p, 3)!;
    expect(l.placed.clip.id).toBe('2');
    expect(l.sourceTime).toBeCloseTo(1);
    expect(locate(p, 6)!.sourceTime).toBeCloseTo(1.5);
    expect(locate(p, 100)!.placed.clip.id).toBe('3');
    expect(locate([], 1)).toBeNull();
  });
  it('computes even output sizes', () => {
    expect(outputSize('9:16', 1080)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize('16:9', 1080)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize('1:1', 720)).toEqual({ width: 720, height: 720 });
    expect(outputSize('4:5', 1080)).toEqual({ width: 1080, height: 1350 });
    expect(outputSize('9:16', 720)).toEqual({ width: 720, height: 1280 });
  });
  it('scales bitrate and estimates size', () => {
    expect(videoBitrate(1080, 1920, 30, 'medium')).toBe(8_000_000);
    expect(videoBitrate(720, 1280, 30, 'medium')).toBeLessThan(4_000_000);
    expect(videoBitrate(1080, 1920, 60, 'high')).toBeGreaterThan(12_000_000);
    expect(estimateFileSize(10, 8_000_000, 0)).toBe(10_000_000);
    expect(outputSize('9:16', 2160)).toEqual({ width: 2160, height: 3840 });
  });
});
