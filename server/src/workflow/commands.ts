import { resolveAttention } from '../services/attention.js';
/**
 * פקודות (Commands): כל פעולה של המשתמש עוברת כאן.
 * כל פקודה בודקת את נקודות האישור (Gates) לפני שהיא משנה מצב, ורושמת Event.
 */
import {
  BRIEF_FIELD_LABELS,
  briefSchema,
  detectPlatform,
  projectSettingsSchema,
  referenceInputSchema,
  referencePatchSchema,
  scriptContentSchema,
  shotFieldsSchema,
  shotPatchSchema,
  STAGE_KEYS,
  validateBrief,
  versionLabel,
  type Brief,
  type ProjectSettings,
  type StageKey,
} from '@apos/shared';
import { z } from 'zod';
import { clientScope, recordFeedback } from '../services/learning.js';
import { GateError, NotFoundError, type Ctx } from '../context.js';
import { json, tx, uid } from '../db/db.js';
import {
  currentStoryboard,
  getJob,
  getProject,
  getRef,
  getScript,
  getShot,
  getStoryboard,
  listScripts,
  nextScriptVersion,
  listShots,
} from '../db/repo.js';
import { emit } from './events.js';
import { enqueueJob } from './queue.js';

const ts = (ctx: Ctx) => ctx.now().toISOString();
const owner = (ctx: Ctx) => ctx.config.ownerName;

function mustProject(ctx: Ctx, id: string) {
  const p = getProject(ctx.db, id);
  if (!p) throw new NotFoundError('פרויקט');
  return p;
}

