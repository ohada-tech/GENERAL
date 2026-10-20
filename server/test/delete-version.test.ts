import { describe, expect, it } from 'vitest';
import { listDeletedScripts, listScripts } from '../src/db/repo.js';
import { drain } from '../src/jobs/worker.js';
import * as cmd from '../src/workflow/commands.js';
import { makeCtx, projectWithBrief } from './helpers.js';

async function threeVersions() {
  const ctx = makeCtx();
  const p = projectWithBrief(ctx);
  cmd.completeBrief(ctx, p.id);
  await drain(ctx);
  const v1 = listScripts(ctx.db, p.id)[0];
  const edit = (t: string) => {
    const c = structuredClone(v1.content);
    c.scenes.forEach((s) => (s.narration = t));
    return c;
  };
  const v2 = cmd.saveScriptVersion(ctx, p.id, { content: edit('גרסה שנייה לגמרי שונה') });
  const v3 = cmd.saveScriptVersion(ctx, p.id, { content: edit('גרסה שלישית לגמרי שונה') });
  return { ctx, p, v1, v2, v3 };
}

describe('Deleting script versions', () => {
  it('hides a version, keeps numbering unique, and can restore it', async () => {
    const { ctx, p, v2, v3 } = await threeVersions();
    cmd.deleteScriptVersion(ctx, v3.id);
    expect(listScripts(ctx.db, p.id).map((v) => v.id)).not.toContain(v3.id);
    expect(listScripts(ctx.db, p.id)[0].id).toBe(v2.id);
    expect(listDeletedScripts(ctx.db, p.id).map((v) => v.id)).toEqual([v3.id]);
    // גרסה חדשה לא מקבלת את המספר של הגרסה שנמחקה
    const v4 = cmd.saveScriptVersion(ctx, p.id, { content: v3.content });
    expect(v4.label).not.toBe(v3.label);
    expect(v4.version).toBeGreaterThan(v3.version);
    cmd.restoreScriptVersion(ctx, v3.id);
    expect(listScripts(ctx.db, p.id).map((v) => v.id)).toContain(v3.id);
  });

  it('refuses to delete a client-approved version or the only one left', async () => {
    const { ctx, p, v1, v2, v3 } = await threeVersions();
    cmd.chooseFinalScript(ctx, v3.id);
    cmd.recordClientApproval(ctx, v3.id, { approvedBy: 'הלקוח' });
    expect(() => cmd.deleteScriptVersion(ctx, v3.id)).toThrow('הלקוח אישר');
    cmd.deleteScriptVersion(ctx, v2.id);
    cmd.deleteScriptVersion(ctx, v1.id);
    expect(listScripts(ctx.db, p.id)).toHaveLength(1);
  });

  it('refuses to delete the last remaining version', async () => {
    const { ctx, v1, v2, v3 } = await threeVersions();
    cmd.deleteScriptVersion(ctx, v3.id);
    cmd.deleteScriptVersion(ctx, v2.id);
    expect(() => cmd.deleteScriptVersion(ctx, v1.id)).toThrow('היחידה');
  });
});
