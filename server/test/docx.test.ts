import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

describe('Script as a Word file for the client', () => {
  it('downloads a .docx with the scenes and no internal notes', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const v = listScripts(ctx.db, p.id)[0];
    ctx.db.prepare('UPDATE script_versions SET change_note = ? WHERE id = ?').run('הערה פנימית סודית', v.id);
    const app = await buildApp(ctx);
    const r = await app.inject({ url: `/api/scripts/${v.id}/docx` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('wordprocessingml');
    expect(String(r.headers['content-disposition'])).toContain("filename*=UTF-8''");
    expect(r.rawPayload.subarray(0, 2).toString()).toBe('PK');
    const { default: JSZip } = await import('jszip');
    const xml = await (await JSZip.loadAsync(r.rawPayload)).file('word/document.xml')!.async('string');
    expect(xml).toContain(v.content.scenes[0].narration.split(' ')[0]);
    expect(xml).toContain('הערות ואישור הלקוח');
    expect(xml).not.toContain('הערה פנימית סודית');
    expect(xml).not.toContain('fake-model');
    await app.close();
  });
});
