import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { registerRoutes } from './api/routes.js';
import { REPO_ROOT } from './config.js';
import { GateError, type Ctx } from './context.js';

export async function buildApp(ctx: Ctx, opts: { logger?: boolean; serveWeb?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024, files: 1 } });
  // גוף JSON ריק בפעולות POST (למשל "אשר") מתפרש כאובייקט ריק
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = String(body ?? '').trim();
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      done(Object.assign(new Error('JSON לא תקין'), { statusCode: 400 }), undefined);
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'נתונים לא תקינים',
        details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    if (err instanceof GateError) return reply.code(err.statusCode).send({ error: err.message });
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? `שגיאת שרת: ${e.message}` : e.message });
  });

  await registerRoutes(app, ctx);

  const webDist = path.join(REPO_ROOT, 'web', 'dist');
  if (opts.serveWeb && fs.existsSync(webDist)) {
    // wildcard (ברירת מחדל) — קבצים חדשים אחרי build מוגשים בלי להפעיל את השרת מחדש
    await app.register(fastifyStatic, { root: webDist });
    // SPA fallback: נתיבי אפליקציה מקבלים index.html; API וקבצים חסרים מקבלים 404 אמיתי
    app.setNotFoundHandler((req, reply) => {
      const pathname = req.url.split('?')[0];
      if (pathname.startsWith('/api/') || /\.[a-z0-9]+$/i.test(pathname)) {
        return reply.code(404).send({ error: 'לא נמצא' });
      }
      return reply.sendFile('index.html');
    });
  }
  return app;
}
