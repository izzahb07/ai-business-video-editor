/** Hook & structure generation: Claude via the user's server, plus clearly-labelled offline templates. */
import type { Asset, Project } from '../../types';
import { layoutClips } from '../timeline';
import { callService } from './service';

export type Objective = 'sales' | 'awareness' | 'education' | 'engagement' | 'storytelling';
export type HookStyle = 'curiosity' | 'problem-solution' | 'emotional' | 'controversial-truthful' | 'educational' | 'storytelling' | 'question';

export interface HookIdea { style: HookStyle; text: string; spoken: string; openingVisual: string; why: string }
export interface HooksResult {
  hooks: HookIdea[];
  bestHookIndex: number;
  structure: { part: string; guidance: string; onScreenText: string }[];
  retentionTips: string[];
  titles: string[];
  description: string;
  caption: string;
  hashtags: string[];
  cta: string;
  claimsToVerify: string[];
  model?: string;
}

/** Spoken words of the CURRENT edit, in timeline order (from transcripts). */
export function editTranscript(project: Project, assets: Record<string, Asset>): string {
  const parts: string[] = [];
  for (const p of layoutClips(project.clips)) {
    const t = assets[p.clip.assetId]?.transcript;
    if (!t) continue;
    const ws = t.words.filter((w) => (w.start + w.end) / 2 >= p.clip.in && (w.start + w.end) / 2 < p.clip.out).map((w) => w.text);
    if (ws.length) parts.push(ws.join(' '));
  }
  return parts.join(' ').trim();
}

export async function generateHooks(req: { transcript: string; description: string; objective: Objective; language: 'auto' | 'en' | 'ms'; durationSec: number }): Promise<HooksResult> {
  const r = (await callService('/ai/hooks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), timeoutMs: 240000,
  })) as HooksResult;
  if (!r || !Array.isArray(r.hooks) || !r.hooks.length) throw new Error('The AI server returned no hooks.');
  return r;
}

/** Offline fill-in-the-blank templates (NOT AI). {t} = the user's topic. */
const TEMPLATES: Record<'en' | 'ms', { style: HookStyle; text: string }[]> = {
  en: [
    { style: 'curiosity', text: 'Nobody tells you this about {t}' },
    { style: 'curiosity', text: 'Watch what happens to {t}' },
    { style: 'problem-solution', text: 'Struggling with {t}? Try this' },
    { style: 'problem-solution', text: 'The fastest fix for {t}' },
    { style: 'emotional', text: 'This is why we love {t}' },
    { style: 'controversial-truthful', text: 'Most people get {t} wrong' },
    { style: 'educational', text: '3 things to know about {t}' },
    { style: 'educational', text: '{t}: before vs after' },
    { style: 'storytelling', text: 'How we handle {t}, step by step' },
    { style: 'question', text: 'Is your {t} really done right?' },
  ],
  ms: [
    { style: 'curiosity', text: 'Ramai tak tahu tentang {t}' },
    { style: 'curiosity', text: 'Tengok apa jadi pada {t}' },
    { style: 'problem-solution', text: 'Ada masalah {t}? Cuba ini' },
    { style: 'problem-solution', text: 'Cara paling cepat untuk {t}' },
    { style: 'emotional', text: 'Sebab kami suka {t}' },
    { style: 'controversial-truthful', text: 'Ramai buat {t} dengan cara salah' },
    { style: 'educational', text: '3 perkara penting tentang {t}' },
    { style: 'educational', text: '{t}: sebelum vs selepas' },
    { style: 'storytelling', text: 'Cara kami buat {t}, langkah demi langkah' },
    { style: 'question', text: 'Betul ke {t} anda selama ini?' },
  ],
};

export function templateHooks(topic: string, lang: 'en' | 'ms'): { style: HookStyle; text: string }[] {
  const t = topic.trim() || (lang === 'ms' ? 'topik anda' : 'your topic');
  return TEMPLATES[lang].map((h) => ({ style: h.style, text: h.text.replace('{t}', t) }));
}

export const STYLE_LABEL: Record<HookStyle, string> = {
  curiosity: 'Curiosity', 'problem-solution': 'Problem → solution', emotional: 'Emotional', 'controversial-truthful': 'Bold but true',
  educational: 'Educational', storytelling: 'Storytelling', question: 'Question',
};
