import { recordFeedback, type LessonArea } from '../services/learning.js';
/**
 * הפקה אוטומטית (שלבים 05–09): כל שלב מתחיל רק מאישור מפורש של המשתמש —
 * אישור השלב הקודם (כשמופעל "המשך אוטומטי") או לחיצה על "הפעל". לפני כל הפעלה
 * מחושבת עלות משוערת ונבדקת מול תקרת התקציב של הפרויקט.
 */
import {
  aspectFor,
  clipDuration,
  creditsToUsd,
  imageModel,
  KIE_USD_PER_CREDIT,
  MUSIC,
  ttsModelFor,
  videoModelForShot,
  type CostEstimate,
  type Media,
  type MediaKind,
  type Project,
  type Shot,
} from '@apos/shared';
import fs from 'node:fs';
import path from 'node:path';
import { GateError, NotFoundError, type Ctx } from '../context.js';
import { json, tx, uid } from '../db/db.js';
import { currentStoryboard, getMedia, getProject, getShot, listGates, listMedia, listScripts, listShots } from '../db/repo.js';
import { emit } from './events.js';
import { enqueueJob } from './queue.js';

export const PRODUCTION_STAGES = ['images', 'animation', 'audio', 'editing', 'delivery'] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

const JOB_FOR: Record<Exclude<MediaKind, 'final'> | 'final', 'frame.generate' | 'clip.generate' | 'voiceover.generate' | 'music.generate' | 'edit.render'> = {
  frame: 'frame.generate',
  clip: 'clip.generate',
  voiceover: 'voiceover.generate',
  music: 'music.generate',
  final: 'edit.render',
};

const STAGE_KINDS: Record<ProductionStage, MediaKind[]> = {
  images: ['frame'],
  animation: ['clip'],
  audio: ['voiceover', 'music'],
  editing: ['final'],
  delivery: [],
};

const ts = (ctx: Ctx) => ctx.now().toISOString();

function mustProject(ctx: Ctx, id: string) {
  const p = getProject(ctx.db, id);
  if (!p) throw new NotFoundError('פרויקט');
  return p;
}

/** הגרסה האחרונה של כל פריט (לפי שוט / סוג) — מה שמוצג ונבדק לאישור. */
export function latestMedia(ctx: Ctx, projectId: string) {
  const all = listMedia(ctx.db, projectId);
  const latest = new Map<string, Media>();
  for (const m of all) {
    const key = `${m.kind}:${m.shotId ?? ''}`;
    const cur = latest.get(key);
    if (!cur || m.version > cur.version) latest.set(key, m);
  }
  return { all, latest };
}

function approvedScript(ctx: Ctx, projectId: string) {
  return listScripts(ctx.db, projectId).find((s) => s.status === 'client_approved') ?? null;
}

function approvedShots(ctx: Ctx, projectId: string): Shot[] {
  const sb = currentStoryboard(ctx.db, projectId);
  if (!sb || sb.status !== 'approved') return [];
  return listShots(ctx.db, sb.id);
}

function narrationText(ctx: Ctx, projectId: string) {
  const s = approvedScript(ctx, projectId);
  return s ? s.content.scenes.map((x) => x.narration.trim()).filter(Boolean).join('\n') : '';
}

