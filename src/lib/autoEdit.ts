/**
 * One-tap Auto Edit: runs the real tools in order and applies the result as ONE undoable change.
 * Every step reports honestly whether it was done, skipped (and why) or failed.
 */
import type { CaptionSegment, Project, TransitionType } from '../types';
import { useEditor } from '../store';
import { defaultGrade, captionStyleFromTemplate, isNeutralGrade, uid } from './defaults';
import { totalDuration, layoutClips } from './timeline';
import { analyzeProject } from './analysis/smart';
import { transcribeAsset, ON_DEVICE_MODELS, type Engine, type Lang } from './transcribe/transcribe';
import { transcriptToSegments, autoEmphasis } from './captionsModel';
import { GRADE_PRESETS } from '../engine/grade';
import { SOUNDS, getSoundAsset } from './soundLibrary';
import { textOverlay } from './overlayTemplates';
import { editTranscript, generateHooks, templateHooks } from './ai/hooks';
import { serviceConfigured, useService } from './ai/service';
import { guard, hasCrashed } from './crashGuard';

export type AutoStyle = 'business' | 'social' | 'cinematic';

export const AUTO_STYLES: Record<AutoStyle, { label: string; sub: string; grade: string; captions: string; music: string; transition: TransitionType }> = {
  business: { label: 'Clean business', sub: 'Professional, clear', grade: 'natural', captions: 'boxed', music: 'pad', transition: 'fade' },
  social: { label: 'Energetic social', sub: 'TikTok / Reels', grade: 'bright-commercial', captions: 'bold-pop', music: 'pulse', transition: 'zoom' },
  cinematic: { label: 'Cinematic', sub: 'Premium, moody', grade: 'cinematic-warm', captions: 'luxury', music: 'pad', transition: 'fade' },
};

export interface AutoOptions {
  style: AutoStyle;
  /** What the video is about (used for the hook when no AI server). */
  topic: string;
  removeSilence: boolean;
  captions: boolean;
  colour: boolean;
  music: boolean;
  hook: boolean;
  language: Lang;
}

export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';
export interface Step { id: string; label: string; status: StepStatus; note?: string }

export const STEP_LABELS: [string, string][] = [
  ['silence', 'Remove silences & dead air'],
  ['captions', 'Captions'],
  ['colour', 'Colour grade'],
  ['transitions', 'Transitions between clips'],
  ['music', 'Background music (ducked under speech)'],
  ['sfx', 'Whoosh on transitions'],
  ['hook', 'Hook text (first 3 s) + call to action'],
];

