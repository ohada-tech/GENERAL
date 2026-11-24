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
  listDeletedScripts,
  listScripts,
  listShots,
  listStoryboards,
  mapNotification,
} from '../db/repo.js';
import { describeProviders } from '../providers/registry.js';
import { dashboard, projectCover, projectState } from '../services/views.js';
import { usageFor } from '../services/usage.js';
import { autoLogo, hideLogo } from '../services/logo.js';
import * as rev from '../services/revisions.js';
import * as hf from '../services/hf-runs.js';
import * as agent from '../services/agent-tasks.js';
import * as act from '../services/actions.js';
import * as secrets from '../services/secrets.js';
import * as learning from '../services/learning.js';
import * as knowledge from '../services/knowledge.js';
import * as time from '../services/time.js';
import * as cmd from '../workflow/commands.js';
import { emit } from '../workflow/events.js';
import * as prod from '../workflow/production.js';
import * as vo from '../workflow/voiceover.js';
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
      cover: projectCover(ctx, id, project.clientName),
      usage: usageFor(ctx, id),
      revisions: rev.listRevisions(ctx, id),
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
    const { brief, base } = (req.body ?? {}) as Body;
    return cmd.updateBrief(ctx, id, brief ?? {}, { base });
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
    return { versions, approvals, comments, deleted: listDeletedScripts(ctx.db, id).map((v) => ({ id: v.id, label: v.label, createdAt: v.createdAt, changeNote: v.changeNote })) };
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
    const b = (req.body ?? {}) as { by?: string; note?: string; doc?: { name?: string; text?: string } };
    return cmd.requestScriptImprove(ctx, (req.params as any).vid, b.by ?? 'openai', b.note ?? '', b.doc);
  });
  // "נמסר ללקוח" (גם כשההפקה נעשתה מחוץ למערכת) — וביטול
  app.post('/api/projects/:id/delivered', async (req) => {
    const b = (req.body ?? {}) as { note?: string; by?: string };
    return cmd.markDelivered(ctx, (req.params as any).id, b);
  });
  app.delete('/api/projects/:id/delivered', async (req) => cmd.unmarkDelivered(ctx, (req.params as any).id));
  // סבבי תיקונים אחרי מסירה
  app.get('/api/projects/:id/revisions', async (req) => rev.listRevisions(ctx, (req.params as any).id));
  app.post('/api/projects/:id/revisions', async (req, reply) => {
    const b = (req.body ?? {}) as { notes?: string; source?: string };
    reply.code(201);
    return rev.openRevision(ctx, (req.params as any).id, b);
  });
  app.post('/api/revisions/:rid/items', async (req) => rev.addRevisionItems(ctx, (req.params as any).rid, String(((req.body ?? {}) as { notes?: string }).notes ?? '')));
  app.post('/api/revisions/:rid/items/:i', async (req) =>
    rev.setRevisionItem(ctx, (req.params as any).rid, Number((req.params as any).i), Boolean(((req.body ?? {}) as { done?: boolean }).done)),
  );
  app.post('/api/revisions/:rid/close', async (req) => rev.closeRevision(ctx, (req.params as any).rid, String(((req.body ?? {}) as { note?: string }).note ?? '')));
  // מחיקת פרויקט ריק בלבד (נפתח בטעות)
  app.delete('/api/projects/:id', async (req) => cmd.deleteEmptyProject(ctx, (req.params as any).id));
  app.post('/api/scripts/:vid/rewrite', async (req) =>
    cmd.requestScriptRewrite(ctx, (req.params as any).vid, String(((req.body ?? {}) as { note?: string }).note ?? '')),
  );
  app.post('/api/scripts/:vid/revise', async (req) =>
    cmd.requestScriptRevision(ctx, (req.params as any).vid, ((req.body ?? {}) as Body).feedback),
  );
  app.delete('/api/scripts/:vid', async (req) => cmd.deleteScriptVersion(ctx, (req.params as any).vid));
  app.post('/api/scripts/:vid/restore', async (req) => cmd.restoreScriptVersion(ctx, (req.params as any).vid));
  app.post('/api/scripts/:vid/choose-final', async (req) => cmd.chooseFinalScript(ctx, (req.params as any).vid));
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
    const outdated = prod.outdatedFrameShots(ctx, id);
    return {
      versions,
      storyboard,
      shots: storyboard ? listShots(ctx.db, storyboard.id) : [],
      references: storyboard ? listRefsForStoryboard(ctx.db, storyboard.id) : [],
      // התמונה של כל שוט (הטייק המוצג בהפקה) — כדי שהסטורי בורד יראה תמונות ולא רק טקסט
      frames: Object.fromEntries(
        [...prod.latestMedia(ctx, id).latest.values()]
          .filter((m) => m.kind === 'frame' && m.shotId && m.assetId)
          // outdated: השוט שונה אחרי שהתמונה נוצרה — תמונה חדשה תיווצר ב"סגור עריכה"
          .map((m) => [m.shotId!, { mediaId: m.id, status: m.status, version: m.version, outdated: outdated.has(m.shotId!) }]),
      ),
      // שוטים ש-Claude מתקן עכשיו לפי ההערה
      fixing: [...cmd.activeShotFixes(ctx, id)],
      // נפתח לעריכה אחרי אישור: "סגור עריכה" משאיר את התמונות של שוטים שלא השתנו
      editingAfterApproval: prod.storyboardEditingAfterApproval(ctx, id),
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
  app.delete('/api/shots/:sid', async (req) => cmd.deleteShot(ctx, (req.params as any).sid));
  app.post('/api/shots/:sid/move', async (req) =>
    cmd.moveShot(ctx, (req.params as any).sid, ((req.body ?? {}) as Body).direction === 'up' ? 'up' : 'down'),
  );
  app.post('/api/projects/:id/shots/approve-all', async (req) => cmd.approveAllShots(ctx, (req.params as any).id));
  app.post('/api/shots/:sid/approve', async (req) => cmd.setShotApproval(ctx, (req.params as any).sid, 'approved'));
  // הערת תיקון על שוט: נשמרת, ו-Claude מתקן את השוט מיד ברקע (apply: false = רק לשמור)
  app.post('/api/shots/:sid/request-revision', async (req) => {
    const b = (req.body ?? {}) as Body;
    const r = cmd.requestShotFix(ctx, (req.params as any).sid, b.note ?? '', { apply: b.apply !== false });
    return { ...r.shot, fixJobId: r.jobId };
  });
  app.post('/api/projects/:id/shots/apply-fixes', async (req) => cmd.applyShotFixes(ctx, (req.params as any).id));

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
  const URGENT = "dedupe_key LIKE 'attention:%'";
  const NOT_URGENT = "(dedupe_key IS NULL OR dedupe_key NOT LIKE 'attention:%')";
  app.get('/api/notifications', async (req) => {
    const q = req.query as { unread?: string; limit?: string };
    const limit = Math.min(Number(q.limit) || 50, 200);
    const rows = ctx.db
      .prepare(
        // "מחכה לך" (סשן תקוע) מוצג בנפרד, לא בפעמון
        `SELECT * FROM notifications WHERE ${NOT_URGENT}${q.unread === '1' ? ' AND read_at IS NULL' : ''} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(limit);
    return rows.map((r) => mapNotification(r as any));
  });
  app.post('/api/notifications/:nid/read', async (req) => {
    ctx.db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL').run(now(), (req.params as any).nid);
    return { ok: true };
  });
  app.post('/api/notifications/read-all', async () => {
    ctx.db.prepare(`UPDATE notifications SET read_at = ? WHERE read_at IS NULL AND ${NOT_URGENT}`).run(now());
    return { ok: true };
  });

  /* ---------- "מחכה לך": הודעות דחופות — סשן שנעצר ומחכה לאוהד (נפרד מהפעמון) ---------- */
  app.get('/api/attention', async () => {
    const rows = ctx.db
      .prepare(`SELECT * FROM notifications WHERE ${URGENT} ORDER BY (read_at IS NULL) DESC, created_at DESC, rowid DESC LIMIT 30`)
      .all();
    return rows.map((r) => mapNotification(r as any));
  });
  app.post('/api/attention/:nid/done', async (req) => {
    ctx.db.prepare(`UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL AND ${URGENT}`).run(now(), (req.params as any).nid);
    return { ok: true };
  });

  /* ---------- assets (קבצים) ---------- */
  app.post('/api/projects/:id/assets', async (req, reply) => {
    const { id } = req.params as { id: string };
    mustProject(id);
    const file = await req.file();
    if (!file) throw new GateError('לא נשלח קובץ', 400);
    const kind = String((req.query as any).kind ?? 'file');
    if (kind === 'logo' && !String(file.mimetype).startsWith('image/')) throw new GateError('הלוגו צריך להיות קובץ תמונה (PNG, SVG, JPG, WEBP)', 400);
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

  /** ניסיון להביא את הלוגו של הלקוח מהאתר שלו (או מקישור ללוגו באפיון) — פעם אחת, בלי עלות */
  app.post('/api/projects/:id/logo/auto', async (req) => {
    const { id } = req.params as { id: string };
    mustProject(id);
    const assetId = await autoLogo(ctx, id, { force: !!((req.body ?? {}) as Body).force });
    return { assetId };
  });
  app.post('/api/projects/:id/logo/hide', async (req) => {
    const { id } = req.params as { id: string };
    mustProject(id);
    return { hidden: hideLogo(ctx, id) };
  });

  app.get('/api/assets/:aid/file', async (req, reply) => {
    const row = getAssetRow(ctx.db, (req.params as any).aid);
    if (!row || !fs.existsSync(row.stored_path)) throw new NotFoundError('קובץ');
    reply.header('Content-Type', row.mime);
    // SVG (למשל לוגו שהגיע מאתר) — בלי סקריפטים, גם אם פותחים אותו ישירות
    if (/svg/i.test(row.mime)) reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
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
  app.post('/api/projects/:id/production/:stage/done-externally', async (req) =>
    prod.markStageDoneExternally(ctx, (req.params as any).id, mustStage((req.params as any).stage), ((req.body ?? {}) as Body).note ?? ''),
  );
  app.post('/api/projects/:id/production/:stage/reopen', async (req) =>
    prod.reopenStage(ctx, (req.params as any).id, mustStage((req.params as any).stage)),
  );
  // שלב הקריינות (ElevenLabs) — מיד אחרי התסריט, בלי לחכות להנפשה
  app.get('/api/projects/:id/voiceover', async (req) => vo.voiceoverOverview(ctx, (req.params as any).id));
  app.post('/api/projects/:id/voiceover/generate', async (req, reply) => {
    const b = (req.body ?? {}) as { voiceId?: string; model?: string; note?: string };
    reply.code(201);
    return vo.generateVoiceover(ctx, (req.params as any).id, {
      voiceId: typeof b.voiceId === 'string' ? b.voiceId : undefined,
      model: typeof b.model === 'string' ? b.model : undefined,
      note: typeof b.note === 'string' ? b.note : undefined,
    });
  });
  app.get('/api/projects/:id/production/requests', async (req) => {
    const ids = String((req.query as { shotIds?: string }).shotIds ?? '').split(',').filter(Boolean);
    return prod.externalRequests(ctx, (req.params as any).id, ids.length ? { shotIds: ids } : {});
  });
  // הרצה בהיגספילד בלחיצה (מסלול קרדיטים): pilot = שוט אחד, all = כל מה שמחכה
  app.post('/api/projects/:id/production/:stage/hf-run', async (req, reply) => {
    const stage = (req.params as any).stage;
    if (stage !== 'images' && stage !== 'animation') throw new GateError('אפשר להריץ בהיגספילד רק תמונות או הנפשה', 400);
    const b = (req.body ?? {}) as { scope?: string; faces?: boolean; model?: string };
    const scope = b.scope === 'pilot' ? 'pilot' : 'all';
    reply.code(201);
    // faces: רק שוטי הפנים, בקרדיטים (גם כשהפרויקט על אנלימיטד), עם מודל ההנפשה שנבחר
    return hf.requestHfRun(ctx, (req.params as any).id, stage, scope, { faces: !!b.faces, model: typeof b.model === 'string' && b.model ? b.model : undefined });
  });
  // העובד המקומי (~/.apos/hf-worker.cjs)
  app.get('/api/hf/next', async (_req, reply) => {
    const r = hf.nextHfRun(ctx);
    if (!r) return reply.code(204).send();
    return r;
  });
  app.post('/api/hf/runs/:rid', async (req) => hf.reportHfRun(ctx, (req.params as any).rid, (req.body ?? {}) as { done?: number; status?: string; error?: string }));
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
      variant: !!b.variant,
    });
  });
  app.post('/api/media/:mid/approve', async (req) => prod.setItemApproval(ctx, (req.params as any).mid, true));
  // השוואת טייקים, תיקון נקודתי ווריאציות — בלחיצה
  app.get('/api/media/:mid/versions', async (req) => prod.mediaVersions(ctx, (req.params as any).mid));
  app.post('/api/media/:mid/pick', async (req) => prod.pickVersion(ctx, (req.params as any).mid));
  app.post('/api/media/:mid/fix', async (req) => act.fixItem(ctx, (req.params as any).mid, String(((req.body ?? {}) as Body).feedback ?? '')));
  app.post('/api/media/:mid/variants', async (req) => act.variants(ctx, (req.params as any).mid, Number(((req.body ?? {}) as Body).count ?? 3)));
  app.post('/api/projects/:id/production/:stage/fix-qa', async (req) => act.fixQaFailures(ctx, (req.params as any).id, (req.params as any).stage === 'animation' ? 'animation' : 'images'));
  app.post('/api/media/:mid/qa', async (req) => prod.setMediaQa(ctx, (req.params as any).mid, (req.body ?? {}) as { verdict?: string; note?: string }));
  // משימות ל-Claude מכפתור: הרצה באנלימיטד, בדיקת איכות
  app.get('/api/projects/:id/agent', async (req) => agent.listTasks(ctx, (req.params as any).id));
  app.post('/api/projects/:id/agent', async (req, reply) => {
    reply.code(201);
    return agent.requestAgentTask(ctx, (req.params as any).id, (req.body ?? {}) as { kind?: string; stage?: string; scope?: string; note?: string });
  });
  app.post('/api/agent/:tid/cancel', async (req) => agent.cancelTask(ctx, (req.params as any).tid));
  app.get('/api/agent/next', async (_req, reply) => {
    const t = agent.nextTask(ctx);
    if (!t) return reply.code(204).send();
    return t;
  });
  app.get('/api/agent/:tid', async (req) => agent.getTask(ctx, (req.params as any).tid));
  app.post('/api/agent/:tid', async (req) => agent.reportTask(ctx, (req.params as any).tid, (req.body ?? {}) as { status?: string; log?: string; result?: string }));
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
