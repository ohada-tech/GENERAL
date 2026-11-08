import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx } from './helpers.js';

const tokens = { input: 1000, output: 2000, cacheRead: 50_000, cacheWrite: 7000 };

describe('עלות לכל פרויקט', () => {
  it('קרדיטים בדולרים, טוקנים, וחלק מהמגבלה השבועית בדשבורד ובעמוד הפרויקט', async () => {
    const ctx = makeCtx();
    const a = cmd.createProject(ctx, { name: 'קבע לי תור', clientName: 'קבע לי תור' });
    const b = cmd.createProject(ctx, { name: 'RIVR', clientName: 'rivr+' });
    const app = await buildApp(ctx);

    const sync = await app.inject({
      method: 'POST',
      url: '/api/usage/sync',
      payload: {
        projects: [
          { projectId: a.id, hfCredits: 150, tokens, weekWeight: 300, sessions: 2 },
          { projectId: 'deleted-project', hfCredits: 5, tokens, weekWeight: 10 },
        ],
        weekWeightTotal: 1000,
      },
    });
    expect(sync.json()).toEqual({ saved: 1 });

    // לפני מדידת המגבלה — אין אחוז, רק החלק היחסי
    let d = (await app.inject({ url: '/api/dashboard' })).json();
    let u = d.projects.find((p: any) => p.id === a.id).usage;
    expect(u).toMatchObject({ hfCredits: 150, hfUsd: 6, sessions: 2, weekShare: 0.3, weekPct: null });
    expect(u.tokens.total).toBe(60_000);
    expect(d.projects.find((p: any) => p.id === b.id).usage).toBeNull();

    await app.inject({
      method: 'POST',
      url: '/api/usage/plan',
      payload: { windows: [{ label: '5-hour limit', percentUsed: 3, resetsAt: null }, { label: 'Weekly · all models', percentUsed: 44, resetsAt: '2026-11-13T06:00:00Z' }] },
    });
    d = (await app.inject({ url: '/api/dashboard' })).json();
    expect(d.planUsage.windows).toHaveLength(2);
    u = d.projects.find((p: any) => p.id === a.id).usage;
    expect(u.weekPct).toBe(13.2);
    expect((await app.inject({ url: `/api/projects/${a.id}` })).json().usage.hfUsd).toBe(6);

    // סנכרון חדש מחליף את הקודם
    await app.inject({ method: 'POST', url: '/api/usage/sync', payload: { projects: [{ projectId: b.id, hfCredits: 1, tokens }], weekWeightTotal: 1 } });
    expect((await app.inject({ url: `/api/projects/${a.id}` })).json().usage).toBeNull();
    expect((await app.inject({ method: 'POST', url: '/api/usage/plan', payload: { windows: [] } })).statusCode).toBe(400);
  });
});
