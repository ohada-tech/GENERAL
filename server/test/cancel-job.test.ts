import { describe, expect, it } from 'vitest';
import { listJobs, listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

describe('Cancelling a running script job', () => {
  it('a revision cancelled while running creates no version', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const v1 = listScripts(ctx.db, p.id)[0];
    const fake = ctx.fake as any;
    fake.reviseScript = async (_c: unknown, b: typeof v1.content) => {
      // אוהד לוחץ "בטל" בזמן שהמודל עוד כותב
      const running = listJobs(ctx.db, p.id, 10).find((j) => j.type === 'script.revise' && j.status === 'running')!;
      cmd.cancelJob(ctx, running.id);
      return { data: { ...b, scenes: b.scenes.map(({ id: _id, ...s }) => s) }, provider: 'fake', model: 'fake-model' };
    };
    cmd.requestScriptRevision(ctx, v1.id, 'לקצר');
    await drain(ctx);
    expect(listScripts(ctx.db, p.id)).toHaveLength(1);
    expect(listJobs(ctx.db, p.id, 10).find((j) => j.type === 'script.revise')!.status).toBe('cancelled');
    expect(ctx.db.prepare("SELECT 1 FROM events WHERE type = 'job.result_discarded'").all()).toHaveLength(1);
  });
});
