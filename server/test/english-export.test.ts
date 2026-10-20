import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import { itemsFromDocx, parseDocx } from '../src/services/client-feedback.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

async function englishVersion() {
  const ctx = makeCtx();
  const p = projectWithBrief(ctx);
  cmd.completeBrief(ctx, p.id);
  await drain(ctx);
  const v1 = listScripts(ctx.db, p.id)[0];
  const c = structuredClone(v1.content);
  c.scenes.forEach((s, i) => {
    s.narration = `English narration line number ${i + 1} for the client`;
    s.onScreenText = `On screen ${i + 1}`;
    s.visualAction = `Wide shot of the product, scene ${i + 1}`;
    s.notes = '';
  });
  const v = cmd.saveScriptVersion(ctx, p.id, { content: c });
  return { ctx, v };
}

describe('Client files for an English script', { timeout: 30_000 }, () => {
  it('Word is fully English and left-to-right, and client notes in it are still read', async () => {
    const { ctx, v } = await englishVersion();
    const app = await buildApp(ctx);
    const r = await app.inject({ url: `/api/scripts/${v.id}/docx` });
    await app.close();
    expect(decodeURIComponent(String(r.headers['content-disposition']))).toContain(`Script v${v.label}.docx`);
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(r.rawPayload);
    const xml = await zip.file('word/document.xml')!.async('string');
    for (const label of ['Narration', 'On-screen text', 'Visual', 'Client notes &amp; approval', 'Version: ', 'Approved']) expect(xml).toContain(label);
    for (const label of ['קריינות', 'הערות ואישור הלקוח', 'גרסה: ']) expect(xml).not.toContain(label);
    expect(xml).not.toContain('<w:bidiVisual/>');

    // הלקוח כותב הערה בחלק ההערות — הייבוא מזהה אותה גם בקובץ באנגלית
    zip.file('word/document.xml', xml.replace(/Notes: _+/, 'Notes: Please shorten scene 2'));
    const edited = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    const items = itemsFromDocx(parseDocx(edited), v.content);
    expect(items.map((i) => [i.kind, i.text])).toEqual([['note', 'Please shorten scene 2']]);
  });

  it('the PDF page is English and left-to-right', async () => {
    const { ctx, v } = await englishVersion();
    const app = await buildApp(ctx);
    const r = await app.inject({ url: `/api/scripts/${v.id}/view` });
    await app.close();
    expect(r.body).toContain('<html lang="en" dir="ltr">');
    expect(r.body).toContain('<th>Narration</th>');
    expect(r.body).toContain('Client notes &amp; approval');
    expect(r.body).not.toContain('<th>קריינות</th>');
  });
});
