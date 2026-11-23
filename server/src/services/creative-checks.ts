/**
 * בדיקות קוד לתסריט — מה שאפשר למדוד, לא סומכים על המודל:
 * תקציב מילים מול האורך, תזמון מציאותי לכל סצנה, ביטויי ברושור, חזרתיות, ריבוי סצנות ורשימות שוטים בתוך התסריט.
 * התוצאה נכנסת לשופט ה-QA כעובדות, וחריגה קריטית חוסמת מעבר גם אם הציון גבוה.
 */
import { BANNED_HE, countWords, wordsPerSecond, type Brief } from '@apos/shared';
import { wordBudget } from '../providers/prompts.js';
import type { ScriptDraft } from '../providers/types.js';

type Scene = ScriptDraft['scenes'][number];
type BriefLike = Pick<Brief, 'durationSec' | 'language' | 'voiceoverNeeded'>;

const round1 = (n: number) => Math.round(n * 10) / 10;
const isHebrew = (b: BriefLike) => !b.language || /עברית|hebrew|^he/i.test(b.language);
/** פנייה ישירה שחוזרת שוב ושוב ("אתם", "שלכם"...) — נשמע כמו טופס, לא כמו בן אדם */
const ADDRESS = /(^|[\s,.!?״"'׳-])(ו?(?:אתם|שלכם|לכם|אתכם|אצלכם|בשבילכם))(?=$|[\s,.!?״"'׳-])/g;

export interface CheckResult {
  issues: string[];
  critical: string[];
  words: number;
  budget: number;
  narrationSec: number;
}

export function scriptChecks(script: Pick<ScriptDraft, 'scenes'>, brief: BriefLike): CheckResult {
  const wps = wordsPerSecond(brief.language);
  const issues: string[] = [];
  const critical: string[] = [];
  const scenes = script.scenes;
  const words = scenes.reduce((a, s) => a + countWords(s.narration), 0);
  const budget = wordBudget(brief);
  const narrationSec = round1(words / wps);
  const total = round1(scenes.reduce((a, s) => a + (Number(s.estDurationSec) || 0), 0));

  if (budget && words > budget * 1.1) {
    critical.push(`קריינות ארוכה מדי: ${words} מילים ≈ ${narrationSec} שניות קריינות בסרטון של ${brief.durationSec} שניות (תקציב: ${budget} מילים)`);
  } else if (budget && words > budget) {
    issues.push(`הקריינות מעט מעל התקציב: ${words}/${budget} מילים`);
  }
  if (brief.durationSec && total && Math.abs(total - brief.durationSec) > brief.durationSec * 0.1) {
    issues.push(`סך הזמנים (${total} שנ׳) לא תואם את האורך המבוקש (${brief.durationSec} שנ׳)`);
  }
  scenes.forEach((s, i) => {
    const need = round1(countWords(s.narration) / wps);
    if (need && (Number(s.estDurationSec) || 0) < need * 0.9) issues.push(`סצנה ${i + 1}: ${countWords(s.narration)} מילים צריכות כ-${need} שנ׳, לא ${s.estDurationSec}`);
    if (s.visualAction.length > 320 || /שוט\s*\d|shot\s*\d/i.test(s.visualAction)) issues.push(`סצנה ${i + 1}: רשימת שוטים בתוך התסריט (שייך לסטוריבורד) — ${s.visualAction.length} תווים`);
  });
  if (brief.durationSec && scenes.length > Math.max(4, Math.ceil(brief.durationSec / 5))) {
    issues.push(`${scenes.length} סצנות ל-${brief.durationSec} שניות — כנראה יותר מדי נושאים`);
  }

  issues.push(...copyIssues(script, brief, words));
  return { issues, critical, words, budget, narrationSec };
}

/** כללי הקופי שנמדדים בקוד: ביטויי ברושור, פנייה חוזרת, שורות רצופות שנפתחות באותה מילה */
function copyIssues(script: Pick<ScriptDraft, 'scenes'>, brief: BriefLike, words: number): string[] {
  const issues: string[] = [];
  const scenes = script.scenes;
  if (isHebrew(brief)) {
    const all = scenes.map((s) => s.narration).join(' \n ');
    for (const b of BANNED_HE) if (all.includes(b)) issues.push(`ביטוי ברושור: "${b}"`);
    const address = (all.match(ADDRESS) ?? []).length;
    if (words && address > Math.max(4, Math.round(words / 15))) issues.push(`פנייה חוזרת: "אתם/שלכם/לכם" מופיע ${address} פעמים ב-${words} מילים`);
  }
  // שתי שורות רצופות שנפתחות באותה מילה — קצב תבניתי
  const firsts = scenes.map((s) => s.narration.trim().split(/\s+/)[0]?.replace(/[^\p{L}]/gu, '') ?? '');
  firsts.forEach((w, i) => {
    if (i && w && w.length > 1 && w === firsts[i - 1]) issues.push(`סצנות ${i}–${i + 1} נפתחות באותה מילה ("${w}")`);
  });
  return issues;
}

/**
 * שער הקופי לפני שמירת גרסה מתיקון: רק הפרות שהתיקון הכניס (מה שהיה כבר בגרסת הבסיס לא נזקף לו,
 * כדי שתיקון ממוקד לא יידחף לגעת בשורות שלא ביקשו לשנות). חריגה מתקציב המילים נספרת רק אם התיקון האריך.
 */
export function newCopyViolations(base: Pick<ScriptDraft, 'scenes'>, revised: Pick<ScriptDraft, 'scenes'>, brief: BriefLike): string[] {
  const count = (s: Pick<ScriptDraft, 'scenes'>) => s.scenes.reduce((a, x) => a + countWords(x.narration), 0);
  const before = new Set(copyIssues(base, brief, count(base)));
  const words = count(revised);
  const out = copyIssues(revised, brief, words).filter((i) => !before.has(i) && !/^פנייה חוזרת/.test(i));
  // פנייה חוזרת: נמדדת לפי כמות, אז משווים את הספירה ולא את הטקסט
  const addr = (s: Pick<ScriptDraft, 'scenes'>) => (s.scenes.map((x) => x.narration).join(' \n ').match(ADDRESS) ?? []).length;
  if (isHebrew(brief) && words && addr(revised) > Math.max(4, Math.round(words / 15)) && addr(revised) > addr(base)) {
    out.push(`פנייה חוזרת: "אתם/שלכם/לכם" מופיע ${addr(revised)} פעמים ב-${words} מילים`);
  }
  const budget = wordBudget(brief);
  if (budget && words > budget * 1.1 && words > count(base)) out.push(`קריינות ארוכה מדי: ${words} מילים (תקציב: ${budget})`);
  return out;
}

/** זמן מציאותי: סצנה לא יכולה להיות קצרה ממה שלוקח להגיד את הקריינות שלה */
export function normalizeTiming<T extends { scenes: Scene[] }>(script: T, brief: BriefLike): T {
  const wps = wordsPerSecond(brief.language);
  return {
    ...script,
    scenes: script.scenes.map((s) => {
      const need = round1(countWords(s.narration) / wps);
      return need > (Number(s.estDurationSec) || 0) ? { ...s, estDurationSec: need } : s;
    }),
  };
}
