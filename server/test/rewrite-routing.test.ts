/**
 * "כתוב מחדש" ≠ תיקון נקודתי ≠ הערה כללית, ושער כללי הקופי לפני שמירת גרסה מתיקון.
 * הכשל (21.10): בקשת סגנון כללית נשלחה כ-SURGICAL EDIT והתסריט שמר את השלד והקצב הישנים.
 */
import { describe, expect, it } from 'vitest';
import { listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import { reviseUserPrompt } from '../src/providers/prompts.js';
import type { ProjectContext } from '../src/providers/types.js';
import { newCopyViolations } from '../src/services/creative-checks.js';
import * as cmd from '../src/workflow/commands.js';
import { isRewriteRequest, revisionKind } from '../src/workflow/revision-scope.js';
import { makeCtx, projectWithBrief } from './helpers.js';

describe('סוג התיקון', () => {
  it('מזהה בקשה לכתוב מחדש', () => {
    for (const f of ['תכתוב מחדש, זה חזרתי', 'תכתבי את זה מחדש', 'שכתוב מלא בבקשה', 'תשכתב את כל התסריט', 'בוא נתחיל מההתחלה', 'מאפס', 'צריך כיוון אחר', 'rewrite it from scratch'])
      expect(isRewriteRequest(f), f).toBe(true);
    for (const f of ['הטון צריך להיות יותר צעיר', 'תקצר את הפתיחה', 'מההתחלה זה מרגיש איטי', 'תוריד את המילה "פשוט"'])
      expect(isRewriteRequest(f), f).toBe(false);
  });

  it('ציטוט / מספר סצנה = ממוקד, גם כשכתוב "מחדש"', () => {
    expect(revisionKind('תכתוב מחדש את סצנה 2', [1])).toBe('surgical');
    expect(revisionKind('תכתוב מחדש', [])).toBe('rewrite');
    expect(revisionKind('הטון צריך להיות יותר צעיר', [])).toBe('global');
  });

  it('הערה כללית לא נשלחת כ-SURGICAL EDIT', () => {
    const ctx = { name: 'n', clientName: 'c', brief: { language: 'עברית', platforms: [], characters: [], links: [] } } as unknown as ProjectContext;
    const base = { title: 't', logline: 'l', scenes: [] };
    expect(reviseUserPrompt(ctx, base, 'x')).toContain('SURGICAL EDIT');
    expect(reviseUserPrompt({ ...ctx, revision: 'global' }, base, 'x')).not.toContain('SURGICAL');
    expect(reviseUserPrompt({ ...ctx, revision: 'global' }, base, 'x')).toContain('GENERAL NOTE');
    expect(reviseUserPrompt({ ...ctx, revision: 'rewrite' }, base, 'x')).toContain('do not reuse its wording');
  });
});

async function v1Of() {
  const ctx = makeCtx();
  const p = projectWithBrief(ctx);
  cmd.completeBrief(ctx, p.id);
  await drain(ctx);
  return { ctx, p, v1: listScripts(ctx.db, p.id)[0] };
}

describe('ניתוב בקשות מתיבת התיקון', () => {
  it('הערה כללית: הכותב מקבל הנחיה לעבור על כל התסריט, בלי נעילה', async () => {
    const { ctx, p, v1 } = await v1Of();
    const seen: Array<string | undefined> = [];
    const fake = ctx.fake as any;
    const orig = fake.reviseScript.bind(fake);
    fake.reviseScript = async (c: ProjectContext, ...rest: any[]) => {
      seen.push(c.revision);
      return orig(c, ...rest);
    };
    cmd.requestScriptRevision(ctx, v1.id, 'הטון צריך להיות יותר צעיר ופחות חזרתי');
    await drain(ctx);
    expect(seen).toEqual(['global']);
    expect(listScripts(ctx.db, p.id)[0].parentId).toBe(v1.id);
  });

  it('"תכתוב מחדש" בלי ChatGPT מחובר: לא SURGICAL — הנחיה לכתוב מחדש, והגרסה מסומנת ככתיבה מחדש', async () => {
    const { ctx, p, v1 } = await v1Of();
    const seen: Array<string | undefined> = [];
    const fake = ctx.fake as any;
    const orig = fake.reviseScript.bind(fake);
    fake.reviseScript = async (c: ProjectContext, ...rest: any[]) => {
      seen.push(c.revision);
      return orig(c, ...rest);
    };
    cmd.requestScriptRevision(ctx, v1.id, 'תכתוב מחדש, זה מרגיש כמו ברושור');
    await drain(ctx);
    expect(seen).toEqual(['rewrite']);
    expect(listScripts(ctx.db, p.id)[0].changeNote).toContain('כתיבה מחדש');
  });
});

describe('שער כללי הקופי לפני שמירה', () => {
  const brief = { language: 'עברית', durationSec: 0, voiceoverNeeded: true };
  const sc = (narration: string) => ({ storyRole: 'other' as const, narration, onScreenText: '', visualAction: '', estDurationSec: 3, notes: '' });

  it('רק הפרות שהתיקון הכניס נזקפות לו', () => {
    const base = { scenes: [sc('הגיע הזמן לשנות'), sc('משהו אחר לגמרי')] };
    expect(newCopyViolations(base, base, brief)).toEqual([]);
    const revised = { scenes: [sc('הגיע הזמן לשנות'), sc('זה הפתרון המושלם')] };
    expect(newCopyViolations(base, revised, brief)).toEqual(['ביטוי ברושור: "הפתרון המושלם"']);
  });

  it('תיקון שהכניס ביטוי ברושור חוזר לכותב פעם אחת עם ההפרה, והגרסה שנשמרת נקייה', async () => {
    const { ctx, p, v1 } = await v1Of();
    const notes: string[] = [];
    const fake = ctx.fake as any;
    fake.reviseScript = async (_c: unknown, b: typeof v1.content, f: string) => {
      notes.push(f);
      const bad = notes.length === 1;
      return {
        data: { title: b.title, logline: b.logline, scenes: b.scenes.map(({ id: _id, ...s }, i) => ({ ...s, narration: i === 0 ? (bad ? 'הפתרון המושלם בשבילך' : 'שורה צעירה וחדשה') : s.narration })) },
        provider: 'fake',
        model: 'fake-model',
      };
    };
    cmd.requestScriptRevision(ctx, v1.id, 'הטון צריך להיות יותר צעיר');
    await drain(ctx);
    expect(notes).toHaveLength(2);
    expect(notes[1]).toContain('COPY RULES');
    expect(notes[1]).toContain('הפתרון המושלם');
    const v2 = listScripts(ctx.db, p.id)[0];
    expect(v2.content.scenes[0].narration).not.toContain('הפתרון המושלם');
    expect(v2.changeNote).not.toContain('כללי קופי');
  });

  it('הפרה שנשארת אחרי הסבב השני מסומנת בהערת הגרסה, לא נבלעת בשקט', async () => {
    const { ctx, p, v1 } = await v1Of();
    const fake = ctx.fake as any;
    fake.reviseScript = async (_c: unknown, b: typeof v1.content) => ({
      data: { title: b.title, logline: b.logline, scenes: b.scenes.map(({ id: _id, ...s }, i) => ({ ...s, narration: i === 0 ? 'הפתרון המושלם בשבילך' : s.narration })) },
      provider: 'fake',
      model: 'fake-model',
    });
    cmd.requestScriptRevision(ctx, v1.id, 'הטון צריך להיות יותר צעיר');
    await drain(ctx);
    const v2 = listScripts(ctx.db, p.id)[0];
    expect(v2.parentId).toBe(v1.id);
    expect(v2.changeNote).toContain('⚠️ כללי קופי: ביטוי ברושור: "הפתרון המושלם"');
  });
});
