/**
 * למידה: כל הערה, בקשת תיקון ואישור-עם-הערה נשמרים (לפי לקוח ותחום). מדי פעם Claude מזקק אותם
 * לכללים קצרים — כלליים ולכל לקוח — שנכנסים לפרומפטים של התסריט, הסטורי בורד והפרומפטים לתמונה/תנועה.
 * כך כל הפקה מתחילה ממה שכבר למדנו על הטעם שלך ושל הלקוח.
 */
import type { Ctx } from '../context.js';
import { uid } from '../db/db.js';
import { getProject } from '../db/repo.js';
import { enqueueJob } from '../workflow/queue.js';

export type LessonArea = 'script' | 'storyboard' | 'image' | 'motion' | 'audio' | 'editing' | 'general';
export const LESSON_AREAS: LessonArea[] = ['script', 'storyboard', 'image', 'motion', 'audio', 'editing', 'general'];

/** כל הערה מפעילה סבב למידה מיד — הערה נאמרת פעם אחת בלבד */
export const DISTILL_EVERY = 1;

export interface Lesson {
  id: string;
  scope: string;
  area: LessonArea;
  text: string;
  source: 'learned' | 'manual';
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const mapLesson = (r: any): Lesson => ({
  id: r.id,
  scope: r.scope,
  area: r.area,
  text: r.text,
  source: r.source,
  active: !!r.active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const clientScope = (client: string) => `client:${client.trim()}`;

export function recordFeedback(ctx: Ctx, projectId: string | null, area: LessonArea, text: string, kind: 'revision' | 'approval' | 'note' = 'revision') {
  const t = text.trim();
  if (!t) return;
  // אותה הערה נרשמת לפעמים פעמיים (סימון "נדרשים שינויים" ואז "צור גרסה מתוקנת") — שומרים אותה פעם אחת
  const dup = ctx.db.prepare('SELECT 1 FROM feedback WHERE project_id IS ? AND text = ? LIMIT 1').get(projectId, t.slice(0, 2000));
  if (dup) return;
  const client = projectId ? (getProject(ctx.db, projectId)?.clientName ?? '') : '';
  ctx.db
    .prepare('INSERT INTO feedback (id, project_id, client, area, kind, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uid(), projectId, client, area, kind, t.slice(0, 2000), ctx.now().toISOString());
  maybeDistill(ctx, projectId);
}

export function pendingFeedbackCount(ctx: Ctx) {
  const r = ctx.db.prepare('SELECT COUNT(*) AS n FROM feedback WHERE distilled = 0').get() as { n: number };
  return Number(r.n);
}

/** מפעיל סבב למידה כשהצטברו מספיק הערות (או בלחיצה על "למד עכשיו") */
export function maybeDistill(ctx: Ctx, projectId: string | null, force = false) {
  const n = pendingFeedbackCount(ctx);
  if (!n || (!force && n < DISTILL_EVERY)) return null;
  const anyProject =
    projectId ?? (ctx.db.prepare('SELECT project_id AS p FROM feedback WHERE distilled = 0 AND project_id IS NOT NULL LIMIT 1').get() as { p: string } | undefined)?.p;
  if (!anyProject) return null;
  const last = ctx.db.prepare('SELECT MAX(created_at) AS t FROM feedback WHERE distilled = 0').get() as { t: string };
  return enqueueJob(ctx, {
    projectId: anyProject,
    type: 'lessons.distill',
    idempotencyKey: `lessons.distill:${last.t}:${n}`,
    actor: 'system',
  }).job;
}

export function listLessons(ctx: Ctx): Lesson[] {
  return (ctx.db.prepare('SELECT * FROM lessons ORDER BY scope, area, created_at').all() as any[]).map(mapLesson);
}

/** הכללים הפעילים לפרויקט: כלליים + של הלקוח, לתחומים שביקשת */
export function lessonsFor(ctx: Ctx, client: string, areas: LessonArea[]): string[] {
  const rows = ctx.db
    .prepare(
      `SELECT * FROM lessons WHERE active = 1 AND (scope = 'global' OR scope = ?) AND area IN (${areas.map(() => '?').join(',')}) ORDER BY scope DESC, created_at`,
    )
    .all(clientScope(client), ...areas) as any[];
  const learned = rows.map((r) => (r.scope === 'global' ? r.text : `[${client}] ${r.text}`));
  // הערות שעוד לא זוקקו נכנסות כמו שהן — כדי שאף הערה לא תצטרך להיאמר פעמיים, גם לפני שסבב הלמידה הסתיים
  const fresh = ctx.db
    .prepare(
      `SELECT text, client FROM feedback WHERE distilled = 0 AND kind != 'approval' AND (client = '' OR client = ?) AND area IN (${areas.map(() => '?').join(',')}) ORDER BY created_at`,
    )
    .all(client.trim(), ...areas) as Array<{ text: string; client: string }>;
  return [...learned, ...fresh.map((f) => `הערה אחרונה של הבעלים${f.client ? ` (${f.client})` : ''}: ${f.text.slice(0, 400)}`)];
}

export function addLesson(ctx: Ctx, input: { scope?: string; area?: string; text: string }) {
  const id = uid();
  const now = ctx.now().toISOString();
  const area = (LESSON_AREAS as string[]).includes(input.area ?? '') ? input.area! : 'general';
  ctx.db
    .prepare("INSERT INTO lessons (id, scope, area, text, source, active, created_at, updated_at) VALUES (?, ?, ?, ?, 'manual', 1, ?, ?)")
    .run(id, input.scope?.trim() || 'global', area, input.text.trim(), now, now);
  return mapLesson(ctx.db.prepare('SELECT * FROM lessons WHERE id = ?').get(id));
}

export function updateLesson(ctx: Ctx, id: string, patch: { text?: string; active?: boolean }) {
  const cur = ctx.db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) as any;
  if (!cur) return null;
  ctx.db
    .prepare("UPDATE lessons SET text = ?, active = ?, source = CASE WHEN ? != text THEN 'manual' ELSE source END, updated_at = ? WHERE id = ?")
    .run(patch.text?.trim() || cur.text, patch.active === undefined ? cur.active : patch.active ? 1 : 0, patch.text?.trim() || cur.text, ctx.now().toISOString(), id);
  return mapLesson(ctx.db.prepare('SELECT * FROM lessons WHERE id = ?').get(id));
}

export function deleteLesson(ctx: Ctx, id: string) {
  ctx.db.prepare('DELETE FROM lessons WHERE id = ?').run(id);
}

export function recentFeedback(ctx: Ctx, limit = 50) {
  return (ctx.db.prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?').all(limit) as any[]).map((r) => ({
    id: r.id,
    projectId: r.project_id,
    client: r.client,
    area: r.area,
    kind: r.kind,
    text: r.text,
    distilled: !!r.distilled,
    createdAt: r.created_at,
  }));
}

export const DISTILL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lessons'],
  properties: {
    lessons: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['scope', 'area', 'text'],
        properties: {
          scope: { type: 'string', description: '"global" or "client:<exact client name>"' },
          area: { type: 'string', enum: LESSON_AREAS },
          text: { type: 'string' },
        },
      },
    },
  },
} as const;

