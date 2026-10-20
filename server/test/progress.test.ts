import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { dashboard } from '../src/services/views.js';
import { makeCtx, projectWithBrief } from './helpers.js';

describe('Progress updates', () => {
  it('a Claude session posts an update: history, bell notification, and the dashboard card show it', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    const app = await buildApp(ctx);
    const r = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/progress`, payload: { text: 'נשלח תסריט v1 למיכאל', by: 'Claude' } });
    expect(r.statusCode).toBe(201);
    const card = dashboard(ctx).projects.find((x) => x.id === p.id)!;
    expect(card.lastUpdate).toMatchObject({ text: 'נשלח תסריט v1 למיכאל', by: 'Claude' });
    const notes = ctx.db.prepare("SELECT title FROM notifications WHERE title LIKE 'עדכון התקדמות%'").all();
    expect(notes).toHaveLength(1);
    const last = await app.inject({ url: `/api/projects/${p.id}/progress` });
    expect(last.json().last.text).toBe('נשלח תסריט v1 למיכאל');
    expect((await app.inject({ method: 'POST', url: `/api/projects/${p.id}/progress`, payload: { text: '  ' } })).statusCode).toBe(400);
    await app.close();
  });

  it("the owner's own update does not ring the bell", async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    const app = await buildApp(ctx);
    await app.inject({ method: 'POST', url: `/api/projects/${p.id}/progress`, payload: { text: 'דיברתי עם הלקוח' } });
    await app.close();
    expect(ctx.db.prepare("SELECT 1 FROM notifications WHERE title LIKE 'עדכון התקדמות%'").all()).toHaveLength(0);
  });
});
