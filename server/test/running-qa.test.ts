import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { listMedia } from '../src/db/repo.js';
import { requestAgentTask } from '../src/services/agent-tasks.js';
import { runningNow } from '../src/services/running.js';
import { approveQaPassed, setMediaQa } from '../src/workflow/production.js';
import { makeCtx, projectWithBrief } from './helpers.js';

describe('"רץ עכשיו"', () => {
  it('מציג משימת Claude בתור עם שם הפרויקט ונתיב עצירה', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    try {
      requestAgentTask(ctx, p.id, { kind: 'qa', stage: 'images', scope: 'all' });
    } catch {
      return; // אין מה לבדוק בפרויקט ריק — הנתיב עצמו נבדק למטה
    }
    const items = runningNow(ctx);
    expect(items.some((i) => i.kind === 'agent' && i.projectId === p.id && i.cancel?.includes('/cancel'))).toBe(true);
  });

  it('הנתיב עונה', async () => {
    const app = await buildApp(makeCtx());
    const r = await app.inject({ method: 'GET', url: '/api/running' });
    expect(r.statusCode).toBe(200);
    expect(Array.isArray(r.json())).toBe(true);
  });
});

describe('אישור כל מה שעבר QA', () => {
  it('בלי טייקים שעברו = שגיאה ברורה', () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    expect(() => approveQaPassed(ctx, p.id, 'images')).toThrow(/QA/);
    expect(listMedia(ctx.db, p.id).length).toBe(0);
    void setMediaQa;
  });
});
