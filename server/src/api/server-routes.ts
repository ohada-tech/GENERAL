/** נתיבים שרצים רק בשרת (לא בגרסת claude.ai בדפדפן) — למשל יצירת קבצי Word */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { validBearer } from '../auth.js';
import { NotFoundError, type Ctx } from '../context.js';
import { getProject, getScript } from '../db/repo.js';
import fs from 'node:fs';
import { GateError } from '../context.js';
import * as dev from '../services/dev-chat.js';
import * as feedback from '../services/client-feedback.js';
import { requestFeedbackReview } from '../services/feedback-review.js';
import * as calls from '../services/client-calls.js';
import { extractDocText } from '../services/doc-text.js';
import { autofillBrief } from '../services/auto-brief.js';
import { previewScript, proposeConcepts } from '../services/concepts.js';
import { textProviderFor } from '../jobs/handlers.js';
import { needsOwner } from '../services/attention.js';
import { pushAll, subscribe, unsubscribe, vapidKeys } from '../services/push.js';
import { scriptDocx } from '../services/script-docx.js';
import { scriptHtml } from '../services/script-html.js';
import * as share from '../services/share.js';
import * as branding from '../services/branding.js';
import { lastProgressUpdate, postProgressUpdate } from '../services/progress.js';
import { translateScript, type TranslateLang } from '../services/translate.js';
import { briefSchema, isEnglishScript, openDiscoveryQuestions } from '@apos/shared';
import { briefToText } from '../providers/prompts.js';
import { lessonsFor } from '../services/learning.js';
import { ProviderError } from '../providers/types.js';

