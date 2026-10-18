import { CommentRangeEnd, CommentRangeStart, CommentReference, Document, Packer, Paragraph, TextRun } from 'docx';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import {
  applyClientFeedback,
  fetchGoogleDoc,
  getFeedbackImport,
  importClientFeedback,
  itemsFromDocx,
  itemsFromText,
  parseDocx,
  scenesFor,
} from '../src/services/client-feedback.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

async function setup() {
  const ctx = makeCtx();
  const p = projectWithBrief(ctx);
  cmd.completeBrief(ctx, p.id);
  await drain(ctx);
  // קריינות שונה לכל סצנה (בתוכן ההדגמה הסצנות דומות מדי)
  const demo = listScripts(ctx.db, p.id)[0];
  const words = ['שקיעה', 'מטבח', 'אוטובוס', 'ספרייה', 'חוף', 'מעלית', 'גשם', 'שוק', 'גשר'];
  demo.content.scenes.forEach((s, i) => (s.narration = `סצנה על ${words[i % words.length]} עם עוד כמה מילים ${i + 1}`));
  ctx.db.prepare('UPDATE script_versions SET content = ? WHERE id = ?').run(JSON.stringify(demo.content), demo.id);
  const v1 = listScripts(ctx.db, p.id)[0];
  return { ctx, p, v1 };
}

