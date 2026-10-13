import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { currentStoryboard, getProject, listMedia, listScripts, listShots } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import { projectState } from '../src/services/views.js';
import * as cmd from '../src/workflow/commands.js';
import * as prod from '../src/workflow/production.js';
import { makeCtx, projectWithBrief, sampleMedia } from './helpers.js';

async function readyProject(ctx: ReturnType<typeof makeCtx>) {
  const p = projectWithBrief(ctx);
  cmd.updateProject(ctx, p.id, { settings: { generator: 'higgsfield' } });
  cmd.completeBrief(ctx, p.id);
  await drain(ctx);
  const v = listScripts(ctx.db, p.id)[0];
  cmd.approveScriptInternal(ctx, v.id);
  cmd.recordClientApproval(ctx, v.id, { approvedBy: 'לקוח' });
  await drain(ctx);
  const shots = listShots(ctx.db, currentStoryboard(ctx.db, p.id)!.id);
  for (const s of shots) cmd.setShotApproval(ctx, s.id, 'approved');
  return { p, shots };
}

describe('Higgsfield mode (Claude / manual uploads)', () => {
  it('never calls KIE for frames, lists what is waiting, and accepts uploads per shot', async () => {
    const ctx = makeCtx();
    const { p, shots } = await readyProject(ctx);
    cmd.approveStoryboard(ctx, p.id); // המשך אוטומטי פותח את השלב — בלי יצירה ב-KIE
    expect(ctx.kie.created).toHaveLength(0);
    const req = prod.externalRequests(ctx, p.id);
    expect(req.images).toHaveLength(shots.length);
    expect(req.images[0]!.prompt.length).toBeGreaterThan(0);

    const png = sampleMedia().png;
    for (const s of shots) prod.addExternalMedia(ctx, p.id, { kind: 'frame', shotId: s.id, data: png, mime: 'image/png', filename: 'f.png', source: 'higgsfield-unlimited' });
    expect(prod.externalRequests(ctx, p.id).images).toHaveLength(0);
    expect(projectState(ctx, getProject(ctx.db, p.id)!).stages.find((s) => s.key === 'images')!.status).toBe('waiting_internal');

    // בקשת גרסה חדשה: לא נוצר כלום ב-KIE, השוט חוזר לרשימה עם ההערה
    const first = listMedia(ctx.db, p.id, 'frame').find((m) => m.shotId === shots[0].id)!;
    prod.regenerateItem(ctx, first.id, 'שיער קצר יותר');
    expect(ctx.kie.created).toHaveLength(0);
    const again = prod.externalRequests(ctx, p.id).images;
    expect(again).toHaveLength(1);
    expect(again[0]!.feedback).toBe('שיער קצר יותר');
    prod.addExternalMedia(ctx, p.id, { kind: 'frame', shotId: shots[0].id, data: png, mime: 'image/png', filename: 'v2.png', source: 'higgsfield-credits', hfCredits: 2 });
    expect(listMedia(ctx.db, p.id, 'frame').find((m) => m.shotId === shots[0].id && m.version === 2)?.params.hfCredits).toBe(2);

    prod.approveStage(ctx, p.id, 'images');
    expect(ctx.kie.created).toHaveLength(0);
    const clips = prod.externalRequests(ctx, p.id).animation;
    expect(clips).toHaveLength(shots.length);
    expect((clips[0] as any).approvedFrame.fileUrl).toMatch(/^\/api\/media\//);
    expect(() => prod.addExternalMedia(ctx, p.id, { kind: 'clip', shotId: shots[0].id, data: png, mime: 'image/png', filename: 'x.png' })).toThrow(/לא מתאים/);
  });

  it('a revocable Claude access token works instead of the password', async () => {
    const ctx = makeCtx();
    ctx.config.auth.password = 'pw-1';
    const app = await buildApp(ctx);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'pw-1' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const created = await app.inject({ method: 'POST', url: '/api/settings/operator-token', headers: { cookie } });
    const token = created.json().token as string;
    expect(token).toMatch(/^apos_/);
    expect((await app.inject({ url: '/api/dashboard', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/dashboard', headers: { authorization: 'Bearer apos_wrong' } })).statusCode).toBe(401);
    await app.inject({ method: 'DELETE', url: '/api/settings/operator-token', headers: { cookie } });
    expect((await app.inject({ url: '/api/dashboard', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    await app.close();
  });
});
