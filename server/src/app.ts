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
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    // SPA fallback
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'לא נמצא' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
