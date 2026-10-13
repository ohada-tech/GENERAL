/** שכבת גישה לנתונים: מיפוי שורות SQLite לטיפוסי הדומיין. ללא לוגיקה עסקית. */
import {
  briefSchema,
  projectSettingsSchema,
  scriptContentSchema,
  shotFieldsSchema,
  type Approval,
  type Asset,
  type Blocker,
  type Comment,
  type Job,
  type JobAttempt,
  type Notification,
  type Project,
  type ProjectEvent,
  type Reference,
  type ScriptVersion,
  type Shot,
  type Storyboard,
} from '@apos/shared';
import { parse, type DB } from './db.js';
import type { Media, MediaKind } from '@apos/shared';

type Row = Record<string, any>;

export const mapProject = (r: Row): Project => ({
  id: r.id,
  name: r.name,
  clientName: r.client_name,
  brief: briefSchema.parse(parse(r.brief, {})),
  briefCompletedAt: r.brief_completed_at ?? null,
  settings: projectSettingsSchema.parse(parse(r.settings, {})),
  pipelineState: r.pipeline_state,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const mapScript = (r: Row): ScriptVersion => ({
  id: r.id,
  projectId: r.project_id,
  version: r.version,
  parentId: r.parent_id ?? null,
  source: r.source,
  provider: r.provider ?? null,
  model: r.model ?? null,
  status: r.status,
  content: scriptContentSchema.parse(parse(r.content, {})),
  changeNote: r.change_note,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export const mapStoryboard = (r: Row): Storyboard => ({
  id: r.id,
  projectId: r.project_id,
  version: r.version,
  scriptVersionId: r.script_version_id,
  source: r.source,
  provider: r.provider ?? null,
  model: r.model ?? null,
  status: r.status,
  createdAt: r.created_at,
  approvedAt: r.approved_at ?? null,
  approvedBy: r.approved_by ?? null,
});

export const mapShot = (r: Row): Shot => ({
  ...shotFieldsSchema.parse(parse(r.fields, {})),
  id: r.id,
  storyboardId: r.storyboard_id,
  projectId: r.project_id,
  number: r.number,
  approval: r.approval,
  revisionNote: r.revision_note,
  previewAssetId: r.preview_asset_id ?? null,
  updatedAt: r.updated_at,
});

export const mapRef = (r: Row): Reference => ({
  id: r.id,
  projectId: r.project_id,
  shotId: r.shot_id,
  url: r.url,
  imageUrl: r.image_url,
  platform: r.platform,
  category: r.category,
  description: r.description,
  status: r.status,
  verification: r.verification,
  matchScore: r.match_score ?? null,
  qualityScore: r.quality_score ?? null,
  rightsNote: r.rights_note,
  origin: r.origin,
  createdAt: r.created_at,
});

export const mapJob = (r: Row): Job => ({
  id: r.id,
  projectId: r.project_id,
  type: r.type,
  status: r.status,
  mode: r.mode,
  payload: parse(r.payload, {}),
  result: parse(r.result, null),
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  lastError: r.last_error ?? null,
  idempotencyKey: r.idempotency_key,
  triggeredBy: r.triggered_by ?? null,
  runAfter: r.run_after,
  startedAt: r.started_at ?? null,
  finishedAt: r.finished_at ?? null,
  heartbeatAt: r.heartbeat_at ?? null,
  createdAt: r.created_at,
});

export const mapAttempt = (r: Row): JobAttempt => ({
  id: r.id,
  jobId: r.job_id,
  attempt: r.attempt,
  startedAt: r.started_at,
  finishedAt: r.finished_at ?? null,
  ok: r.ok === null || r.ok === undefined ? null : Boolean(r.ok),
  error: r.error ?? null,
});

export const mapEvent = (r: Row): ProjectEvent => ({
  id: r.id,
  projectId: r.project_id ?? null,
  type: r.type,
  actor: r.actor,
  message: r.message,
  payload: parse(r.payload, {}),
  createdAt: r.created_at,
});

export const mapNotification = (r: Row): Notification => ({
  id: r.id,
  projectId: r.project_id ?? null,
  kind: r.kind,
  title: r.title,
  body: r.body,
  link: r.link,
  readAt: r.read_at ?? null,
  createdAt: r.created_at,
});

export const mapBlocker = (r: Row): Blocker => ({
  id: r.id,
  projectId: r.project_id,
  stage: r.stage,
  reason: r.reason,
  source: r.source,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at ?? null,
});

export const mapApproval = (r: Row): Approval => ({
  id: r.id,
  projectId: r.project_id,
  subjectType: r.subject_type,
  subjectId: r.subject_id,
  kind: r.kind,
  decision: r.decision,
  by: r.by,
  note: r.note,
  createdAt: r.created_at,
});

export const mapComment = (r: Row): Comment => ({
  id: r.id,
  projectId: r.project_id,
  subjectType: r.subject_type,
  subjectId: r.subject_id,
  author: r.author,
  text: r.text,
  createdAt: r.created_at,
});

export const mapAsset = (r: Row): Asset => ({
  id: r.id,
  projectId: r.project_id,
  filename: r.filename,
  mime: r.mime,
  size: r.size,
  kind: r.kind,
  createdAt: r.created_at,
});

/* ---------- queries ---------- */

export const getProject = (db: DB, id: string) => {
  const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
  return r ? mapProject(r) : null;
};

export const listProjects = (db: DB) =>
  (db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as Row[]).map(mapProject);

export const listScripts = (db: DB, projectId: string) =>
  (db.prepare('SELECT * FROM script_versions WHERE project_id = ? ORDER BY version DESC').all(projectId) as Row[]).map(
    mapScript,
  );

export const getScript = (db: DB, id: string) => {
  const r = db.prepare('SELECT * FROM script_versions WHERE id = ?').get(id) as Row | undefined;
  return r ? mapScript(r) : null;
};

export const listStoryboards = (db: DB, projectId: string) =>
  (db.prepare('SELECT * FROM storyboards WHERE project_id = ? ORDER BY version DESC').all(projectId) as Row[]).map(
    mapStoryboard,
  );

export const getStoryboard = (db: DB, id: string) => {
  const r = db.prepare('SELECT * FROM storyboards WHERE id = ?').get(id) as Row | undefined;
  return r ? mapStoryboard(r) : null;
};

/** הסטורי בורד הנוכחי = הגרסה האחרונה שלא הוחלפה */
export const currentStoryboard = (db: DB, projectId: string) => {
  const r = db
    .prepare("SELECT * FROM storyboards WHERE project_id = ? AND status != 'superseded' ORDER BY version DESC LIMIT 1")
    .get(projectId) as Row | undefined;
  return r ? mapStoryboard(r) : null;
};

export const listShots = (db: DB, storyboardId: string) =>
  (db.prepare('SELECT * FROM shots WHERE storyboard_id = ? ORDER BY number').all(storyboardId) as Row[]).map(mapShot);

export const getShot = (db: DB, id: string) => {
  const r = db.prepare('SELECT * FROM shots WHERE id = ?').get(id) as Row | undefined;
  return r ? mapShot(r) : null;
};

export const listRefsForStoryboard = (db: DB, storyboardId: string) =>
  (
    db
      .prepare(
        'SELECT r.* FROM refs r JOIN shots s ON s.id = r.shot_id WHERE s.storyboard_id = ? ORDER BY r.created_at',
      )
      .all(storyboardId) as Row[]
  ).map(mapRef);

export const getRef = (db: DB, id: string) => {
  const r = db.prepare('SELECT * FROM refs WHERE id = ?').get(id) as Row | undefined;
  return r ? mapRef(r) : null;
};

export const listJobs = (db: DB, projectId: string, limit = 50) =>
  (
    db.prepare('SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?').all(projectId, limit) as Row[]
  ).map(mapJob);

export const getJob = (db: DB, id: string) => {
  const r = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined;
  return r ? mapJob(r) : null;
};

export const listAttempts = (db: DB, jobId: string) =>
  (db.prepare('SELECT * FROM job_attempts WHERE job_id = ? ORDER BY attempt').all(jobId) as Row[]).map(mapAttempt);

export const listEvents = (db: DB, projectId: string, limit = 200) =>
  (
    db
      .prepare('SELECT * FROM events WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(projectId, limit) as Row[]
  ).map(mapEvent);

export const lastEventAt = (db: DB, projectId: string): string | null => {
  const r = db.prepare('SELECT MAX(created_at) AS t FROM events WHERE project_id = ?').get(projectId) as Row;
  return r?.t ?? null;
};

export const openBlockers = (db: DB, projectId: string) =>
  (
    db
      .prepare('SELECT * FROM blockers WHERE project_id = ? AND resolved_at IS NULL ORDER BY created_at')
      .all(projectId) as Row[]
  ).map(mapBlocker);

export const listApprovals = (db: DB, projectId: string) =>
  (db.prepare('SELECT * FROM approvals WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as Row[]).map(
    mapApproval,
  );

export const listComments = (db: DB, subjectType: string, subjectId: string) =>
  (
    db
      .prepare('SELECT * FROM comments WHERE subject_type = ? AND subject_id = ? ORDER BY created_at')
      .all(subjectType, subjectId) as Row[]
  ).map(mapComment);

export const listAssets = (db: DB, projectId: string) =>
  (db.prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as Row[]).map(
    mapAsset,
  );

export const getAssetRow = (db: DB, id: string) =>
  db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Row | undefined;

export const mapMedia = (r: Row): Media => ({
  id: r.id,
  projectId: r.project_id,
  shotId: r.shot_id ?? null,
  kind: r.kind,
  version: r.version,
  status: r.status,
  provider: r.provider,
  model: r.model,
  prompt: r.prompt,
  params: parse(r.params, {}),
  assetId: r.asset_id ?? null,
  mime: r.mime ?? null,
  durationSec: r.duration_sec ?? null,
  costCredits: r.cost_credits ?? null,
  error: r.error ?? null,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const MEDIA_SELECT = 'SELECT m.*, a.mime AS mime FROM media m LEFT JOIN assets a ON a.id = m.asset_id';

export const getMedia = (db: DB, id: string) => {
  const r = db.prepare(`${MEDIA_SELECT} WHERE m.id = ?`).get(id);
  return r ? mapMedia(r as Row) : null;
};

/** כל תוצרי המדיה של הפרויקט (מהחדש לישן) */
export const listMedia = (db: DB, projectId: string, kind?: MediaKind) =>
  (kind
    ? db.prepare(`${MEDIA_SELECT} WHERE m.project_id = ? AND m.kind = ? ORDER BY m.created_at DESC, m.version DESC`).all(projectId, kind)
    : db.prepare(`${MEDIA_SELECT} WHERE m.project_id = ? ORDER BY m.created_at DESC, m.version DESC`).all(projectId)
  ).map((r) => mapMedia(r as Row));

export interface StageGate {
  stage: string;
  startedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  note: string;
}

export const listGates = (db: DB, projectId: string): Record<string, StageGate> =>
  Object.fromEntries(
    (db.prepare('SELECT * FROM stage_gates WHERE project_id = ?').all(projectId) as Row[]).map((r) => [
      r.stage,
      { stage: r.stage, startedAt: r.started_at ?? null, approvedAt: r.approved_at ?? null, approvedBy: r.approved_by ?? null, note: r.note },
    ]),
  );
