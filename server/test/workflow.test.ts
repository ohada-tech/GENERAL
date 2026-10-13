import { describe, expect, it } from 'vitest';
import { getProject, listJobs, listScripts, listShots, listStoryboards, currentStoryboard } from '../src/db/repo.js';
import { drain, recoverStuckJobs, runOnce } from '../src/jobs/worker.js';
import { ProviderError } from '../src/providers/types.js';
import { projectState } from '../src/services/views.js';
import * as cmd from '../src/workflow/commands.js';
import { applyRules } from '../src/workflow/rules.js';
import { makeCtx, projectWithBrief } from './helpers.js';

const state = (ctx: ReturnType<typeof makeCtx>, id: string) => projectState(ctx, getProject(ctx.db, id)!);
const stage = (ctx: ReturnType<typeof makeCtx>, id: string, key: string) =>
  state(ctx, id).stages.find((s) => s.key === key)!;

async function toClientApprovedScript(ctx: ReturnType<typeof makeCtx>) {
  const p = projectWithBrief(ctx);
  cmd.completeBrief(ctx, p.id);
  await drain(ctx);
  const v = listScripts(ctx.db, p.id)[0];
  cmd.approveScriptInternal(ctx, v.id);
  cmd.recordClientApproval(ctx, v.id, { approvedBy: 'דנה מהלקוח' });
  return { p, v };
}

describe('Brief gate', () => {
  it('blocks completion while required fields are missing and lists them', () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'X', clientName: 'Y' });
    expect(() => cmd.completeBrief(ctx, p.id)).toThrow(/חסרים שדות חובה/);
    const s = state(ctx, p.id);
    expect(s.briefValidation.complete).toBe(false);
    expect(s.overallStatus).toBe('not_started');
    expect(listJobs(ctx.db, p.id)).toHaveLength(0);
  });

  it('completing the brief enqueues exactly one script job (no duplicates)', () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    expect(() => cmd.completeBrief(ctx, p.id)).toThrow(/כבר סומן/);
    const jobs = listJobs(ctx.db, p.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].type).toBe('script.generate');

    // הרצה חוזרת של אותו Event לא יוצרת משימה כפולה
    const ev = ctx.db.prepare("SELECT * FROM events WHERE type = 'brief.completed'").get() as any;
    applyRules(ctx, { id: ev.id, projectId: p.id, type: ev.type, actor: 'x', message: '', payload: {}, createdAt: ev.created_at });
    expect(listJobs(ctx.db, p.id)).toHaveLength(1);

    // גם בקשה ידנית בזמן שמשימה פעילה לא יוצרת כפילות
    const r = cmd.requestScriptGeneration(ctx, p.id);
    expect(r.created).toBe(false);
    expect(r.reason).toBe('already_active');
  });

  it('does not auto-trigger when autoGenerateScript is off', () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.updateProject(ctx, p.id, { settings: { autoGenerateScript: false } });
    cmd.completeBrief(ctx, p.id);
    expect(listJobs(ctx.db, p.id)).toHaveLength(0);
    expect(state(ctx, p.id).nextAction?.stage).toBe('script');
  });
});

