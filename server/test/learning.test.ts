import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { listJobs, listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import { briefToText } from '../src/providers/prompts.js';
import type { ProjectContext } from '../src/providers/types.js';
import * as learning from '../src/services/learning.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

/** מוסיף לספק המזויף קריאת JSON שמחזירה כללים, ומתעד את ההקשר שנשלח לכתיבת תסריט */
function learningCtx() {
  const ctx = makeCtx();
  const seen: ProjectContext[] = [];
  const distillInputs: string[] = [];
  const fake = ctx.fake as any;
  const orig = fake.reviseScript.bind(fake);
  fake.reviseScript = async (c: ProjectContext, ...rest: any[]) => {
    seen.push(c);
    return orig(c, ...rest);
  };
  fake.json = async (_n: string, _s: object, _sys: string, user: string) => {
    distillInputs.push(user);
    return {
      data: {
        lessons: [
          { scope: 'global', area: 'script', text: 'ההוק חייב להראות את המוצר ב-2 השניות הראשונות' },
          { scope: 'client:לקוח בדיקה', area: 'script', text: 'בלי סלנג — טון רשמי' },
          { scope: 'bogus', area: 'nope', text: 'כלל עם scope לא תקין' },
        ],
      },
      model: 'fake-model',
    };
  };
  return { ctx, seen, distillInputs };
}

describe('Learning engine', () => {
  it('records feedback, distills it into lessons after a few notes, and injects them into the next prompt', async () => {
    const { ctx, seen, distillInputs } = learningCtx();
    const p = projectWithBrief(ctx);
    ctx.db.prepare('UPDATE projects SET client_name = ? WHERE id = ?').run('לקוח בדיקה', p.id);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const v1 = listScripts(ctx.db, p.id)[0];

    cmd.requestScriptChanges(ctx, v1.id, { from: 'client', note: 'הטון צעיר מדי', by: 'דנה' });
    expect(learning.pendingFeedbackCount(ctx)).toBe(1);
    cmd.requestScriptRevision(ctx, v1.id, 'להראות את המוצר כבר בהתחלה');
    await drain(ctx);
    expect(listJobs(ctx.db, p.id).some((j) => j.type === 'lessons.distill')).toBe(false);

    const v2 = listScripts(ctx.db, p.id)[0];
    cmd.requestScriptRevision(ctx, v2.id, 'פחות מילים בסצנה 2');
    expect(listJobs(ctx.db, p.id).filter((j) => j.type === 'lessons.distill')).toHaveLength(1);
    await drain(ctx);

    expect(distillInputs[0]).toContain('הטון צעיר מדי');
    expect(distillInputs[0]).toContain('client: לקוח בדיקה');
    expect(learning.pendingFeedbackCount(ctx)).toBe(0);
    const lessons = learning.listLessons(ctx);
    expect(lessons).toHaveLength(3);
    expect(lessons.find((l) => l.text.startsWith('כלל עם'))?.scope).toBe('global');

    // הסבב הבא של התסריט כבר מקבל את הכללים
    const v3 = listScripts(ctx.db, p.id)[0];
    cmd.requestScriptRevision(ctx, v3.id, 'עוד ניסיון');
    await drain(ctx);
    const last = seen.at(-1)!;
    expect(last.lessons).toEqual(['ההוק חייב להראות את המוצר ב-2 השניות הראשונות', 'כלל עם scope לא תקין', '[לקוח בדיקה] בלי סלנג — טון רשמי']);
    expect(briefToText(last)).toContain('HOUSE RULES LEARNED');
  });

  it('client rules stay with their client', () => {
    const { ctx } = learningCtx();
    learning.addLesson(ctx, { scope: 'client:A', area: 'image', text: 'רקע לבן' });
    learning.addLesson(ctx, { scope: 'global', area: 'image', text: 'עור טבעי' });
    expect(learning.lessonsFor(ctx, 'B', ['image'])).toEqual(['עור טבעי']);
    expect(learning.lessonsFor(ctx, 'A', ['image'])).toEqual(['עור טבעי', '[A] רקע לבן']);
    expect(learning.lessonsFor(ctx, 'A', ['script'])).toEqual([]);
  });

  it('a learned rule the owner turned off is not resurrected by the next distill', () => {
    const { ctx } = learningCtx();
    learning.applyDistilled(ctx, [{ scope: 'global', area: 'motion', text: 'תנועת מצלמה איטית' }], []);
    const [l] = learning.listLessons(ctx);
    learning.updateLesson(ctx, l.id, { active: false });
    const prompts = learning.distillPrompts(ctx);
    expect(prompts.user).toContain('TURNED OFF');
    expect(prompts.user).toContain('תנועת מצלמה איטית');
    learning.applyDistilled(ctx, [{ scope: 'global', area: 'motion', text: 'כלל חדש' }], []);
    const after = learning.listLessons(ctx);
    expect(after.map((x) => [x.text, x.active])).toEqual(
      expect.arrayContaining([
        ['תנועת מצלמה איטית', false],
        ['כלל חדש', true],
      ]),
    );
  });

  it('exposes lessons over the API (list, add, toggle, delete, learn now)', async () => {
    const { ctx } = learningCtx();
    const p = projectWithBrief(ctx);
    const app = await buildApp(ctx);
    const add = await app.inject({ method: 'POST', url: '/api/lessons', payload: { area: 'audio', text: 'מוזיקה שקטה מתחת לקריין' } });
    expect(add.statusCode).toBe(200);
    const id = add.json().id;
    expect((await app.inject({ method: 'PATCH', url: `/api/lessons/${id}`, payload: { active: false } })).json().active).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/api/lessons/distill' })).statusCode).toBe(409);
    learning.recordFeedback(ctx, p.id, 'image', 'הדמות צריכה לחייך');
    const now = await app.inject({ method: 'POST', url: '/api/lessons/distill' });
    expect(now.statusCode).toBe(200);
    await drain(ctx);
    const list = (await app.inject({ url: '/api/lessons' })).json();
    expect(list.pending).toBe(0);
    expect(list.feedback[0].text).toBe('הדמות צריכה לחייך');
    expect(list.lessons.length).toBe(4);
    expect((await app.inject({ method: 'DELETE', url: `/api/lessons/${id}` })).statusCode).toBe(200);
    await app.close();
  });
});
