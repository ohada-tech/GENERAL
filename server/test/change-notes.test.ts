import { describe, expect, it } from 'vitest';
import { listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import { compactChangeNotes, mechanicalShort } from '../src/services/change-notes.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

const OLD =
  "תיקון AI ל-v2 לפי משוב: הערה סופר חשובה, שים לב שאת התיקונים לגרסה הראשונה ביקשתי נטו על שתי השורות האלה. לא ביקשתי שתערוך מחדש את כל הקריינות · Claude שיפר: בהתאם לכלל שלך, לא שכתבתי את התסריט. הקריינות, המבנה, התזמונים והוויזואל נשארו כפי שהם · תיקון אחד בלבד, שגיאת כתיב בסצנה 6";

describe('Old long version notes get shortened', () => {
  it('mechanical fallback keeps the prefix and drops the repeated feedback', () => {
    const s = mechanicalShort(OLD);
    expect(s.startsWith('תיקון ל-v2: ')).toBe(true);
    expect(s).not.toContain('הערה סופר חשובה');
    expect(s.split(/\s+/).length).toBeLessThanOrEqual(15);
  });

  it('uses Claude to summarize what changed', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const v = listScripts(ctx.db, p.id)[0];
    ctx.db.prepare("UPDATE script_versions SET change_note = ?, source = 'ai_revision' WHERE id = ?").run(OLD, v.id);
    (ctx.fake as any).json = async () => ({ data: { summary: 'סצנה 6: תוקנה שגיאת כתיב' } });
    expect(await compactChangeNotes(ctx)).toBe(1);
    expect(listScripts(ctx.db, p.id)[0].changeNote).toBe('תיקון ל-v2: סצנה 6: תוקנה שגיאת כתיב');
    expect(await compactChangeNotes(ctx)).toBe(0);
  });
});
