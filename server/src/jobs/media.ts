/**
 * מטפלי משימות ההפקה. run: יצירה מול KIE / ffmpeg והורדת התוצר לדיסק.
 * persist: רישום הקובץ והעדכון של פריט המדיה בטרנזקציה.
 * מזהה המשימה ב-KIE נשמר מיד אחרי היצירה — ניסיון חוזר ממשיך לחכות לאותה משימה ולא משלם שוב.
 */
import {
  aspectFor,
  clipDuration,
  imageModel,
  MUSIC,
  ttsModelFor,
  TTS_V3,
  VIDEO_MODELS,
  videoModelForShot,
  type Job,
  type Media,
} from '@apos/shared';
import fs from 'node:fs';
import path from 'node:path';
import { GateError, type Ctx } from '../context.js';
import { json, uid } from '../db/db.js';
import { getAssetRow, getMedia, getProject, getShot, listRefsForStoryboard, listScripts } from '../db/repo.js';
import { ProviderError } from '../providers/types.js';
import { ffprobeDuration, renderVideo } from '../services/render.js';
import { emit } from '../workflow/events.js';
import { latestMedia } from '../workflow/production.js';
import type { JobHandler } from './handlers.js';

interface MediaOut {
  mediaId: string;
  file: string;
  mime: string;
  size: number;
  durationSec: number | null;
  credits: number | null;
  model: string;
  prompt?: string;
  extraParams?: Record<string, unknown>;
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

function mustMedia(ctx: Ctx, job: Job): Media {
  const m = getMedia(ctx.db, String(job.payload.mediaId ?? ''));
  if (!m) throw new GateError('פריט המדיה נמחק');
  if (m.status !== 'generating') throw new GateError('הפריט כבר לא ממתין ליצירה');
  return m;
}

function mediaDir(ctx: Ctx, projectId: string) {
  const dir = path.join(ctx.config.dataDir, 'uploads', projectId, 'media');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function guessMime(url: string, fallback: string) {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  const byExt: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav' };
  return fallback !== 'application/octet-stream' && fallback !== 'binary/octet-stream' ? fallback : (byExt[ext] ?? fallback);
}

async function saveDownload(ctx: Ctx, m: Media, url: string) {
  const dl = await ctx.providers.media.download(url);
  const mime = guessMime(url, dl.mime);
  const file = path.join(mediaDir(ctx, m.projectId), `${m.kind}-${m.id}.${EXT[mime] ?? 'bin'}`);
  fs.writeFileSync(file, dl.data);
  const durationSec = mime.startsWith('video/') || mime.startsWith('audio/') ? await ffprobeDuration(file) : null;
  return { file, mime, size: dl.data.length, durationSec };
}

/** שמירת מזהה משימה ב-KIE מיד אחרי היצירה (כתיבה קטנה מחוץ ל-persist, בכוונה). */
function rememberTask(ctx: Ctx, m: Media, taskId: string, extra: Record<string, unknown> = {}) {
  ctx.db
    .prepare('UPDATE media SET params = ?, updated_at = ? WHERE id = ?')
    .run(json({ ...m.params, ...extra, taskId }), ctx.now().toISOString(), m.id);
}

const heartbeat = (ctx: Ctx, job: Job) => () =>
  ctx.db.prepare('UPDATE jobs SET heartbeat_at = ? WHERE id = ?').run(ctx.now().toISOString(), job.id);

/** קובץ מקומי (תמונה שאושרה / רפרנס שהועלה) → כתובת זמנית ב-KIE */
async function uploadAsset(ctx: Ctx, assetId: string) {
  const row = getAssetRow(ctx.db, assetId);
  if (!row || !fs.existsSync(row.stored_path)) throw new GateError('קובץ המקור לא נמצא בשרת');
  return ctx.providers.media.upload(fs.readFileSync(row.stored_path), path.basename(row.stored_path), row.mime);
}

/** הערת "צור מחדש" → ה-AI משכתב את הפרומפט (Claude אם מחובר, אחרת ChatGPT), אחרת מצרפים את ההערה. */
async function applyFeedback(ctx: Ctx, prompt: string, feedback: string, what: 'image' | 'motion') {
  if (!feedback.trim()) return prompt;
  const p = [ctx.providers.text.claude, ctx.providers.text.openai].find((x) => x?.isConfigured()) as
    | { json?: <T>(n: string, s: object, sys: string, user: string) => Promise<{ data: T }> }
    | undefined;
  if (p?.json) {
    try {
      const r = await p.json<{ prompt: string }>(
        'prompt_rewrite',
        { type: 'object', additionalProperties: false, required: ['prompt'], properties: { prompt: { type: 'string' } } },
        `You rewrite English prompts for AI ${what === 'image' ? 'image generation (photorealistic still frame)' : 'image-to-video animation (motion only)'}. Apply the user's feedback precisely and keep everything else (subject identity, wardrobe, setting, camera) unchanged. Return only the new prompt in English.`,
        `CURRENT PROMPT:\n${prompt}\n\nFEEDBACK (may be in Hebrew):\n${feedback}`,
      );
      if (r.data?.prompt?.trim()) return r.data.prompt.trim();
    } catch {
      /* נופלים לצירוף ההערה */
    }
  }
  return `${prompt}\nAdjustment: ${feedback}`;
}

function persistMedia(ctx: Ctx, job: Job, r: MediaOut) {
  const m = getMedia(ctx.db, r.mediaId);
  if (!m || m.status !== 'generating') return { mediaId: r.mediaId, discarded: true };
  const assetId = uid();
  const ts = ctx.now().toISOString();
  ctx.db
    .prepare('INSERT INTO assets (id, project_id, filename, stored_path, mime, size, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(assetId, m.projectId, path.basename(r.file), r.file, r.mime, r.size, `media:${m.kind}`, ts);
  ctx.db
    .prepare(
      "UPDATE media SET status = 'ready', asset_id = ?, model = ?, duration_sec = ?, cost_credits = ?, prompt = COALESCE(?, prompt), params = ?, error = NULL, updated_at = ? WHERE id = ?",
    )
    .run(assetId, r.model, r.durationSec, r.credits, r.prompt ?? null, json({ ...getMedia(ctx.db, m.id)!.params, ...(r.extraParams ?? {}) }), ts, m.id);
  emit(ctx, {
    projectId: m.projectId,
    type: 'media.ready',
    actor: m.provider,
    message: `${KIND[m.kind]} מוכנה לבדיקה${m.shotId ? ` (שוט ${getShot(ctx.db, m.shotId)?.number ?? '?'})` : ''} · ${r.model}`,
    payload: { mediaId: m.id, kind: m.kind, shotId: m.shotId, credits: r.credits },
  });
  return { mediaId: m.id, assetId, credits: r.credits };
}

const KIND: Record<Media['kind'], string> = { frame: 'תמונה', clip: 'קליפ', voiceover: 'קריינות', music: 'מוזיקה', final: 'סרטון סופי' };

function failMedia(ctx: Ctx, job: Job, err: unknown) {
  const id = String(job.payload.mediaId ?? '');
  ctx.db
    .prepare("UPDATE media SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'generating'")
    .run(err instanceof Error ? err.message : String(err), ctx.now().toISOString(), id);
}

const frameGenerate: JobHandler<MediaOut> = {
  async run(ctx, job) {
    const m = mustMedia(ctx, job);
    const project = getProject(ctx.db, m.projectId)!;
    const shot = m.shotId ? getShot(ctx.db, m.shotId) : null;
    if (!shot) throw new GateError('השוט נמחק');
    const model = imageModel(project.settings.imageModel);
    const tick = heartbeat(ctx, job);
    let taskId = m.params.taskId as string | undefined;
    let prompt = m.prompt;
    if (!taskId) {
      prompt = await applyFeedback(ctx, m.prompt, String(m.params.feedback ?? ''), 'image');
      const aspect = aspectFor(project.brief.aspectRatio).image;
      const input: Record<string, unknown> = { prompt, [model.aspectField]: model.aspects.includes(aspect) ? aspect : '9:16', ...model.extra };
      if (model.refsField) {
        const refs = listRefsForStoryboard(ctx.db, shot.storyboardId).filter((r) => r.shotId === shot.id && r.status === 'approved' && r.imageUrl);
        const urls: string[] = [];
        for (const r of refs.slice(0, 3)) {
          const local = /\/api\/assets\/([^/]+)\/file/.exec(r.imageUrl);
          urls.push(local ? await uploadAsset(ctx, local[1]) : r.imageUrl);
        }
        if (urls.length) input[model.refsField] = urls;
      }
      taskId = await ctx.providers.media.createTask(model.apiModel, input);
      rememberTask(ctx, m, taskId, { input });
      if (prompt !== m.prompt) ctx.db.prepare('UPDATE media SET prompt = ? WHERE id = ?').run(prompt, m.id);
    }
    const res = await ctx.providers.media.waitTask(taskId, tick);
    const saved = await saveDownload(ctx, m, res.urls[0]);
    return { mediaId: m.id, ...saved, credits: res.creditsConsumed ?? model.credits, model: model.label.split(' · ')[0], prompt };
  },
  persist: persistMedia,
  onFinalFail: failMedia,
};

const clipGenerate: JobHandler<MediaOut> = {
  async run(ctx, job) {
    const m = mustMedia(ctx, job);
    const project = getProject(ctx.db, m.projectId)!;
    const shot = m.shotId ? getShot(ctx.db, m.shotId) : null;
    if (!shot) throw new GateError('השוט נמחק');
    const vm = videoModelForShot(shot.animationModel, project.settings.videoModel);
    const duration = clipDuration(vm, shot.durationSec || 5);
    const tick = heartbeat(ctx, job);
    let taskId = m.params.taskId as string | undefined;
    let prompt = m.prompt;
    if (!taskId) {
      const frame = latestMedia(ctx, m.projectId).latest.get(`frame:${shot.id}`);
      if (!frame || frame.status !== 'approved' || !frame.assetId) throw new GateError(`אין תמונה מאושרת לשוט ${shot.number}`);
      prompt = await applyFeedback(ctx, m.prompt, String(m.params.feedback ?? ''), 'motion');
      const imageUrl = await uploadAsset(ctx, frame.assetId);
      const input: Record<string, unknown> = {
        prompt,
        [vm.imageField]: vm.imageField === 'image_url' || vm.imageField === 'first_frame_url' ? imageUrl : [imageUrl],
        duration: vm.durationAsString ? String(duration) : duration,
        ...vm.extra,
      };
      if (vm.hasAspect) input.aspect_ratio = aspectFor(project.brief.aspectRatio).video;
      taskId = await ctx.providers.media.createTask(vm.apiModel, input);
      rememberTask(ctx, m, taskId, { input: { ...input }, frameMediaId: frame.id, videoModel: vm.id });
      if (prompt !== m.prompt) ctx.db.prepare('UPDATE media SET prompt = ? WHERE id = ?').run(prompt, m.id);
    }
    const res = await ctx.providers.media.waitTask(taskId, tick);
    const saved = await saveDownload(ctx, m, res.urls[0]);
    const used = VIDEO_MODELS.find((x) => x.id === m.params.videoModel) ?? vm;
    return { mediaId: m.id, ...saved, credits: res.creditsConsumed ?? used.creditsPerSec * duration, model: used.label.split(' · ')[0], prompt };
  },
  persist: persistMedia,
  onFinalFail: failMedia,
};

function approvedScriptText(ctx: Ctx, projectId: string) {
  const s = listScripts(ctx.db, projectId).find((x) => x.status === 'client_approved');
  if (!s) throw new GateError('אין תסריט מאושר');
  return s.content.scenes.map((x) => x.narration.trim()).filter(Boolean).join('\n');
}

/** שמירת אודיו שהתקבל ישירות (ElevenLabs) לקובץ */
async function saveBytes(ctx: Ctx, m: Media, data: Buffer, ext: string, mime: string) {
  const file = path.join(mediaDir(ctx, m.projectId), `${m.kind}-${m.id}.${ext}`);
  fs.writeFileSync(file, data);
  return { file, mime, size: data.length, durationSec: await ffprobeDuration(file) };
}

const voiceoverGenerate: JobHandler<MediaOut> = {
  async run(ctx, job) {
    const m = mustMedia(ctx, job);
    const project = getProject(ctx.db, m.projectId)!;
    const text = approvedScriptText(ctx, m.projectId);
    if (!text) throw new GateError('אין קריינות בתסריט המאושר');
    if (project.settings.audioProvider === 'elevenlabs' && ctx.providers.voice) {
      const { elevenVoiceId, elevenModel } = project.settings;
      if (!elevenVoiceId) throw new GateError('לא נבחר קול ElevenLabs בהגדרות הפרויקט');
      const data = await ctx.providers.voice.tts(text, elevenVoiceId, elevenModel || 'eleven_v3');
      const saved = await saveBytes(ctx, m, data, 'mp3', 'audio/mpeg');
      return { mediaId: m.id, ...saved, credits: null, model: `ElevenLabs · ${elevenModel || 'eleven_v3'}`, prompt: text, extraParams: { voiceId: elevenVoiceId, chars: text.length } };
    }
    const tts = ttsModelFor(project.brief.language);
    const voice = project.settings.voiceId;
    let taskId = m.params.taskId as string | undefined;
    if (!taskId) {
      const input =
        tts === TTS_V3
          ? { dialogue: [{ text, voice }], stability: 0.5, language_code: 'he' }
          : { text, voice, output_format: 'mp3_44100_128' };
      taskId = await ctx.providers.media.createTask(tts.apiModel, input);
      rememberTask(ctx, m, taskId, { voice, ttsModel: tts.apiModel });
    }
    const res = await ctx.providers.media.waitTask(taskId, heartbeat(ctx, job));
    const saved = await saveDownload(ctx, m, res.urls[0]);
    return {
      mediaId: m.id,
      ...saved,
      credits: res.creditsConsumed ?? Math.ceil((text.length / 1000) * tts.creditsPer1000),
      model: tts === TTS_V3 ? 'ElevenLabs v3' : 'ElevenLabs Multilingual v2',
      prompt: text,
    };
  },
  persist: persistMedia,
  onFinalFail: failMedia,
};

function musicPrompt(ctx: Ctx, projectId: string, feedback: string) {
  const p = getProject(ctx.db, projectId)!;
  const b = p.brief;
  const parts = [
    `Instrumental background music for a ${b.durationSec ?? 30}-second ${b.videoType || 'commercial'} video`,
    b.tone && `tone: ${b.tone}`,
    b.visualStyle && `visual style: ${b.visualStyle}`,
    b.targetAudience && `audience: ${b.targetAudience}`,
    'modern, clean mix, no vocals, suitable under voice-over',
    feedback && `adjust: ${feedback}`,
  ].filter(Boolean);
  return parts.join('; ').slice(0, 480);
}

const musicGenerate: JobHandler<MediaOut> = {
  async run(ctx, job) {
    const m = mustMedia(ctx, job);
    const project = getProject(ctx.db, m.projectId)!;
    let taskId = m.params.taskId as string | undefined;
    const prompt = m.prompt || musicPrompt(ctx, m.projectId, String(m.params.feedback ?? ''));
    if (project.settings.audioProvider === 'elevenlabs' && ctx.providers.voice) {
      const seconds = (project.brief.durationSec ?? 30) + 3;
      const data = await ctx.providers.voice.music(prompt, seconds * 1000);
      const saved = await saveBytes(ctx, m, data, 'mp3', 'audio/mpeg');
      return { mediaId: m.id, ...saved, credits: null, model: 'ElevenLabs · Music', prompt };
    }
    if (!taskId) {
      taskId = await ctx.providers.media.createMusic({ prompt, instrumental: true, model: MUSIC.model });
      rememberTask(ctx, m, taskId);
      ctx.db.prepare('UPDATE media SET prompt = ? WHERE id = ?').run(prompt, m.id);
    }
    const tracks = await ctx.providers.media.waitMusic(taskId, heartbeat(ctx, job));
    const saved = await saveDownload(ctx, m, tracks[0].audioUrl);
    return {
      mediaId: m.id,
      ...saved,
      credits: MUSIC.credits,
      model: `Suno ${MUSIC.model}`,
      prompt,
      extraParams: { alternateTrackUrl: tracks[1]?.audioUrl ?? null },
    };
  },
  persist: persistMedia,
  onFinalFail: failMedia,
};

const editRender: JobHandler<MediaOut> = {
  async run(ctx, job) {
    const m = mustMedia(ctx, job);
    const project = getProject(ctx.db, m.projectId)!;
    const { latest } = latestMedia(ctx, m.projectId);
    const sb = ctx.db.prepare("SELECT id FROM storyboards WHERE project_id = ? AND status = 'approved' ORDER BY version DESC LIMIT 1").get(m.projectId) as { id: string } | undefined;
    if (!sb) throw new GateError('אין סטורי בורד מאושר');
    const shots = ctx.db.prepare('SELECT id, number, fields FROM shots WHERE storyboard_id = ? ORDER BY number').all(sb.id) as Array<{ id: string; number: number; fields: string }>;
    const filePath = (assetId: string | null) => {
      const row = assetId ? getAssetRow(ctx.db, assetId) : null;
      if (!row || !fs.existsSync(row.stored_path)) return null;
      return row.stored_path;
    };
    const clips = shots.map((s) => {
      const clip = latest.get(`clip:${s.id}`);
      const p = clip?.status === 'approved' ? filePath(clip.assetId) : null;
      if (!p) throw new GateError(`חסר קליפ מאושר לשוט ${s.number}`);
      const planned = Number(JSON.parse(s.fields || '{}').durationSec) || clip!.durationSec || 5;
      return { path: p, durationSec: Math.max(1, Math.min(planned, clip!.durationSec ?? planned)) };
    });
    const voice = latest.get('voiceover:');
    const music = latest.get('music:');
    const out = path.join(mediaDir(ctx, m.projectId), `final-${m.id}.mp4`);
    const { width, height } = { width: aspectFor(project.brief.aspectRatio).out.w, height: aspectFor(project.brief.aspectRatio).out.h };
    const r = await renderVideo({
      clips,
      voice: voice?.status === 'approved' ? filePath(voice.assetId) : null,
      music: music?.status === 'approved' ? filePath(music.assetId) : null,
      width,
      height,
      output: out,
    });
    const size = fs.statSync(out).size;
    return { mediaId: m.id, file: out, mime: 'video/mp4', size, durationSec: r.durationSec, credits: 0, model: `ffmpeg · ${width}×${height}` };
  },
  persist: persistMedia,
  onFinalFail: failMedia,
};

export const MEDIA_HANDLERS = {
  'frame.generate': frameGenerate,
  'clip.generate': clipGenerate,
  'voiceover.generate': voiceoverGenerate,
  'music.generate': musicGenerate,
  'edit.render': editRender,
};

export { ProviderError };
