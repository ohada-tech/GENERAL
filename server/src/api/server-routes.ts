/** נתיבים שרצים רק בשרת (לא בגרסת claude.ai בדפדפן) — למשל יצירת קבצי Word */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { validBearer } from '../auth.js';
import { NotFoundError, type Ctx } from '../context.js';
import { getProject, getScript } from '../db/repo.js';
import fs from 'node:fs';
import { GateError } from '../context.js';
import * as dev from '../services/dev-chat.js';
import * as feedback from '../services/client-feedback.js';
import { scriptDocx } from '../services/script-docx.js';
import { scriptHtml } from '../services/script-html.js';
import * as branding from '../services/branding.js';
import { translateScript, type TranslateLang } from '../services/translate.js';
import { briefSchema, openDiscoveryQuestions } from '@apos/shared';
import { briefToText } from '../providers/prompts.js';
import { lessonsFor } from '../services/learning.js';
import { ProviderError } from '../providers/types.js';

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
      brand: p.settings.brand,
      genesisLogo: p.settings.brand === 'genesis' ? branding.genesisLogo(ctx) : null,
      ownerName: 'Ohad Alfi', // השם בקטן מתחת ללוגו של Genesis (לא OWNER_NAME, שמשמש לאישורים)
    });
    const name = `${p.name} - תסריט v${v.label}.docx`.replace(/[\\/:*?"<>|]+/g, ' ');
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('content-disposition', `attachment; filename="script-v${v.label}.docx"; filename*=UTF-8''${encodeURIComponent(name)}`);
    return reply.send(buf);
  });

  // תרגום תסריט לתצוגה בלבד (ה-Word ללקוח נשאר בשפת המקור)
  app.post('/api/scripts/:vid/translate', async (req) =>
    translateScript(ctx, (req.params as { vid: string }).vid, (((req.body ?? {}) as { to?: string }).to ?? 'he') as TranslateLang),
  );

  // מיתוג: לוגו Genesis (מועלה פעם אחת, משמש בכל פרויקט שממותג Genesis)
  app.get('/api/settings/brand', async () => branding.brandStatus(ctx));
  app.post('/api/settings/brand/genesis-logo', async (req) => {
    const file = await req.file();
    if (!file) throw new GateError('לא נשלח קובץ', 400);
    const data = await file.toBuffer();
    if (data.length > 10 * 1024 * 1024) throw new GateError('הלוגו גדול מדי (עד 10MB)', 400);
    return branding.saveGenesisLogo(ctx, data);
  });
  app.delete('/api/settings/brand/genesis-logo', async () => branding.removeGenesisLogo(ctx));
  app.get('/api/settings/brand/genesis-logo', async (_req, reply) => {
    const logo = branding.genesisLogo(ctx);
    if (!logo) throw new NotFoundError('לוגו');
    return reply.header('content-type', logo.type === 'png' ? 'image/png' : 'image/jpeg').header('cache-control', 'no-cache').send(logo.data);
  });

  // ייבוא הערות לקוח: Google Doc / Word / טקסט ← רשימת הערות לבדיקה ← תיקון התסריט
  app.get('/api/projects/:id/feedback', async (req) => ({ imports: feedback.listFeedbackImports(ctx, (req.params as { id: string }).id) }));
  app.post('/api/projects/:id/feedback/import', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    let input: { url?: string; text?: string; file?: { name: string; data: Buffer } };
    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) throw new GateError('לא נשלח קובץ', 400);
      if (!/.docx$/i.test(file.filename)) throw new GateError('אפשר להעלות קובץ Word (.docx). ב-Google Docs: קובץ ← הורדה ← Microsoft Word.', 400);
      const data = await file.toBuffer();
      if (data.length > 30 * 1024 * 1024) throw new GateError('הקובץ גדול מדי (עד 30MB)', 400);
      input = { file: { name: file.filename, data } };
    } else input = (req.body ?? {}) as { url?: string; text?: string };
    reply.code(201);
    return feedback.importClientFeedback(ctx, id, input);
  });
  app.post('/api/feedback/:fid/apply', async (req) => {
    const b = (req.body ?? {}) as { items?: feedback.FeedbackItem[]; baseVersionId?: string };
    return feedback.applyClientFeedback(ctx, (req.params as { fid: string }).fid, b);
  });

  // התסריט כדף לצפייה ולשמירה כ-PDF — נפתח בכל מחשב וטלפון, בלי Word
  app.get('/api/scripts/:vid/view', async (req, reply) => {
    const v = getScript(ctx.db, (req.params as { vid: string }).vid);
    if (!v) throw new NotFoundError('גרסת תסריט');
    const p = getProject(ctx.db, v.projectId);
    if (!p) throw new NotFoundError('פרויקט');
    const html = scriptHtml({
      version: v,
      projectName: p.name,
      clientName: p.clientName,
      language: p.brief.language,
      targetSec: p.brief.durationSec ?? null,
      brand: p.settings.brand,
      genesisLogo: p.settings.brand === 'genesis' ? branding.genesisLogo(ctx) : null,
      ownerName: 'Ohad Alfi',
    });
    return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').send(html);
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

  /** Claude עובר על האפיון ומחזיר את השאלות שעוד צריך לשאול את בעל העסק — לפי הפרויקט הזה */
  app.post('/api/projects/:id/brief/questions', async (req) => {
    const p = getProject(ctx.db, (req.params as { id: string }).id);
    if (!p) throw new NotFoundError('פרויקט');
    const body = (req.body ?? {}) as { brief?: unknown };
    const brief = body.brief ? briefSchema.parse(body.brief) : p.brief;
    const prov = [ctx.providers.text.claude, ctx.providers.text.openai].find((x) => x?.isConfigured()) as
      | { json?: <T>(n: string, s: object, sys: string, user: string) => Promise<{ data: T }> }
      | undefined;
    if (!prov?.json) throw new ProviderError('אין מנוע כתיבה מחובר (Claude או ChatGPT)', false, 'not_configured');
    const open = openDiscoveryQuestions(brief).map((q) => q.q);
    const r = await prov.json<{ questions: Array<{ q: string; why: string }> }>(
      'brief_questions',
      {
        type: 'object',
        additionalProperties: false,
        required: ['questions'],
        properties: {
          questions: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, required: ['q', 'why'], properties: { q: { type: 'string' }, why: { type: 'string' } } },
          },
        },
      },
      [
        'You are a senior producer preparing a discovery call with a business owner before writing a marketing video script.',
        'Read the brief and list the follow-up questions that must be answered so the script hits the business goal and nothing important is missed.',
        'Focus on gaps, ambiguities and assumptions: target market/country and language (never assume Israel/Hebrew), the exact audience and their pain, the offer and allowed claims, CTA and where it leads, success metric, platform and format versions, brand assets, approvals, legal limits.',
        'Ask only what this brief does not already answer clearly. At most 8 questions, most critical first. Write in Hebrew, short and concrete, phrased so they can be sent to the client as-is. "why": a few words on why it matters.',
      ].join('\n'),
      `BRIEF:\n${briefToText({ name: p.name, clientName: p.clientName, brief, lessons: lessonsFor(ctx, p.clientName, ['general', 'script']) })}\n\nSTANDARD QUESTIONS NOT ANSWERED YET:\n${open.map((q) => `- ${q}`).join('\n') || '(none)'}`,
    );
    return { questions: (r.data.questions ?? []).slice(0, 8) };
  });
}
