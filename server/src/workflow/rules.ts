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
import { approveStage, latestMedia, nextStage, planStage, startStage, type ProductionStage } from './production.js';

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
      autoStart(ctx, projectId, 'images', `storyboard.approved:${p.storyboardId}`);
      return;
    }

    case 'stage.approved': {
      const next = nextStage(p.stage as ProductionStage);
      if (!next) {
        notify(ctx, {
          projectId,
          kind: 'success',
          title: 'הפרויקט נמסר 🎬',
          body: `${project.name}: הסרטון הסופי אושר ונמסר.`,
          link: `/projects/${projectId}/production`,
          dedupeKey: `delivered:${e.id}`,
        });
        return;
      }
      if (next === 'delivery') {
        notify(ctx, {
          projectId,
          kind: 'approval_needed',
          title: 'הסרטון הסופי מוכן ללקוח',
          body: `${project.name}: הורד את הסרטון, שלח ללקוח וסמן את אישורו כדי לסגור את הפרויקט.`,
          link: `/projects/${projectId}/production`,
          dedupeKey: `delivery.ready:${e.id}`,
        });
        return;
      }
      autoStart(ctx, projectId, next, `stage.approved:${e.id}`);
      return;
    }

    case 'media.ready': {
      // כשכל הפריטים בשלב מוכנים — התראה אחת לבדיקה ואישור
      const stage = STAGE_OF[p.kind as string];
      if (!stage) return;
      const { latest } = latestMedia(ctx, projectId);
      const items = planStage(ctx, project, stage).map((it) => latest.get(`${it.kind}:${it.shotId ?? ''}`));
      if (items.some((m) => !m || m.status === 'generating')) return;
      const failed = items.filter((m) => m?.status === 'failed').length;
      notify(ctx, {
        projectId,
        kind: failed ? 'warning' : 'approval_needed',
        title: failed ? `${STAGE_TITLE[stage]}: ${failed} פריטים נכשלו` : `${STAGE_TITLE[stage]} מוכן לבדיקה ואישור`,
        body: project.name,
        link: `/projects/${projectId}/production`,
        dedupeKey: `stage.ready:${stage}:${items.map((m) => m?.id).join(',')}`,
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

const STAGE_OF: Record<string, ProductionStage> = { frame: 'images', clip: 'animation', voiceover: 'audio', music: 'audio', final: 'editing' };
const STAGE_TITLE: Record<ProductionStage, string> = {
  images: 'התמונות',
  animation: 'ההנפשה',
  audio: 'הסאונד',
  editing: 'הסרטון הערוך',
  delivery: 'המסירה',
};

/** "המשך אוטומטי": אישור שלב מפעיל את הבא. כישלון (תקציב, מפתח חסר) לא מבטל את האישור — רק מתריע. */
function autoStart(ctx: Ctx, projectId: string, stage: ProductionStage, dedupe: string) {
  const project = getProject(ctx.db, projectId);
  if (!project || !project.settings.autoAdvance || project.pipelineState === 'stopped') return;
  if (stage === 'audio' && planStage(ctx, project, 'audio').length === 0) {
    // אין קריינות ואין מוזיקה — השלב מאושר אוטומטית והעריכה מתחילה
    approveStage(ctx, projectId, 'audio', 'אין קריינות/מוזיקה בפרויקט', SYSTEM);
    return;
  }
  try {
    startStage(ctx, projectId, stage, SYSTEM);
  } catch (err) {
    notify(ctx, {
      projectId,
      kind: 'warning',
      title: `השלב "${STAGE_TITLE[stage]}" לא הופעל אוטומטית`,
      body: `${project.name}: ${err instanceof Error ? err.message : String(err)}`,
      link: `/projects/${projectId}/production`,
      dedupeKey: `autostart:${stage}:${dedupe}`,
    });
  }
}
