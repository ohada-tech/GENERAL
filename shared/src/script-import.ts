/**
 * הוספה ידנית של תסריט — בעיקר נוסח שהלקוח ערך אחרי שקיבל את שלנו.
 * מטקסט מודבק או משורות הטבלה של קובץ ה-Word ← תוכן תסריט, על בסיס גרסה קיימת:
 * מה שהלקוח לא נגע בו (מה רואים, משך, הערות פנימיות) נשאר מהגרסה שנשלחה.
 * Claude לא כותב כאן כלום — רק מסדר את הטקסט של הלקוח בתוך הסצנות.
 */
import { STORY_ROLE_LABELS, STORY_ROLE_LABELS_EN, type ScriptContent } from './script.js';

export interface EditedSceneFields {
  narration?: string;
  onScreenText?: string;
  visualAction?: string;
  estDurationSec?: number;
  storyRole?: string;
}

const EMPTY = /^[\s—–\-]*$/;
const cleanField = (s: string | undefined) => {
  const t = (s ?? '').replace(/[‎‏‪-‮]/g, '').replace(/[ \t]+\n/g, '\n').trim();
  return EMPTY.test(t) ? '' : t;
};

/** "הוק / פתיחה" / "Hook" ← hook */
export function storyRoleFromLabel(label: string): string | undefined {
  const t = label.trim().toLowerCase();
  if (!t) return undefined;
  for (const map of [STORY_ROLE_LABELS, STORY_ROLE_LABELS_EN]) {
    for (const [k, v] of Object.entries(map)) if (v.toLowerCase() === t || k === t) return k;
  }
  return undefined;
}

/** סצנות שנקראו ← תוכן תסריט. כל סצנה יורשת מהסצנה באותו מקום בגרסת הבסיס את מה שלא הגיע. */
export function mergeEditedScenes(base: ScriptContent | null, rows: EditedSceneFields[], meta: { title?: string; logline?: string } = {}): ScriptContent {
  const scenes = rows.map((r, i) => {
    const b = base?.scenes[i];
    return {
      id: b?.id ?? '',
      storyRole: r.storyRole ?? b?.storyRole ?? 'other',
      narration: r.narration !== undefined ? cleanField(r.narration) : (b?.narration ?? ''),
      onScreenText: r.onScreenText !== undefined ? cleanField(r.onScreenText) : (b?.onScreenText ?? ''),
      visualAction: r.visualAction !== undefined ? cleanField(r.visualAction) : (b?.visualAction ?? ''),
      estDurationSec: r.estDurationSec !== undefined && Number.isFinite(r.estDurationSec) ? r.estDurationSec : (b?.estDurationSec ?? 0),
      notes: b?.notes ?? '',
    };
  });
  return { title: meta.title?.trim() || base?.title || '', logline: meta.logline?.trim() || base?.logline || '', scenes };
}

const FIELD_LABELS: Array<[keyof EditedSceneFields, RegExp]> = [
  ['onScreenText', /^(?:טקסט\s+על\s+(?:ה)?מסך|על\s+המסך|כיתוב(?:\s+על\s+המסך)?|on[- ]?screen(?:\s+text)?|super|text)$/i],
  ['visualAction', /^(?:מה\s+רואים|ויזואל(?:י)?|תיאור\s+(?:ה)?תמונה|visual(?:s)?|action)$/i],
  ['narration', /^(?:קריינות|קריין|טקסט\s+(?:ה)?קריינות|דיבור|vo|v\.o\.?|voice[- ]?over|narration)$/i],
  ['estDurationSec', /^(?:שניות|משך|זמן|sec|secs|seconds|duration)$/i],
];
const LABEL_LINE = /^\s*([^:：\n]{1,24}?)\s*[:：]\s*(.*)$/;
const SCENE_HEAD = /^\s*(?:(?:סצנה|scene)\s*(\d{1,2})\b[\s.:)\-–—]*|(\d{1,2})\s*[.)\-–—:]\s+)(.*)$/i;

function fieldOf(label: string): keyof EditedSceneFields | null {
  const t = label.trim();
  for (const [k, re] of FIELD_LABELS) if (re.test(t)) return k;
  return null;
}

