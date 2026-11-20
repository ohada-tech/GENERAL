/**
 * Claude כמנוע מאחורי הקלעים: כפתור במערכת יוצר משימה עם כל ההקשר, ועובד מקומי במחשב של אוהד
 * (~/.apos/agent-worker.cjs) מריץ אותה ב-Claude Code (מנוי Max, עם Chrome והסקילים שלו) ומחזיר תוצאה למסך.
 * סוגי משימות קבועים — ההוראות נבנות כאן, לא נכתבות בצ'אט.
 */
import type { Ctx } from '../context.js';
import { GateError, NotFoundError } from '../context.js';
import { uid } from '../db/db.js';
import { getProject } from '../db/repo.js';
import { emit } from '../workflow/events.js';
import { externalRequests } from '../workflow/production.js';

export const AGENT_KINDS = ['hf_unlimited', 'qa'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];
export type AgentStage = 'images' | 'animation';

export interface AgentTask {
  id: string;
  projectId: string;
  kind: AgentKind;
  stage: AgentStage;
  scope: 'pilot' | 'all';
  title: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  log: string;
  result: string;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

type Row = {
  id: string;
  project_id: string;
  kind: AgentKind;
  stage: AgentStage;
  scope: 'pilot' | 'all';
  title: string;
  prompt: string;
  status: AgentTask['status'];
  log: string;
  result: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
};
const map = (r: Row): AgentTask => ({
  id: r.id,
  projectId: r.project_id,
  kind: r.kind,
  stage: r.stage,
  scope: r.scope,
  title: r.title,
  status: r.status,
  log: r.log,
  result: r.result,
  requestedAt: r.requested_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

const STAGE_HE: Record<AgentStage, string> = { images: 'תמונות', animation: 'הנפשה' };

function title(kind: AgentKind, stage: AgentStage, scope: 'pilot' | 'all') {
  if (kind === 'qa') return `בדיקת איכות · ${STAGE_HE[stage]}`;
  return `היגספילד אנלימיטד · ${STAGE_HE[stage]} · ${scope === 'pilot' ? 'פיילוט (שוט אחד)' : 'כל השוטים'}`;
}

/** ההוראות ל-Claude Code. באנגלית לדיוק; התוצאה לאוהד — בעברית */
function buildPrompt(ctx: Ctx, projectId: string, kind: AgentKind, stage: AgentStage, scope: 'pilot' | 'all', note: string) {
  const p = getProject(ctx.db, projectId)!;
  const api = `API base: ${process.env.PUBLIC_URL || 'https://ai-production-ap.onrender.com'} — every request needs the header "Authorization: Bearer <token>", token = contents of ~/.apos-operator-token (strip whitespace; never print it).`;
  const common = [
    `You are working for Ohad's AI video studio on project "${p.name}" (id ${projectId}) in the AI Production AP system. You were started by a button in the system — there is no human in this conversation; do the job end to end and do not ask questions.`,
    api,
    'Follow the standing rules in ~/.claude/CLAUDE.md and the relevant skills (video-qc, ai-video-director, ai-engine-selection) — they are part of this job.',
    note ? `Ohad's note for this run: ${note}` : '',
  ];
  if (kind === 'hf_unlimited') {
    const what =
      stage === 'images'
        ? 'GET /api/projects/:id/production/requests → "images": one still per shot (prompt, aspect, characters, visualStyle, feedback from a rejected version).'
        : 'GET /api/projects/:id/production/requests → "animation": one clip per shot with an approved frame (approvedFrame.fileUrl — download it with the auth header and use it as the start frame).';
    return [
      ...common,
      `TASK: generate ${STAGE_HE[stage]} in Higgsfield (higgsfield.ai) in Ohad's Chrome, UNLIMITED ONLY.`,
      what,
      scope === 'pilot' ? 'PILOT: do only the FIRST pending shot, then stop.' : 'Do ALL pending shots, one after another (open Unlimited slots in parallel when Higgsfield allows).',
      `Model: images — Nano Banana Pro at 2K unless the project says otherwise (project imageModel: ${p.settings.imageModel}); animation — the shot's animation model (Kling 3.0 default). Aspect ratio from the requests response.`,
      'HARD RULES: before every click on Generate, read the button — it must say "Unlimited". NEVER click a button that shows credits. If Unlimited is not available for this model, stop and report it. Use approved references attached to the shot when there are any.',
      'For each result: QA it at full resolution (anatomy, hands, faces/eyes, product text read letter by letter, matches the shot prompt). Upload every take you keep with POST /api/projects/:id/media/from-url {"url": <result url>, "kind": "' +
        (stage === 'images' ? 'frame' : 'clip') +
        '", "shotId": <shotId>, "source": "higgsfield-unlimited", "model": <model>, "prompt": <prompt>, "note": <your QA finding in Hebrew, one line>}. If the URL needs login, download the file and use POST /api/projects/:id/media/upload?kind=..&shotId=..&source=higgsfield-unlimited (multipart field "file").',
      'Close the Chrome tabs you opened when done.',
      'FINAL ANSWER (it is shown to Ohad in the system): Hebrew, short — how many shots were generated and uploaded, QA problems per shot, and anything that blocked you.',
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    ...common,
    `TASK: quality check of the ${STAGE_HE[stage]} that wait for Ohad's approval.`,
    'GET /api/projects/:id/production → stages[stage="' + stage + '"].items: each item.media with status "ready" is a candidate. Download each file (GET /api/media/:mid/file with the auth header) and check it at full resolution per the video-qc skill: anatomy, hands, faces and eyes, product shape/size/text letter by letter, set continuity against the other shots, match to the shot prompt (GET /api/projects/:id/storyboard for the shots). For video: at least 4 full frames per clip.',
    'Write your verdict on each media item: POST /api/media/:mid/qa {"verdict": "pass" | "fail", "note": "<Hebrew, one line: what is wrong and how to fix>"}. Do NOT approve or reject anything yourself — Ohad decides.',
    'FINAL ANSWER (shown to Ohad): Hebrew, short — how many passed, which failed and why, and the one fix you recommend first.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function requestAgentTask(ctx: Ctx, projectId: string, input: { kind?: string; stage?: string; scope?: string; note?: string }) {
  const p = getProject(ctx.db, projectId);
  if (!p) throw new NotFoundError('פרויקט');
  const kind = AGENT_KINDS.find((k) => k === input.kind);
  if (!kind) throw new GateError('סוג משימה לא מוכר', 400);
  const stage: AgentStage = input.stage === 'animation' ? 'animation' : 'images';
  const scope = input.scope === 'pilot' ? 'pilot' : 'all';
  if (ctx.db.prepare("SELECT 1 FROM agent_tasks WHERE project_id = ? AND kind = ? AND stage = ? AND status IN ('queued','running')").get(projectId, kind, stage))
    throw new GateError('המשימה הזו כבר רצה', 409);
  if (kind === 'hf_unlimited') {
    const req = externalRequests(ctx, projectId);
    const pending = stage === 'images' ? req.images : (req.animation as Array<{ approvedFrame?: unknown }>).filter((i) => i.approvedFrame);
    if (!pending.length) throw new GateError(stage === 'images' ? 'אין שוטים שמחכים לתמונה' : 'אין שוטים עם תמונה מאושרת שמחכים להנפשה', 409);
  }
  const id = uid();
  const at = ctx.now().toISOString();
  const t = title(kind, stage, scope);
  ctx.db
    .prepare("INSERT INTO agent_tasks (id, project_id, kind, stage, scope, title, prompt, status, log, result, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', '', '', ?)")
    .run(id, projectId, kind, stage, scope, t, buildPrompt(ctx, projectId, kind, stage, scope, String(input.note ?? '').slice(0, 500)), at);
  emit(ctx, { projectId, type: 'project.progress', actor: 'אוהד', message: `▶ נשלח ל-Claude: ${t}`, payload: { agentTask: id } });
  return getTask(ctx, id);
}

export function getTask(ctx: Ctx, id: string) {
  const r = ctx.db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new NotFoundError('משימה');
  return map(r);
}

export function listTasks(ctx: Ctx, projectId: string) {
  return (ctx.db.prepare('SELECT * FROM agent_tasks WHERE project_id = ? ORDER BY requested_at DESC, rowid DESC LIMIT 20').all(projectId) as Row[]).map(map);
}

/** העובד במחשב: המשימה הבאה, עם ההוראות */
export function nextTask(ctx: Ctx) {
  const r = ctx.db.prepare("SELECT * FROM agent_tasks WHERE status = 'queued' ORDER BY requested_at, rowid LIMIT 1").get() as Row | undefined;
  if (!r) return null;
  ctx.db.prepare("UPDATE agent_tasks SET status = 'running', started_at = ? WHERE id = ?").run(ctx.now().toISOString(), r.id);
  return { ...map(r), status: 'running' as const, prompt: r.prompt };
}

export function reportTask(ctx: Ctx, id: string, body: { status?: string; log?: string; result?: string }) {
  const t = getTask(ctx, id);
  if (t.status === 'cancelled') return t;
  const status = body.status === 'done' || body.status === 'failed' ? body.status : t.status;
  const finished = status === 'done' || status === 'failed' ? ctx.now().toISOString() : null;
  ctx.db
    .prepare('UPDATE agent_tasks SET status = ?, log = ?, result = ?, finished_at = COALESCE(?, finished_at) WHERE id = ?')
    .run(status, String(body.log ?? t.log).slice(-4000), String(body.result ?? t.result).slice(0, 4000), finished, id);
  if (finished) {
    emit(ctx, {
      projectId: t.projectId,
      type: 'project.progress',
      actor: 'Claude',
      message: `${status === 'done' ? '✓' : '✗'} ${t.title}: ${String(body.result ?? '').slice(0, 300)}`,
      payload: { agentTask: id, status },
    });
  }
  return getTask(ctx, id);
}

export function cancelTask(ctx: Ctx, id: string) {
  const t = getTask(ctx, id);
  if (t.status === 'queued' || t.status === 'running')
    ctx.db.prepare("UPDATE agent_tasks SET status = 'cancelled', finished_at = ? WHERE id = ?").run(ctx.now().toISOString(), id);
  return getTask(ctx, id);
}