/** אילו פריטים ייווצרו בשלב, ובכמה קרדיטים (לפני שמשלמים). */
export function planStage(ctx: Ctx, project: Project, stage: ProductionStage) {
  const shots = approvedShots(ctx, project.id);
  const items: Array<{ kind: MediaKind; shotId: string | null; credits: number; label: string }> = [];
  const external = project.settings.generator === 'higgsfield';
  if (external && (stage === 'images' || stage === 'animation')) {
    for (const s of shots)
      items.push({ kind: stage === 'images' ? 'frame' : 'clip', shotId: s.id, credits: 0, label: stage === 'images' ? 'תמונה · Higgsfield' : 'קליפ · Higgsfield' });
    return items;
  }
  if (stage === 'images') {
    const m = imageModel(project.settings.imageModel);
    for (const s of shots) items.push({ kind: 'frame', shotId: s.id, credits: m.credits, label: `תמונה · ${m.label.split(' · ')[0]}` });
  } else if (stage === 'animation') {
    for (const s of shots) {
      const vm = videoModelForShot(s.animationModel, project.settings.videoModel);
      const dur = clipDuration(vm, s.durationSec || 5);
      items.push({ kind: 'clip', shotId: s.id, credits: vm.creditsPerSec * dur, label: `קליפ · ${vm.label.split(' · ')[0]}` });
    }
  } else if (stage === 'audio' && project.settings.audioProvider === 'elevenlabs') {
    const text = narrationText(ctx, project.id);
    if (project.brief.voiceoverNeeded && text) items.push({ kind: 'voiceover', shotId: null, credits: 0, label: 'קריינות · ElevenLabs' });
    if (project.settings.music) items.push({ kind: 'music', shotId: null, credits: 0, label: 'מוזיקה · ElevenLabs' });
  } else if (stage === 'audio') {
    const text = narrationText(ctx, project.id);
    if (project.brief.voiceoverNeeded && text) {
      const tts = ttsModelFor(project.brief.language);
      items.push({ kind: 'voiceover', shotId: null, credits: Math.ceil((text.length / 1000) * tts.creditsPer1000), label: 'קריינות · ElevenLabs' });
    }
    if (project.settings.music) items.push({ kind: 'music', shotId: null, credits: MUSIC.credits, label: 'מוזיקה · Suno' });
  } else if (stage === 'editing') {
    items.push({ kind: 'final', shotId: null, credits: 0, label: 'עריכה אוטומטית (בשרת, ללא עלות)' });
  }
  return items;
}

export function estimate(items: ReturnType<typeof planStage>): CostEstimate {
  const byLabel = new Map<string, { label: string; count: number; credits: number }>();
  for (const it of items) {
    const cur = byLabel.get(it.label) ?? { label: it.label, count: 0, credits: 0 };
    cur.count++;
    cur.credits += it.credits;
    byLabel.set(it.label, cur);
  }
  const credits = items.reduce((a, b) => a + b.credits, 0);
  return { lines: [...byLabel.values()], credits, usd: creditsToUsd(credits) };
}

/** הוצאה עד כה: עלות בפועל כשידועה, אחרת ההערכה ששמרנו בזמן ההפעלה. */
export function spentCredits(ctx: Ctx, projectId: string) {
  const r = ctx.db
    .prepare(
      "SELECT COALESCE(SUM(COALESCE(cost_credits, json_extract(params, '$.estCredits'), 0)), 0) AS c FROM media WHERE project_id = ? AND status != 'failed'",
    )
    .get(projectId) as { c: number };
  return Number(r?.c ?? 0);
}

function checkBudget(ctx: Ctx, project: Project, newCredits: number) {
  const budgetCredits = project.settings.budgetUsd / KIE_USD_PER_CREDIT;
  const spent = spentCredits(ctx, project.id);
  if (spent + newCredits > budgetCredits + 1e-6) {
    throw new GateError(
      `חריגה מתקרת התקציב של הפרויקט ($${project.settings.budgetUsd}): כבר נוצל ~$${creditsToUsd(spent)}, והפעולה תעלה ~$${creditsToUsd(newCredits)}. הגדל את התקרה בהגדרות הפרויקט כדי להמשיך.`,
    );
  }
}

const isExternal = (project: Project, kind: MediaKind) => project.settings.generator === 'higgsfield' && (kind === 'frame' || kind === 'clip');

