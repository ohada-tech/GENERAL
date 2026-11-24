import { describe, expect, it } from 'vitest';
import { currentStoryboard, getProject, listMedia, listScripts, listShots } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import { projectState } from '../src/services/views.js';
import * as cmd from '../src/workflow/commands.js';
import * as prod from '../src/workflow/production.js';
import { makeCtx, projectWithBrief, sampleMedia } from './helpers.js';

async function withImages(ctx: ReturnType<typeof makeCtx>) {
  const p = projectWithBrief(ctx);
  cmd.updateProject(ctx, p.id, { settings: { generator: 'higgsfield' } });
  cmd.completeBrief(ctx, p.id);
  await drain(ctx);
  const v = listScripts(ctx.db, p.id)[0];
  cmd.approveScriptInternal(ctx, v.id);
  cmd.recordClientApproval(ctx, v.id, { approvedBy: 'לקוח' });
  await drain(ctx);
  const shots = listShots(ctx.db, currentStoryboard(ctx.db, p.id)!.id);
  for (const s of shots) cmd.setShotApproval(ctx, s.id, 'approved');
  cmd.approveStoryboard(ctx, p.id);
  const png = sampleMedia().png;
  for (const s of shots) prod.addExternalMedia(ctx, p.id, { kind: 'frame', shotId: s.id, data: png, mime: 'image/png', filename: 'f.png', source: 'higgsfield-unlimited' });
  prod.approveStage(ctx, p.id, 'images');
  return { p, shots };
}

const imagesStage = (ctx: ReturnType<typeof makeCtx>, id: string) => projectState(ctx, getProject(ctx.db, id)!).stages.find((s) => s.key === 'images')!;

describe('פתיחת הסטורי בורד לעריכה אחרי שהתמונות נוצרו', () => {
  it('בזמן העריכה התמונות נשארות, וסגירה בלי שינוי לא מאפסת כלום', async () => {
    const ctx = makeCtx();
    const { p, shots } = await withImages(ctx);
    expect(imagesStage(ctx, p.id).status).toBe('completed');

    cmd.reopenStoryboard(ctx, p.id);
    expect(prod.storyboardEditingAfterApproval(ctx, p.id)).toBe(true);
    expect(imagesStage(ctx, p.id).status).toBe('completed');
    expect(prod.productionOverview(ctx, p.id).stages[0].items).toHaveLength(shots.length);

    cmd.approveStoryboard(ctx, p.id);
    expect(imagesStage(ctx, p.id).status).toBe('completed');
    expect(listMedia(ctx.db, p.id, 'frame').every((m) => m.status === 'approved')).toBe(true);
    expect(prod.externalRequests(ctx, p.id).images).toHaveLength(0);
  });

  it('רק שוט ששינו בו את התמונה צריך תמונה חדשה', async () => {
    const ctx = makeCtx();
    const { p, shots } = await withImages(ctx);
    cmd.reopenStoryboard(ctx, p.id);
    cmd.updateShot(ctx, shots[1].id, { imagePrompt: 'A totally different frame' });
    cmd.setShotApproval(ctx, shots[1].id, 'approved');
    cmd.approveStoryboard(ctx, p.id);

    const waiting = prod.externalRequests(ctx, p.id).images;
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.shotId).toBe(shots[1].id);
    const frames = listMedia(ctx.db, p.id, 'frame');
    expect(frames.filter((m) => m.status === 'approved')).toHaveLength(shots.length - 1);
  });
});
