/** נתיבים שרצים רק בשרת (לא בגרסת claude.ai בדפדפן) — למשל יצירת קבצי Word */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { validBearer } from '../auth.js';
import { NotFoundError, type Ctx } from '../context.js';
import { getProject, getScript } from '../db/repo.js';
import fs from 'node:fs';
import { GateError } from '../context.js';
import * as dev from '../services/dev-chat.js';
import { scriptDocx } from '../services/script-docx.js';

export function registerServerOnlyRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/scripts/:vid/docx', async (req, reply) => {
    const v = getScript(ctx.db, (req.params as { vid: string }).vid);
    if (!v) throw new NotFoundError('גרסת תסריט');
    const p = getProject(ctx.db, v.projectId);
    if (!p) throw new NotFoundError('פרויקט');
    const buf = await scriptDocx({
      version: v,
      projectName: p.name,
      clientName: p.clientName,
      language: p.brief.language,
      targetSec: p.brief.durationSec ?? null,
    });
    const name = `${p.name} - תסריט v${v.label}.docx`.replace(/[\\/:*?"<>|]+/g, ' ');
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('content-disposition', `attachment; filename="script-v${v.label}.docx"; filename*=UTF-8''${encodeURIComponent(name)}`);
    return reply.send(buf);
  });

  // צ'אט "שינויים במערכת": אתה כותב מהמערכת; Claude (המפתח) עונה עם מפתח המפעיל
  // רק מפתח המפעיל (Claude) יכול לענות כ-Claude; בלי סיסמה (מקומי) — כל Bearer
  const isOperator = (req: FastifyRequest) =>
    String(req.headers.authorization ?? '').startsWith('Bearer ') && (!ctx.config.auth.password || validBearer(ctx.config, req));
  app.get('/api/dev/messages', async (req) => ({ messages: dev.listDevMessages(ctx, { status: (req.query as { status?: string }).status }) }));
  app.post('/api/dev/messages', async (req, reply) => {
    const b = (req.body ?? {}) as { text?: string; attachments?: string[]; replyTo?: string; status?: dev.DevStatus; role?: string };
    const role = b.role === 'claude' && isOperator(req) ? 'claude' : 'owner';
    reply.code(201);
    return dev.postDevMessage(ctx, { role, text: b.text ?? '', attachments: b.attachments, replyTo: role === 'claude' ? b.replyTo : null, status: role === 'claude' ? b.status : undefined });
  });
  app.post('/api/dev/messages/:mid/status', async (req) =>
    dev.setDevStatus(ctx, (req.params as { mid: string }).mid, ((req.body ?? {}) as { status: dev.DevStatus }).status),
  );
  app.post('/api/dev/attachments', async (req, reply) => {
    const file = await req.file();
    if (!file) throw new GateError('לא נשלח קובץ', 400);
    const buf = await file.toBuffer();
    if (buf.length > 15 * 1024 * 1024) throw new GateError('התמונה גדולה מדי (עד 15MB)', 400);
    reply.code(201);
    return { name: dev.saveDevAttachment(ctx, buf, file.mimetype) };
  });
  app.get('/api/dev/attachments/:name', async (req, reply) => {
    const f = dev.devAttachmentPath(ctx, (req.params as { name: string }).name);
    if (!f) throw new NotFoundError('קובץ');
    reply.header('content-type', f.mime).header('cache-control', 'private, max-age=86400');
    return reply.send(fs.createReadStream(f.path));
  });
}
