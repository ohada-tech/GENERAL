/**
 * "מה רץ עכשיו": כל מה שהמערכת והמחשב של אוהד עובדים עליו בכל הפרויקטים, במקום אחד —
 * כתיבה ב-ChatGPT / Claude, משימות Claude (אנלימיטד / QA) והרצות קרדיטים בהיגספילד.
 * לכל שורה: מה, באיזה פרויקט, מאז מתי, ואיך עוצרים.
 */
import type { Ctx } from '../context.js';

export interface RunningItem {
  id: string;
  kind: 'job' | 'agent' | 'hf';
  projectId: string;
  projectName: string;
  label: string;
  status: 'queued' | 'running';
  since: string;
  /** נתיב לעצירה (POST), אם אפשר */
  cancel: string | null;
  tab: string;
}

const JOB_LABEL: Record<string, [string, string]> = {
  'script.generate': ['ChatGPT כותב תסריט', 'script'],
  'script.revise': ['ChatGPT מתקן תסריט', 'script'],
  'storyboard.generate': ['Claude בונה סטורי בורד', 'storyboard'],
  'shot.revise': ['Claude מתקן שוט', 'storyboard'],
  'feedback.review': ['ChatGPT עובר על הערות הלקוח', 'script'],
};

export function runningNow(ctx: Ctx): RunningItem[] {
  const names = new Map((ctx.db.prepare('SELECT id, name FROM projects').all() as { id: string; name: string }[]).map((r) => [r.id, r.name]));
  const name = (id: string) => names.get(id) ?? '';
  const out: RunningItem[] = [];

  const jobs = ctx.db
    .prepare("SELECT id, project_id, type, status, started_at, created_at FROM jobs WHERE status IN ('queued','running') ORDER BY created_at")
    .all() as { id: string; project_id: string; type: string; status: string; started_at: string | null; created_at: string }[];
  for (const j of jobs) {
    const l = JOB_LABEL[j.type];
    if (!l) continue; // עבודות פנימיות קצרות (למידה וכו') לא מוצגות
    out.push({ id: j.id, kind: 'job', projectId: j.project_id, projectName: name(j.project_id), label: l[0], status: j.status === 'running' ? 'running' : 'queued', since: j.started_at ?? j.created_at, cancel: `/api/jobs/${j.id}/cancel`, tab: l[1] });
  }

  const tasks = ctx.db
    .prepare("SELECT id, project_id, title, status, started_at, requested_at FROM agent_tasks WHERE status IN ('queued','running') ORDER BY requested_at")
    .all() as { id: string; project_id: string; title: string; status: string; started_at: string | null; requested_at: string }[];
  for (const t of tasks) {
    out.push({ id: t.id, kind: 'agent', projectId: t.project_id, projectName: name(t.project_id), label: t.title, status: t.status === 'running' ? 'running' : 'queued', since: t.started_at ?? t.requested_at, cancel: `/api/agent/${t.id}/cancel`, tab: 'storyboard' });
  }

  const runs = ctx.db
    .prepare("SELECT id, project_id, stage, status, total, done, credits, requested_at FROM hf_runs WHERE status IN ('queued','running') ORDER BY requested_at")
    .all() as { id: string; project_id: string; stage: string; status: string; total: number; done: number; credits: number; requested_at: string }[];
  for (const r of runs) {
    const what = r.stage === 'images' ? 'תמונות' : 'הנפשה';
    out.push({ id: r.id, kind: 'hf', projectId: r.project_id, projectName: name(r.project_id), label: `היגספילד בקרדיטים · ${what} ${r.done}/${r.total} (${r.credits} קרדיטים)`, status: r.status === 'running' ? 'running' : 'queued', since: r.requested_at, cancel: null, tab: r.stage === 'images' ? 'storyboard' : 'production' });
  }
  return out.sort((a, b) => (a.status === b.status ? a.since.localeCompare(b.since) : a.status === 'running' ? -1 : 1));
}
