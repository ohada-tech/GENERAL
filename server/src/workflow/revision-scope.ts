/**
 * תיקון ממוקד: כשאתה מעתיק שורות מהתסריט להערה (או כותב "סצנה 6"), רק הסצנות האלה רשאיות להשתנות.
 * הקוד אוכף את זה אחרי שהמודל מחזיר תשובה — כל סצנה אחרת, הכותרת והלוגליין חוזרים מילה במילה מהגרסה הקודמת.
 */
import type { ScriptContent } from '@apos/shared';
import type { ScriptDraft } from '../providers/types.js';

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const MIN = 8;
const CHUNK = 14;

function overlaps(fragment: string, field: string) {
  if (fragment.length < MIN || field.length < MIN) return false;
  if (field.includes(fragment) || fragment.includes(field)) return true;
  // שורה שהועתקה חלקית או עם שינוי קטן: מספיק רצף משותף של CHUNK תווים
  for (let i = 0; i + CHUNK <= fragment.length; i += 4) if (field.includes(fragment.slice(i, i + CHUNK))) return true;
  return false;
}

/** אילו סצנות (אינדקס מ-0) ההערה מכוונת אליהן. ריק = ההערה כללית, אין נעילה. */
export function targetScenes(base: ScriptContent, feedback: string): number[] {
  const out = new Set<number>();
  for (const m of feedback.matchAll(/(?:סצנה|סצינה|סצנות|scene)\s*(\d+)/giu)) {
    const i = Number(m[1]) - 1;
    if (i >= 0 && i < base.scenes.length) out.add(i);
  }
  const fragments = feedback
    .split(/[\n\r"״“”«»]+/)
    .map(norm)
    .filter((f) => f.length >= MIN);
  base.scenes.forEach((s, i) => {
    const fields = [s.narration, s.onScreenText].map(norm);
    if (fragments.some((f) => fields.some((x) => overlaps(f, x)))) out.add(i);
  });
  return [...out].sort((a, b) => a - b);
}

/** משאיר שינויים רק בסצנות המטרה; כל השאר מוחזר מהגרסה הקודמת */
export function lockToTargets(base: ScriptContent, revised: ScriptDraft, targets: number[]): ScriptDraft {
  const strip = ({ id: _id, ...s }: ScriptContent['scenes'][number]) => s;
  const scenes = base.scenes.map((s, i) => (targets.includes(i) && revised.scenes[i] ? revised.scenes[i] : strip(s)));
  // סצנות נוספות רק אם ההערה כוונה לסוף התסריט
  if (targets.includes(base.scenes.length - 1)) scenes.push(...revised.scenes.slice(base.scenes.length));
  return { title: base.title, logline: base.logline, scenes };
}

export const scopeLabel = (targets: number[]) =>
  targets.length ? `${targets.length === 1 ? 'סצנה' : 'סצנות'} ${targets.map((i) => i + 1).join(', ')} בלבד` : '';