/** הקובץ שהמערכת מייצאת ללקוח, אחרי שהלקוח כתב בו */
async function exportedWithClientNotes(ctx: Awaited<ReturnType<typeof setup>>['ctx'], versionId: string, edit: (xml: string) => string) {
  const app = await buildApp(ctx);
  const r = await app.inject({ url: `/api/scripts/${versionId}/docx` });
  await app.close();
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(r.rawPayload);
  const xml = await zip.file('word/document.xml')!.async('string');
  zip.file('word/document.xml', edit(xml));
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

describe('Client feedback import', { timeout: 30_000 }, () => {
  it('reads notes written in our exported Word file and direct edits in the script table', async () => {
    const { ctx, p, v1 } = await setup();
    const first = v1.content.scenes[0].narration;
    const buf = await exportedWithClientNotes(ctx, v1.id, (xml) =>
      xml
        .replace(/הערות: _+/, 'הערות: חסר מסר על למידה מהקהילה')
        .replace(/>_{20,}</, '>סצנה 2 — לקצר<')
        .replace(`>${first}<`, '>נוסח חדש של הלקוח<'),
    );
    const parsed = parseDocx(buf);
    expect(parsed.tables.some((t) => t[0]?.[1]?.includes('קריינות'))).toBe(true);
    const items = itemsFromDocx(parsed, v1.content);
    expect(items.map((i) => [i.kind, i.scenes])).toEqual([
      ['edit', [0]],
      ['note', []],
      ['note', [1]],
    ]);
    expect(items[0].text).toContain('נוסח חדש של הלקוח');

    const imp = await importClientFeedback(ctx, p.id, { file: { name: 'notes.docx', data: buf } });
    expect(imp.baseVersionId).toBe(v1.id);
    expect(imp.detectedLabel).toBe(v1.label);
    expect(imp.items).toHaveLength(3);
  });

  it('an untouched export has no notes', async () => {
    const { ctx, p, v1 } = await setup();
    const buf = await exportedWithClientNotes(ctx, v1.id, (x) => x);
    await expect(importClientFeedback(ctx, p.id, { file: { name: 'a.docx', data: buf } })).rejects.toThrow('לא נמצאו הערות');
  });

  it('reads Word comments with the text they point at', async () => {
    const { v1 } = await setup();
    const c = structuredClone(v1.content);
    const lines = ['הבוקר מתחיל בכוס קפה חמה', 'השעון מצלצל ואף אחד לא קם', 'בסוף היום כולם חוזרים הביתה'];
    c.scenes.forEach((s, i) => (s.narration = lines[i % 3] + ` ${'אבגדהוזחט'[i]}`));
    const quoted = c.scenes[2].narration;
    const doc = new Document({
      comments: { children: [{ id: 0, author: 'לקוח', date: new Date(0), children: [new Paragraph('לקצר את המשפט')] }] },
      sections: [
        {
          children: [
            new Paragraph({ children: [new CommentRangeStart(0), new TextRun(quoted), new CommentRangeEnd(0), new TextRun({ children: [new CommentReference(0)] })] }),
          ],
        },
      ],
    });
    const items = itemsFromDocx(parseDocx(await Packer.toBuffer(doc)), c);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'comment', author: 'לקוח', quote: quoted, text: 'לקצר את המשפט', scenes: [2] });
  });

  it('maps a leading number to a scene, or to a unique scene duration', async () => {
    const { v1 } = await setup();
    const c = structuredClone(v1.content);
    c.scenes.forEach((s, i) => (s.estDurationSec = i + 0.5));
    expect(scenesFor(c, '', '2 — לחדד')).toEqual([1]);
    expect(scenesFor(c, '', '1.5 לא ברור')).toEqual([1]);
    expect(scenesFor(c, '', 'הטון צריך להיות צעיר יותר')).toEqual([]);
    expect(itemsFromText('- הערה ראשונה\n- הערה שנייה\n\nהערה שלישית', c).map((i) => i.text)).toEqual(['הערה ראשונה', 'הערה שנייה', 'הערה שלישית']);
  });

  it('applies the notes as one revision and links the new version back to the import', async () => {
    const { ctx, p, v1 } = await setup();
    const fake = ctx.fake as any;
    let sent = '';
    fake.reviseScript = async (_c: unknown, b: typeof v1.content, f: string) => {
      sent = f;
      return { data: { ...b, scenes: b.scenes.map(({ id: _id, ...s }) => ({ ...s, narration: 'נכתב מחדש' })) }, provider: 'fake', model: 'fake-model' };
    };
    const imp = await importClientFeedback(ctx, p.id, { text: 'סצנה 2: לקצר\n\nהשם תמיד באותיות קטנות' });
    // רק ההערה הממוקדת נבחרה ← רק סצנה 2 משתנה
    applyClientFeedback(ctx, imp.id, { items: imp.items.map((it, i) => ({ ...it, include: i === 0 })) });
    await drain(ctx);
    const v2 = listScripts(ctx.db, p.id)[0];
    expect(sent).toContain('1. [סצנה 2 · הערה] סצנה 2: לקצר');
    expect(sent).not.toContain('אותיות קטנות');
    expect(v2.changeNote).toBe(`תיקון לפי הערות הלקוח (1 הערות) ל-v${v1.label} (סצנה 2 בלבד)`);
    expect(v2.content.scenes.map((s) => s.narration)).toEqual(v1.content.scenes.map((s, i) => (i === 1 ? 'נכתב מחדש' : s.narration)));
    expect(getFeedbackImport(ctx, imp.id)).toMatchObject({ status: 'applied', resultVersionId: v2.id });

    // הערה כללית פותחת את כל התסריט
    const imp2 = await importClientFeedback(ctx, p.id, { text: 'השם תמיד באותיות קטנות' });
    applyClientFeedback(ctx, imp2.id, {});
    await drain(ctx);
    expect(listScripts(ctx.db, p.id)[0].content.scenes.every((s) => s.narration === 'נכתב מחדש')).toBe(true);
  });

  it('explains what to do when a Google Doc is not shared', async () => {
    const html = (async () => new Response('<html>sign in</html>', { status: 200 })) as unknown as typeof fetch;
    await expect(fetchGoogleDoc('https://example.com/x', html)).rejects.toThrow('Google Doc');
    await expect(fetchGoogleDoc('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789/edit', html)).rejects.toThrow('כל מי שיש לו את הקישור');
    let asked = '';
    const ok = (async (u: string) => {
      asked = u;
      return new Response(new Uint8Array([0x50, 0x4b, 3, 4]));
    }) as unknown as typeof fetch;
    await fetchGoogleDoc('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789/edit?tab=t.0', ok);
    expect(asked).toBe('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789/export?format=docx');
  });
});