export async function runAutoEdit(opts: AutoOptions, onStep: (id: string, status: StepStatus, note?: string) => void): Promise<number> {
  const st = useEditor.getState();
  const assets = () => useEditor.getState().assets;
  const style = AUTO_STYLES[opts.style];
  let p: Project = structuredClone(st.project);
  let changes = 0;
  const step = async (id: string, enabled: boolean, fn: () => Promise<string | void>) => {
    if (!enabled) { onStep(id, 'skipped', 'Turned off'); return; }
    onStep(id, 'running');
    try {
      const note = await fn();
      onStep(id, note?.startsWith('SKIP:') ? 'skipped' : 'done', note?.replace(/^SKIP:\s*/, '') || undefined);
      if (!note?.startsWith('SKIP:')) changes++;
    } catch (err) {
      onStep(id, 'failed', (err as Error).message);
    }
  };

  // Remember where the original clips change, so transitions go between DIFFERENT clips,
  // not on every small jump cut from silence removal.
  const originalStarts = new Set(p.clips.map((c) => c.id));

  await step('silence', opts.removeSilence, async () => {
    if (hasCrashed('auto:silence')) return 'SKIP: this step crashed Safari before on this device (not enough memory)';
    const sugg = await guard('auto:silence', () => analyzeProject(p, assets(), { audioOnly: true, silence: { thresholdDb: null, minPause: 0.5, padding: 0.12 } }));
    const cuts = sugg.filter((s) => s.type === 'silence' || s.type === 'deadair').sort((a, b) => b.at - a.at);
    if (!cuts.length) return 'SKIP: no long pauses found';
    const before = totalDuration(p.clips);
    p = cuts.reduce((acc, s) => s.apply(acc), p);
    return `${cuts.length} removed, ${(before - totalDuration(p.clips)).toFixed(1)} s shorter`;
  });

  await step('captions', opts.captions, async () => {
    const ids = [...new Set(p.clips.map((c) => c.assetId))].filter((id) => assets()[id]?.kind === 'video' && assets()[id]?.hasAudio);
    if (!ids.length) return 'SKIP: no clips with sound';
    const engine: Engine = serviceConfigured() && useService.getState().consentAudio ? 'cloud' : 'on-device';
    if (engine === 'on-device' && hasCrashed('transcribe:on-device')) {
      return 'SKIP: on-device captions crashed Safari before on this iPhone (not enough memory). Connect the AI server (ⓘ) for captions, or add them in the Captions tab.';
    }
    const segs: CaptionSegment[] = [];
    for (let i = 0; i < ids.length; i++) {
      const a = assets()[ids[i]];
      let t = a.transcript;
      if (!t) {
        onStep('captions', 'running', `Clip ${i + 1} of ${ids.length}${engine === 'on-device' ? ' (first time downloads the speech model)' : ''}…`);
        t = await transcribeAsset(a, engine, opts.language, ON_DEVICE_MODELS[0].id, (pr) => {
          if (pr.stage === 'downloading-model' && pr.progress != null) onStep('captions', 'running', `Downloading speech model ${Math.round(pr.progress * 100)}%`);
        });
        useEditor.getState().patchAsset(a.id, { transcript: t });
      }
      segs.push(...transcriptToSegments({ ...a, transcript: t }, t));
    }
    if (!segs.length) return 'SKIP: no speech detected';
    const keep = p.captions.segments.filter((s) => !s.anchorAssetId || !ids.includes(s.anchorAssetId));
    p = {
      ...p,
      captions: {
        ...p.captions, enabled: true, language: opts.language,
        style: captionStyleFromTemplate(style.captions, p.captions.style.y),
        segments: [...keep, ...segs.map((s) => ({ ...s, emphasis: autoEmphasis(s) }))],
      },
    };
    return `${segs.length} lines (${engine === 'cloud' ? 'AI server' : 'on device'})`;
  });

  await step('colour', opts.colour, async () => {
    const preset = GRADE_PRESETS.find((g) => g.id === style.grade)!;
    let n = 0;
    p = { ...p, clips: p.clips.map((c) => (isNeutralGrade(c.grade) ? (n++, { ...c, grade: { ...defaultGrade(), ...preset.grade } }) : c)) };
    return n ? `${preset.name} on ${n} clip${n > 1 ? 's' : ''}` : 'SKIP: your clips already have a grade';
  });

  const cutTimes: number[] = [];
  await step('transitions', true, async () => {
    let n = 0;
    p = {
      ...p, clips: p.clips.map((c, i) => {
        if (i === 0 || !originalStarts.has(c.id) || c.transition.type !== 'none') return c;
        if (p.clips[i - 1].assetId === c.assetId && Math.abs(p.clips[i - 1].out - c.in) < 0.01) return c;
        n++;
        return { ...c, transition: { type: style.transition, duration: 0.5 } };
      }),
    };
    for (const pl of layoutClips(p.clips)) if (pl.index > 0 && pl.clip.transition.type !== 'none') cutTimes.push(pl.start);
    return n ? `${n} added` : 'SKIP: only one clip';
  });

  await step('music', opts.music, async () => {
    if (p.audio.items.some((i) => i.kind === 'music')) return 'SKIP: you already have music';
    const def = SOUNDS.find((s) => s.id === style.music)!;
    const a = await getSoundAsset(def);
    const len = Math.max(1, totalDuration(p.clips));
    p = { ...p, audio: { ...p.audio, items: [...p.audio.items, { id: uid(), assetId: a.id, kind: 'music', start: 0, in: 0, length: len, loop: true, volume: 0.4, fadeIn: 0.8, fadeOut: 1.5, duck: true }] } };
    return def.name;
  });

  await step('sfx', opts.music && cutTimes.length > 0, async () => {
    const a = await getSoundAsset(SOUNDS.find((s) => s.id === 'whoosh')!);
    p = { ...p, audio: { ...p.audio, items: [...p.audio.items, ...cutTimes.map((t) => ({ id: uid(), assetId: a.id, kind: 'sfx' as const, start: Math.max(0, t - 0.32), in: 0, length: a.duration, loop: false, volume: 0.7, fadeIn: 0, fadeOut: 0, duck: false }))] } };
    return `${cutTimes.length} placed`;
  });

  await step('hook', opts.hook, async () => {
    if (p.overlays.some((o) => o.name === 'Hook')) return 'SKIP: you already have a hook';
    const transcript = editTranscript(p, assets());
    let hook = '', cta = '', source = '';
    if (serviceConfigured() && useService.getState().consentText && (transcript || opts.topic.trim())) {
      const r = await generateHooks({ transcript, description: opts.topic, objective: 'engagement', language: opts.language, durationSec: totalDuration(p.clips) });
      hook = r.hooks[Math.max(0, Math.min(r.hooks.length - 1, r.bestHookIndex))].text;
      cta = r.cta;
      source = 'written by AI';
    } else if (opts.topic.trim()) {
      hook = templateHooks(opts.topic, opts.language === 'ms' ? 'ms' : 'en')[0].text;
      source = 'from a template (connect the AI server for AI-written hooks)';
    } else {
      return 'SKIP: type what the video is about to get a hook';
    }
    const end = totalDuration(p.clips);
    const overlays = [...p.overlays, { ...textOverlay('hook', 0), text: hook }];
    if (cta && end > 6) overlays.push({ ...textOverlay('cta', end - 3), text: cta });
    p = { ...p, overlays };
    return `“${hook}” — ${source}`;
  });

  if (changes) useEditor.getState().update(() => p);
  return changes;
}
