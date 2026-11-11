import { describe, expect, it } from 'vitest';
import { listJobs } from '../src/db/repo.js';
import { runOnce } from '../src/jobs/worker.js';
import { bridgeOffline } from '../src/services/bridge.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';
import { projectState } from '../src/services/views.js';
import { getProject } from '../src/db/repo.js';

describe('הגשר של ChatGPT כבוי', () => {
  it('משימת תסריט מחכה בתור, בלי לשרוף ניסיונות, בלי "נכשלה" ובלי חסם', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    const fake = ctx.fake as any;
    fake.generateScript = async () => {
      throw bridgeOffline();
    };
    cmd.completeBrief(ctx, p.id);
    for (let i = 0; i < 5; i++) {
      await runOnce(ctx);
      ctx.db.prepare("UPDATE jobs SET run_after = '2000-01-01T00:00:00.000Z' WHERE status = 'queued'").run();
    }
    const job = listJobs(ctx.db, p.id, 10).find((j) => j.type === 'script.generate')!;
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(0);
    expect(job.lastError).toMatch(/ממתין/);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'job.retry_scheduled'").get()).toEqual({ n: 1 });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'job.failed'").get()).toEqual({ n: 0 });
    // אוהד רואה למה זה מחכה, לא "בתור להרצה"
    const st = projectState(ctx, getProject(ctx.db, p.id)!).stages.find((s) => s.key === 'script')!;
    expect(st.detail).toMatch(/ממתין ל-ChatGPT/);
  });
});