function requireKie(ctx: Ctx, stage: ProductionStage, project?: Project) {
  if (project?.settings.generator === 'higgsfield' && (stage === 'images' || stage === 'animation')) return;
  if (stage === 'audio' && project?.settings.audioProvider === 'elevenlabs') {
    if (!ctx.providers.voice?.isConfigured()) throw new GateError('ElevenLabs לא מחובר — הדבק מפתח ב"מפתחות" בסרגל העליון (או העלה קריינות ומוזיקה ידנית).');
    if (!project.settings.elevenVoiceId) throw new GateError('לא נבחר קול ElevenLabs — בחר קול בהגדרות הפרויקט.');
    return;
  }
  if (stage !== 'editing' && stage !== 'delivery' && !ctx.providers.media.isConfigured()) {
    throw new GateError('KIE לא מחובר — חבר מפתח KIE ב"מפתחות" בסרגל העליון כדי ליצור תמונות, וידאו וסאונד.');
  }
}

function gateApproved(ctx: Ctx, projectId: string, stage: string) {
  return !!listGates(ctx.db, projectId)[stage]?.approvedAt;
}

/** תנאי קדם לכל שלב — כדי ששום יצירה בתשלום לא תרוץ לפני אישור השלב שלפניה. */
function assertPrereq(ctx: Ctx, project: Project, stage: ProductionStage) {
  if (stage === 'images') {
    const sb = currentStoryboard(ctx.db, project.id);
    if (!sb || sb.status !== 'approved') throw new GateError('יש לאשר את הסטורי בורד לפני יצירת תמונות');
    return;
  }
  const prev = PRODUCTION_STAGES[PRODUCTION_STAGES.indexOf(stage) - 1];
  if (!gateApproved(ctx, project.id, prev)) throw new GateError(`יש לאשר את שלב "${STAGE_HE[prev]}" לפני שלב "${STAGE_HE[stage]}"`);
}

const STAGE_HE: Record<ProductionStage, string> = {
  images: 'יצירת תמונות',
  animation: 'הנפשה',
  audio: 'סאונד',
  editing: 'עריכה',
  delivery: 'מסירה',
};

function shotPrompt(shot: Shot) {
  const f = shot;
  return [f.imagePrompt || f.action, f.consistencyNotes ? `Consistency: ${f.consistencyNotes}` : ''].filter(Boolean).join('\n');
}

