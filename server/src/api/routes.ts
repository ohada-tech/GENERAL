import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { GateError, NotFoundError, type Ctx } from '../context.js';
import { now, tx, uid } from '../db/db.js';
import {
  currentStoryboard,
  getAssetRow,
  getProject,
  listApprovals,
  listAssets,
  listAttempts,
  listComments,
  listEvents,
  listJobs,
  listRefsForStoryboard,
  listScripts,
  listShots,
  listStoryboards,
  mapNotification,
} from '../db/repo.js';
import { describeProviders } from '../providers/registry.js';
import { dashboard, projectState } from '../services/views.js';
import * as secrets from '../services/secrets.js';
import * as time from '../services/time.js';
import * as cmd from '../workflow/commands.js';
import { emit } from '../workflow/events.js';

type Body = Record<string, any>;

export async function registerRoutes(app: FastifyInstance, ctx: Ctx) {
  const mustProject = (id: string) => {
    const p = getProject(ctx.db, id);
    if (!p) throw new NotFoundError('פרויקט');
    return p;
  };

  app.get('/api/health', async () => ({
    ok: true,
    owner: ctx.config.ownerName,
    openai: { ...secrets.openaiStatus(ctx.config), defaultModel: ctx.config.openai.model },
    providers: describeProviders(ctx.providers),
  }));

  app.get('/api/dashboard', async () => dashboard(ctx));

  /* ---------- projects ---------- */
  app.post('/api/projects', async (req, reply) => {
    const b = (req.body ?? {}) as Body;
    const p = cmd.createProject(ctx, { name: b.name, clientName: b.clientName ?? '', settings: b.settings });
    reply.code(201);
    return p;
  });

  app.get('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const project = mustProject(id);
    return {
      project,
      state: projectState(ctx, project),
      approvals: listApprovals(ctx.db, id),
      assets: listAssets(ctx.db, id),
    };
  });

  app.patch('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    return cmd.updateProject(ctx, id, (req.body ?? {}) as Body);
  });

  app.post('/api/projects/:id/pipeline', async (req) => {
    const { id } = req.params as { id: string };
    const { action } = (req.body ?? {}) as Body;
    if (!['pause', 'resume', 'stop'].includes(action)) throw new GateError('פעולה לא חוקית', 400);
    return cmd.setPipelineState(ctx, id, action);
  });

  /* ---------- brief ---------- */
  app.put('/api/projects/:id/brief', async (req) => {
    const { id } = req.params as { id: string };
    return cmd.updateBrief(ctx, id, ((req.body ?? {}) as Body).brief ?? {});
  });
  app.post('/api/projects/:id/brief/complete', async (req) => cmd.completeBrief(ctx, (req.params as any).id));
  app.post('/api/projects/:id/brief/reopen', async (req) => cmd.reopenBrief(ctx, (req.params as any).id));

  /* ---------- script ---------- */
  app.get('/api/projects/:id/scripts', async (req) => {
    const { id } = req.params as { id: string };
    mustProject(id);
    const versions = listScripts(ctx.db, id);
    const approvals = listApprovals(ctx.db, id).filter((a) => a.subjectType === 'script_version');
    const comments = Object.fromEntries(versions.map((v) => [v.id, listComments(ctx.db, 'script_version', v.id)]));
    return { versions, approvals, comments };
  });
  app.post('/api/projects/:id/scripts/generate', async (req) => cmd.requestScriptGeneration(ctx, (req.params as any).id));
  app.post('/api/projects/:id/scripts', async (req, reply) => {
    const b = (req.body ?? {}) as Body;
    reply.code(201);
    return cmd.saveScriptVersion(ctx, (req.params as any).id, b as any);
  });
  app.post('/api/scripts/:vid/revise', async (req) =>
    cmd.requestScriptRevision(ctx, (req.params as any).vid, ((req.body ?? {}) as Body).feedback),
  );
  app.post('/api/scripts/:vid/approve-internal', async (req) =>
    cmd.approveScriptInternal(ctx, (req.params as any).vid, ((req.body ?? {}) as Body).note ?? ''),
  );
  app.post('/api/scripts/:vid/client-approval', async (req) =>
    cmd.recordClientApproval(ctx, (req.params as any).vid, (req.body ?? {}) as any),
  );
  app.post('/api/scripts/:vid/request-changes', async (req) =>
    cmd.requestScriptChanges(ctx, (req.params as any).vid, (req.body ?? {}) as any),
  );
  app.post('/api/projects/:id/comments', async (req, reply) => {
    const b = (req.body ?? {}) as Body;
    reply.code(201);
    return { id: cmd.addComment(ctx, (req.params as any).id, b.subjectType, b.subjectId, b.text) };
  });

  /* ---------- storyboard ---------- */
  app.get('/api/projects/:id/storyboard', async (req) => {
    const { id } = req.params as { id: string };
    mustProject(id);
    const q = req.query as { version?: string };
    const versions = listStoryboards(ctx.db, id);
    const storyboard = q.version ? (versions.find((v) => String(v.version) === q.version) ?? null) : currentStoryboard(ctx.db, id);
    return {
      versions,
      storyboard,
      shots: storyboard ? listShots(ctx.db, storyboard.id) : [],
      references: storyboard ? listRefsForStoryboard(ctx.db, storyboard.id) : [],
    };
  });
  app.post('/api/projects/:id/storyboard/generate', async (req) =>
    cmd.requestStoryboardGeneration(ctx, (req.params as any).id),
  );
  app.post('/api/projects/:id/storyboard/approve', async (req) =>
    cmd.approveStoryboard(ctx, (req.params as any).id, ((req.body ?? {}) as Body).note ?? ''),
  );
  app.post('/api/projects/:id/storyboard/reopen', async (req) => cmd.reopenStoryboard(ctx, (req.params as any).id));
  app.post('/api/projects/:id/shots', async (req, reply) => {
    reply.code(201);
    return cmd.addShot(ctx, (req.params as any).id, req.body ?? {});
  });
  app.patch('/api/shots/:sid', async (req) => cmd.updateShot(ctx, (req.params as any).sid, req.body ?? {}));
  app.delete('/api/shots/:sid', async (req, reply) => {
    cmd.deleteShot(ctx, (req.params as any).sid);
    reply.code(204);
  });
  app.post('/api/shots/:sid/move', async (req) =>
    cmd.moveShot(ctx, (req.params as any).sid, ((req.body ?? {}) as Body).direction === 'up' ? 'up' : 'down'),
  );
  app.post('/api/shots/:sid/approve', async (req) => cmd.setShotApproval(ctx, (req.params as any).sid, 'approved'));
  app.post('/api/shots/:sid/request-revision', async (req) =>
    cmd.setShotApproval(ctx, (req.params as any).sid, 'needs_revision', ((req.body ?? {}) as Body).note ?? ''),
  );

  /* ---------- references ---------- */
  app.post('/api/shots/:sid/references', async (req, reply) => {
    reply.code(201);
    return cmd.addReference(ctx, (req.params as any).sid, req.body ?? {});
  });
  app.patch('/api/references/:rid', async (req) => cmd.updateReference(ctx, (req.params as any).rid, req.body ?? {}));
  app.delete('/api/references/:rid', async (req, reply) => {
    cmd.deleteReference(ctx, (req.params as any).rid);
    reply.code(204);
  });

  /* ---------- jobs / events / blockers ---------- */
  app.get('/api/projects/:id/jobs', async (req) => {
    const { id } = req.params as { id: string };
    mustProject(id);
    return listJobs(ctx.db, id, 100).map((j) => ({ ...j, attemptLog: listAttempts(ctx.db, j.id) }));
  });
  app.post('/api/jobs/:jid/retry', async (req) => cmd.retryJob(ctx, (req.params as any).jid));
  app.post('/api/jobs/:jid/cancel', async (req) => cmd.cancelJob(ctx, (req.params as any).jid));

  app.get('/api/projects/:id/events', async (req) => {
    const { id } = req.params as { id: string };
    mustProject(id);
    return listEvents(ctx.db, id, 300);
  });

  app.post('/api/projects/:id/blockers', async (req, reply) => {
    reply.code(201);
    return { id: cmd.addBlocker(ctx, (req.params as any).id, (req.body ?? {}) as any) };
  });
  app.post('/api/blockers/:bid/resolve', async (req) => {
    cmd.resolveBlocker(ctx, (req.params as any).bid);
    return { ok: true };
  });

  /* ---------- notifications ---------- */
  app.get('/api/notifications', async (req) => {
    const q = req.query as { unread?: string; limit?: string };
    const limit = Math.min(Number(q.limit) || 50, 200);
    const rows = ctx.db
      .prepare(
        `SELECT * FROM notifications ${q.unread === '1' ? 'WHERE read_at IS NULL' : ''} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(limit);
    return rows.map((r) => mapNotification(r as any));
  });
  app.post('/api/notifications/:nid/read', async (req) => {
    ctx.db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL').run(now(), (req.params as any).nid);
    return { ok: true };
  });
  app.post('/api/notifications/read-all', async () => {
    ctx.db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(now());
    return { ok: true };
  });

  /* ---------- assets (קבצים) ---------- */
  app.post('/api/projects/:id/assets', async (req, reply) => {
    const { id } = req.params as { id: string };
    mustProject(id);
    const file = await req.file();
    if (!file) throw new GateError('לא נשלח קובץ', 400);
    const kind = String((req.query as any).kind ?? 'file');
    const assetId = uid();
    const dir = path.join(ctx.config.dataDir, 'uploads', id);
    fs.mkdirSync(dir, { recursive: true });
    const safe = file.filename.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120);
    const stored = path.join(dir, `${assetId}-${safe}`);
    await pipeline(file.file, fs.createWriteStream(stored));
    if (file.file.truncated) {
      fs.rmSync(stored, { force: true });
      throw new GateError('הקובץ גדול מהמותר', 413);
    }
    const size = fs.statSync(stored).size;
    tx(ctx.db, () => {
      ctx.db
        .prepare(
          'INSERT INTO assets (id, project_id, filename, stored_path, mime, size, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(assetId, id, file.filename, stored, file.mimetype, size, kind, now());
      emit(ctx, {
        projectId: id,
        type: 'asset.uploaded',
        actor: ctx.config.ownerName,
        message: `הועלה קובץ: ${file.filename}`,
        payload: { assetId, kind },
      });
    });
    reply.code(201);
    return { id: assetId, filename: file.filename, mime: file.mimetype, size, kind };
  });

  app.get('/api/assets/:aid/file', async (req, reply) => {
    const row = getAssetRow(ctx.db, (req.params as any).aid);
    if (!row || !fs.existsSync(row.stored_path)) throw new NotFoundError('קובץ');
    reply.header('Content-Type', row.mime);
    reply.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
    return reply.send(fs.createReadStream(row.stored_path));
  });

  /* ---------- זמן עבודה ---------- */
  app.get('/api/time/running', async () => ({ running: time.runningTimer(ctx) }));
  app.post('/api/time/stop', async (req) => time.stopTimer(ctx, ((req.body ?? {}) as Body).note));
  app.get('/api/projects/:id/time', async (req) => {
    const { id } = req.params as { id: string };
    mustProject(id);
    return { summary: time.timeSummary(ctx, id), entries: time.listEntries(ctx, id) };
  });
  app.post('/api/projects/:id/time/start', async (req) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as Body;
    // ברירת מחדל: השלב הנוכחי של הפרויקט
    const stage = b.stage || projectState(ctx, mustProject(id)).currentStage;
    return time.startTimer(ctx, id, { stage, note: b.note });
  });
  app.post('/api/projects/:id/time', async (req, reply) => {
    reply.code(201);
    return time.addManualEntry(ctx, (req.params as any).id, req.body ?? {});
  });
  app.patch('/api/time/:tid', async (req) => time.updateEntry(ctx, (req.params as any).tid, req.body ?? {}));
  app.delete('/api/time/:tid', async (req, reply) => {
    time.deleteEntry(ctx, (req.params as any).tid);
    reply.code(204);
  });

  /* ---------- חיבור OpenAI מתוך הממשק (המפתח נשאר בשרת) ---------- */
  app.get('/api/settings/openai', async () => secrets.openaiStatus(ctx.config));
  app.post('/api/settings/openai', async (req, reply) => {
    const b = (req.body ?? {}) as Body;
    const r = await secrets.saveOpenAI(ctx, { apiKey: b.apiKey, model: b.model });
    if (!r.ok) reply.code(422);
    return r.ok ? r.status : { error: r.error, status: r.status };
  });
  app.post('/api/settings/openai/test', async () => secrets.testOpenAI(ctx));
  app.delete('/api/settings/openai', async () => secrets.clearOpenAI(ctx));
}