/** בלוק של סצנה אחת: שדות עם תווית ("קריינות: …"), וטקסט בלי תווית = קריינות */
function parseBlock(lines: string[]): EditedSceneFields {
  const acc: Partial<Record<keyof EditedSceneFields, string[]>> = {};
  let cur: keyof EditedSceneFields = 'narration';
  let sawLabel = false;
  for (const line of lines) {
    const m = line.match(LABEL_LINE);
    const f = m ? fieldOf(m[1]) : null;
    if (m && f) {
      cur = f;
      sawLabel = true;
      (acc[cur] ??= []).push(m[2]);
      continue;
    }
    const role = !sawLabel && !acc.narration?.length ? storyRoleFromLabel(line.replace(/[()[\]]/g, '')) : undefined;
    if (role) {
      (acc.storyRole ??= []).push(role);
      continue;
    }
    (acc[cur] ??= []).push(line);
  }
  const join = (k: keyof EditedSceneFields) => (acc[k] ? acc[k]!.join('\n').trim() : undefined);
  const out: EditedSceneFields = {};
  for (const k of ['narration', 'onScreenText', 'visualAction'] as const) {
    const v = join(k);
    if (v !== undefined) out[k] = v;
  }
  const d = join('estDurationSec')?.match(/\d+(?:\.\d+)?/);
  if (d) out.estDurationSec = Number(d[0]);
  if (acc.storyRole?.length) out.storyRole = acc.storyRole[0];
  return out;
}

/**
 * טקסט מודבק ← סצנות. מזהה (לפי הסדר):
 * 1. כותרות "סצנה 3" / "Scene 3" / "3." — בלוק לכל סצנה, עם שדות מסומנים או בלי.
 * 2. שורות טבלה שהועתקו מ-Word (תאים מופרדים בטאב, מספר בתא הראשון).
 * 3. בלי סימון: פסקאות (שורה ריקה ביניהן). אם מספר הפסקאות לא תואם לבסיס אבל מספר השורות כן — שורה לכל סצנה.
 */
export function parseEditedScriptText(text: string, base: ScriptContent | null): ScriptContent {
  const lines = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '').split('\n');

  // 2. טבלה שהועתקה
  const tabRows = lines.map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c.length >= 3 && /^\d{1,2}\b/.test(c[0]));
  if (tabRows.length >= 2) {
    return mergeEditedScenes(
      base,
      tabRows.map((c) => {
        const role = storyRoleFromLabel(c[0].replace(/^\d{1,2}\s*/, ''));
        const d = c[4]?.match(/\d+(?:\.\d+)?/);
        return { narration: c[1], onScreenText: c[2], ...(c[3] !== undefined ? { visualAction: c[3] } : {}), ...(d ? { estDurationSec: Number(d[0]) } : {}), ...(role ? { storyRole: role } : {}) };
      }),
    );
  }

  // 1. כותרות סצנה
  const blocks: string[][] = [];
  let pre: string[] = [];
  for (const l of lines) {
    const m = l.match(SCENE_HEAD);
    if (m) {
      blocks.push(m[3]?.trim() ? [m[3].trim()] : []);
      continue;
    }
    if (blocks.length) blocks[blocks.length - 1].push(l);
    else pre.push(l);
  }
  if (blocks.length >= 2) {
    const title = pre.map((l) => l.trim()).find(Boolean);
    return mergeEditedScenes(
      base,
      blocks.map((b) => parseBlock(b.filter((l) => l.trim()))),
      title && title.length <= 80 ? { title: title.replace(/^(?:כותרת|title)\s*[:：]\s*/i, '') } : {},
    );
  }

  // 3. פסקאות / שורות
  const paras = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  const n = base?.scenes.length ?? 0;
  const chunks = n && paras.length !== n && nonEmpty.length === n ? nonEmpty : paras;
  return mergeEditedScenes(base, chunks.map((c) => parseBlock(c.split('\n'))));
}

/**
 * שורות הטבלה של קובץ ה-Word שהמערכת שולחת ללקוח (# | קריינות | טקסט על המסך | מה רואים | שניות),
 * אחרי שהלקוח ערך אותו. null אם אין בקובץ טבלה כזו.
 */
export function scenesFromDocTable(tables: string[][][]): EditedSceneFields[] | null {
  for (const t of tables) {
    const hi = t.findIndex((row) => row.some((c) => fieldOf(c) === 'narration'));
    if (hi < 0) continue;
    const head = t[hi].map((c) => (c.trim() === '#' ? 'num' : fieldOf(c)));
    const col = (k: string) => head.indexOf(k as never);
    const rows = t.slice(hi + 1).filter((r) => r.some((c) => !EMPTY.test(c)));
    if (!rows.length) continue;
    return rows.map((r) => {
      const out: EditedSceneFields = {};
      const get = (k: string) => (col(k) >= 0 ? (r[col(k)] ?? '') : undefined);
      for (const k of ['narration', 'onScreenText', 'visualAction'] as const) {
        const v = get(k);
        if (v !== undefined) out[k] = v;
      }
      const d = get('estDurationSec')?.match(/\d+(?:\.\d+)?/);
      if (d) out.estDurationSec = Number(d[0]);
      const num = get('num');
      if (num) {
        const role = storyRoleFromLabel(num.split('\n').slice(1).join(' '));
        if (role) out.storyRole = role;
      }
      return out;
    });
  }
  return null;
}