function recordApproval(
  ctx: Ctx,
  a: { projectId: string; subjectType: string; subjectId: string; kind: string; decision: string; by: string; note: string },
) {
  ctx.db
    .prepare(
      'INSERT INTO approvals (id, project_id, subject_type, subject_id, kind, decision, by, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(uid(), a.projectId, a.subjectType, a.subjectId, a.kind, a.decision, a.by, a.note, ts(ctx));
}

/* ---------------- Project ---------------- */

export function createProject(ctx: Ctx, input: { name: string; clientName: string; settings?: Partial<ProjectSettings> }) {
  const name = input.name?.trim();
  if (!name) throw new GateError('שם פרויקט הוא שדה חובה', 400);
  return tx(ctx.db, () => {
    const id = uid();
    const t = ts(ctx);
    const settings = projectSettingsSchema.parse(input.settings ?? {});
    ctx.db
      .prepare(
        'INSERT INTO projects (id, name, client_name, brief, settings, pipeline_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, name, input.clientName?.trim() ?? '', json(briefSchema.parse({})), json(settings), 'active', t, t);
    emit(ctx, { projectId: id, type: 'project.created', actor: owner(ctx), message: `נפתח פרויקט "${name}"` });
    return getProject(ctx.db, id)!;
  });
}

export function updateProject(
  ctx: Ctx,
  id: string,
  input: { name?: string; clientName?: string; settings?: Partial<ProjectSettings> },
) {
  const p = mustProject(ctx, id);
  return tx(ctx.db, () => {
    const settings = projectSettingsSchema.parse({ ...p.settings, ...(input.settings ?? {}) });
    const name = input.name?.trim() || p.name;
    const clientName = input.clientName !== undefined ? input.clientName.trim() : p.clientName;
    ctx.db
      .prepare('UPDATE projects SET name = ?, client_name = ?, settings = ? WHERE id = ?')
      .run(name, clientName, json(settings), id);
    // שינוי שם לקוח: הכללים וההערות שנלמדו על הלקוח עוברים לשם החדש (כשאין עוד פרויקט עם השם הישן)
    if (p.clientName.trim() && clientName && clientName !== p.clientName.trim()) {
      const others = ctx.db.prepare('SELECT 1 FROM projects WHERE client_name = ? AND id != ? LIMIT 1').get(p.clientName, id);
      if (!others) {
        ctx.db.prepare('UPDATE lessons SET scope = ? WHERE scope = ?').run(clientScope(clientName), clientScope(p.clientName));
        ctx.db.prepare('UPDATE feedback SET client = ? WHERE client = ?').run(clientName, p.clientName);
      }
    }
    const changed = Object.keys(input.settings ?? {});
    emit(ctx, {
      projectId: id,
      type: 'project.updated',
      actor: owner(ctx),
      message: changed.length ? `עודכנו הגדרות הפרויקט (${changed.join(', ')})` : 'עודכנו פרטי הפרויקט',
      payload: { settings: input.settings ?? null },
    });
    return getProject(ctx.db, id)!;
  });
}

export function setPipelineState(ctx: Ctx, id: string, action: 'pause' | 'resume' | 'stop') {
  const p = mustProject(ctx, id);
  const next = action === 'pause' ? 'paused' : action === 'stop' ? 'stopped' : 'active';
  if (p.pipelineState === next) return p;
  return tx(ctx.db, () => {
    ctx.db.prepare('UPDATE projects SET pipeline_state = ? WHERE id = ?').run(next, id);
    let cancelled = 0;
    if (action === 'stop') {
      const res = ctx.db
        .prepare(
          "UPDATE jobs SET status = 'cancelled', finished_at = ?, last_error = 'Pipeline נעצר' WHERE project_id = ? AND status IN ('queued','running')",
        )
        .run(ts(ctx), id);
      cancelled = Number(res.changes);
    }
    const label = { pause: 'הושהה', resume: 'הופעל מחדש', stop: 'נעצר' }[action];
    emit(ctx, {
      projectId: id,
      type: `pipeline.${action}`,
      actor: owner(ctx),
      message: `ה-Pipeline ${label}${cancelled ? ` (${cancelled} משימות בוטלו)` : ''}`,
    });
    return getProject(ctx.db, id)!;
  });
}

/* ---------------- Brief ---------------- */

/**
 * base = הערכים שהטופס ראה לפני העריכה. שדה שהשתנה בשרת מאז (למשל במילוי אוטומטי)
 * ושהשמירה הייתה דורסת בערך אחר — 409 עם האפיון העדכני, במקום למחוק בשקט.
 */
export function updateBrief(ctx: Ctx, id: string, patch: Partial<Brief>, opts: { by?: string; note?: string; base?: Partial<Brief> } = {}) {
  const p = mustProject(ctx, id);
  if (opts.base) {
    const cur = p.brief as Record<string, unknown>;
    const base = briefSchema.parse({ ...p.brief, ...opts.base }) as Record<string, unknown>;
    const next = briefSchema.parse({ ...p.brief, ...patch }) as Record<string, unknown>;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const conflicts = Object.keys(patch).filter((k) => k in opts.base! && !same(cur[k], base[k]) && !same(cur[k], next[k]));
    if (conflicts.length) {
      const labels = conflicts.map((k) => BRIEF_FIELD_LABELS[k as keyof Brief] ?? k).join(', ');
      const many = conflicts.length > 1;
      const msg = `${many ? 'השדות' : 'השדה'} ${labels} ${many ? 'עודכנו' : 'עודכן'} בינתיים במערכת ולא ${many ? 'נשמרו' : 'נשמר'}. שאר הטופס רוענן; הערך שלך נשאר — שמור שוב כדי להחליף את הערך החדש.`;
      throw new GateError(msg, 409, {
        conflicts,
        brief: p.brief,
      });
    }
  }
  const brief = briefSchema.parse({ ...p.brief, ...patch });
  // שדה שאוהד שינה בעצמו כבר לא "מולא על ידי AI"
  if (!('aiFilled' in patch)) {
    const changed = Object.keys(patch).filter((k) => JSON.stringify((p.brief as Record<string, unknown>)[k]) !== JSON.stringify((brief as Record<string, unknown>)[k]));
    brief.aiFilled = brief.aiFilled.filter((k) => !changed.includes(k));
  }
  return tx(ctx.db, () => {
    ctx.db.prepare('UPDATE projects SET brief = ? WHERE id = ?').run(json(brief), id);
    emit(ctx, {
      projectId: id,
      type: 'brief.updated',
      actor: opts.by ?? owner(ctx),
      message: opts.note ?? (p.briefCompletedAt ? 'האפיון עודכן לאחר שסומן כמוכן' : 'האפיון עודכן'),
      payload: { fields: Object.keys(patch) },
    });
    return getProject(ctx.db, id)!;
  });
}

export function completeBrief(ctx: Ctx, id: string) {
  const p = mustProject(ctx, id);
  if (p.briefCompletedAt) throw new GateError('האפיון כבר סומן כמוכן');
  const v = validateBrief(p.brief);
  if (!v.complete) {
    throw new GateError(`חסרים שדות חובה באפיון: ${v.missingRequired.map((m) => m.label).join(', ')}`, 422);
  }
  return tx(ctx.db, () => {
    ctx.db.prepare('UPDATE projects SET brief_completed_at = ? WHERE id = ?').run(ts(ctx), id);
    emit(ctx, { projectId: id, type: 'brief.completed', actor: owner(ctx), message: 'האפיון סומן כמוכן' });
    return getProject(ctx.db, id)!;
  });
}

export function reopenBrief(ctx: Ctx, id: string) {
  const p = mustProject(ctx, id);
  if (!p.briefCompletedAt) return p;
  return tx(ctx.db, () => {
    ctx.db.prepare('UPDATE projects SET brief_completed_at = NULL WHERE id = ?').run(id);
    emit(ctx, { projectId: id, type: 'brief.reopened', actor: owner(ctx), message: 'האפיון נפתח מחדש לעריכה' });
    return getProject(ctx.db, id)!;
  });
}

/* ---------------- Script ---------------- */

function requireBriefComplete(ctx: Ctx, projectId: string) {
  const p = mustProject(ctx, projectId);
  if (!p.briefCompletedAt) throw new GateError('יש להשלים ולסמן את האפיון כמוכן לפני עבודה על התסריט');
  if (p.pipelineState === 'stopped') throw new GateError('ה-Pipeline עצור. הפעל אותו מחדש כדי להריץ משימות.');
  return p;
}

/** הרצה (חוזרת) של יצירת תסריט — לא מוחקת גרסאות קודמות. */
export function requestScriptGeneration(ctx: Ctx, projectId: string) {
  requireBriefComplete(ctx, projectId);
  return tx(ctx.db, () =>
    enqueueJob(ctx, {
      projectId,
      type: 'script.generate',
      idempotencyKey: `script.generate:manual:${uid()}`,
      actor: owner(ctx),
    }),
  );
}

export function requestScriptRevision(ctx: Ctx, versionId: string, feedback: string) {
  const v = getScript(ctx.db, versionId);
  if (!v) throw new NotFoundError('גרסת תסריט');
  requireBriefComplete(ctx, v.projectId);
  if (!feedback?.trim()) throw new GateError('יש לכתוב משוב לתיקון', 400);
  return tx(ctx.db, () => {
    recordFeedback(ctx, v.projectId, 'script', feedback);
    return enqueueJob(ctx, {
      projectId: v.projectId,
      type: 'script.revise',
      payload: { baseVersionId: versionId, feedback: feedback.trim() },
      idempotencyKey: `script.revise:${versionId}:${uid()}`,
      actor: owner(ctx),
    });
  });
}

/**
 * "נמסר ללקוח": הסרטון נשלח והלקוח אישר — גם כשההפקה נעשתה מחוץ למערכת (סשן Claude, קאפקאט).
 * מסמן את כל השלבים כהושלמו בלי להפעיל אוטומציות (לא יוצר סטורי בורד, לא מריץ משימות). ניתן לביטול.
 */
export function markDelivered(ctx: Ctx, projectId: string, input: { note?: string; by?: string } = {}) {
  const p = mustProject(ctx, projectId);
  const note = String(input.note ?? '').trim().slice(0, 300);
  const by = String(input.by ?? '').trim().slice(0, 40) || owner(ctx);
  const at = ctx.now().toISOString();
  return tx(ctx.db, () => {
    ctx.db.prepare('UPDATE projects SET delivered_at = ?, delivered_note = ?, updated_at = ? WHERE id = ?').run(at, note, at, projectId);
    // נמסר — אין יותר מה לחכות לו בפרויקט הזה
    resolveAttention(ctx, { projectId });
    emit(ctx, { projectId, type: 'project.progress', actor: by, message: `✅ נמסר ללקוח והסרטון אושר${note ? `: ${note}` : ''}`, payload: { by, delivered: true } });
    return { ...p, deliveredAt: at, deliveredNote: note };
  });
}

export function unmarkDelivered(ctx: Ctx, projectId: string) {
  mustProject(ctx, projectId);
  const at = ctx.now().toISOString();
  ctx.db.prepare("UPDATE projects SET delivered_at = NULL, delivered_note = '', updated_at = ? WHERE id = ?").run(at, projectId);
  emit(ctx, { projectId, type: 'project.progress', actor: owner(ctx), message: 'בוטל הסימון "נמסר ללקוח"', payload: { delivered: false } });
  return { ok: true };
}

/** "כתוב מחדש": תסריט חדש מהעובדות ומהכיוון (עם QA), בלי לשמר את הנוסח והמבנה של הגרסה החלשה */
export function requestScriptRewrite(ctx: Ctx, versionId: string, note: string) {
  const v = getScript(ctx.db, versionId);
  if (!v) throw new NotFoundError('גרסת תסריט');
  requireBriefComplete(ctx, v.projectId);
  return tx(ctx.db, () => {
    if (note.trim()) recordFeedback(ctx, v.projectId, 'script', note);
    return enqueueJob(ctx, {
      projectId: v.projectId,
      type: 'script.revise',
      payload: { baseVersionId: versionId, feedback: note.trim(), mode: 'rewrite' },
      idempotencyKey: `script.rewrite:${versionId}:${uid()}`,
      actor: owner(ctx),
    });
  });
}

/** "שפר עם ChatGPT/Claude": מודל אחד עובר על הגרסה ומחזיר גרסה משופרת (הערה אופציונלית מכוונת אותו) */
export function requestScriptImprove(ctx: Ctx, versionId: string, by: string, note = '', doc?: { name?: string; text?: string }) {
  const v = getScript(ctx.db, versionId);
  if (!v) throw new NotFoundError('גרסת תסריט');
  requireBriefComplete(ctx, v.projectId);
  if (by !== 'openai' && by !== 'claude') throw new GateError('יש לבחור ChatGPT או Claude', 400);
  return tx(ctx.db, () => {
    if (note.trim()) recordFeedback(ctx, v.projectId, 'script', note);
    return enqueueJob(ctx, {
      projectId: v.projectId,
      type: 'script.revise',
      payload: {
        baseVersionId: versionId,
        feedback: note.trim(),
        improveBy: by,
        ...(doc?.text?.trim() ? { docName: String(doc.name ?? 'מסמך').slice(0, 200), docText: doc.text.slice(0, 15_000) } : {}),
      },
      idempotencyKey: `script.improve:${versionId}:${uid()}`,
      actor: owner(ctx),
    });
  });
}

/** שמירת עריכה ידנית — תמיד כגרסה חדשה (היסטוריה נשמרת). */
export function saveScriptVersion(
  ctx: Ctx,
  projectId: string,
  input: { content: unknown; parentId?: string | null; changeNote?: string },
) {
  requireBriefComplete(ctx, projectId);
  const content = scriptContentSchema.parse(input.content);
  content.scenes = content.scenes.map((s) => ({ ...s, id: s.id || uid() }));
  if (input.parentId && !getScript(ctx.db, input.parentId)) throw new NotFoundError('גרסת בסיס');
  return tx(ctx.db, () => {
    const { version, major, minor } = nextScriptVersion(ctx.db, projectId, input.parentId ?? null, content);
    const label = versionLabel(major, minor);
    const id = uid();
    ctx.db
      .prepare(
        `INSERT INTO script_versions (id, project_id, version, major, minor, parent_id, source, provider, model, status, content, change_note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'manual', NULL, NULL, 'draft', ?, ?, ?, ?)`,
      )
      .run(id, projectId, version, major, minor, input.parentId ?? null, json(content), input.changeNote?.trim() ?? '', owner(ctx), ts(ctx));
    emit(ctx, {
      projectId,
      type: 'script.version_saved',
      actor: owner(ctx),
      message: `נשמרה גרסת תסריט v${label} (עריכה ידנית)${input.changeNote ? `: ${input.changeNote}` : ''}`,
      payload: { scriptVersionId: id, version, label },
    });
    return getScript(ctx.db, id)!;
  });
}

/**
 * "שמור" (בלי גרסה חדשה): מעדכן את הגרסה עצמה. גרסה שהלקוח אישר נעולה — רק גרסה חדשה.
 * גרסה שאושרה פנימית חוזרת לטיוטה, כי התוכן שאושר השתנה.
 */
export function updateScriptVersion(ctx: Ctx, versionId: string, input: { content: unknown; changeNote?: string }) {
  const v = getScript(ctx.db, versionId);
  if (!v) throw new NotFoundError('גרסת תסריט');
  if (v.status === 'client_approved') throw new GateError('הלקוח אישר את הגרסה הזו — שמור את השינויים כגרסה חדשה');
  const content = scriptContentSchema.parse(input.content);
  content.scenes = content.scenes.map((s) => ({ ...s, id: s.id || uid() }));
  const reset = v.status === 'internal_approved';
  return tx(ctx.db, () => {
    ctx.db
      .prepare(`UPDATE script_versions SET content = ?, change_note = ?, status = ? WHERE id = ?`)
      .run(json(content), input.changeNote?.trim() || v.changeNote, reset ? 'draft' : v.status, v.id);
    emit(ctx, {
      projectId: v.projectId,
      type: 'script.version_updated',
      actor: owner(ctx),
      message: `תסריט v${v.label} עודכן (עריכה ידנית)${reset ? ' · חזר לטיוטה — צריך לאשר שוב' : ''}`,
      payload: { scriptVersionId: v.id, version: v.version, label: v.label },
    });
    return getScript(ctx.db, v.id)!;
  });
}

function mustLatestScript(ctx: Ctx, versionId: string) {
  const v = getScript(ctx.db, versionId);
  if (!v) throw new NotFoundError('גרסת תסריט');
  const latest = listScripts(ctx.db, v.projectId)[0];
  if (latest?.id !== v.id) {
    throw new GateError(`ניתן לאשר רק את הגרסה האחרונה (v${latest?.label}). לשחזור גרסה ישנה שמור אותה כגרסה חדשה.`);
  }
  return v;
}

export function approveScriptInternal(ctx: Ctx, versionId: string, note = '') {
  const v = mustLatestScript(ctx, versionId);
  if (v.status !== 'draft' && v.status !== 'changes_requested') {
    throw new GateError('הגרסה כבר אושרה פנימית');
  }
  if (v.content.scenes.length === 0) throw new GateError('לא ניתן לאשר תסריט ללא סצנות');
  return tx(ctx.db, () => {
    ctx.db.prepare("UPDATE script_versions SET status = 'internal_approved' WHERE id = ?").run(v.id);
    recordApproval(ctx, {
      projectId: v.projectId,
      subjectType: 'script_version',
      subjectId: v.id,
      kind: 'internal',
      decision: 'approved',
      by: owner(ctx),
      note,
    });
    emit(ctx, {
      projectId: v.projectId,
      type: 'script.internal_approved',
      actor: owner(ctx),
      message: `תסריט v${v.label} אושר פנימית${note ? `: ${note}` : ''}`,
      payload: { scriptVersionId: v.id, version: v.version, label: v.label },
    });
    recordFeedback(ctx, v.projectId, 'script', note, 'approval');
    return getScript(ctx.db, v.id)!;
  });
}

/**
 * "בחר כסופי": כל גרסה יכולה להיבחר כגרסה הסופית. גרסה ישנה מועתקת לגרסה חדשה (ההיסטוריה נשמרת),
 * והגרסה הסופית מאושרת פנימית — משם ממשיכים כרגיל לאישור לקוח ולסטורי בורד.
 */
export function chooseFinalScript(ctx: Ctx, versionId: string) {
  const chosen = getScript(ctx.db, versionId);
  if (chosen) resolveAttention(ctx, { projectId: chosen.projectId, titlePrefix: '⏳ ChatGPT QA' });
  const v = getScript(ctx.db, versionId);
  if (!v) throw new NotFoundError('גרסת תסריט');
  const latest = listScripts(ctx.db, v.projectId)[0];
  if (latest.id === v.id && (v.status === 'internal_approved' || v.status === 'client_approved')) {
    throw new GateError('הגרסה הזו כבר הסופית');
  }
  return tx(ctx.db, () => {
    const target =
      latest.id === v.id
        ? v
        : saveScriptVersion(ctx, v.projectId, { content: v.content, parentId: v.id, changeNote: `נבחרה כסופית — זהה ל-v${v.label}` });
    return approveScriptInternal(ctx, target.id, `נבחרה כגרסה הסופית${target.id !== v.id ? ` (מ-v${v.label})` : ''}`);
  });
}

/** מחיקת גרסה = הסתרה מהרשימה (אפשר לשחזר). אסור: גרסה שהלקוח אישר, גרסה שיש עליה סטורי בורד, או הגרסה האחרונה שנשארה. */
export function deleteScriptVersion(ctx: Ctx, versionId: string) {
  const v = getScript(ctx.db, versionId);
  if (!v) throw new NotFoundError('גרסת תסריט');
  if (v.status === 'client_approved') throw new GateError('אי אפשר למחוק גרסה שהלקוח אישר');
  const sb = ctx.db.prepare('SELECT 1 FROM storyboards WHERE script_version_id = ? LIMIT 1').get(v.id);
  if (sb) throw new GateError('אי אפשר למחוק גרסה שנבנה עליה סטורי בורד');
  if (listScripts(ctx.db, v.projectId).length <= 1) throw new GateError('זו הגרסה היחידה — אי אפשר למחוק אותה');
  return tx(ctx.db, () => {
    ctx.db.prepare('UPDATE script_versions SET deleted_at = ? WHERE id = ?').run(ts(ctx), v.id);
    emit(ctx, { projectId: v.projectId, type: 'script.version_deleted', actor: owner(ctx), message: `נמחקה גרסת תסריט v${v.label}`, payload: { scriptVersionId: v.id, label: v.label } });
    return { deleted: v.id };
  });
}

export function restoreScriptVersion(ctx: Ctx, versionId: string) {
  const v = getScript(ctx.db, versionId);
  if (!v) throw new NotFoundError('גרסת תסריט');
  return tx(ctx.db, () => {
    ctx.db.prepare('UPDATE script_versions SET deleted_at = NULL WHERE id = ?').run(v.id);
    emit(ctx, { projectId: v.projectId, type: 'script.version_restored', actor: owner(ctx), message: `שוחזרה גרסת תסריט v${v.label}`, payload: { scriptVersionId: v.id, label: v.label } });
    return getScript(ctx.db, v.id)!;
  });
}

export function recordClientApproval(ctx: Ctx, versionId: string, input: { approvedBy: string; note?: string }) {
  const v = mustLatestScript(ctx, versionId);
  if (v.status !== 'internal_approved') {
    throw new GateError(
      v.status === 'client_approved' ? 'הלקוח כבר אישר גרסה זו' : 'יש לאשר את התסריט פנימית לפני סימון אישור לקוח',
    );
  }
  const by = input.approvedBy?.trim();
  if (!by) throw new GateError('יש לציין מי אישר מטעם הלקוח', 400);
  return tx(ctx.db, () => {
    ctx.db.prepare("UPDATE script_versions SET status = 'client_approved' WHERE id = ?").run(v.id);
    recordApproval(ctx, {
      projectId: v.projectId,
      subjectType: 'script_version',
      subjectId: v.id,
      kind: 'client',
      decision: 'approved',
      by: `${by} (נרשם ע"י ${owner(ctx)})`,
      note: input.note ?? '',
    });
    emit(ctx, {
      projectId: v.projectId,
      type: 'script.client_approved',
      actor: owner(ctx),
      message: `הלקוח (${by}) אישר את תסריט v${v.label}`,
      payload: { scriptVersionId: v.id, version: v.version, label: v.label, approvedBy: by },
    });
    recordFeedback(ctx, v.projectId, 'script', input.note ?? '', 'approval');
    return getScript(ctx.db, v.id)!;
  });
}

export function requestScriptChanges(ctx: Ctx, versionId: string, input: { from: 'internal' | 'client'; note: string; by?: string }) {
  const v = mustLatestScript(ctx, versionId);
  if (v.status === 'client_approved') throw new GateError('הגרסה אושרה ע"י הלקוח. לשינוי — שמור גרסה חדשה.');
  if (!input.note?.trim()) throw new GateError('יש לפרט אילו שינויים נדרשים', 400);
  return tx(ctx.db, () => {
    ctx.db.prepare("UPDATE script_versions SET status = 'changes_requested' WHERE id = ?").run(v.id);
    const by = input.from === 'client' ? `${input.by?.trim() || 'לקוח'} (נרשם ע"י ${owner(ctx)})` : owner(ctx);
    recordApproval(ctx, {
      projectId: v.projectId,
      subjectType: 'script_version',
      subjectId: v.id,
      kind: input.from,
      decision: 'changes_requested',
      by,
      note: input.note.trim(),
    });
    emit(ctx, {
      projectId: v.projectId,
      type: 'script.changes_requested',
      actor: owner(ctx),
      message: `נדרשים שינויים בתסריט v${v.label} (${input.from === 'client' ? 'לקוח' : 'פנימי'}): ${input.note.trim()}`,
      payload: { scriptVersionId: v.id, version: v.version, label: v.label, from: input.from },
    });
    recordFeedback(ctx, v.projectId, 'script', `${input.from === 'client' ? 'הלקוח: ' : ''}${input.note}`);
    return getScript(ctx.db, v.id)!;
  });
}

export function addComment(ctx: Ctx, projectId: string, subjectType: string, subjectId: string, text: string) {
  mustProject(ctx, projectId);
  if (!text?.trim()) throw new GateError('הערה ריקה', 400);
  return tx(ctx.db, () => {
    const id = uid();
    ctx.db
      .prepare(
        'INSERT INTO comments (id, project_id, subject_type, subject_id, author, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, projectId, subjectType, subjectId, owner(ctx), text.trim(), ts(ctx));
    emit(ctx, {
      projectId,
      type: 'comment.added',
      actor: owner(ctx),
      message: `הערה: ${text.trim().slice(0, 120)}`,
      payload: { subjectType, subjectId, commentId: id },
    });
    return id;
  });
}

/* ---------------- Storyboard ---------------- */

function latestClientApprovedScript(ctx: Ctx, projectId: string) {
  const latest = listScripts(ctx.db, projectId)[0];
  if (!latest || latest.status !== 'client_approved') return null;
  return latest;
}

export function requestStoryboardGeneration(ctx: Ctx, projectId: string) {
  const p = mustProject(ctx, projectId);
  if (p.pipelineState === 'stopped') throw new GateError('ה-Pipeline עצור. הפעל אותו מחדש כדי להריץ משימות.');
  const script = latestClientApprovedScript(ctx, projectId);
  if (!script) throw new GateError('יש לקבל אישור לקוח על הגרסה האחרונה של התסריט לפני יצירת סטורי בורד');
  return tx(ctx.db, () =>
    enqueueJob(ctx, {
      projectId,
      type: 'storyboard.generate',
      payload: { scriptVersionId: script.id },
      idempotencyKey: `storyboard.generate:manual:${uid()}`,
      actor: owner(ctx),
    }),
  );
}

function mustDraftStoryboardOfShot(ctx: Ctx, shotId: string) {
  const shot = getShot(ctx.db, shotId);
  if (!shot) throw new NotFoundError('שוט');
  const sb = getStoryboard(ctx.db, shot.storyboardId)!;
  if (sb.status === 'superseded') throw new GateError('זו גרסת סטורי בורד ישנה — לקריאה בלבד');
  if (sb.status === 'approved') throw new GateError('הסטורי בורד אושר. פתח אותו מחדש לעריכה.');
  return { shot, sb };
}

export function updateShot(ctx: Ctx, shotId: string, patch: unknown) {
  const { shot } = mustDraftStoryboardOfShot(ctx, shotId);
  const parsed = shotPatchSchema.parse(patch);
  const { previewAssetId, ...fieldPatch } = parsed;
  const contentChanged = Object.entries(fieldPatch).some(([k, val]) => (shot as any)[k] !== val);
  const fields = shotFieldsSchema.parse({ ...shot, ...fieldPatch });
  return tx(ctx.db, () => {
    // שינוי תוכן שוט מאושר מחזיר אותו לבדיקה — האישור תמיד משקף את התוכן הנוכחי
    const approval = contentChanged && shot.approval === 'approved' ? 'pending' : shot.approval;
    ctx.db
      .prepare('UPDATE shots SET fields = ?, approval = ?, preview_asset_id = ?, updated_at = ? WHERE id = ?')
      .run(
        json(fields),
        approval,
        previewAssetId !== undefined ? previewAssetId : shot.previewAssetId,
        ts(ctx),
        shotId,
      );
    emit(ctx, {
      projectId: shot.projectId,
      type: 'shot.updated',
      actor: owner(ctx),
      message: `שוט ${shot.number} עודכן${approval !== shot.approval ? ' (חזר לבדיקה)' : ''}`,
      payload: { shotId, fields: Object.keys(parsed) },
    });
    return getShot(ctx.db, shotId)!;
  });
}

export function addShot(ctx: Ctx, projectId: string, fields: unknown = {}) {
  const sb = currentStoryboard(ctx.db, projectId);
  if (!sb) throw new GateError('אין סטורי בורד פעיל');
  if (sb.status !== 'draft') throw new GateError('הסטורי בורד אושר. פתח אותו מחדש לעריכה.');
  const f = shotFieldsSchema.parse(fields);
  return tx(ctx.db, () => {
    const number = listShots(ctx.db, sb.id).length + 1;
    const id = uid();
    ctx.db
      .prepare(
        "INSERT INTO shots (id, storyboard_id, project_id, number, fields, approval, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      )
      .run(id, sb.id, projectId, number, json(f), ts(ctx));
    emit(ctx, { projectId, type: 'shot.added', actor: owner(ctx), message: `נוסף שוט ${number}`, payload: { shotId: id } });
    return getShot(ctx.db, id)!;
  });
}

function renumber(ctx: Ctx, storyboardId: string, orderedIds: string[]) {
  // שני שלבים כדי לא להתנגש במספרים קיימים
  const up = ctx.db.prepare('UPDATE shots SET number = ? WHERE id = ?');
  orderedIds.forEach((id, i) => up.run(-(i + 1), id));
  orderedIds.forEach((id, i) => up.run(i + 1, id));
}

export function deleteShot(ctx: Ctx, shotId: string) {
  const { shot, sb } = mustDraftStoryboardOfShot(ctx, shotId);
  return tx(ctx.db, () => {
    ctx.db.prepare('DELETE FROM shots WHERE id = ?').run(shotId);
    renumber(
      ctx,
      sb.id,
      listShots(ctx.db, sb.id).map((s) => s.id),
    );
    emit(ctx, {
      projectId: shot.projectId,
      type: 'shot.deleted',
      actor: owner(ctx),
      message: `שוט ${shot.number} נמחק`,
      payload: { shotId },
    });
  });
}

export function moveShot(ctx: Ctx, shotId: string, direction: 'up' | 'down') {
  const { shot, sb } = mustDraftStoryboardOfShot(ctx, shotId);
  const ids = listShots(ctx.db, sb.id).map((s) => s.id);
  const i = ids.indexOf(shotId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= ids.length) return getShot(ctx.db, shotId)!;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return tx(ctx.db, () => {
    renumber(ctx, sb.id, ids);
    emit(ctx, {
      projectId: shot.projectId,
      type: 'shot.moved',
      actor: owner(ctx),
      message: `שוט ${shot.number} הועבר למיקום ${j + 1}`,
      payload: { shotId },
    });
    return getShot(ctx.db, shotId)!;
  });
}

export function setShotApproval(ctx: Ctx, shotId: string, decision: 'approved' | 'needs_revision', note = '') {
  const { shot } = mustDraftStoryboardOfShot(ctx, shotId);
  if (decision === 'needs_revision' && !note.trim()) throw new GateError('יש לפרט מה צריך לתקן בשוט', 400);
  return tx(ctx.db, () => {
    ctx.db
      .prepare('UPDATE shots SET approval = ?, revision_note = ?, updated_at = ? WHERE id = ?')
      .run(decision, decision === 'needs_revision' ? note.trim() : '', ts(ctx), shotId);
    recordApproval(ctx, {
      projectId: shot.projectId,
      subjectType: 'shot',
      subjectId: shotId,
      kind: 'internal',
      decision: decision === 'approved' ? 'approved' : 'changes_requested',
      by: owner(ctx),
      note,
    });
    emit(ctx, {
      projectId: shot.projectId,
      type: decision === 'approved' ? 'shot.approved' : 'shot.revision_requested',
      actor: owner(ctx),
      message: decision === 'approved' ? `שוט ${shot.number} אושר` : `שוט ${shot.number} — נדרש תיקון: ${note.trim()}`,
      payload: { shotId },
    });
    recordFeedback(ctx, shot.projectId, 'storyboard', note, decision === 'approved' ? 'approval' : 'revision');
    return getShot(ctx.db, shotId)!;
  });
}

export function approveStoryboard(ctx: Ctx, projectId: string, note = '') {
  const sb = currentStoryboard(ctx.db, projectId);
  if (!sb) throw new GateError('אין סטורי בורד לאישור');
  if (sb.status === 'approved') throw new GateError('הסטורי בורד כבר אושר');
  const shots = listShots(ctx.db, sb.id);
  if (shots.length === 0) throw new GateError('אין שוטים בסטורי בורד');
  const notApproved = shots.filter((s) => s.approval !== 'approved');
  if (notApproved.length) {
    throw new GateError(`יש לאשר את כל השוטים לפני אישור הסטורי בורד (חסרים: ${notApproved.map((s) => s.number).join(', ')})`);
  }
  return tx(ctx.db, () => {
    ctx.db
      .prepare("UPDATE storyboards SET status = 'approved', approved_at = ?, approved_by = ? WHERE id = ?")
      .run(ts(ctx), owner(ctx), sb.id);
    recordApproval(ctx, {
      projectId,
      subjectType: 'storyboard',
      subjectId: sb.id,
      kind: 'internal',
      decision: 'approved',
      by: owner(ctx),
      note,
    });
    emit(ctx, {
      projectId,
      type: 'storyboard.approved',
      actor: owner(ctx),
      message: `סטורי בורד v${sb.version} אושר (${shots.length} שוטים)`,
      payload: { storyboardId: sb.id, version: sb.version },
    });
    recordFeedback(ctx, projectId, 'storyboard', note, 'approval');
    return getStoryboard(ctx.db, sb.id)!;
  });
}

export function reopenStoryboard(ctx: Ctx, projectId: string) {
  const sb = currentStoryboard(ctx.db, projectId);
  if (!sb || sb.status !== 'approved') throw new GateError('אין סטורי בורד מאושר לפתיחה מחדש');
  return tx(ctx.db, () => {
    ctx.db.prepare("UPDATE storyboards SET status = 'draft', approved_at = NULL, approved_by = NULL WHERE id = ?").run(sb.id);
    emit(ctx, {
      projectId,
      type: 'storyboard.reopened',
      actor: owner(ctx),
      message: `סטורי בורד v${sb.version} נפתח מחדש לעריכה`,
      payload: { storyboardId: sb.id },
    });
    return getStoryboard(ctx.db, sb.id)!;
  });
}

/* ---------------- References ---------------- */

/** רפרנסים ניתנים לניהול גם אחרי אישור הסטורי בורד (שלב 04), אך לא בגרסה שהוחלפה. */
function assertRefsEditable(ctx: Ctx, shotId: string) {
  const shot = getShot(ctx.db, shotId);
  if (!shot) throw new NotFoundError('שוט');
  if (getStoryboard(ctx.db, shot.storyboardId)?.status === 'superseded') {
    throw new GateError('זו גרסת סטורי בורד ישנה — לקריאה בלבד');
  }
  return shot;
}

export function addReference(ctx: Ctx, shotId: string, input: unknown) {
  const shot = assertRefsEditable(ctx, shotId);
  const r = referenceInputSchema.parse(input);
  return tx(ctx.db, () => {
    const id = uid();
    ctx.db
      .prepare(
        `INSERT INTO refs (id, project_id, shot_id, url, image_url, platform, category, description, status, verification, match_score, quality_score, rights_note, origin, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?, 'manual', ?)`,
      )
      .run(
        id,
        shot.projectId,
        shotId,
        r.url,
        r.imageUrl,
        detectPlatform(r.url),
        r.category,
        r.description,
        r.verification,
        r.matchScore,
        r.qualityScore,
        r.rightsNote,
        ts(ctx),
      );
    emit(ctx, {
      projectId: shot.projectId,
      type: 'reference.added',
      actor: owner(ctx),
      message: `נוסף רפרנס לשוט ${shot.number} (${detectPlatform(r.url)})`,
      payload: { referenceId: id, shotId },
    });
    return getRef(ctx.db, id)!;
  });
}

export function updateReference(ctx: Ctx, refId: string, patch: unknown) {
  const ref = getRef(ctx.db, refId);
  if (!ref) throw new NotFoundError('רפרנס');
  assertRefsEditable(ctx, ref.shotId);
  const p = referencePatchSchema.parse(patch);
  const next = { ...ref, ...p };
  if (p.url) next.platform = detectPlatform(p.url);
  return tx(ctx.db, () => {
    ctx.db
      .prepare(
        `UPDATE refs SET url = ?, image_url = ?, platform = ?, category = ?, description = ?, status = ?, verification = ?,
         match_score = ?, quality_score = ?, rights_note = ? WHERE id = ?`,
      )
      .run(
        next.url,
        next.imageUrl,
        next.platform,
        next.category,
        next.description,
        next.status,
        next.verification,
        next.matchScore,
        next.qualityScore,
        next.rightsNote,
        refId,
      );
    const shot = getShot(ctx.db, ref.shotId);
    const statusMsg = p.status && p.status !== ref.status ? { approved: 'אושר', rejected: 'נפסל', candidate: 'הוחזר למועמד' }[p.status] : null;
    emit(ctx, {
      projectId: ref.projectId,
      type: statusMsg ? `reference.${p.status}` : 'reference.updated',
      actor: owner(ctx),
      message: `רפרנס לשוט ${shot?.number ?? '?'} ${statusMsg ?? 'עודכן'}`,
      payload: { referenceId: refId, shotId: ref.shotId },
    });
    return getRef(ctx.db, refId)!;
  });
}

export function deleteReference(ctx: Ctx, refId: string) {
  const ref = getRef(ctx.db, refId);
  if (!ref) throw new NotFoundError('רפרנס');
  assertRefsEditable(ctx, ref.shotId);
  tx(ctx.db, () => {
    ctx.db.prepare('DELETE FROM refs WHERE id = ?').run(refId);
    emit(ctx, {
      projectId: ref.projectId,
      type: 'reference.deleted',
      actor: owner(ctx),
      message: 'רפרנס נמחק',
      payload: { referenceId: refId },
    });
  });
}

/* ---------------- Jobs & blockers ---------------- */

/** ניסיון חוזר ידני: יוצר משימה חדשה עם אותו payload — הלוג של הקודמת נשמר. */
export function retryJob(ctx: Ctx, jobId: string) {
  const job = getJob(ctx.db, jobId);
  if (!job) throw new NotFoundError('משימה');
  if (job.status !== 'failed' && job.status !== 'cancelled') throw new GateError('ניתן לנסות שוב רק משימה שנכשלה או בוטלה');
  const p = mustProject(ctx, job.projectId);
  if (p.pipelineState === 'stopped') throw new GateError('ה-Pipeline עצור. הפעל אותו מחדש קודם.');
  return tx(ctx.db, () =>
    enqueueJob(ctx, {
      projectId: job.projectId,
      type: job.type,
      payload: job.payload,
      idempotencyKey: `${job.idempotencyKey}:retry:${uid()}`,
      triggeredBy: job.id,
      actor: owner(ctx),
    }),
  );
}

export function cancelJob(ctx: Ctx, jobId: string) {
  const job = getJob(ctx.db, jobId);
  if (!job) throw new NotFoundError('משימה');
  if (job.status !== 'queued' && job.status !== 'running') throw new GateError('המשימה אינה פעילה');
  return tx(ctx.db, () => {
    ctx.db
      .prepare("UPDATE jobs SET status = 'cancelled', finished_at = ?, last_error = 'בוטלה ידנית' WHERE id = ?")
      .run(ts(ctx), jobId);
    emit(ctx, {
      projectId: job.projectId,
      type: 'job.cancelled',
      actor: owner(ctx),
      message: 'משימה בוטלה ידנית',
      payload: { jobId, jobType: job.type },
    });
    return getJob(ctx.db, jobId)!;
  });
}

const stageSchema = z.enum(STAGE_KEYS);

export function addBlocker(ctx: Ctx, projectId: string, input: { stage: StageKey; reason: string }) {
  mustProject(ctx, projectId);
  const stage = stageSchema.parse(input.stage);
  if (!input.reason?.trim()) throw new GateError('יש לפרט את סיבת החסימה', 400);
  return tx(ctx.db, () => {
    const id = uid();
    ctx.db
      .prepare(
        "INSERT INTO blockers (id, project_id, stage, reason, source, created_at) VALUES (?, ?, ?, ?, 'manual', ?)",
      )
      .run(id, projectId, stage, input.reason.trim(), ts(ctx));
    emit(ctx, {
      projectId,
      type: 'blocker.added',
      actor: owner(ctx),
      message: `נוסף חסם: ${input.reason.trim()}`,
      payload: { blockerId: id, stage },
    });
    return id;
  });
}

export function resolveBlocker(ctx: Ctx, blockerId: string) {
  const b = ctx.db.prepare('SELECT * FROM blockers WHERE id = ?').get(blockerId) as any;
  if (!b) throw new NotFoundError('חסם');
  if (b.resolved_at) return;
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE blockers SET resolved_at = ? WHERE id = ?').run(ts(ctx), blockerId);
    emit(ctx, {
      projectId: b.project_id,
      type: 'blocker.resolved',
      actor: owner(ctx),
      message: `חסם הוסר: ${b.reason}`,
      payload: { blockerId },
    });
  });
}
