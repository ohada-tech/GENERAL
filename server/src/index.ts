import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { Ctx } from './context.js';
import { openDb } from './db/db.js';
import { startWorker } from './jobs/worker.js';
import { createProviders } from './providers/registry.js';
import { isProjectCompleted } from './services/views.js';

const config = loadConfig();
const db = openDb(path.join(config.dataDir, 'production.db'));
const ctx: Ctx = { db, config, providers: createProviders(config), now: () => new Date() };

const app = await buildApp(ctx, { logger: true, serveWeb: true });
const worker = startWorker(ctx, (id) => isProjectCompleted(ctx, id));

await app.listen({ port: config.port, host: config.host });
console.log(`\n  AI Production AP → http://${config.host}:${config.port}`);
console.log(`  Data: ${config.dataDir}`);
console.log(
  config.openai.apiKey
    ? `  OpenAI: connected (default model ${config.openai.model})`
    : '  OpenAI: OPENAI_API_KEY not set - AI script writing is disabled until you add it to .env (or use the demo provider)',
);

const shutdown = async () => {
  await worker.stop();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
