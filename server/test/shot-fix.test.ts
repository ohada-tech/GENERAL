import { describe, expect, it } from 'vitest';
import { currentStoryboard, getShot, listJobs, listScripts, listShots } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

async function storyboardReady(ctx: ReturnType<typeof makeCtx>) {
  const p = projectWithBrief(ctx);
  cmd.completeBrief(ctx, p.id);
  await drain(ctx);
  const v = listScripts(ctx.db, p.id)[0];
  cmd.approveScriptInternal(ctx, v.id);
  cmd.recordClientApproval(ctx, v.id, { approvedBy: 'דנה' });
  await drain(ctx);
  const sb = currentStoryboard(ctx.db, p.id)!;
  return { p, shots: listShots(ctx.db, sb.id) };
}

/** Claude מזויף: מחזיר את השוט עם זווית חדשה, ומנסה (בלי הצלחה) לשנות קריינות */
function withClaude(ctx: ReturnType<typeof makeCtx>, calls: string[]) {
  (ctx.providers.text.claude as any).json = async (_n: string, _s: object, _sys: string, user: string) => {
    calls.push(user);
    const cur = JSON.parse(user.split('— CURRENT (JSON):\n')[1].split('\n\nDIRECTOR')[0]);
    return { data: { shot: { ...cur, cameraAngle: 'זווית נמוכה', imagePrompt: 'low angle shot', narration: 'קריינות אחרת' }, changed: ['זווית נמוכה'] }, model: 'claude-test' };
  };
}

describe('תיקון על כל שוט', () => {
  it('הערה על שוט → Claude מתקן את השוט ברקע, הקריינות נשארת, השוט חוזר לבדיקה', async () => {
    const ctx = makeCtx();
    const { p, shots } = await storyboardReady(ctx);
    const calls: string[] = [];
    withClaude(ctx, calls);
    const s = shots[0];
    const r = cmd.requestShotFix(ctx, s.id, 'זווית נמוכה יותר');
    expect(r.jobId).toBeTruthy();
    expect(cmd.activeShotFixes(ctx, p.id).has(s.id)).toBe(true);
    await drain(ctx);
    const after = getShot(ctx.db, s.id)!;
    expect(after.cameraAngle).toBe('זווית נמוכה');
    expect(after.imagePrompt).toBe('low angle shot');
    expect(after.narration).toBe(s.narration);
    expect(after.approval).toBe('pending');
    expect(after.revisionNote).toBe('זווית נמוכה יותר');
    expect(calls[0]).toContain('זווית נמוכה יותר');
    // השוטים האחרים לא נגעו
    expect(getShot(ctx.db, shots[1].id)!.imagePrompt).toBe(shots[1].imagePrompt);
    expect(cmd.activeShotFixes(ctx, p.id).size).toBe(0);
  });

  it('הערה חדשה בזמן הריצה — התיקון הישן לא דורס, החדש נכנס', async () => {
    const ctx = makeCtx();
    const { p, shots } = await storyboardReady(ctx);
    withClaude(ctx, []);
    const s = shots[0];
    cmd.requestShotFix(ctx, s.id, 'הערה ראשונה');
    cmd.requestShotFix(ctx, s.id, 'הערה שנייה');
    await drain(ctx);
    const jobs = listJobs(ctx.db, p.id).filter((j) => j.type === 'shot.revise');
    expect(jobs.length).toBe(2);
    expect(jobs.every((j) => j.status === 'succeeded')).toBe(true);
    const after = getShot(ctx.db, s.id)!;
    expect(after.revisionNote).toBe('הערה שנייה');
    expect(after.approval).toBe('pending');
  });

  it('"תקן לפי ההערות" מריץ רק שוטים עם הערה שלא בטיפול; רק שמירה בלי תיקון אפשרית', async () => {
    const ctx = makeCtx();
    const { p, shots } = await storyboardReady(ctx);
    withClaude(ctx, []);
    cmd.requestShotFix(ctx, shots[0].id, 'לשמור בלבד', { apply: false });
    expect(cmd.activeShotFixes(ctx, p.id).size).toBe(0);
    expect(getShot(ctx.db, shots[0].id)!.approval).toBe('needs_revision');
    expect(cmd.applyShotFixes(ctx, p.id).queued).toBe(1);
    expect(cmd.applyShotFixes(ctx, p.id).queued).toBe(0);
    await drain(ctx);
    expect(getShot(ctx.db, shots[0].id)!.approval).toBe('pending');
  });
});
