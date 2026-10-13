import './flag';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import type { Config } from '../../../server/src/config';
import type { Ctx } from '../../../server/src/context';
import { startWorker } from '../../../server/src/jobs/worker';
import { DemoTextProvider } from '../../../server/src/providers/demo';
import { isProjectCompleted } from '../../../server/src/services/views';
import { App } from '../App';
import { TimerProvider } from '../lib/timer';
import '../fonts';
import '../styles.css';
import { ClaudeTextProvider } from './claude-provider';
import { CloudBanner } from './CloudBanner';
import { registerCloudRoutes } from './cloud-routes';
import { openBrowserDb, type DB } from './db-browser';
import { CloudStore } from './persist';
import { installFetchShim, MiniApp } from './router';

const config: Config = {
  port: 0,
  host: '',
  dataDir: '/cloud',
  ownerName: 'owner',
  openai: { apiKey: '', model: 'Claude', baseUrl: '', timeoutMs: 180_000 },
  jobs: { maxAttempts: 3, retryBaseSeconds: 15, stuckMinutes: 10, pollMs: 1000 },
  stalledProjectDays: 3,
  timerMaxHours: 10,
};

interface Booted {
  store: CloudStore | null;
  reason: string | null;
}

async function boot(): Promise<Booted> {
  const claude = (window as Partial<Window>).claude;
  if (!claude?.use) throw new Error('המערכת רצה בתוך claude.ai — פתח את הקישור ששלחנו לך כשאתה מחובר לחשבון.');
  const [cdb, user, assets, sample] = await Promise.all([
    claude.use('db'),
    claude.use('user'),
    claude.use('assets'),
    claude.use('sample'),
  ]);
  const userId = user ? await user.id() : null;

  let store: CloudStore | null = null;
  let reason: string | null = null;
  let bytes: Uint8Array | null = null;
  let db: DB | null = null;
  if (cdb && userId) {
    store = new CloudStore(cdb, userId, () => db!.export());
    bytes = await store.load();
  } else {
    reason = !userId ? 'לא זוהה משתמש מחובר' : 'אחסון הענן לא זמין';
  }
  db = await openBrowserDb(bytes, () => store?.markDirty());
  // DB הדפדפני מממש את אותו API שהשרת משתמש בו
  const ctx: Ctx = {
    db: db as unknown as Ctx['db'],
    config,
    providers: { text: { openai: new ClaudeTextProvider(sample), demo: new DemoTextProvider() } },
    now: () => new Date(),
  };
  const app = new MiniApp();
  await registerCloudRoutes(app, ctx, { assets, aiAvailable: sample !== null });
  installFetchShim(app);
  startWorker(ctx, (id) => isProjectCompleted(ctx, id));

  const flush = () => void store?.flush();
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  return { store, reason };
}

function Root() {
  const [state, setState] = useState<{ booted?: Booted; error?: string }>({});
  useEffect(() => {
    boot().then(
      (booted) => setState({ booted }),
      (e) => setState({ error: e instanceof Error ? e.message : String(e) }),
    );
  }, []);

  if (state.error) {
    return (
      <div className="boot">
        <div className="card stack">
          <h2>לא ניתן לפתוח את המערכת</h2>
          <p>{state.error}</p>
          <button className="btn btn-primary" onClick={() => location.reload()}>
            נסה שוב
          </button>
        </div>
      </div>
    );
  }
  if (!state.booted) {
    return (
      <div className="boot">
        <div className="muted">טוען את AI Production AP…</div>
      </div>
    );
  }
  return (
    <HashRouter>
      <TimerProvider>
        <CloudBanner store={state.booted.store} reason={state.booted.reason} />
        <App />
      </TimerProvider>
    </HashRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
