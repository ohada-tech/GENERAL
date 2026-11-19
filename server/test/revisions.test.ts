import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx } from './helpers.js';

describe('סבבי תיקונים אחרי מסירה', () => {
  it('פרויקט שנמסר חוזר להפקה בסבב, הערות מסומנות אחת אחת, וסגירה מחזירה ל"נמסרו"', async () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'KAMI', clientName: 'KAMI' });
    const app = await buildApp(ctx);
    cmd.markDelivered(ctx, p.id, { note: 'v1' });
    const summary = async () => (await app.inject({ url: '/api/dashboard' })).json().projects.find((x: any) => x.id === p.id);
    expect((await summary()).state.overallStatus).toBe('completed');

    const bad = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/revisions`, payload: { notes: '   ' } });
    expect(bad.statusCode).toBe(400);
    const r1 = (await app.inject({ method: 'POST', url: `/api/projects/${p.id}/revisions`, payload: { notes: '1. להחליף מוזיקה\n- לקצר את הפתיח\n\nלוגו גדול יותר' } })).json();
    expect(r1.number).toBe(1);
    expect(r1.items.map((i: any) => i.text)).toEqual(['להחליף מוזיקה', 'לקצר את הפתיח', 'לוגו גדול יותר']);

    let s = await summary();
    expect(s.state.overallStatus).not.toBe('completed');
    expect(s.state.stages.find((x: any) => x.key === 'delivery').detail).toBe('סבב תיקונים 1: 0/3 הערות טופלו');
    expect(s.state.nextAction.label).toContain('סבב תיקונים 1');
    expect(s.revisions).toMatchObject({ count: 1, included: 2, open: { number: 1, total: 3, done: 0 } });
    // סבב שני לא נפתח כשיש פתוח
    expect((await app.inject({ method: 'POST', url: `/api/projects/${p.id}/revisions`, payload: { notes: 'עוד' } })).statusCode).toBe(409);

    await app.inject({ method: 'POST', url: `/api/revisions/${r1.id}/items/0`, payload: { done: true } });
    await app.inject({ method: 'POST', url: `/api/revisions/${r1.id}/items`, payload: { notes: 'צבע כתוביות' } });
    s = await summary();
    expect(s.revisions.open).toMatchObject({ total: 4, done: 1 });

    await app.inject({ method: 'POST', url: `/api/revisions/${r1.id}/close`, payload: { note: 'v2 נשלח' } });
    s = await summary();
    expect(s.state.overallStatus).toBe('completed');
    expect(s.revisions).toMatchObject({ count: 1, open: null });

    // סבב 2 ו-3: השלישי מעבר לכלולים; "נמסר" (גם מסשן) סוגר את הסבב הפתוח
    await app.inject({ method: 'POST', url: `/api/projects/${p.id}/revisions`, payload: { notes: 'א' } });
    cmd.markDelivered(ctx, p.id, { note: 'v3' });
    const r3 = (await app.inject({ method: 'POST', url: `/api/projects/${p.id}/revisions`, payload: { notes: 'ב' } })).json();
    expect(r3.number).toBe(3);
    const ev = ctx.db.prepare("SELECT message FROM events WHERE message LIKE '%סבב תיקונים 3%'").get() as { message: string };
    expect(ev.message).toContain('מעבר ל-2 הכלולים');
    expect((await app.inject({ url: `/api/projects/${p.id}` })).json().revisions).toHaveLength(3);
  });
});
