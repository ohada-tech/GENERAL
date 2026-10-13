/**
 * מטפלי משימות. כל מטפל מחולק לשניים:
 * - run: עבודה אסינכרונית מול ספק (ללא כתיבה ל-DB).
 * - persist: כתיבת התוצר בטרנזקציה, רק אם המשימה עדיין פעילה (לא בוטלה בזמן הריצה).
 */
import { shotFieldsSchema, type Job, type JobType, type ScriptContent, type ShotFields } from '@apos/shared';
import { GateError, type Ctx } from '../context.js';
import { json, uid } from '../db/db.js';
import { getProject, getScript, listScripts } from '../db/repo.js';
import type { GenResult, ScriptDraft, TextProvider } from '../providers/types.js';
import { ProviderError } from '../providers/types.js';
import { emit } from '../workflow/events.js';
import { MEDIA_HANDLERS } from './media.js';

export interface JobHandler<R = unknown> {
  run(ctx: Ctx, job: Job): Promise<R>;
  persist(ctx: Ctx, job: Job, result: R): Record<string, unknown>;
  /** נקרא כשהמשימה נכשלה סופית (בלי ניסיונות נוספים) */
  onFinalFail?(ctx: Ctx, job: Job, err: unknown): void;
}

function textProviderFor(ctx: Ctx, projectId: string): { provider: TextProvider; model?: string } {
  const project = getProject(ctx.db, projectId);
  if (!project) throw new GateError('הפרויקט נמחק');
  const key =
    project.settings.textProvider === 'collab' && project.settings.collabWriter === 'claude' ? 'collab:claude' : project.settings.textProvider;
  const provider = ctx.providers.text[key];
  if (!provider) throw new ProviderError(`ספק טקסט לא מוכר: ${project.settings.textProvider}`, false, 'unknown_provider');
  return { provider, model: project.settings.textModel || undefined };
}

function projectContext(ctx: Ctx, projectId: string) {
  const p = getProject(ctx.db, projectId);
  if (!p) throw new GateError('הפרויקט נמחק');
  if (!p.briefCompletedAt) throw new GateError('האפיון לא סומן כמוכן');
  return { name: p.name, clientName: p.clientName, brief: p.brief };
}

