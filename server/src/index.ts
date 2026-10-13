import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { Ctx } from './context.js';
import { openDb } from './db/db.js';
import { startWorker } from './jobs/worker.js';
import { createProviders } from './providers/registry.js';
import { loadSecrets, testOpenAI } from './services/secrets.js';
import { isProjectCompleted } from './services/views.js';

const config = loadConfig();
loadSecrets(config);
const db = openDb(path.join(config.dataDir, 'production.db'));
const ctx: Ctx = { db, config, providers: createProviders(config), now: () => new Date() };

const app = await buildApp(ctx, { logger: true, serveWeb: true });
const worker = startWorker(ctx, (id) => isProjectCompleted(ctx, id));

await app.listen({ port: config.port, host: config.host });
console.log(`\n  AI Production AP → http://${config.host}:${config.port}`);
console.log(`  Data: ${config.dataDir}`);
if (config.openai.apiKey) {
  const s = await testOpenAI(ctx);
  console.log(s.verified ? `  OpenAI: connected and verified (model ${s.model})` : `  OpenAI: key set but check failed - ${s.lastError}`);
} else {
  console.log('  OpenAI: not connected - open the app and click "OpenAI" in the top bar to connect');
}

const shutdown = async () => {
  await worker.stop();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