export function distillPrompts(ctx: Ctx) {
  const all = listLessons(ctx);
  const learned = all.filter((l) => l.source === 'learned' && l.active);
  const manual = all.filter((l) => l.source === 'manual' && l.active);
  const rejected = all.filter((l) => !l.active);
  const fb = ctx.db.prepare('SELECT * FROM feedback WHERE distilled = 0 ORDER BY created_at').all() as any[];
  const system = [
    'You maintain the house style guide of an AI video production studio (Hebrew-speaking owner, Israeli clients).',
    'From the owner\'s and clients\' feedback, derive short, concrete, reusable rules that will be injected into future prompts (scripts, storyboards, image and motion prompts, audio, editing).',
    'Rules: imperative, specific and checkable (e.g. "Hook must show the product within the first 2 seconds"), one idea per rule, no project-specific trivia unless it is a lasting client preference.',
    'Scope: use "global" when it reflects the owner\'s general taste; use "client:<exact client name>" when it is specific to that client.',
    'Return the COMPLETE updated set of learned rules: keep the existing learned rules that still hold, merge duplicates, refine wording, drop rules that new feedback contradicts. At most 10 rules per scope+area.',
    'NEVER turn feedback into a fixed script structure, a scene order, a numbered list of parts or a feature checklist (e.g. "the script is built of 7 parts in this order"). Such rules kill the creative idea. When the owner complains that something is unclear, write a clarity requirement instead (e.g. "by the end the viewer knows who it is for and what the product does").',
    'Write the rule text in Hebrew. Never duplicate a manual rule (they are kept as-is).',
  ].join('\n');
  const user = [
    `MANUAL RULES (owner-written, keep, do not repeat):\n${manual.map((l) => `- [${l.scope} · ${l.area}] ${l.text}`).join('\n') || '(none)'}`,
    `RULES THE OWNER TURNED OFF (never re-add them or anything equivalent):\n${rejected.map((l) => `- [${l.scope} · ${l.area}] ${l.text}`).join('\n') || '(none)'}`,
    `CURRENT LEARNED RULES:\n${learned.map((l) => `- [${l.scope} · ${l.area}] ${l.text}`).join('\n') || '(none)'}`,
    `NEW FEEDBACK (oldest first):\n${fb.map((f) => `- [client: ${f.client || '-'} · area: ${f.area} · ${f.kind}] ${f.text}`).join('\n')}`,
    'Return the full updated learned rule set.',
  ].join('\n\n');
  return { system, user, feedbackIds: fb.map((f) => f.id as string) };
}

