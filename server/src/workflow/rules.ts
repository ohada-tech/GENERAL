/**
 * כללי אוטומציה: Event → Job / Notification.
 * כאן בלבד מוגדר "מה מפעיל מה". כל כלל מכבד את נקודות האישור:
 * משימה אוטומטית נוצרת רק אחרי אירוע אישור מפורש (השלמת אפיון / אישור לקוח).
 */
import { JOB_LABELS, type JobType, type ProjectEvent } from '@apos/shared';
import type { Ctx } from '../context.js';
import { getProject } from '../db/repo.js';
import { notify } from '../services/notifications.js';
import { enqueueJob } from './queue.js';

const SYSTEM = 'system';

export function applyRules(ctx: Ctx, e: ProjectEvent) {
  const projectId = e.projectId;
  if (!projectId) return;
  const project = getProject(ctx.db, projectId);
  if (!project) return;
  const p = e.payload as Record<string, any>;

  switch (e.type) {
    case 'brief.completed': {
      if (!project.settings.autoGenerateScript || project.pipelineState === 'stopped') return;
      const hasScript = ctx.db.prepare('SELECT 1 FROM script_versions WHERE project_id = ? LIMIT 1').get(projectId);
      if (hasScript) return; // יש כבר תסריט — הרצה חוזרת רק ביוזמה ידנית
      enqueueJob(ctx, {
        projectId,
        type: 'script.generate',
        idempotencyKey: `script.generate:event:${e.id}`,
        triggeredBy: e.id,
        actor: SYSTEM,
      });
      return;
    }

    case 'script.version_created': {
      notify(ctx, {
        projectId,
        kind: 'approval_needed',
        title: `טיוטת תסריט v${p.version} מוכנה לבדיקה`,
        body: `${project.name} — ${p.sourceLabel ?? ''}`.trim(),
        link: `/projects/${projectId}/script`,
        dedupeKey: `script.version_created:${p.scriptVersionId}`,
      });
      return;
    }

    case 'script.internal_approved': {
      notify(ctx, {
        projectId,
        kind: 'approval_needed',
        title: `תסריט v${p.version} אושר פנימית — ממתין לאישור לקוח`,
        body: `${project.name}: הצג ללקוח וסמן את אישורו במערכת.`,
        link: `/projects/${projectId}/script`,
        dedupeKey: `script.internal_approved:${p.scriptVersionId}`,
      });
      return;
    }

    case 'script.client_approved': {
      if (!project.settings.autoGenerateStoryboard || project.pipelineState === 'stopped') return;
      enqueueJob(ctx, {
        projectId,
        type: 'storyboard.generate',
        payload: { scriptVersionId: p.scriptVersionId },
        // סטורי בורד אוטומטי אחד לכל גרסת תסריט שאושרה
        idempotencyKey: `storyboard.generate:script:${p.scriptVersionId}`,
        triggeredBy: e.id,
        actor: SYSTEM,
      });
      return;
    }

    case 'storyboard.created': {
      notify(ctx, {
        projectId,
        kind: 'approval_needed',
        title: `סטורי בורד v${p.version} מוכן לבדיקה (${p.shotCount} שוטים)`,
        body: project.name,
        link: `/projects/${projectId}/storyboard`,
        dedupeKey: `storyboard.created:${p.storyboardId}`,
      });
      return;
    }

    case 'storyboard.approved': {
      notify(ctx, {
        projectId,
        kind: 'success',
        title: 'הסטורי בורד אושר',
        body: `${project.name}: שלב יצירת התמונות עדיין לא אוטומטי במערכת (Phase 3) — ניתן להמשיך ידנית עם הפרומפטים.`,
        link: `/projects/${projectId}/storyboard`,
        dedupeKey: `storyboard.approved:${p.storyboardId}`,
      });
      return;
    }

    case 'job.failed': {
      notify(ctx, {
        projectId,
        kind: 'error',
        title: `משימה נכשלה: ${JOB_LABELS[p.jobType as JobType] ?? p.jobType}`,
        body: `${project.name}: ${p.error ?? ''}`,
        link: `/projects/${projectId}/jobs`,
        dedupeKey: `job.failed:${p.jobId}`,
      });
      return;
    }

    case 'project.stalled': {
      notify(ctx, {
        projectId,
        kind: 'warning',
        title: 'פרויקט ללא התקדמות',
        body: `${project.name}: ${p.reason ?? ''}`,
        link: `/projects/${projectId}`,
        dedupeKey: `project.stalled:${p.blockerKey}`,
      });
      return;
    }
  }
}
