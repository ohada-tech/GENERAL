import { describe, expect, it } from 'vitest';
import { currentStoryboard, listScripts, listShots } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

async function draftStoryboard() {
  const ctx = makeCtx();
  const p = projectWithBrief(ctx);
  cmd.completeBrief(ctx, p.id);
  await drain(ctx);
  const v = listScripts(ctx.db, p.id)[0];
  cmd.approveScriptInternal(ctx, v.id);
  cmd.recordClientApproval(ctx, v.id, { approvedBy: 'לקוח' });
  await drain(ctx);
  const sbId = currentStoryboard(ctx.db, p.id)!.id;
  return { ctx, sbId };
}

describe('מחיקת שוט מיותר בלי לאבד קריינות', () => {
  it('הקריינות והזמן של השוט עוברים לשוט הקודם, והמספור מתעדכן', async () => {
    const { ctx, sbId } = await draftStoryboard();
    let shots = listShots(ctx.db, sbId);
    while (shots.length < 3) {
      cmd.addShot(ctx, shots[0].projectId, { sceneIndex: shots[0].sceneIndex });
      shots = listShots(ctx.db, sbId);
    }
    cmd.updateShot(ctx, shots[0].id, { sceneIndex: 0, narration: 'שורה ראשונה', durationSec: 3 });
    cmd.updateShot(ctx, shots[1].id, { sceneIndex: 0, narration: 'שורה שנייה', durationSec: 2 });
    const before = listShots(ctx.db, sbId).length;
    const r = cmd.deleteShot(ctx, shots[1].id);
    const after = listShots(ctx.db, sbId);
    expect(after.length).toBe(before - 1);
    expect(r.narrationMovedTo).toBe(1);
    expect(after[0].narration).toBe('שורה ראשונה שורה שנייה');
    expect(after[0].durationSec).toBe(5);
    expect(after.map((s) => s.number)).toEqual(after.map((_, i) => i + 1));
  });

  it('שוט ראשון: הקריינות עוברת לשוט הבא ונכנסת לפני הטקסט שלו', async () => {
    const { ctx, sbId } = await draftStoryboard();
    let shots = listShots(ctx.db, sbId);
    while (shots.length < 2) {
      cmd.addShot(ctx, shots[0].projectId, {});
      shots = listShots(ctx.db, sbId);
    }
    cmd.updateShot(ctx, shots[0].id, { sceneIndex: 0, narration: 'פתיחה' });
    cmd.updateShot(ctx, shots[1].id, { sceneIndex: 0, narration: 'המשך' });
    const r = cmd.deleteShot(ctx, shots[0].id);
    expect(r.narrationMovedTo).toBe(1);
    expect(listShots(ctx.db, sbId)[0].narration).toBe('פתיחה המשך');
  });

  it('שוט בלי קריינות נמחק בלי לגעת בשוטים אחרים', async () => {
    const { ctx, sbId } = await draftStoryboard();
    let shots = listShots(ctx.db, sbId);
    while (shots.length < 2) {
      cmd.addShot(ctx, shots[0].projectId, {});
      shots = listShots(ctx.db, sbId);
    }
    cmd.updateShot(ctx, shots[1].id, { narration: '' });
    const keep = listShots(ctx.db, sbId)[0];
    const r = cmd.deleteShot(ctx, shots[1].id);
    expect(r.narrationMovedTo).toBeNull();
    const first = listShots(ctx.db, sbId)[0];
    expect(first.narration).toBe(keep.narration);
    expect(first.durationSec).toBe(keep.durationSec);
  });
});
