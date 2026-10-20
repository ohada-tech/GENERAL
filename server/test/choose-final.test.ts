import { describe, expect, it } from 'vitest';
import { listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

async function twoVersions() {
  const ctx = makeCtx();
  const p = projectWithBrief(ctx);
  cmd.completeBrief(ctx, p.id);
  await drain(ctx);
  const v1 = listScripts(ctx.db, p.id)[0];
  const edited = structuredClone(v1.content);
  edited.scenes[0].narration = 'נוסח אחר לגמרי בגרסה השנייה';
  const v2 = cmd.saveScriptVersion(ctx, p.id, { content: edited, parentId: v1.id, changeNote: 'עריכה' });
  return { ctx, p, v1, v2 };
}

describe('Choose the final script', () => {
  it('an older version becomes a new latest copy, approved internally; history is kept', async () => {
    const { ctx, p, v1, v2 } = await twoVersions();
    const fin = cmd.chooseFinalScript(ctx, v1.id);
    const all = listScripts(ctx.db, p.id);
    expect(all).toHaveLength(3);
    expect(all[0].id).toBe(fin.id);
    expect(fin.status).toBe('internal_approved');
    expect(fin.content.scenes.map((s) => s.narration)).toEqual(v1.content.scenes.map((s) => s.narration));
    expect(fin.changeNote).toContain(`v${v1.label}`);
    expect(all.find((v) => v.id === v2.id)!.content.scenes[0].narration).toBe('נוסח אחר לגמרי בגרסה השנייה');
    // משם ממשיכים כרגיל לאישור לקוח
    expect(cmd.recordClientApproval(ctx, fin.id, { approvedBy: 'הלקוח' }).status).toBe('client_approved');
  });

  it('the latest version is approved in place, and choosing it twice is refused', async () => {
    const { ctx, p, v2 } = await twoVersions();
    const fin = cmd.chooseFinalScript(ctx, v2.id);
    expect(fin.id).toBe(v2.id);
    expect(listScripts(ctx.db, p.id)).toHaveLength(2);
    expect(() => cmd.chooseFinalScript(ctx, v2.id)).toThrow('כבר הסופית');
  });
});