function insertScriptVersion(
  ctx: Ctx,
  projectId: string,
  draft: GenResult<ScriptDraft>,
  opts: { source: 'ai' | 'ai_revision' | 'demo'; parentId: string | null; changeNote: string; isDemo: boolean },
) {
  const versions = listScripts(ctx.db, projectId);
  const version = (versions[0]?.version ?? 0) + 1;
  const id = uid();
  const content: ScriptContent = {
    title: draft.data.title,
    logline: draft.data.logline,
    scenes: draft.data.scenes.map((s) => ({ id: uid(), ...s })),
  };
  ctx.db
    .prepare(
      `INSERT INTO script_versions (id, project_id, version, parent_id, source, provider, model, status, content, change_note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    )
    .run(
      id,
      projectId,
      version,
      opts.parentId,
      opts.isDemo ? 'demo' : opts.source,
      draft.provider,
      draft.model,
      json(content),
      draft.reviewNotes?.length ? `${opts.changeNote} · ${draft.reviewer ?? 'המבקר'} שיפר: ${draft.reviewNotes.join(' · ')}` : opts.changeNote,
      draft.provider,
      ctx.now().toISOString(),
    );
  emit(ctx, {
    projectId,
    type: 'script.version_created',
    actor: draft.provider,
    message: `נוצרה טיוטת תסריט v${version} (${opts.isDemo ? 'DEMO — ללא AI' : draft.provider === 'collab' ? draft.model : `${draft.provider} · ${draft.model}`})${draft.reviewNotes?.length ? ` · הערות הביקורת: ${draft.reviewNotes.join(' · ')}` : ''}`,
    payload: {
      scriptVersionId: id,
      version,
      source: opts.source,
      sourceLabel: opts.isDemo ? 'תוכן הדגמה' : draft.provider === 'collab' ? draft.model : `${draft.provider} · ${draft.model}`,
      usage: draft.usage ?? null,
      reviewNotes: draft.reviewNotes ?? [],
    },
  });
  return { scriptVersionId: id, version, model: draft.model, provider: draft.provider };
}

type ScriptRun = { draft: GenResult<ScriptDraft>; isDemo: boolean };

const scriptGenerate: JobHandler<ScriptRun> = {
  async run(ctx, job) {
    const pc = projectContext(ctx, job.projectId);
    const { provider, model } = textProviderFor(ctx, job.projectId);
    const draft = await provider.generateScript(pc, { model });
    return { draft, isDemo: provider.isDemo };
  },
  persist(ctx, job, r) {
    return insertScriptVersion(ctx, job.projectId, r.draft, {
      source: 'ai',
      parentId: null,
      changeNote: 'טיוטה ראשונה מהאפיון',
      isDemo: r.isDemo,
    });
  },
};

const scriptRevise: JobHandler<ScriptRun & { baseId: string; feedback: string }> = {
  async run(ctx, job) {
    const baseId = String(job.payload.baseVersionId ?? '');
    const feedback = String(job.payload.feedback ?? '');
    const base = getScript(ctx.db, baseId);
    if (!base) throw new GateError('גרסת הבסיס לא נמצאה');
    const pc = projectContext(ctx, job.projectId);
    const { provider, model } = textProviderFor(ctx, job.projectId);
    const draft = await provider.reviseScript(pc, base.content, feedback, { model });
    return { draft, isDemo: provider.isDemo, baseId, feedback };
  },
  persist(ctx, job, r) {
    const base = getScript(ctx.db, r.baseId);
    return insertScriptVersion(ctx, job.projectId, r.draft, {
      source: 'ai_revision',
      parentId: r.baseId,
      changeNote: `תיקון AI ל-v${base?.version ?? '?'} לפי משוב: ${r.feedback}`,
      isDemo: r.isDemo,
    });
  },
};

type StoryboardRun = {
  scriptVersionId: string;
  shots: ShotFields[];
  reviewNotes?: string[];
  source: 'ai' | 'skeleton' | 'demo';
  provider: string | null;
  model: string | null;
};

const storyboardGenerate: JobHandler<StoryboardRun> = {
  async run(ctx, job) {
    const scriptVersionId = String(job.payload.scriptVersionId ?? '');
    const script = getScript(ctx.db, scriptVersionId);
    if (!script) throw new GateError('גרסת התסריט לא נמצאה');
    if (script.status !== 'client_approved') {
      throw new GateError('לא ניתן ליצור סטורי בורד לפני אישור לקוח על התסריט');
    }
    const project = getProject(ctx.db, job.projectId)!;
    const defaults = {
      imageModel: project.settings.defaultImageModel,
      animationModel: project.settings.defaultAnimationModel,
    };

    if (project.settings.chatgptScope === 'script_only') {
      // מצב "ChatGPT לתסריט בלבד": שלד שוטים מהסצנות, לעריכה ידנית — ללא קריאה למודל.
      const shots = script.content.scenes.map((s, i) =>
        shotFieldsSchema.parse({
          sceneIndex: i,
          narration: s.narration,
          durationSec: s.estDurationSec,
          action: s.visualAction,
          imageModel: defaults.imageModel,
          animationModel: defaults.animationModel,
        }),
      );
      return { scriptVersionId, shots, source: 'skeleton', provider: null, model: null };
    }

    const pc = projectContext(ctx, job.projectId);
    const { provider, model } = textProviderFor(ctx, job.projectId);
    const res = await provider.generateStoryboard(pc, script.content, defaults, { model });
    return {
      scriptVersionId,
      shots: res.data,
      source: provider.isDemo ? 'demo' : 'ai',
      provider: res.provider,
      model: res.model,
      reviewNotes: res.reviewNotes,
    };
  },
  persist(ctx, job, r) {
    const projectId = job.projectId;
    const ts = ctx.now().toISOString();
    const last = ctx.db.prepare('SELECT MAX(version) AS v FROM storyboards WHERE project_id = ?').get(projectId) as {
      v: number | null;
    };
    const version = (last?.v ?? 0) + 1;
    // גרסאות קודמות נשמרות (superseded) — לא נמחקות
    ctx.db
      .prepare("UPDATE storyboards SET status = 'superseded' WHERE project_id = ? AND status != 'superseded'")
      .run(projectId);
    const id = uid();
    ctx.db
      .prepare(
        `INSERT INTO storyboards (id, project_id, version, script_version_id, source, provider, model, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      )
      .run(id, projectId, version, r.scriptVersionId, r.source, r.provider, r.model, ts);
    const ins = ctx.db.prepare(
      `INSERT INTO shots (id, storyboard_id, project_id, number, fields, approval, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    );
    r.shots.forEach((s, i) => ins.run(uid(), id, projectId, i + 1, json(s), ts));
    const label =
      r.source === 'skeleton' ? 'שלד שוטים לעריכה ידנית' : r.source === 'demo' ? 'DEMO — ללא AI' : r.provider === 'collab' ? `${r.model}` : `${r.provider} · ${r.model}`;
    emit(ctx, {
      projectId,
      type: 'storyboard.created',
      actor: r.provider ?? 'system',
      message: `נוצר סטורי בורד v${version} עם ${r.shots.length} שוטים (${label})${r.reviewNotes?.length ? ` · הערות הביקורת: ${r.reviewNotes.join(' · ')}` : ''}`,
      payload: { storyboardId: id, version, shotCount: r.shots.length, source: r.source },
    });
    return { storyboardId: id, version, shotCount: r.shots.length, source: r.source };
  },
};

export const HANDLERS: Record<JobType, JobHandler<any>> = {
  'script.generate': scriptGenerate,
  'script.revise': scriptRevise,
  'storyboard.generate': storyboardGenerate,
  ...MEDIA_HANDLERS,
};
