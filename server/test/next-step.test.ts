import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { getProject } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import { projectState } from '../src/services/views.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

describe('"הבא" שמבצע', () => {
  it('מחזיר לאן לעבור או מריץ את הצעד, ותמיד עונה', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    const app = await buildApp(ctx);
    const before = projectState(ctx, getProject(ctx.db, p.id)!).nextAction;
    const r = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/next` });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    if (before && before.kind !== 'task') expect(body.navigate).toBe(before.tab);
    else expect(body.done || body.navigate).toBeTruthy();
    await drain(ctx);
  });

  it('אחרי אפיון מלא: לא נופל ומחזיר תשובה תקינה', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const app = await buildApp(ctx);
    const r = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/next` });
    expect(r.statusCode).toBe(200);
    expect(r.json().done || r.json().navigate).toBeTruthy();
  });

  it('פרויקט לא קיים = 404', async () => {
    const app = await buildApp(makeCtx());
    expect((await app.inject({ method: 'POST', url: `/api/projects/nope/next` })).statusCode).toBe(404);
  });
});
