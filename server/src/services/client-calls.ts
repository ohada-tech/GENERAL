/**
 * שיחה עם הלקוח: הקלטה ← תמלול עם הפרדת דוברים (ElevenLabs Scribe) ← ChatGPT שולף מה הלקוח ביקש והחליט
 * ← ייבוא הערות רגיל (מוכן ל"מה ChatGPT חושב?" ולתיקון). ההקלטה עצמה לא נשמרת, רק התמלול.
 */
import { GateError, NotFoundError, type Ctx } from '../context.js';
import { json, uid } from '../db/db.js';
import { getProject, listScripts } from '../db/repo.js';
import type { JsonCapableProvider } from '../providers/collab.js';
import type { ScribeResult } from '../providers/elevenlabs.js';
import { ProviderError } from '../providers/types.js';
import { getFeedbackImport, type FeedbackItem } from './client-feedback.js';

export interface ClientCall {
  id: string;
  projectId: string;
  name: string;
  language: string;
  durationSec: number;
  transcript: string;
  createdAt: string;
}

const map = (r: any): ClientCall => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  language: r.language,
  durationSec: r.duration_sec,
  transcript: r.transcript,
  createdAt: r.created_at,
});

export const AUDIO_EXT = /\.(m4a|mp3|wav|aac|ogg|opus|webm|mp4|mov|flac)$/i;

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** מילים ← שורה לכל תור דיבור: "[3:12] דובר 2: ..." */
export function formatTranscript(words: ScribeResult['words']): string {
  const speakers = new Map<string, number>();
  const lines: string[] = [];
  let cur: { speaker: string; start: number; text: string } | null = null;
  const flush = () => {
    if (cur?.text.trim()) lines.push(`[${clock(cur.start)}] דובר ${speakers.get(cur.speaker)}: ${cur.text.trim().replace(/\s+/g, ' ')}`);
  };
  for (const w of words) {
    if (w.type === 'audio_event') continue;
    if (w.type === 'word' && (!cur || w.speaker !== cur.speaker)) {
      flush();
      if (!speakers.has(w.speaker)) speakers.set(w.speaker, speakers.size + 1);
      cur = { speaker: w.speaker, start: w.start, text: '' };
    }
    if (cur) cur.text += w.text;
  }
  flush();
  return lines.join('\n');
}

export function listCalls(ctx: Ctx, projectId: string) {
  return (ctx.db.prepare('SELECT * FROM client_calls WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as any[]).map(map);
}

export function getCall(ctx: Ctx, id: string) {
  const r = ctx.db.prepare('SELECT * FROM client_calls WHERE id = ?').get(id);
  return r ? map(r) : null;
}

/** תמלול הקלטה ושמירת התמלול על הפרויקט */
export async function transcribeCall(ctx: Ctx, projectId: string, file: { name: string; data: Buffer }) {
  if (!getProject(ctx.db, projectId)) throw new NotFoundError('פרויקט');
  if (!AUDIO_EXT.test(file.name)) throw new GateError('אפשר להעלות הקלטה (m4a, mp3, wav, mp4…)', 400);
  const voice = ctx.providers.voice;
  if (!voice?.isConfigured()) throw new GateError('ElevenLabs לא מחובר. חבר מפתח ב"מפתחות" ונסה שוב.', 400);
  const r = await voice.transcribe(file.data, file.name);
  const transcript = formatTranscript(r.words) || r.text;
  if (!transcript.trim()) throw new GateError('לא נשמע דיבור בהקלטה', 400);
  const id = uid();
  const duration = r.words.reduce((m, w) => Math.max(m, w.start), 0);
  ctx.db
    .prepare('INSERT INTO client_calls (id, project_id, name, language, duration_sec, transcript, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, projectId, file.name.slice(0, 300), r.languageCode, duration, transcript, ctx.now().toISOString());
  return getCall(ctx, id)!;
}

const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['clientSpeaker', 'items'],
  properties: {
    clientSpeaker: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['scene', 'text', 'quote', 'agreed'],
        properties: {
          scene: { type: 'integer' },
          text: { type: 'string' },
          quote: { type: 'string' },
          agreed: { type: 'boolean' },
        },
      },
    },
  },
};

const EXTRACT_SYSTEM = [
  'You read the transcript of a call between a video production studio (Ohad) and his client about a video ad script.',
  'Speakers are labeled "דובר 1", "דובר 2"… Identify which speaker is the client and return that label as clientSpeaker.',
  'Extract every concrete point the client made about the script or the video: a requested change, a decision, a preference, a question, or something he wants removed or kept. Also include decisions both sides agreed on during the call, even if the studio proposed them.',
  'One item per point. text: the point in Hebrew, phrased as a clear instruction for the script (or as the question, if it is a question). Keep wording the client dictated in the script language exactly as he said it.',
  'quote: a short exact quote from the transcript that supports it. scene: the 1-based number of the script scene it refers to, or 0 if it is general or unclear. agreed: true if both sides agreed on it in the call.',
  'Skip small talk, scheduling and anything not about this video. Do not invent points that were not said.',
].join('\n');

/** מה הלקוח ביקש והחליט בשיחה ← ייבוא הערות (על הגרסה האחרונה; אפשר להחליף בממשק) */
export async function callToFeedback(ctx: Ctx, callId: string) {
  const call = getCall(ctx, callId);
  if (!call) throw new NotFoundError('שיחה');
  const versions = listScripts(ctx.db, call.projectId);
  if (!versions.length) throw new GateError('אין עדיין תסריט בפרויקט', 400);
  const base = versions[0];
  const openai = ctx.providers.text.openai as unknown as JsonCapableProvider | undefined;
  if (!openai?.json || !openai.isConfigured()) throw new ProviderError('ChatGPT לא מחובר', false, 'not_configured');
  const script = base.content.scenes
    .map((s, i) => `Scene ${i + 1}: VO: ${s.narration || '—'} | ON SCREEN: ${s.onScreenText || '—'} | VISUAL: ${s.visualAction.slice(0, 200)}`)
    .join('\n');
  const user = `CURRENT SCRIPT (v${base.label}):\n${script}\n\nCALL TRANSCRIPT:\n${call.transcript}`;
  const r = await openai.json<{ clientSpeaker: string; items: Array<{ scene: number; text: string; quote: string; agreed: boolean }> }>(
    'call_points',
    EXTRACT_SCHEMA,
    EXTRACT_SYSTEM,
    user,
  );
  const items: FeedbackItem[] = (r.data.items ?? [])
    .filter((x) => x.text?.trim())
    .map((x) => ({
      id: uid(),
      kind: 'note',
      author: x.agreed ? 'סוכם בשיחה' : 'הלקוח בשיחה',
      quote: x.quote ?? '',
      text: x.text.trim(),
      scenes: Number.isInteger(x.scene) && x.scene >= 1 && x.scene <= base.content.scenes.length ? [x.scene - 1] : [],
      include: true,
    }));
  if (!items.length) throw new GateError('לא נמצאו בשיחה הערות על התסריט', 400);
  const id = uid();
  ctx.db
    .prepare(
      `INSERT INTO client_feedback (id, project_id, base_version_id, source, source_name, detected_label, items, status, created_at, call_id)
       VALUES (?, ?, ?, 'call', ?, NULL, ?, 'draft', ?, ?)`,
    )
    .run(id, call.projectId, base.id, `שיחה: ${call.name}`.slice(0, 500), json(items), ctx.now().toISOString(), call.id);
  return getFeedbackImport(ctx, id)!;
}
