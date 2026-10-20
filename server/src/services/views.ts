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
import { trackedTotals } from './time.js';
import { lastProgressUpdate } from './progress.js';
import { lastShareFor } from './share.js';
import { productionOverview } from '../workflow/production.js';

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
    production: productionSummary(ctx, project.id),
  });
}

function productionSummary(ctx: Ctx, projectId: string) {
  const o = productionOverview(ctx, projectId);
  return {
    kieConfigured: o.kieConfigured,
    generator: o.generator,
    stages: o.stages.map((s) => ({
      stage: s.stage,
      approved: !!s.gate?.approvedAt,
      items: s.items.map((it) => it.media?.status ?? null),
      pendingUsd: s.pendingEstimate.usd,
    })),
  };
}

export function dashboard(ctx: Ctx): DashboardData {
  const time = trackedTotals(ctx);
  const projects: ProjectSummary[] = listProjects(ctx.db).map((p) => ({
    id: p.id,
    name: p.name,
    clientName: p.clientName,
    dueDate: p.brief.dueDate,
    updatedAt: p.updatedAt,
    state: projectState(ctx, p),
    trackedSec: time.byProject[p.id] ?? 0,
    cover: projectCover(ctx, p.id),
    lastUpdate: lastProgressUpdate(ctx, p.id),
    lastShare: lastShareFor(ctx, p.id),
  }));
  const unread = ctx.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL').get() as { n: number };
  return { projects, unreadNotifications: Number(unread.n), weekTrackedSec: time.weekSec };
}

/** תמונת שער: הפריים הראשון בסטורי בורד (מאושר קודם), ואם אין — תמונה שהועלתה לשוט */
function projectCover(ctx: Ctx, projectId: string): ProjectSummary['cover'] {
  const m = ctx.db
    .prepare(
      `SELECT m.id FROM media m LEFT JOIN shots s ON s.id = m.shot_id
       WHERE m.project_id = ? AND m.kind = 'frame' AND m.status IN ('approved', 'ready') AND m.asset_id IS NOT NULL
       ORDER BY (m.status = 'approved') DESC, s.number ASC, m.version DESC LIMIT 1`,
    )
    .get(projectId) as { id: string } | undefined;
  if (m) return { mediaId: m.id };
  const a = ctx.db
    .prepare('SELECT preview_asset_id AS id FROM shots WHERE project_id = ? AND preview_asset_id IS NOT NULL ORDER BY number ASC LIMIT 1')
    .get(projectId) as { id: string } | undefined;
  return a ? { assetId: a.id } : null;
}

export function isProjectCompleted(ctx: Ctx, projectId: string) {
  const p = listProjects(ctx.db).find((x) => x.id === projectId);
  return p ? projectState(ctx, p).overallStatus === 'completed' : true;
}
