import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import { translateScript } from '../src/services/translate.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

async function setup(reply: (input: any) => unknown) {
  const ctx = makeCtx();
  const p = projectWithBrief(ctx);
  cmd.completeBrief(ctx, p.id);
  await drain(ctx);
  const v = listScripts(ctx.db, p.id)[0];
  let calls = 0;
  (ctx.providers.text as any).claude = {
    isConfigured: () => true,
    json: async (_n: string, _s: object, _sys: string, user: string) => {
      calls++;
      return { data: reply(JSON.parse(user)), model: 'fake' };
    },
  };
  return { ctx, v, calls: () => calls };
}

describe('Script translation for reading', () => {
  it('translates the text, keeps scene ids and timing, and caches per language', async () => {
    const { ctx, v, calls } = await setup((src) => ({
      title: 'כותרת',
      logline: 'שורה',
      scenes: src.scenes.map((_: unknown, i: number) => ({ narration: `קריינות ${i + 1}`, onScreenText: '', visualAction: 'ויזואל', notes: '' })),
    }));
    const a = await translateScript(ctx, v.id, 'he');
    expect(a.cached).toBe(false);
    expect(a.content.scenes.map((s) => s.id)).toEqual(v.content.scenes.map((s) => s.id));
    expect(a.content.scenes.map((s) => s.estDurationSec)).toEqual(v.content.scenes.map((s) => s.estDurationSec));
    expect(a.content.scenes[0].narration).toBe('קריינות 1');
    const b = await translateScript(ctx, v.id, 'he');
    expect(b.cached).toBe(true);
    expect(calls()).toBe(1);
    // המקור לא השתנה
    expect(listScripts(ctx.db, v.projectId)[0].content.scenes[0].narration).toBe(v.content.scenes[0].narration);
  });

  it('refuses a partial translation instead of showing wrong scenes', async () => {
    const { ctx, v } = await setup(() => ({ title: '', logline: '', scenes: [] }));
    await expect(translateScript(ctx, v.id, 'he')).rejects.toThrow('חלקי');
  });

  it('downloads the translated version as Word and as the PDF page', async () => {
    const { ctx, v } = await setup((src) => ({
      title: 'כותרת מתורגמת',
      logline: '',
      scenes: src.scenes.map((_: unknown, i: number) => ({ narration: `שורה מתורגמת ${i + 1}`, onScreenText: '', visualAction: '', notes: '' })),
    }));
    const app = await buildApp(ctx);
    const doc = await app.inject({ url: `/api/scripts/${v.id}/docx?lang=he` });
    expect(decodeURIComponent(String(doc.headers['content-disposition']))).toContain('(עברית).docx');
    const { default: JSZip } = await import('jszip');
    const xml = await (await JSZip.loadAsync(doc.rawPayload)).file('word/document.xml')!.async('string');
    expect(xml).toContain('שורה מתורגמת 1');
    const page = await app.inject({ url: `/api/scripts/${v.id}/view?lang=he` });
    expect(page.body).toContain('שורה מתורגמת 1');
    const original = await app.inject({ url: `/api/scripts/${v.id}/view` });
    expect(original.body).not.toContain('שורה מתורגמת 1');
    await app.close();
  });
});