/** יצירת פריט מדיה חדש + משימה. גרסה = הגרסה האחרונה של אותו פריט + 1. */
function createItem(
  ctx: Ctx,
  project: Project,
  it: { kind: MediaKind; shotId: string | null; credits: number },
  extra: { prompt?: string; params?: Record<string, unknown>; note?: string; actor: string },
) {
  const last = ctx.db
    .prepare('SELECT MAX(version) AS v FROM media WHERE project_id = ? AND kind = ? AND COALESCE(shot_id, \'\') = ?')
    .get(project.id, it.kind, it.shotId ?? '') as { v: number | null };
  const version = (last?.v ?? 0) + 1;
  const id = uid();
  const shot = it.shotId ? getShot(ctx.db, it.shotId) : null;
  const prompt = extra.prompt ?? (it.kind === 'frame' && shot ? shotPrompt(shot) : it.kind === 'clip' && shot ? shot.animationPrompt || shot.action : '');
  ctx.db
    .prepare(
      `INSERT INTO media (id, project_id, shot_id, kind, version, status, provider, model, prompt, params, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'generating', ?, '', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      project.id,
      it.shotId,
      it.kind,
      version,
      it.kind === 'final' ? 'ffmpeg' : 'kie',
      prompt,
      json({ estCredits: it.credits, ...(extra.params ?? {}) }),
      extra.note ?? '',
      ts(ctx),
      ts(ctx),
    );
  enqueueJob(ctx, {
    projectId: project.id,
    type: JOB_FOR[it.kind],
    payload: { mediaId: id, shotId: it.shotId },
    idempotencyKey: `${JOB_FOR[it.kind]}:media:${id}`,
    actor: extra.actor,
  });
  return id;
}

/** הפעלת שלב: יוצר את כל הפריטים החסרים (פריט שכבר קיים ולא נכשל — לא נוצר שוב). */
export function startStage(ctx: Ctx, projectId: string, stage: ProductionStage, actor = ctx.config.ownerName) {
  const project = mustProject(ctx, projectId);
  if (project.pipelineState === 'stopped') throw new GateError('ה-Pipeline עצור — הפעל אותו מחדש קודם');
  assertPrereq(ctx, project, stage);
  if (stage === 'delivery') throw new GateError('שלב המסירה לא מייצר תוצרים — אשר את הסרטון הסופי');
  requireKie(ctx, stage, project);
  if (project.settings.generator === 'higgsfield' && (stage === 'images' || stage === 'animation')) {
    // הייצור מתבצע מחוץ למערכת (Claude ב-Higgsfield או העלאה ידנית) — רק מסמנים שהשלב פתוח
    const { latest } = latestMedia(ctx, projectId);
    const waiting = planStage(ctx, project, stage).filter((it) => {
      const cur = latest.get(`${it.kind}:${it.shotId ?? ''}`);
      return !cur || cur.status === 'failed' || cur.status === 'rejected';
    }).length;
    return tx(ctx.db, () => {
      ctx.db
        .prepare(
          `INSERT INTO stage_gates (project_id, stage, started_at) VALUES (?, ?, ?)
           ON CONFLICT(project_id, stage) DO UPDATE SET started_at = excluded.started_at, approved_at = NULL, approved_by = NULL`,
        )
        .run(projectId, stage, ts(ctx));
      emit(ctx, {
        projectId,
        type: 'stage.awaiting_external',
        actor,
        message: `שלב "${STAGE_HE[stage]}" פתוח: ${waiting} שוטים מחכים ל-Higgsfield`,
        payload: { stage, waiting },
      });
      return { stage, created: 0, external: true, waiting, estimate: estimate([]) };
    });
  }
  const { latest } = latestMedia(ctx, projectId);
  const items = planStage(ctx, project, stage).filter((it) => {
    const cur = latest.get(`${it.kind}:${it.shotId ?? ''}`);
    return !cur || cur.status === 'failed' || cur.status === 'rejected' || stage === 'editing';
  });
  if (stage === 'editing') {
    const cur = latest.get('final:');
    if (cur?.status === 'generating') throw new GateError('העריכה כבר רצה');
  }
  if (!items.length) throw new GateError('כל הפריטים בשלב כבר נוצרו');
  const est = estimate(items);
  checkBudget(ctx, project, est.credits);
  return tx(ctx.db, () => {
    const ids = items.map((it) => createItem(ctx, project, it, { actor }));
    ctx.db
      .prepare(
        `INSERT INTO stage_gates (project_id, stage, started_at) VALUES (?, ?, ?)
         ON CONFLICT(project_id, stage) DO UPDATE SET started_at = excluded.started_at, approved_at = NULL, approved_by = NULL`,
      )
      .run(projectId, stage, ts(ctx));
    emit(ctx, {
      projectId,
      type: 'stage.started',
      actor,
      message: `הופעל שלב "${STAGE_HE[stage]}": ${items.length} פריטים · עלות משוערת ~$${est.usd}`,
      payload: { stage, count: items.length, estimate: est },
    });
    return { stage, created: ids.length, estimate: est };
  });
}

/** יצירה מחדש של פריט אחד, עם הערה אופציונלית (למשל "הדמות צריכה לחייך"). */
export function regenerateItem(ctx: Ctx, mediaId: string, feedback = '', actor = ctx.config.ownerName) {
  const m = getMedia(ctx.db, mediaId);
  if (!m) throw new NotFoundError('פריט');
  const project = mustProject(ctx, m.projectId);
  if (m.status === 'generating') throw new GateError('הפריט עדיין בתהליך יצירה');
  const stage = (Object.keys(STAGE_KINDS) as ProductionStage[]).find((s) => STAGE_KINDS[s].includes(m.kind))!;
  if (isExternal(project, m.kind)) {
    // Higgsfield: לא יוצרים כאן — מסמנים לתיקון עם ההערה, ו-Claude/אתה מעלים גרסה חדשה
    return tx(ctx.db, () => {
      ctx.db.prepare("UPDATE media SET status = 'rejected', note = ?, updated_at = ? WHERE id = ?").run(feedback || m.note, ts(ctx), m.id);
      ctx.db.prepare('UPDATE stage_gates SET approved_at = NULL, approved_by = NULL WHERE project_id = ? AND stage = ?').run(m.projectId, stage);
      emit(ctx, {
        projectId: m.projectId,
        type: 'media.redo_requested',
        actor,
        message: `בקשה לגרסה חדשה ב-Higgsfield: ${KIND_HE[m.kind]}${feedback ? ` — ${feedback}` : ''}`,
        payload: { mediaId: m.id, kind: m.kind, shotId: m.shotId, feedback },
      });
      recordFeedback(ctx, m.projectId, KIND_AREA[m.kind], feedback);
      return getMedia(ctx.db, m.id)!;
    });
  }
  requireKie(ctx, stage, project);
  const { latest } = latestMedia(ctx, m.projectId);
  if (latest.get(`${m.kind}:${m.shotId ?? ''}`)?.id !== m.id) throw new GateError('יש גרסה חדשה יותר לפריט הזה');
  const plan = planStage(ctx, project, stage).find((it) => it.kind === m.kind && it.shotId === m.shotId);
  const credits = plan?.credits ?? 0;
  checkBudget(ctx, project, credits);
  return tx(ctx.db, () => {
    ctx.db.prepare("UPDATE media SET status = 'rejected', updated_at = ? WHERE id = ? AND status != 'failed'").run(ts(ctx), m.id);
    // אישור השלב מתבטל — יש פריט חדש שצריך לבדוק
    ctx.db.prepare('UPDATE stage_gates SET approved_at = NULL, approved_by = NULL WHERE project_id = ? AND stage = ?').run(m.projectId, stage);
    const id = createItem(
      ctx,
      project,
      { kind: m.kind, shotId: m.shotId, credits },
      { prompt: m.kind === 'frame' || m.kind === 'clip' ? m.prompt : undefined, params: feedback ? { feedback } : {}, note: feedback, actor },
    );
    emit(ctx, {
      projectId: m.projectId,
      type: 'media.regenerate',
      actor,
      message: `יצירה מחדש: ${KIND_HE[m.kind]} v${m.version + 1}${feedback ? ` — ${feedback}` : ''}`,
      payload: { mediaId: id, previousId: m.id, kind: m.kind },
    });
    recordFeedback(ctx, m.projectId, KIND_AREA[m.kind], feedback);
    return getMedia(ctx.db, id)!;
  });
}

const KIND_AREA: Record<MediaKind, LessonArea> = { frame: 'image', clip: 'motion', voiceover: 'audio', music: 'audio', final: 'editing' };
const STAGE_AREA: Record<ProductionStage, LessonArea> = { images: 'image', animation: 'motion', audio: 'audio', editing: 'editing', delivery: 'general' };

export const KIND_HE: Record<MediaKind, string> = {
  frame: 'תמונה',
  clip: 'קליפ',
  voiceover: 'קריינות',
  music: 'מוזיקה',
  final: 'סרטון סופי',
};

export function setItemApproval(ctx: Ctx, mediaId: string, approved: boolean) {
  const m = getMedia(ctx.db, mediaId);
  if (!m) throw new NotFoundError('פריט');
  if (approved && m.status !== 'ready' && m.status !== 'approved') throw new GateError('אפשר לאשר רק פריט שנוצר בהצלחה');
  ctx.db.prepare('UPDATE media SET status = ?, updated_at = ? WHERE id = ?').run(approved ? 'approved' : 'ready', ts(ctx), m.id);
  return getMedia(ctx.db, m.id)!;
}

/** אישור שלב: כל הפריטים מוכנים → כולם מאושרים, ואם "המשך אוטומטי" — השלב הבא מופעל. */
export function approveStage(ctx: Ctx, projectId: string, stage: ProductionStage, note = '', actor = ctx.config.ownerName) {
  const project = mustProject(ctx, projectId);
  assertPrereq(ctx, project, stage);
  const { latest } = latestMedia(ctx, projectId);
  const kinds = stage === 'delivery' ? ['final'] : STAGE_KINDS[stage];
  const expected = stage === 'delivery' ? [{ kind: 'final' as MediaKind, shotId: null }] : planStage(ctx, project, stage);
  const items = expected.map((it) => latest.get(`${it.kind}:${it.shotId ?? ''}`));
  const missing = items.filter((m) => !m || m.status === 'failed' || m.status === 'rejected').length;
  const running = items.filter((m) => m?.status === 'generating').length;
  if (running) throw new GateError(`${running} פריטים עדיין בתהליך יצירה`);
  if (missing) throw new GateError(`${missing} פריטים חסרים או נכשלו — צור אותם מחדש לפני האישור`);
  const result = tx(ctx.db, () => {
    for (const m of items) if (m && kinds.includes(m.kind)) ctx.db.prepare("UPDATE media SET status = 'approved', updated_at = ? WHERE id = ?").run(ts(ctx), m.id);
    ctx.db
      .prepare(
        `INSERT INTO stage_gates (project_id, stage, approved_at, approved_by, note) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, stage) DO UPDATE SET approved_at = excluded.approved_at, approved_by = excluded.approved_by, note = excluded.note`,
      )
      .run(projectId, stage, ts(ctx), actor, note);
    ctx.db
      .prepare('INSERT INTO approvals (id, project_id, subject_type, subject_id, kind, decision, by, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uid(), projectId, 'stage', stage, stage === 'delivery' ? 'client' : 'internal', 'approved', actor, note, ts(ctx));
    emit(ctx, {
      projectId,
      type: 'stage.approved',
      actor,
      message: `שלב "${STAGE_HE[stage]}" אושר`,
      payload: { stage },
    });
    recordFeedback(ctx, projectId, STAGE_AREA[stage], note, 'approval');
    return { stage, approved: true };
  });
  return result;
}

export function reopenStage(ctx: Ctx, projectId: string, stage: ProductionStage) {
  mustProject(ctx, projectId);
  ctx.db.prepare('UPDATE stage_gates SET approved_at = NULL, approved_by = NULL WHERE project_id = ? AND stage = ?').run(projectId, stage);
  // שלבים מאוחרים יותר תלויים בשלב הזה — גם האישור שלהם מתבטל
  for (const later of PRODUCTION_STAGES.slice(PRODUCTION_STAGES.indexOf(stage) + 1)) {
    ctx.db.prepare('UPDATE stage_gates SET approved_at = NULL, approved_by = NULL WHERE project_id = ? AND stage = ?').run(projectId, later);
  }
  emit(ctx, { projectId, type: 'stage.reopened', actor: ctx.config.ownerName, message: `שלב "${STAGE_HE[stage]}" נפתח מחדש`, payload: { stage } });
  return { stage, reopened: true };
}

/** תמונת מצב לממשק: פריטים לכל שלב, אישורים, הערכת עלות לשלב הבא והוצאה עד כה. */
export function productionOverview(ctx: Ctx, projectId: string) {
  const project = mustProject(ctx, projectId);
  const gates = listGates(ctx.db, projectId);
  const { latest, all } = latestMedia(ctx, projectId);
  const shots = approvedShots(ctx, projectId);
  const stages = PRODUCTION_STAGES.map((stage) => {
    const plan = stage === 'delivery' ? [] : planStage(ctx, project, stage);
    const items = plan.map((it) => ({ ...it, media: latest.get(`${it.kind}:${it.shotId ?? ''}`) ?? null }));
    let canStart = false;
    let blockedReason: string | null = null;
    try {
      assertPrereq(ctx, project, stage);
      canStart = stage !== 'delivery';
    } catch (e) {
      blockedReason = (e as Error).message;
    }
    const toCreate = plan.filter((it) => {
      const cur = latest.get(`${it.kind}:${it.shotId ?? ''}`);
      return !cur || cur.status === 'failed' || cur.status === 'rejected';
    });
    return {
      stage,
      gate: gates[stage] ?? null,
      items,
      canStart,
      blockedReason,
      pendingEstimate: estimate(toCreate),
      fullEstimate: estimate(plan),
    };
  });
  const spent = spentCredits(ctx, projectId);
  return {
    stages,
    shots: shots,
    history: all.filter((m) => m.status === 'rejected' || m.status === 'failed').slice(0, 50),
    spentUsd: creditsToUsd(spent),
    budgetUsd: project.settings.budgetUsd,
    kieConfigured: ctx.providers.media.isConfigured(),
    generator: project.settings.generator,
    aspect: aspectFor(project.brief.aspectRatio),
    autoAdvance: project.settings.autoAdvance,
  };
}

/** הסטטוס לשלב (עבור מנוע המצב) */
export function stageProgress(ctx: Ctx, projectId: string) {
  return productionOverview(ctx, projectId);
}

export function nextStage(stage: ProductionStage): ProductionStage | null {
  return PRODUCTION_STAGES[PRODUCTION_STAGES.indexOf(stage) + 1] ?? null;
}

/* ---------- תוצרים מבחוץ (Higgsfield / העלאה ידנית) ---------- */

export interface ExternalMediaInput {
  kind: MediaKind;
  shotId?: string | null;
  data: Buffer;
  mime: string;
  filename: string;
  model?: string;
  prompt?: string;
  /** higgsfield-unlimited | higgsfield-credits | manual */
  source?: string;
  /** קרדיטי Higgsfield שנוצלו (לא קרדיטי KIE) */
  hfCredits?: number | null;
  sourceUrl?: string;
  note?: string;
}

const EXT_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav' };

/** מוסיף גרסה חדשה לפריט מתוצר שנוצר מחוץ למערכת. הגרסה הקודמת מסומנת "הוחלף", והשלב חוזר לבדיקה. */
export function addExternalMedia(ctx: Ctx, projectId: string, input: ExternalMediaInput, actor = ctx.config.ownerName) {
  const project = mustProject(ctx, projectId);
  const kind = input.kind;
  if (!['frame', 'clip', 'voiceover', 'music', 'final'].includes(kind)) throw new GateError('סוג תוצר לא מוכר', 400);
  const shotId = kind === 'frame' || kind === 'clip' ? (input.shotId ?? null) : null;
  if ((kind === 'frame' || kind === 'clip') && !shotId) throw new GateError('חסר שוט לתמונה/קליפ', 400);
  if (shotId && !approvedShots(ctx, projectId).some((s) => s.id === shotId)) {
    throw new GateError('השוט לא שייך לסטורי בורד המאושר של הפרויקט', 400);
  }
  const ext = (input.filename.split('.').pop() ?? '').toLowerCase();
  const mime = input.mime && input.mime !== 'application/octet-stream' ? input.mime : (EXT_MIME[ext] ?? input.mime);
  const okType = kind === 'frame' ? mime.startsWith('image/') : kind === 'clip' || kind === 'final' ? mime.startsWith('video/') : mime.startsWith('audio/');
  if (!okType) throw new GateError(`סוג הקובץ (${mime}) לא מתאים ל${KIND_HE[kind]}`, 400);
  const stage = (Object.keys(STAGE_KINDS) as ProductionStage[]).find((s) => STAGE_KINDS[s].includes(kind))!;
  const dir = path.join(ctx.config.dataDir, 'uploads', projectId, 'media');
  fs.mkdirSync(dir, { recursive: true });
  const id = uid();
  const file = path.join(dir, `${kind}-${id}.${EXT_MIME[ext] ? ext : (Object.entries(EXT_MIME).find(([, m]) => m === mime)?.[0] ?? 'bin')}`);
  fs.writeFileSync(file, input.data);
  return tx(ctx.db, () => {
    const { latest } = latestMedia(ctx, projectId);
    const prev = latest.get(`${kind}:${shotId ?? ''}`);
    if (prev && prev.status !== 'failed' && prev.status !== 'rejected') {
      ctx.db.prepare("UPDATE media SET status = 'rejected', updated_at = ? WHERE id = ?").run(ts(ctx), prev.id);
    }
    const last = ctx.db
      .prepare("SELECT MAX(version) AS v FROM media WHERE project_id = ? AND kind = ? AND COALESCE(shot_id, '') = ?")
      .get(projectId, kind, shotId ?? '') as { v: number | null };
    const assetId = uid();
    ctx.db
      .prepare('INSERT INTO assets (id, project_id, filename, stored_path, mime, size, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(assetId, projectId, input.filename, file, mime, input.data.length, `media:${kind}`, ts(ctx));
    const source = input.source || 'manual';
    const provider = source.startsWith('higgsfield') ? 'higgsfield' : 'manual';
    const label = input.model || (source === 'higgsfield-unlimited' ? 'Higgsfield · Unlimited' : source === 'higgsfield-credits' ? 'Higgsfield' : 'הועלה ידנית');
    ctx.db
      .prepare(
        `INSERT INTO media (id, project_id, shot_id, kind, version, status, provider, model, prompt, params, asset_id, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        shotId,
        kind,
        (last?.v ?? 0) + 1,
        provider,
        label,
        input.prompt ?? '',
        json({ source, hfCredits: input.hfCredits ?? null, sourceUrl: input.sourceUrl ?? null }),
        assetId,
        input.note ?? '',
        ts(ctx),
        ts(ctx),
      );
    ctx.db
      .prepare(
        `INSERT INTO stage_gates (project_id, stage, started_at) VALUES (?, ?, ?)
         ON CONFLICT(project_id, stage) DO UPDATE SET approved_at = NULL, approved_by = NULL, started_at = COALESCE(stage_gates.started_at, excluded.started_at)`,
      )
      .run(projectId, stage, ts(ctx));
    const shot = shotId ? getShot(ctx.db, shotId) : null;
    emit(ctx, {
      projectId,
      type: 'media.ready',
      actor,
      message: `${KIND_HE[kind]} חדשה${shot ? ` לשוט ${shot.number}` : ''} · ${label}${input.hfCredits ? ` · ${input.hfCredits} קרדיטים ב-Higgsfield` : source === 'higgsfield-unlimited' ? ' · ללא עלות' : ''}`,
      payload: { mediaId: id, kind, shotId, source, hfCredits: input.hfCredits ?? null },
    });
    void project;
    return getMedia(ctx.db, id)!;
  });
}

