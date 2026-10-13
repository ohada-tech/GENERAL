import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { currentStoryboard, getAssetRow, getProject, listMedia, listScripts, listShots } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import { ProviderError } from '../src/providers/types.js';
import { projectState } from '../src/services/views.js';
import * as cmd from '../src/workflow/commands.js';
import * as prod from '../src/workflow/production.js';
import { makeCtx, projectWithBrief, sampleMedia } from './helpers.js';

const haveFfmpeg = !!sampleMedia().mp4;
const state = (ctx: ReturnType<typeof makeCtx>, id: string) => projectState(ctx, getProject(ctx.db, id)!);
const stage = (ctx: ReturnType<typeof makeCtx>, id: string, key: string) => state(ctx, id).stages.find((s) => s.key === key)!;

/** אפיון → תסריט מאושר → סטורי בורד מאושר (השלב הראשון שמתחיל לעלות כסף) */
async function toApprovedStoryboard(ctx: ReturnType<typeof makeCtx>, settings: Record<string, unknown> = {}) {
  const p = projectWithBrief(ctx);
  if (Object.keys(settings).length) cmd.updateProject(ctx, p.id, { settings });
  cmd.completeBrief(ctx, p.id);
  await drain(ctx);
  const v = listScripts(ctx.db, p.id)[0];
  cmd.approveScriptInternal(ctx, v.id);
  cmd.recordClientApproval(ctx, v.id, { approvedBy: 'לקוח' });
  await drain(ctx);
  const sb = currentStoryboard(ctx.db, p.id)!;
  const shots = listShots(ctx.db, sb.id);
  for (const s of shots) cmd.setShotApproval(ctx, s.id, 'approved');
  return { p, shots };
}

