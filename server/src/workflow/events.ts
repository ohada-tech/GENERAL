/**
 * Event bus: כל שינוי משמעותי נרשם כ-Event (היסטוריית פעילות),
 * ואז מופעלים הכללים (rules) שמתרגמים אירועים למשימות ולהתראות.
 * הכל רץ בתוך אותה טרנזקציה של הפקודה שיצרה את האירוע.
 */
import type { ProjectEvent } from '@apos/shared';
import type { Ctx } from '../context.js';
import { json, uid } from '../db/db.js';
import { applyRules } from './rules.js';

export interface EmitInput {
  projectId: string | null;
  type: string;
  actor: string;
  message: string;
  payload?: Record<string, unknown>;
}

/** אירועים שאינם נחשבים "התקדמות" לצורך זיהוי פרויקט תקוע */
const NON_PROGRESS = new Set(['project.stalled', 'job.retry_scheduled', 'job.failed']);

export function emit(ctx: Ctx, e: EmitInput): ProjectEvent {
  const event: ProjectEvent = {
    id: uid(),
    projectId: e.projectId,
    type: e.type,
    actor: e.actor,
    message: e.message,
    payload: e.payload ?? {},
    createdAt: ctx.now().toISOString(),
  };
  ctx.db
    .prepare('INSERT INTO events (id, project_id, type, actor, message, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(event.id, event.projectId, event.type, event.actor, event.message, json(event.payload), event.createdAt);

  if (event.projectId && !NON_PROGRESS.has(event.type)) {
    ctx.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(event.createdAt, event.projectId);
    // התקדמות חדשה מסירה חסם "פרויקט תקוע"
    ctx.db
      .prepare("UPDATE blockers SET resolved_at = ? WHERE project_id = ? AND source = 'stalled' AND resolved_at IS NULL")
      .run(event.createdAt, event.projectId);
  }

  applyRules(ctx, event);
  return event;
}
