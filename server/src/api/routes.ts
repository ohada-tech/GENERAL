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
import * as learning from '../services/learning.js';
import * as knowledge from '../services/knowledge.js';
import * as time from '../services/time.js';
import * as cmd from '../workflow/commands.js';
import { emit } from '../workflow/events.js';
import * as prod from '../workflow/production.js';
import { importProjects } from '../workflow/import.js';
import { getMedia } from '../db/repo.js';

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
    keys: secrets.allKeyStatus(ctx.config),
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

  app.post('/api/import', async (req) => importProjects(ctx, req.body ?? {}));

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
  app.put('/api/scripts/:vid', async (req) => {
    const b = (req.body ?? {}) as { content?: unknown; changeNote?: string };
    return cmd.updateScriptVersion(ctx, (req.params as any).vid, { content: b.content, changeNote: b.changeNote });
  });
  app.post('/api/scripts/:vid/improve', async (req) => {
    const b = (req.body ?? {}) as { by?: string; note?: string };
    return cmd.requestScriptImprove(ctx, (req.params as any).vid, b.by ?? 'openai', b.note ?? '');
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

  /* ---------- הפקה אוטומטית 05–09 ---------- */
  const mustStage = (v: string) => {
    if (!(prod.PRODUCTION_STAGES as readonly string[]).includes(v)) throw new GateError('שלב לא מוכר', 400);
    return v as prod.ProductionStage;
  };
  app.get('/api/projects/:id/production', async (req) => prod.productionOverview(ctx, (req.params as any).id));
  app.post('/api/projects/:id/production/:stage/start', async (req) =>
    prod.startStage(ctx, (req.params as any).id, mustStage((req.params as any).stage)),
  );
  app.post('/api/projects/:id/production/:stage/approve', async (req) =>
    prod.approveStage(ctx, (req.params as any).id, mustStage((req.params as any).stage), ((req.body ?? {}) as Body).note ?? ''),
  );
  app.post('/api/projects/:id/production/:stage/reopen', async (req) =>
    prod.reopenStage(ctx, (req.params as any).id, mustStage((req.params as any).stage)),
  );
  app.get('/api/projects/:id/production/requests', async (req) => prod.externalRequests(ctx, (req.params as any).id));
  // העלאת תוצר שנוצר מחוץ למערכת (Higgsfield / ידני) — קובץ
  app.post('/api/projects/:id/media/upload', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const file = await req.file();
    if (!file) throw new GateError('לא נשלח קובץ', 400);
    const data = await file.toBuffer();
    reply.code(201);
    return prod.addExternalMedia(ctx, (req.params as any).id, {
      kind: q.kind as any,
      shotId: q.shotId || null,
      data,
      mime: file.mimetype,
      filename: file.filename,
      model: q.model,
      prompt: q.prompt,
      source: q.source || 'manual',
      hfCredits: q.hfCredits ? Number(q.hfCredits) : null,
      note: q.note,
    });
  });
  // אותו דבר מקישור (למשל rawUrl מ-Higgsfield) — השרת מוריד בעצמו
  app.post('/api/projects/:id/media/from-url', async (req, reply) => {
    const b = (req.body ?? {}) as Body;
    const url = String(b.url ?? '');
    if (!/^https:\/\//.test(url)) throw new GateError('נדרש קישור https', 400);
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    } catch (e) {
      throw new GateError(`ההורדה נכשלה: ${e instanceof Error ? e.message : String(e)}`, 502);
    }
    if (!res.ok) throw new GateError(`ההורדה נכשלה (${res.status})`, 502);
    const size = Number(res.headers.get('content-length') ?? 0);
    if (size > 400 * 1024 * 1024) throw new GateError('הקובץ גדול מדי', 413);
    const data = Buffer.from(await res.arrayBuffer());
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'file');
    reply.code(201);
    return prod.addExternalMedia(ctx, (req.params as any).id, {
      kind: b.kind,
      shotId: b.shotId ?? null,
      data,
      mime: res.headers.get('content-type')?.split(';')[0] || 'application/octet-stream',
      filename: name,
      model: b.model,
      prompt: b.prompt,
      source: b.source || 'higgsfield-unlimited',
      hfCredits: b.hfCredits ?? null,
      sourceUrl: url,
      note: b.note,
    });
  });
  app.post('/api/media/:mid/approve', async (req) => prod.setItemApproval(ctx, (req.params as any).mid, true));
  app.post('/api/media/:mid/unapprove', async (req) => prod.setItemApproval(ctx, (req.params as any).mid, false));
  app.post('/api/media/:mid/regenerate', async (req) =>
    prod.regenerateItem(ctx, (req.params as any).mid, String(((req.body ?? {}) as Body).feedback ?? '')),
  );
  app.get('/api/media/:mid/file', async (req, reply) => {
    const m = getMedia(ctx.db, (req.params as any).mid);
    const row = m?.assetId ? getAssetRow(ctx.db, m.assetId) : null;
    if (!row || !fs.existsSync(row.stored_path)) throw new NotFoundError('קובץ');
    const size = fs.statSync(row.stored_path).size;
    const download = (req.query as any).download === '1';
    const project = getProject(ctx.db, m!.projectId);
    const name = download ? `${project?.name ?? 'video'}-${m!.kind}-v${m!.version}${path.extname(row.stored_path)}` : row.filename;
    reply.header('Content-Type', row.mime);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`);
    // Range — כדי שאפשר יהיה לדלג בנגן הווידאו
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        reply.code(416).header('Content-Range', `bytes */${size}`);
        return reply.send();
      }
      reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1);
      return reply.send(fs.createReadStream(row.stored_path, { start, end }));
    }
    reply.header('Content-Length', size);
    return reply.send(fs.createReadStream(row.stored_path));
  });

  /* ---------- מפתחות API (OpenAI / Anthropic / KIE) — נשמרים בשרת בלבד ---------- */
  const mustService = (v: string) => {
    if (!(secrets.KEY_SERVICES as string[]).includes(v)) throw new GateError('שירות לא מוכר', 400);
    return v as secrets.KeyService;
  };
  // למידה: מה המערכת למדה מההערות שלך ושל הלקוחות
  app.get('/api/lessons', async () => ({
    lessons: learning.listLessons(ctx),
    feedback: learning.recentFeedback(ctx, 60),
    pending: learning.pendingFeedbackCount(ctx),
    distillEvery: learning.DISTILL_EVERY,
    firstPass: learning.firstPassStats(ctx),
    clients: (ctx.db.prepare("SELECT DISTINCT client_name AS c FROM projects WHERE client_name != '' ORDER BY client_name").all() as Array<{ c: string }>).map((r) => r.c),
  }));
  app.post('/api/lessons', async (req) => {
    const b = (req.body ?? {}) as { scope?: string; area?: string; text?: string };
    if (!b.text?.trim()) throw new GateError('יש לכתוב את הכלל', 400);
    return learning.addLesson(ctx, { scope: b.scope, area: b.area, text: b.text });
  });
  app.patch('/api/lessons/:lid', async (req) => {
    const b = (req.body ?? {}) as { text?: string; active?: boolean };
    const l = learning.updateLesson(ctx, (req.params as any).lid, b);
    if (!l) throw new NotFoundError('כלל');
    return l;
  });
  app.delete('/api/lessons/:lid', async (req) => {
    learning.deleteLesson(ctx, (req.params as any).lid);
    return { ok: true };
  });
  app.post('/api/lessons/distill', async () => {
    const job = tx(ctx.db, () => learning.maybeDistill(ctx, null, true));
    if (!job) throw new GateError('אין הערות חדשות ללמוד מהן');
    return { jobId: job.id };
  });

  // ספר הידע: הסקילים שלימדת את Claude
  const skillSummary = ({ body, ...s }: knowledge.Skill) => ({ ...s, bodyChars: body.length });
  app.get('/api/skills', async () => ({ skills: knowledge.listSkills(ctx).map(skillSummary) }));
  app.get('/api/skills/:sid', async (req) => {
    const s = knowledge.getSkill(ctx, (req.params as any).sid);
    if (!s) throw new NotFoundError('סקיל');
    return s;
  });
  /** סקיל אחד: קובץ SKILL.md גולמי ({md}) או שדות מפורשים */
  app.post('/api/skills', async (req) => {
    const b = (req.body ?? {}) as Record<string, any>;
    const input = typeof b.md === 'string' ? { ...knowledge.parseSkillMd(b.md, b.name), ...(b.clients ? { clients: b.clients } : {}), source: 'manual' } : b;
    const s = knowledge.upsertSkill(ctx, input as knowledge.SkillInput);
    void knowledge.digestPending(ctx);
    return skillSummary(s);
  });
  app.post('/api/skills/import', async (req) => {
    const list = ((req.body ?? {}) as { skills?: unknown[] }).skills;
    if (!Array.isArray(list) || !list.length) throw new GateError('אין סקילים לייבוא', 400);
    const out = list.map((x) => skillSummary(knowledge.upsertSkill(ctx, x as knowledge.SkillInput)));
    void knowledge.digestPending(ctx);
    return { imported: out.length, skills: out };
  });
  app.patch('/api/skills/:sid', async (req) => {
    const s = knowledge.updateSkill(ctx, (req.params as any).sid, (req.body ?? {}) as any);
    if (!s) throw new NotFoundError('סקיל');
    return skillSummary(s);
  });
  app.post('/api/skills/:sid/redigest', async (req) => {
    knowledge.redigest(ctx, (req.params as any).sid);
    return { ok: true };
  });
  app.delete('/api/skills/:sid', async (req) => {
    knowledge.deleteSkill(ctx, (req.params as any).sid);
    return { ok: true };
  });

  app.get('/api/settings/keys', async () => secrets.allKeyStatus(ctx.config));
  app.get('/api/elevenlabs/voices', async () => {
    if (!ctx.providers.voice?.isConfigured()) return { connected: false, voices: [] };
    return { connected: true, voices: await ctx.providers.voice.voices() };
  });
  app.post('/api/settings/keys/:service', async (req, reply) => {
    const b = (req.body ?? {}) as Body;
    const r = await secrets.saveKey(ctx, mustService((req.params as any).service), { apiKey: b.apiKey, model: b.model });
    if (!r.ok) reply.code(422);
    return r.ok ? r.status : { error: r.error, status: r.status };
  });
  app.post('/api/settings/keys/:service/test', async (req) => secrets.testKey(ctx, mustService((req.params as any).service)));
  app.delete('/api/settings/keys/:service', async (req) => secrets.clearKey(ctx, mustService((req.params as any).service)));

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
