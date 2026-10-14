/** נתיבים שרצים רק בשרת (לא בגרסת claude.ai בדפדפן) — למשל יצירת קבצי Word */
import type { FastifyInstance } from 'fastify';
import { NotFoundError, type Ctx } from '../context.js';
import { getProject, getScript } from '../db/repo.js';
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
}
