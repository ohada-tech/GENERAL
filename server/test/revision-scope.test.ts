import { describe, expect, it } from 'vitest';
import { listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import * as cmd from '../src/workflow/commands.js';
import { lockToTargets, targetScenes } from '../src/workflow/revision-scope.js';
import { makeCtx, projectWithBrief } from './helpers.js';

const base = {
  title: 'כותרת',
  logline: 'לוגליין',
  scenes: [1, 2, 3].map((n) => ({
    id: `s${n}`,
    storyRole: 'other',
    narration: n === 3 ? 'ממשחקנים אחרים כמוך שכבר הצטרפו אלינו היום' : `קריינות של סצנה מספר ${n} עם עוד כמה מילים`,
    onScreenText: '',
    visualAction: `ויזואל ${n}`,
    estDurationSec: 5,
    notes: '',
  })),
};

describe('Scoped script revisions', () => {
  it('finds the scenes a note quotes or names', () => {
    expect(targetScenes(base, 'תשפר את השורה: "ממשחקנים אחרים כמוך שכבר הצטרפו"')).toEqual([2]);
    expect(targetScenes(base, 'בסצנה 1 תקצר')).toEqual([0]);
    expect(targetScenes(base, 'הטון צריך להיות יותר צעיר')).toEqual([]);
  });

  it('restores every untargeted scene, title and logline', () => {
    const revised = { title: 'חדש', logline: 'חדש', scenes: base.scenes.map(({ id: _id, ...s }) => ({ ...s, narration: 'נכתב מחדש' })) };
    const out = lockToTargets(base, revised, [2]);
    expect(out.title).toBe('כותרת');
    expect(out.scenes.map((s) => s.narration)).toEqual([base.scenes[0].narration, base.scenes[1].narration, 'נכתב מחדש']);
  });

  it('end to end: a model that rewrites everything only changes the quoted lines', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const v1 = listScripts(ctx.db, p.id)[0];
    const fake = ctx.fake as any;
    let sentFeedback = '';
    fake.reviseScript = async (_c: unknown, b: typeof base, f: string) => {
      sentFeedback = f;
      return {
        data: { title: 'הכל חדש', logline: 'הכל חדש', scenes: b.scenes.map(({ id: _id, ...s }) => ({ ...s, narration: 'נכתב מחדש לגמרי' })) },
        provider: 'fake',
        model: 'fake-model',
      };
    };
    const last = v1.content.scenes.at(-1)!;
    cmd.requestScriptRevision(ctx, v1.id, `רק את השורה הזאת לשפר:\n${last.narration}`);
    await drain(ctx);
    const v2 = listScripts(ctx.db, p.id)[0];
    expect(sentFeedback).toContain('SCOPE (mandatory)');
    expect(v2.content.title).toBe(v1.content.title);
    expect(v2.content.scenes.slice(0, -1).map((s) => s.narration)).toEqual(v1.content.scenes.slice(0, -1).map((s) => s.narration));
    expect(v2.content.scenes.at(-1)!.narration).toBe('נכתב מחדש לגמרי');
    expect(v2.changeNote).toBe(`תיקון ל-v1 (סצנה ${v1.content.scenes.length} בלבד)`);
  });
});

describe('Improve with one model', () => {
  it('ChatGPT reviews the whole script and a new version is saved with a short note', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const v1 = listScripts(ctx.db, p.id)[0];
    let reviewed = '';
    (ctx.fake as any).json = async (name: string, _s: object, _sys: string, user: string) => {
      if (name !== 'script_review') return { data: { lessons: [] } };
      reviewed = user;
      return {
        data: { reviewNotes: ['חיזוק ההוק'], script: { title: v1.content.title, logline: v1.content.logline, scenes: v1.content.scenes.map(({ id: _id, ...s }) => ({ ...s, narration: `${s.narration}!` })) } },
        model: 'gpt-x',
      };
    };
    cmd.requestScriptImprove(ctx, v1.id, 'openai');
    await drain(ctx);
    const v2 = listScripts(ctx.db, p.id)[0];
    expect(reviewed).toContain('DRAFT SCRIPT');
    expect(v2.version).toBe(2);
    expect(v2.changeNote).toBe('שיפור ChatGPT ל-v1: חיזוק ההוק');
    expect(v2.content.scenes.every((s) => s.narration.endsWith('!'))).toBe(true);
  });
});
