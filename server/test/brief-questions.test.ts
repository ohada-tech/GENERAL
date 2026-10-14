import { emptyBrief, openDiscoveryQuestions, validateBrief } from '@apos/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeCtx, projectWithBrief } from './helpers.js';

describe('Brief discovery questions', () => {
  it('target market is required and asked first among the critical questions', () => {
    const b = emptyBrief();
    expect(validateBrief(b).missingRequired.map((m) => m.field)).toContain('targetMarket');
    const open = openDiscoveryQuestions(b);
    expect(open[0].critical).toBe(true);
    expect(open.some((q) => q.field === 'targetMarket')).toBe(true);
    expect(openDiscoveryQuestions({ ...b, targetMarket: 'ארה"ב ואירופה' }).some((q) => q.field === 'targetMarket')).toBe(false);
  });

  it('Claude suggests project-specific follow-up questions', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    let sent = '';
    (ctx.fake as any).json = async (_n: string, _s: object, _sys: string, user: string) => {
      sent = user;
      return { data: { questions: [{ q: 'האם יש גרסה באנגלית?', why: 'שוק יעד' }] } };
    };
    const app = await buildApp(ctx);
    const r = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/brief/questions`, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().questions[0].q).toBe('האם יש גרסה באנגלית?');
    expect(sent).toContain('Target market / country: ישראל');
    await app.close();
  });
});
