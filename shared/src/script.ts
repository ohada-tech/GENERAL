import { z } from 'zod';

export const STORY_ROLES = ['hook', 'problem', 'solution', 'benefit', 'proof', 'cta', 'transition', 'other'] as const;

export const STORY_ROLE_LABELS: Record<string, string> = {
  hook: 'הוק / פתיחה',
  problem: 'בעיה',
  solution: 'פתרון',
  benefit: 'תועלת',
  proof: 'הוכחה',
  cta: 'קריאה לפעולה',
  transition: 'מעבר',
  other: 'אחר',
};

export const sceneSchema = z.object({
  id: z.string(),
  storyRole: z.string().default('other'),
  narration: z.string().default(''),
  onScreenText: z.string().default(''),
  visualAction: z.string().default(''),
  estDurationSec: z.number().nonnegative().default(0),
  notes: z.string().default(''),
});

export type Scene = z.infer<typeof sceneSchema>;

export const scriptContentSchema = z.object({
  title: z.string().default(''),
  logline: z.string().default(''),
  scenes: z.array(sceneSchema).default([]),
});

export type ScriptContent = z.infer<typeof scriptContentSchema>;

export type ScriptVersionStatus = 'draft' | 'internal_approved' | 'client_approved' | 'changes_requested';

export const SCRIPT_STATUS_LABELS: Record<ScriptVersionStatus, string> = {
  draft: 'טיוטה',
  internal_approved: 'אושר פנימית',
  client_approved: 'אושר ע"י הלקוח',
  changes_requested: 'נדרשים שינויים',
};

export type ScriptSource = 'ai' | 'ai_revision' | 'manual' | 'demo';

export interface ScriptVersion {
  id: string;
  projectId: string;
  /** מספר רץ פנימי (סדר יצירה) */
  version: number;
  /** מספר הגרסה שמוצג: major.minor — שינוי קטן מעלה minor (v6.1), שינוי כולל מעלה major (v7) */
  major: number;
  minor: number;
  /** "6" או "6.1" */
  label: string;
  parentId: string | null;
  source: ScriptSource;
  provider: string | null;
  model: string | null;
  status: ScriptVersionStatus;
  content: ScriptContent;
  changeNote: string;
  createdBy: string;
  createdAt: string;
}

/** קצב דיבור משוער למילים בשנייה — לבדיקת התאמה בין קריינות לתזמון. */
export const WORDS_PER_SECOND: Record<string, number> = { he: 2.2, en: 2.5, default: 2.4 };

export function wordsPerSecond(language: string): number {
  const l = language.trim().toLowerCase();
  if (l.startsWith('he') || l.includes('עבר')) return WORDS_PER_SECOND.he;
  if (l.startsWith('en') || l.includes('אנגל')) return WORDS_PER_SECOND.en;
  return WORDS_PER_SECOND.default;
}

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export interface ScriptTiming {
  totalSec: number;
  narrationSec: number;
  targetSec: number | null;
  deviationPct: number | null;
  scenes: Array<{ id: string; estDurationSec: number; narrationSec: number; tooDense: boolean }>;
}

/** מחשב תזמון: סכום משכי סצנות מול זמן הקראה משוער, וסצנות "דחוסות" מדי. */
export function computeTiming(content: ScriptContent, language: string, targetSec: number | null): ScriptTiming {
  const wps = wordsPerSecond(language);
  const scenes = content.scenes.map((s) => {
    const narrationSec = Math.round((countWords(s.narration) / wps) * 10) / 10;
    return {
      id: s.id,
      estDurationSec: s.estDurationSec,
      narrationSec,
      tooDense: s.estDurationSec > 0 && narrationSec > s.estDurationSec * 1.1,
    };
  });
  const totalSec = Math.round(content.scenes.reduce((a, s) => a + (s.estDurationSec || 0), 0) * 10) / 10;
  const narrationSec = Math.round(scenes.reduce((a, s) => a + s.narrationSec, 0) * 10) / 10;
  return {
    totalSec,
    narrationSec,
    targetSec,
    deviationPct: targetSec ? Math.round(((totalSec - targetSec) / targetSec) * 100) : null,
    scenes,
  };
}

export interface SceneDiff {
  index: number;
  status: 'added' | 'removed' | 'changed' | 'same';
  fields: string[];
  before?: Scene;
  after?: Scene;
}

const DIFF_FIELDS: Array<keyof Scene> = ['storyRole', 'narration', 'onScreenText', 'visualAction', 'estDurationSec', 'notes'];

/** השוואת גרסאות לפי מיקום סצנה. */
export function diffScripts(a: ScriptContent, b: ScriptContent): SceneDiff[] {
  const n = Math.max(a.scenes.length, b.scenes.length);
  const out: SceneDiff[] = [];
  for (let i = 0; i < n; i++) {
    const before = a.scenes[i];
    const after = b.scenes[i];
    if (!before) out.push({ index: i, status: 'added', fields: [], after });
    else if (!after) out.push({ index: i, status: 'removed', fields: [], before });
    else {
      const fields = DIFF_FIELDS.filter((f) => before[f] !== after[f]);
      out.push({ index: i, status: fields.length ? 'changed' : 'same', fields, before, after });
    }
  }
  return out;
}

export const versionLabel = (major: number, minor: number) => (minor ? `${major}.${minor}` : `${major}`);

/**
 * גודל השינוי בין שתי גרסאות: "major" רק כשגם הקריינות וגם הוויזואל השתנו ברוב הסצנות
 * (או שהמבנה השתנה מהותית). כל השאר — תיקון שורה, טקסט, תזמון — "minor".
 */
export function scriptChangeSize(a: ScriptContent, b: ScriptContent): 'major' | 'minor' {
  const n = Math.max(a.scenes.length, b.scenes.length);
  if (!n) return 'minor';
  const diff = diffScripts(a, b);
  const touched = (field: keyof Scene) =>
    diff.filter((d) => d.status === 'added' || d.status === 'removed' || (d.status === 'changed' && d.fields.includes(field))).length / n;
  return touched('narration') >= 0.5 && touched('visualAction') >= 0.5 ? 'major' : 'minor';
}

/** המספר הבא: minor → אותו major של הגרסה שעליה עבדת, minor פנוי הבא; major → major חדש */
export function nextScriptNumbers(
  existing: Array<{ major: number; minor: number }>,
  base: { major: number } | null,
  size: 'major' | 'minor',
): { major: number; minor: number } {
  const maxMajor = existing.reduce((m, v) => Math.max(m, v.major), 0);
  if (!base || size === 'major' || !maxMajor) return { major: maxMajor + 1, minor: 0 };
  const minor = existing.filter((v) => v.major === base.major).reduce((m, v) => Math.max(m, v.minor), 0) + 1;
  return { major: base.major, minor };
}

/** תסריט שכתוב בעיקר באנגלית (לפי הקריינות והטקסט על המסך) — קובע כיוון ושפת התוויות בקבצים ללקוח */
export function isEnglishScript(content: ScriptContent): boolean {
  const text = content.scenes.map((s) => `${s.narration} ${s.onScreenText}`).join(' ');
  const he = (text.match(/[֐-׿]/g) ?? []).length;
  const en = (text.match(/[A-Za-z]/g) ?? []).length;
  return en > he;
}

export const STORY_ROLE_LABELS_EN: Record<string, string> = {
  hook: 'Hook',
  problem: 'Problem',
  solution: 'Solution',
  benefit: 'Benefit',
  proof: 'Proof',
  cta: 'Call to action',
  transition: 'Transition',
  other: 'Other',
};