describe('Production autopilot (05–09)', () => {
  it('nothing paid runs before the storyboard is approved', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    expect(() => prod.startStage(ctx, p.id, 'images')).toThrow(/סטורי בורד/);
    expect(ctx.kie.created).toHaveLength(0);
  });

  it.skipIf(!haveFfmpeg)('runs every stage after each approval, through to the final video', async () => {
    const ctx = makeCtx();
    const { p, shots } = await toApprovedStoryboard(ctx);

    // אישור הסטורי בורד מפעיל אוטומטית את יצירת התמונות
    cmd.approveStoryboard(ctx, p.id);
    expect(listMedia(ctx.db, p.id, 'frame')).toHaveLength(shots.length);
    expect(stage(ctx, p.id, 'images').status).toBe('in_progress');
    await drain(ctx);
    expect(ctx.kie.created.filter((c) => c.model === 'nano-banana-2')).toHaveLength(shots.length);
    expect(ctx.kie.created[0].input).toMatchObject({ aspect_ratio: '9:16', resolution: '2K' });
    expect(stage(ctx, p.id, 'images').status).toBe('waiting_internal');

    // שוט אחד נוצר מחדש עם הערה → גרסה 2, ואישור השלב מחכה לה
    const first = listMedia(ctx.db, p.id, 'frame').find((m) => m.shotId === shots[0].id)!;
    const v2 = prod.regenerateItem(ctx, first.id, 'הדמות מחייכת');
    expect(v2.version).toBe(2);
    expect(() => prod.approveStage(ctx, p.id, 'images')).toThrow(/בתהליך/);
    await drain(ctx);

    // אישור התמונות → הנפשה אוטומטית מכל תמונה מאושרת
    prod.approveStage(ctx, p.id, 'images');
    expect(listMedia(ctx.db, p.id, 'clip')).toHaveLength(shots.length);
    await drain(ctx);
    const clipCalls = ctx.kie.created.filter((c) => c.model.includes('video') || c.model.includes('seedance') || c.model.includes('hailuo'));
    expect(clipCalls).toHaveLength(shots.length);
    expect(ctx.kie.uploads).toBeGreaterThanOrEqual(shots.length); // התמונה המאושרת הועלתה כמקור
    prod.approveStage(ctx, p.id, 'animation');

    // סאונד: קריינות בעברית (ElevenLabs v3) + מוזיקה
    await drain(ctx);
    const tts = ctx.kie.created.find((c) => c.model.includes('elevenlabs'))!;
    expect(tts.model).toBe('elevenlabs/text-to-dialogue-v3');
    expect(tts.input).toMatchObject({ language_code: 'he' });
    expect(ctx.kie.music).toBe(1);
    prod.approveStage(ctx, p.id, 'audio');

    // עריכה אוטומטית ב-ffmpeg → סרטון סופי
    await drain(ctx);
    const final = listMedia(ctx.db, p.id, 'final')[0];
    expect(final.status).toBe('ready');
    const file = getAssetRow(ctx.db, final.assetId!)!.stored_path;
    expect(fs.statSync(file).size).toBeGreaterThan(1000);
    expect(final.durationSec).toBeGreaterThan(1);
    expect(stage(ctx, p.id, 'editing').status).toBe('waiting_internal');
    prod.approveStage(ctx, p.id, 'editing');
    expect(stage(ctx, p.id, 'delivery').status).toBe('waiting_client');
    prod.approveStage(ctx, p.id, 'delivery');
    expect(state(ctx, p.id).overallStatus).toBe('completed');

    // הוצאה מתועדת לפי פריט
    const o = prod.productionOverview(ctx, p.id);
    expect(o.spentUsd).toBeGreaterThan(0);
  }, 60_000);

  it('a retry after a network error keeps waiting for the same paid task', async () => {
    const ctx = makeCtx();
    const { p } = await toApprovedStoryboard(ctx, { autoAdvance: false });
    cmd.approveStoryboard(ctx, p.id);
    expect(listMedia(ctx.db, p.id, 'frame')).toHaveLength(0); // בלי המשך אוטומטי — לא מתחיל לבד
    ctx.kie.failNextWait.push(new ProviderError('שגיאת רשת', true, 'network'));
    prod.startStage(ctx, p.id, 'images');
    const count = listMedia(ctx.db, p.id, 'frame').length;
    ctx.advance(3600);
    await drain(ctx);
    ctx.advance(3600);
    await drain(ctx);
    expect(ctx.kie.created).toHaveLength(count); // לא נוצרה משימה בתשלום פעם נוספת
    expect(listMedia(ctx.db, p.id, 'frame').every((m) => m.status === 'ready')).toBe(true);
  });

  it('a failed generation is not retried automatically (it would cost again)', async () => {
    const ctx = makeCtx();
    const { p } = await toApprovedStoryboard(ctx, { autoAdvance: false });
    cmd.approveStoryboard(ctx, p.id);
    ctx.kie.failTask.add('task-1');
    prod.startStage(ctx, p.id, 'images');
    await drain(ctx);
    const frames = listMedia(ctx.db, p.id, 'frame');
    expect(frames.filter((m) => m.status === 'failed')).toHaveLength(1);
    expect(ctx.kie.created).toHaveLength(frames.length);
    expect(stage(ctx, p.id, 'images').status).not.toBe('completed');
    expect(() => prod.approveStage(ctx, p.id, 'images')).toThrow(/נכשלו/);
  });

  it('blocks a stage that would exceed the project budget', async () => {
    const ctx = makeCtx();
    const { p } = await toApprovedStoryboard(ctx, { autoAdvance: false, budgetUsd: 0.01 });
    cmd.approveStoryboard(ctx, p.id);
    expect(() => prod.startStage(ctx, p.id, 'images')).toThrow(/תקרת התקציב/);
    expect(ctx.kie.created).toHaveLength(0);
  });

  it('auto-advance reports a missing KIE key instead of failing the approval', async () => {
    const ctx = makeCtx();
    ctx.kie.configured = false;
    const { p } = await toApprovedStoryboard(ctx);
    expect(() => cmd.approveStoryboard(ctx, p.id)).not.toThrow();
    expect(listMedia(ctx.db, p.id)).toHaveLength(0);
    const n = ctx.db.prepare("SELECT title FROM notifications WHERE title LIKE '%לא הופעל%'").all();
    expect(n.length).toBe(1);
    expect(stage(ctx, p.id, 'images').detail).toContain('KIE');
  });
});