describe('Script stage', () => {
  it('generates a structured draft, notifies, and waits for internal approval', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    expect(stage(ctx, p.id, 'script').status).toBe('in_progress');
    await drain(ctx);
    const [v] = listScripts(ctx.db, p.id);
    expect(v.status).toBe('draft');
    expect(v.source).toBe('ai');
    expect(v.content.scenes.length).toBeGreaterThan(0);
    expect(v.content.scenes[0]).toHaveProperty('narration');
    expect(stage(ctx, p.id, 'script').status).toBe('waiting_internal');
    const notes = ctx.db.prepare("SELECT * FROM notifications WHERE kind = 'approval_needed'").all();
    expect(notes).toHaveLength(1);
    expect(state(ctx, p.id).myActions.some((a) => a.kind === 'approval' && a.stage === 'script')).toBe(true);
  });

  it('enforces internal approval before client approval, and storyboard only after client approval', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const [v] = listScripts(ctx.db, p.id);
    expect(() => cmd.recordClientApproval(ctx, v.id, { approvedBy: 'לקוח' })).toThrow(/לאשר את התסריט פנימית/);
    expect(() => cmd.requestStoryboardGeneration(ctx, p.id)).toThrow(/אישור לקוח/);

    cmd.approveScriptInternal(ctx, v.id, 'נראה טוב');
    expect(stage(ctx, p.id, 'script').status).toBe('waiting_client');
    expect(listJobs(ctx.db, p.id).filter((j) => j.type === 'storyboard.generate')).toHaveLength(0);
    expect(() => cmd.requestStoryboardGeneration(ctx, p.id)).toThrow(/אישור לקוח/);

    cmd.recordClientApproval(ctx, v.id, { approvedBy: 'דנה' });
    expect(stage(ctx, p.id, 'script').status).toBe('completed');
    const sbJobs = listJobs(ctx.db, p.id).filter((j) => j.type === 'storyboard.generate');
    expect(sbJobs).toHaveLength(1);

    const approvals = ctx.db.prepare("SELECT * FROM approvals WHERE subject_type = 'script_version'").all() as any[];
    expect(approvals.map((a) => a.kind).sort()).toEqual(['client', 'internal']);
    expect(approvals.find((a) => a.kind === 'client').by).toContain('דנה');
  });

  it('manual edit creates a new version and only the latest can be approved', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const [v1] = listScripts(ctx.db, p.id);
    const v2 = cmd.saveScriptVersion(ctx, p.id, {
      content: { ...v1.content, title: 'ערוך' },
      parentId: v1.id,
      changeNote: 'קיצור',
    });
    expect(v2.version).toBe(2);
    expect(v2.source).toBe('manual');
    expect(listScripts(ctx.db, p.id)).toHaveLength(2);
    expect(() => cmd.approveScriptInternal(ctx, v1.id)).toThrow(/רק את הגרסה האחרונה/);
    cmd.approveScriptInternal(ctx, v2.id);
  });

  it('changes requested → needs revision → AI revision creates a child version', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const [v1] = listScripts(ctx.db, p.id);
    cmd.requestScriptChanges(ctx, v1.id, { from: 'client', note: 'לקצר את הפתיחה', by: 'דנה' });
    expect(stage(ctx, p.id, 'script').status).toBe('needs_revision');
    cmd.requestScriptRevision(ctx, v1.id, 'לקצר את הפתיחה');
    await drain(ctx);
    const [v2] = listScripts(ctx.db, p.id);
    expect(v2.version).toBe(2);
    expect(v2.parentId).toBe(v1.id);
    expect(v2.source).toBe('ai_revision');
    expect(stage(ctx, p.id, 'script').status).toBe('waiting_internal');
  });
});

