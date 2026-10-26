import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { getProject, listJobs } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import { projectState } from '../src/services/views.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

describe('"נמסר ללקוח" — הפקה שנעשתה מחוץ למערכת', () => {
  it('כל השלבים הושלמו, אין פעולות פתוחות ולא נפתחות משימות; ביטול מחזיר למצב הקודם', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const jobsBefore = listJobs(ctx.db, p.id).length;
    const app = await buildApp(ctx);
    const r = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/delivered`, payload: { note: 'הלקוח אישר את הגרסה הסופית' } });
    expect(r.statusCode).toBe(200);
    const st = projectState(ctx, getProject(ctx.db, p.id)!);
    expect(st.overallStatus).toBe('completed');
    expect(st.progress).toBe(100);
    expect(st.myActions).toEqual([]);
    expect(st.deliveredAt).toBeTruthy();
    await drain(ctx);
    expect(listJobs(ctx.db, p.id).length).toBe(jobsBefore);
    await app.inject({ method: 'DELETE', url: `/api/projects/${p.id}/delivered` });
    const back = projectState(ctx, getProject(ctx.db, p.id)!);
    expect(back.overallStatus).not.toBe('completed');
    expect(back.deliveredAt).toBeNull();
  });
});

describe('מחיקת פרויקט', () => {
  it('נמחק רק כשהוא ריק; פרויקט עם תסריט נשאר', async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const empty = cmd.createProject(ctx, { name: 'kc', clientName: '' });
    expect((await app.inject({ method: 'DELETE', url: `/api/projects/${empty.id}` })).statusCode).toBe(200);
    expect(getProject(ctx.db, empty.id)).toBeNull();
    const busy = projectWithBrief(ctx);
    cmd.completeBrief(ctx, busy.id);
    await drain(ctx);
    const r = await app.inject({ method: 'DELETE', url: `/api/projects/${busy.id}` });
    expect(r.statusCode).toBe(409);
    expect(getProject(ctx.db, busy.id)).toBeTruthy();
  });
});