export function registerServerOnlyRoutes(app: FastifyInstance, ctx: Ctx) {
  /** גרסה בשפה שביקשו (?lang=he / en): תרגום שמור, או תרגום חדש פעם אחת. בלי lang — המקור */
  const versionIn = async (vid: string, lang: unknown) => {
    const v = getScript(ctx.db, vid);
    if (!v) throw new NotFoundError('גרסת תסריט');
    if (lang !== 'he' && lang !== 'en') return { v, lang: null as TranslateLang | null };
    const t = await translateScript(ctx, vid, lang);
    return { v: { ...v, content: t.content }, lang: lang as TranslateLang };
  };
  const LANG_SUFFIX: Record<TranslateLang, string> = { he: ' (עברית)', en: ' (English)' };

  app.get('/api/scripts/:vid/docx', async (req, reply) => {
    const { v, lang } = await versionIn((req.params as { vid: string }).vid, (req.query as { lang?: string }).lang);
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
    const name = `${p.name} - ${isEnglishScript(v.content) ? 'Script' : 'תסריט'} v${v.label}${lang ? LANG_SUFFIX[lang] : ''}.docx`.replace(/[\\/:*?"<>|]+/g, ' ');
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('content-disposition', `attachment; filename="script-v${v.label}.docx"; filename*=UTF-8''${encodeURIComponent(name)}`);
    return reply.send(buf);
  });

  // תרגום תסריט לתצוגה בלבד (ה-Word ללקוח נשאר בשפת המקור)
  app.post('/api/scripts/:vid/translate', async (req) =>
    translateScript(ctx, (req.params as { vid: string }).vid, (((req.body ?? {}) as { to?: string }).to ?? 'he') as TranslateLang),
  );

  // כיווני קריאייטיב: 3 רעיונות מ-ChatGPT לפני התסריט (הבחירה נשמרת באפיון, brief.concept)
  app.post('/api/projects/:id/concepts', async (req) => proposeConcepts(ctx, (req.params as { id: string }).id));

  // תסריט לבדיקה בלבד (לא נשמר) — להשוואה בין שיטות כתיבה
  app.post('/api/projects/:id/script/preview', async (req) => {
    const id = (req.params as { id: string }).id;
    const { provider } = textProviderFor(ctx, id);
    return previewScript(ctx, id, provider.id === 'collab' ? (ctx.providers.text.claude ?? null) : null);
  });

  // התראות Push למחשב / לטלפון
  app.get('/api/push/key', async () => ({ publicKey: vapidKeys(ctx).publicKey }));
  app.post('/api/push/subscribe', async (req) => subscribe(ctx, (req.body ?? {}) as never));
  app.post('/api/push/unsubscribe', async (req) => unsubscribe(ctx, String(((req.body ?? {}) as { endpoint?: string }).endpoint ?? '')));
  app.post('/api/push/test', async () => pushAll(ctx, { title: 'AI Production AP', body: 'ההתראות פועלות ✓', link: '/', tag: 'push-test' }));

  // סשן של Claude (או כל כלי אחר) תקוע ומחכה לאוהד — התראה קופצת מיד
  app.post('/api/attention', async (req, reply) => {
    reply.code(201);
    return needsOwner(ctx, (req.body ?? {}) as { projectId?: string; text?: string; by?: string; link?: string });
  });

  // עדכוני התקדמות (מאוהד או מסשן Claude שעבד על הפרויקט מחוץ למערכת)
  app.post('/api/projects/:id/progress', async (req, reply) => {
    const b = (req.body ?? {}) as { text?: string; by?: string };
    reply.code(201);
    return postProgressUpdate(ctx, (req.params as { id: string }).id, b);
  });
  app.get('/api/projects/:id/progress', async (req) => ({ last: lastProgressUpdate(ctx, (req.params as { id: string }).id) }));

  // בחירת מודל ל-ChatGPT: רשימת המודלים בחשבון, ובדיקה קצרה שהמודל תומך בפלט מובנה (נדרש לכתיבת תסריטים)
  app.get('/api/settings/openai/models', async () => {
    const p = ctx.providers.text.openai as unknown as { listModels?: () => Promise<string[]> };
    if (!p?.listModels) throw new ProviderError('OpenAI לא זמין', false, 'not_configured');
    return { models: await p.listModels() };
  });
  app.post('/api/settings/openai/probe', async (req) => {
    const model = String(((req.body ?? {}) as { model?: string }).model ?? '').trim();
    if (!model) throw new GateError('יש לציין מודל', 400);
    const p = ctx.providers.text.openai as unknown as { json?: <T>(n: string, s: object, sys: string, user: string, model?: string) => Promise<{ data: T; model: string }> };
    if (!p?.json) throw new ProviderError('OpenAI לא זמין', false, 'not_configured');
    const r = await p.json<{ line: string }>(
      'probe',
      { type: 'object', additionalProperties: false, required: ['line'], properties: { line: { type: 'string' } } },
      'You write short, warm Hebrew marketing lines.',
      'כתוב שורת פתיחה אחת לסרטון על בית קפה שכונתי.',
      model,
    );
    return { ok: true, model: r.model, sample: r.data.line };
  });

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

  // מילוי אפיון אוטומטי: סיכום / קבצים / אתר הלקוח ← כל השדות (JSON, או multipart עם קבצים)
  app.post('/api/projects/:id/brief/autofill', async (req) => {
    const id = (req.params as { id: string }).id;
    let input: { text?: string; url?: string; overwrite?: boolean; files?: Array<{ name: string; text: string }> } = {};
    if (req.isMultipart()) {
      const files: Array<{ name: string; text: string }> = [];
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const data = await part.toBuffer();
          if (data.length > 30 * 1024 * 1024) throw new GateError('קובץ גדול מדי (עד 30MB)', 400);
          files.push({ name: part.filename, text: extractDocText(part.filename, data).text });
        } else {
          const v = String(part.value ?? '');
          if (part.fieldname === 'text') input.text = v;
          if (part.fieldname === 'url') input.url = v;
          if (part.fieldname === 'overwrite') input.overwrite = v === 'true';
        }
      }
      input.files = files;
    } else input = (req.body ?? {}) as typeof input;
    return autofillBrief(ctx, id, input);
  });

  // קובץ שמצרפים להנחיה (שיפור תסריט) — מחזיר את הטקסט שלו
  app.post('/api/doc-text', async (req) => {
    const file = await req.file();
    if (!file) throw new GateError('לא נשלח קובץ', 400);
    const data = await file.toBuffer();
    if (data.length > 30 * 1024 * 1024) throw new GateError('הקובץ גדול מדי (עד 30MB)', 400);
    return extractDocText(file.filename, data);
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
  // שיחה עם הלקוח: הקלטה ← תמלול ← הערות לתסריט
  app.get('/api/projects/:id/calls', async (req) => ({ calls: calls.listCalls(ctx, (req.params as { id: string }).id) }));
  app.get('/api/calls/:cid', async (req) => {
    const c = calls.getCall(ctx, (req.params as { cid: string }).cid);
    if (!c) throw new NotFoundError('שיחה');
    return c;
  });
  app.post('/api/projects/:id/calls', async (req, reply) => {
    const file = await req.file();
    if (!file) throw new GateError('לא נשלחה הקלטה', 400);
    const data = await file.toBuffer();
    if (data.length > 200 * 1024 * 1024) throw new GateError('ההקלטה גדולה מדי (עד 200MB)', 400);
    reply.code(201);
    return calls.transcribeCall(ctx, (req.params as { id: string }).id, { name: file.filename, data });
  });
  app.post('/api/calls/:cid/feedback', async (req, reply) => {
    reply.code(201);
    return calls.callToFeedback(ctx, (req.params as { cid: string }).cid);
  });

  // שמירת הבחירות וההחלטות של אוהד בלי תיקון; דעה של ChatGPT לפני תיקון
  app.put('/api/feedback/:fid', async (req) => {
    const b = (req.body ?? {}) as { items?: feedback.FeedbackItem[]; baseVersionId?: string };
    return feedback.saveFeedbackItems(ctx, (req.params as { fid: string }).fid, b);
  });
  app.post('/api/feedback/:fid/review', async (req) => {
    const b = (req.body ?? {}) as { items?: feedback.FeedbackItem[]; baseVersionId?: string };
    return requestFeedbackReview(ctx, (req.params as { fid: string }).fid, b);
  });
  app.post('/api/feedback/:fid/apply', async (req) => {
    const b = (req.body ?? {}) as { items?: feedback.FeedbackItem[]; baseVersionId?: string };
    return feedback.applyClientFeedback(ctx, (req.params as { fid: string }).fid, b);
  });

  // התסריט כדף לצפייה ולשמירה כ-PDF — נפתח בכל מחשב וטלפון, בלי Word
  app.get('/api/scripts/:vid/view', async (req, reply) => {
    const { v } = await versionIn((req.params as { vid: string }).vid, (req.query as { lang?: string }).lang);
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

  // "שלח ללקוח": קישור פרטי לתסריט. הדף הציבורי נמצא מחוץ ל-/api (לא דורש התחברות) ומציג רק את הדף ללקוח.
  const baseUrl = (req: FastifyRequest) => {
    const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0].trim();
    return `${proto}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
  };
  app.post('/api/scripts/:vid/share', async (req, reply) => {
    const link = share.shareScript(ctx, (req.params as { vid: string }).vid, ((req.body ?? {}) as { lang?: string }).lang);
    reply.code(201);
    return { ...link, url: `${baseUrl(req)}/s/${link.token}` };
  });
  app.get('/api/scripts/:vid/shares', async (req) => ({
    links: share.listShares(ctx, (req.params as { vid: string }).vid).map((l) => ({ ...l, url: `${baseUrl(req)}/s/${l.token}` })),
  }));
  app.delete('/api/share/:token', async (req) => share.revokeShare(ctx, (req.params as { token: string }).token));
  app.get('/s/:token', async (req, reply) => {
    reply.header('x-robots-tag', 'noindex, nofollow').header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    let link: share.ShareLink | null = null;
    try {
      link = share.openShare(ctx, (req.params as { token: string }).token);
    } catch {
      return reply.code(410).type('text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><p style="font-family:Arial;padding:40px">This link is no longer active. · הקישור הזה כבר לא פעיל.</p>');
    }
    const v = link ? getScript(ctx.db, link.scriptVersionId) : null;
    const p = v ? getProject(ctx.db, v.projectId) : null;
    if (!link || !v || !p) return reply.code(404).type('text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><p style="font-family:Arial;padding:40px">Not found · לא נמצא</p>');
    let version = v;
    if (link.lang) version = { ...v, content: (await translateScript(ctx, v.id, link.lang)).content };
    const html = scriptHtml({
      version,
      projectName: p.name,
      clientName: p.clientName,
      language: p.brief.language,
      targetSec: p.brief.durationSec ?? null,
      brand: p.settings.brand,
      genesisLogo: p.settings.brand === 'genesis' ? branding.genesisLogo(ctx) : null,
      ownerName: 'Ohad Alfi',
      forClient: true,
    });
    return reply.type('text/html; charset=utf-8').send(html);
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