describe('Storyboard stage', () => {
  it('creates shots after client approval; approval requires every shot approved', async () => {
    const ctx = makeCtx();
    const { p } = await toClientApprovedScript(ctx);
    await drain(ctx);
    const sb = currentStoryboard(ctx.db, p.id)!;
    const shots = listShots(ctx.db, sb.id);
    expect(shots.length).toBeGreaterThan(0);
    expect(stage(ctx, p.id, 'storyboard').status).toBe('waiting_internal');
    expect(() => cmd.approveStoryboard(ctx, p.id)).toThrow(/לאשר את כל השוטים/);

    cmd.setShotApproval(ctx, shots[0].id, 'needs_revision', 'זווית אחרת');
    expect(stage(ctx, p.id, 'storyboard').status).toBe('needs_revision');
    for (const s of shots) cmd.setShotApproval(ctx, s.id, 'approved');
    cmd.approveStoryboard(ctx, p.id);
    expect(stage(ctx, p.id, 'storyboard').status).toBe('completed');
    expect(() => cmd.updateShot(ctx, shots[0].id, { imagePrompt: 'x' })).toThrow(/פתח אותו מחדש/);
  });

  it('editing an approved shot returns it to review', async () => {
    const ctx = makeCtx();
    const { p } = await toClientApprovedScript(ctx);
    await drain(ctx);
    const sb = currentStoryboard(ctx.db, p.id)!;
    const [s1] = listShots(ctx.db, sb.id);
    cmd.setShotApproval(ctx, s1.id, 'approved');
    const updated = cmd.updateShot(ctx, s1.id, { imagePrompt: 'new prompt' });
    expect(updated.approval).toBe('pending');
    expect(updated.imagePrompt).toBe('new prompt');
  });

  it('re-running the stage keeps previous storyboard versions', async () => {
    const ctx = makeCtx();
    const { p } = await toClientApprovedScript(ctx);
    await drain(ctx);
    cmd.requestStoryboardGeneration(ctx, p.id);
    await drain(ctx);
    const versions = listStoryboards(ctx.db, p.id);
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'draft'],
      [1, 'superseded'],
    ]);
    expect(listShots(ctx.db, versions[1].id).length).toBeGreaterThan(0);
  });

  it('script_only scope builds a skeleton without calling the model', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.updateProject(ctx, p.id, { settings: { chatgptScope: 'script_only' } });
    cmd.completeBrief(ctx, p.id);
    await drain(ctx);
    const callsAfterScript = ctx.fake.calls;
    const [v] = listScripts(ctx.db, p.id);
    cmd.approveScriptInternal(ctx, v.id);
    cmd.recordClientApproval(ctx, v.id, { approvedBy: 'דנה' });
    await drain(ctx);
    expect(ctx.fake.calls).toBe(callsAfterScript);
    const sb = currentStoryboard(ctx.db, p.id)!;
    expect(sb.source).toBe('skeleton');
    const shots = listShots(ctx.db, sb.id);
    expect(shots).toHaveLength(v.content.scenes.length);
    expect(shots[0].imagePrompt).toBe('');
  });
});

describe('Jobs: retry, failure, pause, stuck', () => {
  it('retries retryable errors with backoff and logs attempts', async () => {
    const ctx = makeCtx();
    ctx.fake.failWith = [new ProviderError('rate limit', true, 'rate_limit')];
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await runOnce(ctx);
    let [job] = listJobs(ctx.db, p.id);
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(1);
    expect(job.lastError).toContain('rate limit');
    // לפני ה-backoff לא רץ
    expect(await runOnce(ctx)).toBe(false);
    ctx.advance(11);
    expect(await runOnce(ctx)).toBe(true);
    [job] = listJobs(ctx.db, p.id);
    expect(job.status).toBe('succeeded');
    const attempts = ctx.db.prepare('SELECT * FROM job_attempts WHERE job_id = ? ORDER BY attempt').all(job.id) as any[];
    expect(attempts.map((a) => a.ok)).toEqual([0, 1]);
  });

  it('marks stage blocked after max attempts and notifies; manual retry recovers', async () => {
    const ctx = makeCtx();
    ctx.fake.failWith = [1, 2, 3].map(() => new ProviderError('server 500', true, 'server'));
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    for (let i = 0; i < 3; i++) {
      await runOnce(ctx);
      ctx.advance(3600);
    }
    const [job] = listJobs(ctx.db, p.id);
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(3);
    const s = state(ctx, p.id);
    expect(s.overallStatus).toBe('blocked');
    expect(s.blockers.some((b) => b.stage === 'script')).toBe(true);
    expect(ctx.db.prepare("SELECT * FROM notifications WHERE kind = 'error'").all()).toHaveLength(1);

    cmd.retryJob(ctx, job.id);
    await drain(ctx);
    expect(stage(ctx, p.id, 'script').status).toBe('waiting_internal');
  });

  it('non-retryable errors (e.g. missing API key) fail immediately', async () => {
    const ctx = makeCtx();
    ctx.fake.failWith = [new ProviderError('OPENAI_API_KEY לא מוגדר', false, 'missing_api_key')];
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    await runOnce(ctx);
    const [job] = listJobs(ctx.db, p.id);
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(1);
    expect(stage(ctx, p.id, 'script').status).toBe('blocked');
  });

  it('paused pipeline holds jobs; stop cancels them', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.setPipelineState(ctx, p.id, 'pause');
    cmd.completeBrief(ctx, p.id);
    expect(await runOnce(ctx)).toBe(false);
    expect(stage(ctx, p.id, 'script').detail).toContain('מושהה');
    cmd.setPipelineState(ctx, p.id, 'resume');
    expect(await runOnce(ctx)).toBe(true);

    const p2 = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p2.id);
    cmd.setPipelineState(ctx, p2.id, 'stop');
    expect(listJobs(ctx.db, p2.id)[0].status).toBe('cancelled');
    expect(state(ctx, p2.id).overallStatus).toBe('blocked');
    expect(() => cmd.requestScriptGeneration(ctx, p2.id)).toThrow(/עצור/);
  });

  it('recovers stuck running jobs', () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    const [job] = listJobs(ctx.db, p.id);
    ctx.db
      .prepare("UPDATE jobs SET status = 'running', attempts = 1, heartbeat_at = ? WHERE id = ?")
      .run(new Date(ctx.clock.t).toISOString(), job.id);
    ctx.db.prepare('INSERT INTO job_attempts (id, job_id, attempt, started_at) VALUES (?, ?, 1, ?)').run('a1', job.id, 'x');
    expect(recoverStuckJobs(ctx)).toBe(0);
    ctx.advance(11 * 60);
    expect(recoverStuckJobs(ctx)).toBe(1);
    const [after] = listJobs(ctx.db, p.id);
    expect(after.status).toBe('queued');
    expect(after.lastError).toContain('תקועה');
  });

  it('a job cancelled mid-run does not persist its result', async () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    cmd.completeBrief(ctx, p.id);
    const orig = ctx.fake.generateScript.bind(ctx.fake);
    ctx.fake.generateScript = async (...a) => {
      cmd.setPipelineState(ctx, p.id, 'stop');
      return orig(...a);
    };
    await runOnce(ctx);
    expect(listScripts(ctx.db, p.id)).toHaveLength(0);
    expect(listJobs(ctx.db, p.id)[0].status).toBe('cancelled');
  });
});

