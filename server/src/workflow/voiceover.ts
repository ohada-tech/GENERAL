/**
 * שלב הקריינות: קריינות מהתסריט דרך ElevenLabs (החשבון של אוהד), מיד אחרי התסריט —
 * בלי לחכות לתמונות ולהנפשה. הטקסט הוא הקריינות של התסריט כמו ש-ChatGPT כתב (לא נערך כאן).
 * כל לחיצה = טייק חדש (גרסה), אפשר להשוות ולבחור. הטייק המאושר הוא זה שנכנס לעריכה.
 */
import { countWords, wordsPerSecond, type Media } from '@apos/shared';
import { GateError, NotFoundError, type Ctx } from '../context.js';
import { json, tx, uid } from '../db/db.js';
import { getMedia, getProject, listMedia, listScripts } from '../db/repo.js';
import { recordFeedback } from '../services/learning.js';
import { emit } from './events.js';
import { enqueueJob } from './queue.js';

const ts = (ctx: Ctx) => ctx.now().toISOString();

export type NarrationSource = 'client' | 'internal' | 'draft';

/** הקריינות שתוקרא: מהתסריט שהלקוח אישר; אם אין — מהגרסה המאושרת פנימית; אם אין — מהגרסה האחרונה */
export function narrationSource(ctx: Ctx, projectId: string) {
  const all = listScripts(ctx.db, projectId);
  const pick =
    all.find((s) => s.status === 'client_approved') ?? all.find((s) => s.status === 'internal_approved') ?? all[0] ?? null;
  if (!pick) return null;
  const text = pick.content.scenes
    .map((x) => x.narration.trim())
    .filter((x) => x && x !== '—' && x !== '-')
    .join('\n');
  const source: NarrationSource = pick.status === 'client_approved' ? 'client' : pick.status === 'internal_approved' ? 'internal' : 'draft';
  return { scriptId: pick.id, version: pick.version, label: `v${pick.label || pick.version}`, source, text };
}

export function voiceoverTakes(ctx: Ctx, projectId: string): Media[] {
  return listMedia(ctx.db, projectId)
    .filter((m) => m.kind === 'voiceover')
    .sort((a, b) => b.version - a.version);
}

export function voiceoverOverview(ctx: Ctx, projectId: string) {
  const project = getProject(ctx.db, projectId);
  if (!project) throw new NotFoundError('פרויקט');
  const n = narrationSource(ctx, projectId);
  const words = n ? countWords(n.text) : 0;
  return {
    connected: !!ctx.providers.voice?.isConfigured(),
    voiceId: project.settings.elevenVoiceId,
    model: project.settings.elevenModel || 'eleven_v3',
    voiceoverNeeded: project.brief.voiceoverNeeded,
    narration: n ? { ...n, chars: n.text.length, words, estSec: Math.round((words / wordsPerSecond(project.brief.language)) * 10) / 10 } : null,
    takes: voiceoverTakes(ctx, projectId),
  };
}

/** טייק קריינות חדש ב-ElevenLabs. עולה תווים מהמכסה של ElevenLabs — רק בלחיצה של אוהד */
export function generateVoiceover(
  ctx: Ctx,
  projectId: string,
  input: { voiceId?: string; model?: string; note?: string } = {},
  actor = ctx.config.ownerName,
) {
  const project = getProject(ctx.db, projectId);
  if (!project) throw new NotFoundError('פרויקט');
  if (!ctx.providers.voice?.isConfigured()) throw new GateError('ElevenLabs לא מחובר — הדבק מפתח ב"מפתחות" בסרגל העליון.');
  const voiceId = (input.voiceId ?? project.settings.elevenVoiceId).trim();
  const model = (input.model ?? project.settings.elevenModel).trim() || 'eleven_v3';
  if (!voiceId) throw new GateError('בחר קול ElevenLabs');
  const n = narrationSource(ctx, projectId);
  if (!n) throw new GateError('אין עדיין תסריט — הקריינות נלקחת מהתסריט');
  if (!n.text) throw new GateError('אין קריינות בתסריט');
  const takes = voiceoverTakes(ctx, projectId);
  if (takes.some((m) => m.status === 'generating')) throw new GateError('קריינות כבר נוצרת — חכה שתסתיים');
  const note = (input.note ?? '').trim();
  return tx(ctx.db, () => {
    // הקול והמודל נשמרים לפרויקט — שלב הסאונד והטייק הבא משתמשים באותו קול
    const settings = { ...project.settings, elevenVoiceId: voiceId, elevenModel: model };
    ctx.db.prepare('UPDATE projects SET settings = ? WHERE id = ?').run(json(settings), projectId);
    // הטייק הקודם מפנה מקום לחדש (נשאר ברשימה — אפשר לבחור בו שוב)
    ctx.db
      .prepare("UPDATE media SET status = 'rejected', updated_at = ? WHERE project_id = ? AND kind = 'voiceover' AND status IN ('ready', 'approved')")
      .run(ts(ctx), projectId);
    const id = uid();
    const version = (takes[0]?.version ?? 0) + 1;
    ctx.db
      .prepare(
        `INSERT INTO media (id, project_id, shot_id, kind, version, status, provider, model, prompt, params, note, created_at, updated_at)
         VALUES (?, ?, NULL, 'voiceover', ?, 'generating', 'elevenlabs', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        version,
        `ElevenLabs · ${model}`,
        n.text,
        json({ estCredits: 0, direct: 'elevenlabs', voiceId, ttsModel: model, scriptId: n.scriptId, scriptVersion: n.version, scriptSource: n.source }),
        note,
        ts(ctx),
        ts(ctx),
      );
    // יש טייק חדש לבדוק — אישור שלב הסאונד מתבטל
    ctx.db.prepare("UPDATE stage_gates SET approved_at = NULL, approved_by = NULL WHERE project_id = ? AND stage = 'audio'").run(projectId);
    enqueueJob(ctx, { projectId, type: 'voiceover.generate', payload: { mediaId: id, shotId: null }, idempotencyKey: `voiceover.generate:media:${id}`, actor });
    emit(ctx, {
      projectId,
      type: 'voiceover.requested',
      actor,
      message: `קריינות ב-ElevenLabs: טייק ${version} (${n.text.length} תווים, תסריט ${n.label})${note ? ` — ${note}` : ''}`,
      payload: { mediaId: id, version, voiceId, model },
    });
    if (note) recordFeedback(ctx, projectId, 'audio', note);
    return getMedia(ctx.db, id)!;
  });
}