export function applyDistilled(ctx: Ctx, rows: Array<{ scope: string; area: string; text: string }>, feedbackIds: string[]) {
  const now = ctx.now().toISOString();
  // כללים שכיבית נשארים כבויים (והמודל מתבקש לא להחזיר אותם); הנלמדים הפעילים מוחלפים בסט המעודכן
  ctx.db.prepare("DELETE FROM lessons WHERE source = 'learned' AND active = 1").run();
  const ins = ctx.db.prepare("INSERT INTO lessons (id, scope, area, text, source, active, created_at, updated_at) VALUES (?, ?, ?, ?, 'learned', 1, ?, ?)");
  let n = 0;
  for (const r of rows.slice(0, 200)) {
    const text = String(r.text ?? '').trim();
    if (!text) continue;
    const scope = r.scope === 'global' || /^client:.+/.test(r.scope) ? r.scope : 'global';
    const area = (LESSON_AREAS as string[]).includes(r.area) ? r.area : 'general';
    ins.run(uid(), scope, area, text.slice(0, 500), now, now);
    n++;
  }
  const mark = ctx.db.prepare('UPDATE feedback SET distilled = 1 WHERE id = ?');
  for (const id of feedbackIds) mark.run(id);
  return n;
}

export interface FirstPassArea {
  area: 'script' | 'storyboard' | 'image' | 'motion' | 'audio' | 'editing';
  total: number;
  firstPass: number;
  byMonth: Array<{ month: string; total: number; firstPass: number }>;
}

/**
 * המדד שמראה אם המערכת משתפרת: כמה מהתוצרים אושרו כבר בפעם הראשונה, בלי בקשת תיקון — לפי תחום ולפי חודש.
 * תסריט: הגרסה שהלקוח אישר היא v1. שוט: אושר בלי "נדרש תיקון". מדיה: הגרסה המאושרת היא הראשונה.
 */
export function firstPassStats(ctx: Ctx): FirstPassArea[] {
  const rows: Array<{ area: FirstPassArea['area']; at: string; first: boolean }> = [];
  for (const r of ctx.db
    .prepare(
      `SELECT sv.version AS v, MIN(a.created_at) AS at FROM script_versions sv
       JOIN approvals a ON a.subject_type = 'script_version' AND a.subject_id = sv.id AND a.kind = 'client' AND a.decision = 'approved'
       WHERE sv.status = 'client_approved' GROUP BY sv.id`,
    )
    .all() as any[])
    rows.push({ area: 'script', at: r.at, first: Number(r.v) === 1 });
  for (const r of ctx.db
    .prepare(
      `SELECT s.updated_at AS at,
         EXISTS (SELECT 1 FROM approvals a WHERE a.subject_type = 'shot' AND a.subject_id = s.id AND a.decision = 'changes_requested') AS fixed
       FROM shots s JOIN storyboards b ON b.id = s.storyboard_id WHERE b.status = 'approved' AND s.approval = 'approved'`,
    )
    .all() as any[])
    rows.push({ area: 'storyboard', at: r.at, first: !Number(r.fixed) });
  const KIND: Record<string, FirstPassArea['area']> = { frame: 'image', clip: 'motion', voiceover: 'audio', music: 'audio', final: 'editing' };
  for (const r of ctx.db.prepare("SELECT kind, version, updated_at AS at FROM media WHERE status = 'approved'").all() as any[])
    if (KIND[r.kind]) rows.push({ area: KIND[r.kind], at: r.at, first: Number(r.version) === 1 });

  const areas: FirstPassArea['area'][] = ['script', 'storyboard', 'image', 'motion', 'audio', 'editing'];
  return areas.map((area) => {
    const mine = rows.filter((r) => r.area === area);
    const months = new Map<string, { total: number; firstPass: number }>();
    for (const r of mine) {
      const m = String(r.at).slice(0, 7);
      const cur = months.get(m) ?? { total: 0, firstPass: 0 };
      cur.total++;
      if (r.first) cur.firstPass++;
      months.set(m, cur);
    }
    return {
      area,
      total: mine.length,
      firstPass: mine.filter((r) => r.first).length,
      byMonth: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
    };
  });
}
