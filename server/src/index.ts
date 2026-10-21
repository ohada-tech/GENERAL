import path from 'node:path';
import { loadBridgeMode } from './services/bridge.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { Ctx } from './context.js';
import { openDb } from './db/db.js';
import { startWorker } from './jobs/worker.js';
import { resumeDigests } from './services/knowledge.js';
import { relabelLegacyNoteRefs, renumberLegacyScripts } from './db/repo.js';
import { compactChangeNotes } from './services/change-notes.js';
import { createProviders } from './providers/registry.js';
import { KEY_SERVICES, keyLabel, keyStatus, loadSecrets, testKey } from './services/secrets.js';
import { isProjectCompleted } from './services/views.js';

const config = loadConfig();
const localOnly = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
if (!localOnly && !config.auth.password) {
  console.error('\n  APP_PASSWORD is required when the server is reachable from the network (HOST is not 127.0.0.1).');
  console.error('  Set APP_PASSWORD in the environment and restart.\n');
  process.exit(1);
}
loadSecrets(config);
const db = openDb(path.join(config.dataDir, 'production.db'));
const ctx: Ctx = { db, config, providers: createProviders(config), now: () => new Date() };

loadBridgeMode(ctx);
const app = await buildApp(ctx, { logger: true, serveWeb: true });
const worker = startWorker(ctx, (id) => isProjectCompleted(ctx, id));
renumberLegacyScripts(ctx.db);
relabelLegacyNoteRefs(ctx.db);
resumeDigests(ctx);
void compactChangeNotes(ctx).catch(() => {});

await app.listen({ port: config.port, host: config.host });
console.log(`\n  AI Production AP → http://${config.host}:${config.port}`);
console.log(`  Data: ${config.dataDir}`);
for (const service of KEY_SERVICES) {
  const name = keyLabel(service);
  if (!keyStatus(config, service).configured) {
    console.log(`  ${name}: not connected - open the app and click "Keys" in the top bar`);
    continue;
  }
  const s = await testKey(ctx, service);
  console.log(s.verified ? `  ${name}: connected and verified${s.model ? ` (${s.model})` : ''}` : `  ${name}: key set but check failed - ${s.lastError}`);
}
console.log(config.auth.password ? '  Login: password required' : '  Login: off (local only)');

const shutdown = async () => {
  await worker.stop();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
