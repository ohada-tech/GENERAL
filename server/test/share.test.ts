import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import { dashboard } from '../src/services/views.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

describe('Send to client (private link)', { timeout: 30_000 }, () => {
  it('creates one link per version, opens without login, counts views, and can be revoked', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const v = listScripts(ctx.db, p.id)[0];
    ctx.db.prepare('UPDATE script_versions SET change_note = ? WHERE id = ?').run('הערה פנימית סודית', v.id);
    const app = await buildApp(ctx);

    const a = (await app.inject({ method: 'POST', url: `/api/scripts/${v.id}/share`, payload: {} })).json();
    const b = (await app.inject({ method: 'POST', url: `/api/scripts/${v.id}/share`, payload: {} })).json();
    expect(a.token).toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(30);
    expect(a.url).toContain(`/s/${a.token}`);

    const page = await app.inject({ url: `/s/${a.token}` });
    expect(page.statusCode).toBe(200);
    expect(page.headers['x-robots-tag']).toContain('noindex');
    expect(page.body).toContain(v.content.scenes[0].narration.split(' ')[0]);
    expect(page.body).not.toContain('הערה פנימית סודית');
    await app.inject({ url: `/s/${a.token}` });

    const shares = (await app.inject({ url: `/api/scripts/${v.id}/shares` })).json().links;
    expect(shares[0].viewCount).toBe(2);
    expect(dashboard(ctx).projects.find((x) => x.id === p.id)!.lastShare).toMatchObject({ label: v.label, views: 2 });
    expect(ctx.db.prepare("SELECT 1 FROM events WHERE type = 'script.share_viewed'").all()).toHaveLength(1);

    expect((await app.inject({ url: '/s/not-a-real-token-1234567890' })).statusCode).toBe(404);
    await app.inject({ method: 'DELETE', url: `/api/share/${a.token}` });
    expect((await app.inject({ url: `/s/${a.token}` })).statusCode).toBe(410);
    await app.close();
  });

  it('the public page needs no login even when the app has a password', async () => {
    const ctx = makeCtx();
    ctx.config.auth.password = 'secret-pass';
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const v = listScripts(ctx.db, p.id)[0];
    const app = await buildApp(ctx);
    expect((await app.inject({ method: 'POST', url: `/api/scripts/${v.id}/share`, payload: {} })).statusCode).toBe(401);
    const { shareScript } = await import('../src/services/share.js');
    const link = shareScript(ctx, v.id);
    expect((await app.inject({ url: `/s/${link.token}` })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/scripts/${v.id}/shares` })).statusCode).toBe(401);
    await app.close();
  });
});
