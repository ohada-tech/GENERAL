/** הרכבת נתוני תצוגה (read models) ל-API. */
import type { DashboardData, Project, ProjectSummary } from '@apos/shared';
import type { Ctx } from '../context.js';
import {
  currentStoryboard,
  lastEventAt,
  listJobs,
  listProjects,
  listRefsForStoryboard,
  listScripts,
  listShots,
  openBlockers,
} from '../db/repo.js';
import { computeProjectState } from '../workflow/state.js';

export function projectState(ctx: Ctx, project: Project) {
  const storyboard = currentStoryboard(ctx.db, project.id);
  return computeProjectState({
    project,
    scripts: listScripts(ctx.db, project.id),
    storyboard,
    shots: storyboard ? listShots(ctx.db, storyboard.id) : [],
    refs: storyboard ? listRefsForStoryboard(ctx.db, storyboard.id) : [],
    jobs: listJobs(ctx.db, project.id, 20),
    blockers: openBlockers(ctx.db, project.id),
    lastActivityAt: lastEventAt(ctx.db, project.id),
  });
}

export function dashboard(ctx: Ctx): DashboardData {
  const projects: ProjectSummary[] = listProjects(ctx.db).map((p) => ({
    id: p.id,
    name: p.name,
    clientName: p.clientName,
    dueDate: p.brief.dueDate,
    updatedAt: p.updatedAt,
    state: projectState(ctx, p),
  }));
  const unread = ctx.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL').get() as { n: number };
  return { projects, unreadNotifications: Number(unread.n) };
}

export function isProjectCompleted(ctx: Ctx, projectId: string) {
  const p = listProjects(ctx.db).find((x) => x.id === projectId);
  return p ? projectState(ctx, p).overallStatus === 'completed' : true;
}
