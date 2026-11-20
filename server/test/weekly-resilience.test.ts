import { describe, expect, it } from 'vitest';
import { listJobs } from '../src/db/repo.js';
import { drain, runOnce } from '../src/jobs/worker.js';
import { ProviderError } from '../src/providers/types.js';
import { bridge } from '../src/services/bridge.js';
import * as learning from '../src/services/learning.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

describe('כשל ב-ChatGPT של הגשר: לא התחבר', () => {
  it('התסריט מחכה בתור (לא נכשל), אוהד מקבל התראה אחת, והיא נסגרת כשהכתיבה מצליחה', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    const fake = ctx.fake as any;
    const orig = fake.generateScript.bind(fake);
    fake.generateScript = async () => {
      throw new ProviderError("ChatGPT לא מחובר בחלון Chrome של הגשר — צריך להתחבר שם פעם אחת, והכתיבה תמשיך לבד.", true, 'bridge_login');
    };
    cmd.completeBrief(ctx, p.id);
    for (let i = 0; i < 4; i++) {
      await runOnce(ctx);
      ctx.db.prepare("UPDATE jobs SET run_after = '2000-01-01T00:00:00.000Z' WHERE status = 'queued'").run();
    }
    const job = listJobs(ctx.db, p.id, 10).find((j) => j.type === 'script.generate')!;
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(0);
    const open = () => ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE project_id = ? AND body LIKE '%ChatGPT לא מחובר%' AND read_at IS NULL").get(p.id);
    expect(open()).toEqual({ n: 1 });

    fake.generateScript = orig;
    ctx.db.prepare("UPDATE jobs SET run_after = '2000-01-01T00:00:00.000Z' WHERE status = 'queued'").run();
    await drain(ctx);
    expect(listJobs(ctx.db, p.id, 10).find((j) => j.type === 'script.generate')!.status).toBe('succeeded');
    expect(open()).toEqual({ n: 0 });
  });

  it('שגיאת התחברות מהעובד במחשב מסווגת כהמתנה', () => {
    const rejected: unknown[] = [];
    (bridge as any).pending.set('x', { req: { id: 'x' }, takenAt: 1, resolve: () => {}, reject: (e: unknown) => rejected.push(e) });
    bridge.answer('x', { error: "Chrome של הגשר לא מחובר ל-ChatGPT — צריך להתחבר בחלון שנפתח" });
    expect(rejected[0]).toMatchObject({ code: 'bridge_login', retryable: true });
  });
});

describe('למידה מהערות כשאין קרדיט ב-Claude', () => {
  it('עוברת ל-ChatGPT במקום ליפול', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    const fake = ctx.fake as any;
    const calls: string[] = [];
    const claude = { isConfigured: () => true, json: async () => { calls.push('claude'); throw new ProviderError('אין קרדיט', false, 'insufficient_quota'); } };
    const openai = { isConfigured: () => true, json: async () => { calls.push('openai'); return { data: { lessons: [{ scope: 'global', area: 'script', text: 'כלל' }] }, model: 'm' }; } };
    (ctx.providers.text as any).claude = claude;
    (ctx.providers.text as any).openai = openai;
    void fake;
    learning.recordFeedback(ctx, p.id, 'script', 'ההוק חלש');
    learning.maybeDistill(ctx, p.id, true);
    await drain(ctx);
    expect(calls).toEqual(['claude', 'openai']);
    expect(learning.pendingFeedbackCount(ctx)).toBe(0);
  });

  it('אם שני המנועים לא זמינים — נדחית בשקט, בלי "נכשלה", וההערות נשארות', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    const down = { isConfigured: () => true, json: async () => { throw new ProviderError('אין קרדיט', false, 'insufficient_quota'); } };
    (ctx.providers.text as any).claude = down;
    (ctx.providers.text as any).openai = down;
    learning.recordFeedback(ctx, p.id, 'script', 'ההוק חלש');
    learning.maybeDistill(ctx, p.id, true);
    await drain(ctx);
    const j = listJobs(ctx.db, p.id, 10).find((x) => x.type === 'lessons.distill')!;
    expect(j.status).toBe('succeeded');
    expect(learning.pendingFeedbackCount(ctx)).toBe(1);
  });
});
