import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { getProject } from '../src/db/repo.js';
import { autofillBrief, siteText } from '../src/services/auto-brief.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx } from './helpers.js';

const extracted = (over: Record<string, unknown> = {}) => ({
  brief: {
    videoType: 'סרטון תדמית', goal: 'להגדיל פניות', productOrService: 'קליניקה לפיזיותרפיה', website: '', targetAudience: 'ספורטאים חובבים',
    targetMarket: 'ישראל', keyMessage: 'חוזרים לרוץ מהר', cta: 'קבעו תור', aspectRatio: '9:16', visualStyle: '', inspirations: '', brandLogo: '',
    brandFonts: '', brandColors: '', brandImages: '', language: 'עברית', tone: 'אנרגטי', voiceNotes: '', budget: '', constraints: '', dueDate: '', notes: '',
    platforms: ['Instagram'], durationSec: 30, voiceoverNeeded: true, characters: [],
    ...over,
  },
  missing: ['מה תאריך היעד?'],
});

function withProvider(ctx: ReturnType<typeof makeCtx>, data = extracted()) {
  const seen: string[] = [];
  (ctx.providers.text as any).claude = {
    id: 'claude',
    label: 'Claude',
    isConfigured: () => true,
    json: async (_n: string, _s: object, _sys: string, user: string) => {
      seen.push(user);
      return { data, model: 'fake' };
    },
  };
  return seen;
}

describe('Auto-fill brief from sources', () => {
  it('fills only empty fields, marks them, and keeps the open questions', async () => {
    const ctx = makeCtx();
    const seen = withProvider(ctx);
    const p = cmd.createProject(ctx, { name: 'Physio', clientName: 'Physio' });
    cmd.updateBrief(ctx, p.id, { goal: 'המטרה שלי' });
    const r = await autofillBrief(ctx, p.id, { text: 'סיכום שיחה עם הלקוח' });
    expect(seen[0]).toContain('סיכום שיחה עם הלקוח');
    const b = getProject(ctx.db, p.id)!.brief;
    expect(b.goal).toBe('המטרה שלי');
    expect(b.videoType).toBe('סרטון תדמית');
    expect(b.durationSec).toBe(30);
    expect(r.filled).not.toContain('goal');
    expect(b.aiFilled).toContain('videoType');
    expect(b.aiQuestions).toEqual(['מה תאריך היעד?']);
  });

  it('removes the ✨ mark from a field once Ohad edits it', async () => {
    const ctx = makeCtx();
    withProvider(ctx);
    const p = cmd.createProject(ctx, { name: 'Physio', clientName: 'Physio' });
    await autofillBrief(ctx, p.id, { text: 'סיכום' });
    cmd.updateBrief(ctx, p.id, { tone: 'רגוע' });
    const b = getProject(ctx.db, p.id)!.brief;
    expect(b.aiFilled).not.toContain('tone');
    expect(b.aiFilled).toContain('videoType');
  });

  it('refuses private addresses and reads a public site as text', async () => {
    let called = false;
    const fake = (async () => {
      called = true;
      return new Response('<html><title>Kvalitor</title><script>x()</script><p>תורים לספרים</p></html>', { headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;
    expect(await siteText('http://localhost:3000', fake)).toBe('');
    expect(await siteText('http://192.168.1.5', fake)).toBe('');
    expect(called).toBe(false);
    const t = await siteText('kvalitor.co.il', fake);
    expect(t).toContain('Kvalitor');
    expect(t).toContain('תורים לספרים');
    expect(t).not.toContain('x()');
  });

  it('accepts files over multipart and needs at least one source', async () => {
    const ctx = makeCtx();
    const seen = withProvider(ctx);
    const p = cmd.createProject(ctx, { name: 'Physio', clientName: 'Physio' });
    const app = await buildApp(ctx);
    const empty = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/brief/autofill`, payload: {} });
    expect(empty.statusCode).toBe(400);

    const boundary = '----apos';
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\nהערות\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="brief.txt"\r\nContent-Type: text/plain\r\n\r\nהלקוח רוצה סרטון של 30 שניות\r\n`,
      `--${boundary}--\r\n`,
    ].join('');
    const res = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/brief/autofill`, payload: Buffer.from(body), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
    expect(res.statusCode).toBe(200);
    expect(seen[0]).toContain('קובץ: brief.txt');
    expect(seen[0]).toContain('30 שניות');
    expect(res.json().filled.length).toBeGreaterThan(5);
  });
});