/** מה מחכה לייצור ב-Higgsfield: לכל שוט — הפרומפט, ההערה האחרונה, יחס תמונה, ולקליפ גם התמונה המאושרת. */
export function externalRequests(ctx: Ctx, projectId: string) {
  const project = mustProject(ctx, projectId);
  const { latest } = latestMedia(ctx, projectId);
  const shots = approvedShots(ctx, projectId);
  const aspect = aspectFor(project.brief.aspectRatio);
  const gates = listGates(ctx.db, projectId);
  const pending = (kind: 'frame' | 'clip') =>
    shots
      .map((s) => {
        const cur = latest.get(`${kind}:${s.id}`);
        if (cur && (cur.status === 'ready' || cur.status === 'approved' || cur.status === 'generating')) return null;
        const frame = latest.get(`frame:${s.id}`);
        return {
          shotId: s.id,
          shotNumber: s.number,
          durationSec: s.durationSec,
          prompt: kind === 'frame' ? shotPrompt(s) : s.animationPrompt || s.action,
          action: s.action,
          narration: s.narration,
          character: s.character,
          wardrobe: s.wardrobe,
          feedback: cur?.status === 'rejected' ? cur.note : '',
          previousVersion: cur?.version ?? 0,
          ...(kind === 'clip'
            ? { approvedFrame: frame?.status === 'approved' ? { mediaId: frame.id, fileUrl: `/api/media/${frame.id}/file` } : null }
            : {}),
        };
      })
      .filter(Boolean);
  return {
    project: { id: project.id, name: project.name, generator: project.settings.generator },
    aspect: aspect.image,
    characters: project.brief.characters,
    visualStyle: project.brief.visualStyle,
    images: pending('frame'),
    animation: gates.images?.approvedAt ? pending('clip') : [],
  };
}
