import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

async function view(brand?: 'genesis' | 'studio') {
  const ctx = makeCtx();
  const p = projectWithBrief(ctx);
  if (brand) cmd.updateProject(ctx, p.id, { settings: { brand } });
  cmd.completeBrief(ctx, p.id);
  await drain(ctx);
  const v = listScripts(ctx.db, p.id)[0];
  ctx.db.prepare('UPDATE script_versions SET change_note = ? WHERE id = ?').run('הערה פנימית סודית', v.id);
  const app = await buildApp(ctx);
  const r = await app.inject({ url: `/api/scripts/${v.id}/view` });
  await app.close();
  return { r, v };
}

describe('Script view page (open / save as PDF)', () => {
  it('serves a branded, client-safe page with every scene and a PDF button', async () => {
    const { r, v } = await view();
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    const html = r.body;
    expect(html).toContain('GENESIS');
    expect(html).toContain('Ohad Alfi');
    expect(html).not.toContain('AI Production Studio');
    expect(html).toContain('window.print()');
    expect(html).toContain('הערות ואישור הלקוח');
    expect(html.match(/<td class="n">/g)).toHaveLength(v.content.scenes.length);
    expect(html).not.toContain('הערה פנימית סודית');
    expect(html).not.toContain('fake-model');
  });

  it('studio projects keep the studio branding', async () => {
    const { r } = await view('studio');
    expect(r.body).toContain('Ohad Alfi · AI Production Studio');
    expect(r.body).not.toContain('GENESIS');
  });

  it('escapes script text', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const v = listScripts(ctx.db, p.id)[0];
    v.content.scenes[0].narration = '<script>alert(1)</script>';
    ctx.db.prepare('UPDATE script_versions SET content = ? WHERE id = ?').run(JSON.stringify(v.content), v.id);
    const app = await buildApp(ctx);
    const r = await app.inject({ url: `/api/scripts/${v.id}/view` });
    await app.close();
    expect(r.body).not.toContain('<script>alert(1)</script>');
    expect(r.body).toContain('&lt;script&gt;');
  });
});