describe('Project state', () => {
  it('progress grows with milestones and planned stages are reported honestly', async () => {
    const ctx = makeCtx();
    const p = cmd.createProject(ctx, { name: 'A', clientName: 'B' });
    const s0 = state(ctx, p.id);
    expect(s0.progress).toBe(0);
    expect(s0.stages.find((s) => s.key === 'images')!.availability).toBe('planned');

    const { p: p2 } = await toClientApprovedScript(ctx);
    await drain(ctx);
    const s1 = state(ctx, p2.id);
    expect(s1.progress).toBeGreaterThan(s0.progress);
    expect(s1.currentStage).toBe('storyboard');
    expect(s1.overallStatus).toBe('waiting_internal');
    expect(s1.nextAction?.stage).toBe('storyboard');
  });

  it('references stage tracks approved references per shot', async () => {
    const ctx = makeCtx();
    const { p } = await toClientApprovedScript(ctx);
    await drain(ctx);
    const sb = currentStoryboard(ctx.db, p.id)!;
    const shots = listShots(ctx.db, sb.id);
    const ref = cmd.addReference(ctx, shots[0].id, { url: 'https://www.pinterest.com/pin/123/', category: 'lighting' });
    expect(ref.platform).toBe('Pinterest');
    expect(ref.verification).toBe('unverified');
    expect(stage(ctx, p.id, 'references').status).toBe('waiting_internal');
    for (const s of shots) {
      const r = s.id === shots[0].id ? ref : cmd.addReference(ctx, s.id, { url: 'https://unsplash.com/photos/abc' });
      cmd.updateReference(ctx, r.id, { status: 'approved' });
    }
    expect(stage(ctx, p.id, 'references').status).toBe('completed');
  });

  it('manual blocker blocks its stage until resolved', () => {
    const ctx = makeCtx();
    const p = projectWithBrief(ctx);
    const id = cmd.addBlocker(ctx, p.id, { stage: 'brief', reason: 'מחכים ללוגו מהלקוח' });
    expect(stage(ctx, p.id, 'brief').status).toBe('blocked');
    expect(state(ctx, p.id).overallStatus).toBe('blocked');
    cmd.resolveBlocker(ctx, id);
    expect(stage(ctx, p.id, 'brief').status).toBe('in_progress');
  });
});
