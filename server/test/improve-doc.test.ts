import { Document, Packer, Paragraph } from 'docx';
import { describe, expect, it } from 'vitest';
import { listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import { extractDocText } from '../src/services/doc-text.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

describe('Improve any version, with an attached document', () => {
  it('reads text from Word and plain text, refuses PDF', async () => {
    const doc = new Document({ sections: [{ children: [new Paragraph('המסר המרכזי: חיסכון בזמן')] }] });
    expect(extractDocText('brief.docx', await Packer.toBuffer(doc)).text).toContain('חיסכון בזמן');
    expect(extractDocText('notes.txt', Buffer.from('﻿שורה אחת')).text).toBe('שורה אחת');
    expect(() => extractDocText('a.pdf', Buffer.from('%PDF'))).toThrow('PDF');
  });

  it('improves an older version (v1) and sends the document with the note, without locking scenes', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const v1 = listScripts(ctx.db, p.id)[0];
    const c2 = structuredClone(v1.content);
    c2.scenes.forEach((s) => (s.narration = 'גרסה שנייה שונה לגמרי'));
    cmd.saveScriptVersion(ctx, p.id, { content: c2 });

    let sent = '';
    (ctx.providers.text as any).openai = {
      id: 'openai',
      label: 'ChatGPT',
      isConfigured: () => true,
      json: async (_n: string, _s: object, _sys: string, user: string) => {
        sent = user;
        return { data: { reviewNotes: ['שופר'], script: { ...v1.content, scenes: v1.content.scenes.map(({ id: _id, ...s }, i) => ({ ...s, narration: `${'אבגדהוזחטי'[i]}משופר` })) } }, model: 'fake' };
      },
    };
    // הטקסט במסמך מצטט שורה מהתסריט — זה לא אמור לנעול רק את הסצנה הזו
    const quote = v1.content.scenes[0].narration;
    cmd.requestScriptImprove(ctx, v1.id, 'openai', 'תחזק את הפתיחה', { name: 'brief.docx', text: `רקע מהלקוח. ציטוט: ${quote}` });
    await drain(ctx);
    const { listJobs } = await import('../src/db/repo.js');
    const job = listJobs(ctx.db, p.id, 10).find((j) => j.type === 'script.revise');
    expect(job?.lastError ?? null).toBeNull();
    const newest = listScripts(ctx.db, p.id)[0];
    expect(newest.parentId).toBe(v1.id);
    expect(sent).toContain('תחזק את הפתיחה');
    expect(sent).toContain('מסמך מצורף (brief.docx)');
    expect(newest.content.scenes.every((s) => s.narration.endsWith('משופר'))).toBe(true);
  });
});
