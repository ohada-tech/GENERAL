import { describe, expect, it } from 'vitest';
import { parseEditedScriptText, scenesFromDocTable, mergeEditedScenes, type ScriptContent } from '@apos/shared';

const base: ScriptContent = {
  title: 'כותרת',
  logline: 'לוגליין',
  scenes: [
    { id: 'a', storyRole: 'hook', narration: 'פתיחה ישנה', onScreenText: 'כותרת 1', visualAction: 'ויזואל 1', estDurationSec: 4, notes: 'הערה פנימית' },
    { id: 'b', storyRole: 'solution', narration: 'אמצע ישן', onScreenText: '', visualAction: 'ויזואל 2', estDurationSec: 6, notes: '' },
    { id: 'c', storyRole: 'cta', narration: 'סוף ישן', onScreenText: 'לינק', visualAction: 'ויזואל 3', estDurationSec: 3, notes: '' },
  ],
};

describe('הוספה ידנית — תסריט שהלקוח ערך', () => {
  it('פסקה לכל סצנה: מחליף קריינות ושומר את השאר מהבסיס', () => {
    const c = parseEditedScriptText('פתיחה חדשה\n\nאמצע חדש\n\nסוף חדש', base);
    expect(c.scenes.map((s) => s.narration)).toEqual(['פתיחה חדשה', 'אמצע חדש', 'סוף חדש']);
    expect(c.scenes[0]).toMatchObject({ id: 'a', storyRole: 'hook', visualAction: 'ויזואל 1', estDurationSec: 4, notes: 'הערה פנימית', onScreenText: 'כותרת 1' });
    expect(c.title).toBe('כותרת');
  });

  it('שורה לכל סצנה כשמספר השורות תואם לבסיס', () => {
    const c = parseEditedScriptText('א\nב\nג', base);
    expect(c.scenes.map((s) => s.narration)).toEqual(['א', 'ב', 'ג']);
  });

  it('כותרות "סצנה N" עם שדות מסומנים', () => {
    const c = parseEditedScriptText(
      'סצנה 1\nקריינות: שלום לכולם\nטקסט על המסך: היי\n\nסצנה 2\nקריינות: תזכרו: זה פשוט\nמה רואים: אישה מחייכת\nשניות: 5',
      base,
    );
    expect(c.scenes).toHaveLength(2);
    expect(c.scenes[0]).toMatchObject({ narration: 'שלום לכולם', onScreenText: 'היי', visualAction: 'ויזואל 1' });
    expect(c.scenes[1]).toMatchObject({ narration: 'תזכרו: זה פשוט', visualAction: 'אישה מחייכת', estDurationSec: 5 });
  });

  it('טבלה שהועתקה מ-Word (טאבים)', () => {
    const c = parseEditedScriptText('#\tקריינות\tטקסט על המסך\tמה רואים\tשניות\n1\tחדש 1\t—\tוויז 1\t4\n2\tחדש 2\tכיתוב\tוויז 2\t7', base);
    expect(c.scenes).toHaveLength(2);
    expect(c.scenes[0]).toMatchObject({ narration: 'חדש 1', onScreenText: '', visualAction: 'וויז 1', estDurationSec: 4 });
    expect(c.scenes[1]).toMatchObject({ onScreenText: 'כיתוב', estDurationSec: 7 });
  });

  it('טבלת ה-Word של המערכת אחרי עריכת הלקוח', () => {
    const rows = scenesFromDocTable([
      [['#', 'קריינות', 'טקסט על המסך', 'מה רואים', 'שניות'], ['1\nהוק / פתיחה', 'פתיחה של הלקוח', '—', 'ויזואל 1', '4'], ['2\nפתרון', 'אמצע של הלקוח', 'חדש', 'ויזואל 2', '6']],
    ]);
    expect(rows).not.toBeNull();
    const c = mergeEditedScenes(base, rows!);
    expect(c.scenes).toHaveLength(2);
    expect(c.scenes[0]).toMatchObject({ id: 'a', storyRole: 'hook', narration: 'פתיחה של הלקוח', onScreenText: '', notes: 'הערה פנימית' });
    expect(c.scenes[1]).toMatchObject({ storyRole: 'solution', onScreenText: 'חדש' });
  });

  it('בלי טבלת תסריט בקובץ ← null', () => {
    expect(scenesFromDocTable([[['a', 'b']]])).toBeNull();
  });

  it('בלי בסיס: סצנה לכל פסקה', () => {
    const c = parseEditedScriptText('אחת\n\nשתיים', null);
    expect(c.scenes.map((s) => [s.narration, s.storyRole, s.id])).toEqual([['אחת', 'other', ''], ['שתיים', 'other', '']]);
  });
});

describe('Word של המערכת ← חזרה לסצנות', () => {
  it('הקובץ שנשלח ללקוח נקרא חזרה לאותן סצנות', async () => {
    const { scriptDocx } = await import('../src/services/script-docx.js');
    const { parseDocx } = await import('../src/services/client-feedback.js');
    const buf = await scriptDocx({
      version: { id: 'v', projectId: 'p', version: 1, major: 1, minor: 0, label: '1', parentId: null, source: 'ai', provider: null, model: null, status: 'draft', content: base, changeNote: '', createdBy: 'x', createdAt: new Date().toISOString() } as any,
      projectName: 'פרויקט',
      clientName: 'לקוח',
      language: 'he',
      targetSec: 15,
    });
    const rows = scenesFromDocTable(parseDocx(buf).tables);
    const c = mergeEditedScenes(base, rows!);
    expect(c.scenes.map((s) => [s.id, s.storyRole, s.narration, s.onScreenText, s.visualAction, s.estDurationSec])).toEqual(
      base.scenes.map((s) => [s.id, s.storyRole, s.narration, s.onScreenText, s.visualAction, s.estDurationSec]),
    );
  });
});
