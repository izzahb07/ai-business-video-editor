/**
 * iPhone Safari kills a tab that uses too much memory ("A problem repeatedly occurred").
 * JavaScript can't catch that, so before each heavy task we leave a note; if the page
 * restarts with the note still there, that task crashed. We then skip it next time and tell the user.
 */
const RUNNING = 'crashguard-running';
const CRASHED = 'crashguard-crashed';

function read<T>(key: string, def: T): T {
  try { return JSON.parse(localStorage.getItem(key) || '') ?? def; } catch { return def; }
}
function write(key: string, v: unknown) {
  try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

export async function guard<T>(task: string, fn: () => Promise<T>): Promise<T> {
  write(RUNNING, { task, at: Date.now() });
  try {
    return await fn();
  } finally {
    write(RUNNING, null);
  }
}

/** Call once at startup. Returns the task that crashed last time (if any). */
export function takeLastCrash(): string | null {
  const r = read<{ task: string } | null>(RUNNING, null);
  if (!r?.task) return null;
  write(RUNNING, null);
  const list = read<string[]>(CRASHED, []);
  if (!list.includes(r.task)) write(CRASHED, [...list, r.task]);
  return r.task;
}

export function hasCrashed(task: string): boolean {
  return read<string[]>(CRASHED, []).includes(task);
}

export function clearCrash(task: string) {
  write(CRASHED, read<string[]>(CRASHED, []).filter((t) => t !== task));
}

export const TASK_LABEL: Record<string, string> = {
  'transcribe:on-device': 'on-device captions (speech model)',
  'auto:silence': 'Auto Edit — silence & scene analysis',
  'auto:music': 'Auto Edit — music',
  'analyze': 'smart-edit analysis',
  'export': 'video export',
};

export function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
