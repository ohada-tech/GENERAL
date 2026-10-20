/**
 * "מה ChatGPT חושב?": דעה מקצועית על כל הערה של הלקוח, לפני שמשהו בתסריט משתנה.
 * ייבוא הערות ← דעה של ChatGPT ← ההחלטה של אוהד על כל הערה ← תיקון אחד (ChatGPT כותב, Claude בודק).
 * התזמון (אורך הקריינות לפני ואחרי) מחושב בקוד, לא במודל.
 */
import { computeTiming, wordsPerSecond, type ScriptContent, type ScriptVersion } from '@apos/shared';
import { GateError, type Ctx } from '../context.js';
import { json, tx, uid } from '../db/db.js';
import { getProject, getScript } from '../db/repo.js';
import type { JsonCapableProvider } from '../providers/collab.js';
import { briefToText } from '../providers/prompts.js';
import { ProviderError, type ProjectContext } from '../providers/types.js';
import { enqueueJob } from '../workflow/queue.js';
import {
  getFeedbackImport,
  KIND_LABEL,
  listFeedbackImports,
  saveFeedbackItems,
  withClientEdits,
  type FeedbackImport,
  type FeedbackItem,
  type FeedbackReview,
  type ReviewVerdict,
} from './client-feedback.js';

export function saveReview(ctx: Ctx, importId: string, review: FeedbackReview) {
  ctx.db.prepare('UPDATE client_feedback SET review = ? WHERE id = ?').run(json(review), importId);
}

/** שומר את הבחירות ומעביר את הניתוח לתור. התסריט לא משתנה */
export function requestFeedbackReview(ctx: Ctx, importId: string, input: { items?: FeedbackItem[]; baseVersionId?: string }) {
  const imp = saveFeedbackItems(ctx, importId, input);
  if (!imp.items.some((it) => it.include && it.text)) throw new GateError('לא נבחרה אף הערה לניתוח', 400);
  if (!ctx.providers.text.openai?.isConfigured()) throw new GateError('ChatGPT לא מחובר. חבר מפתח OpenAI ונסה שוב.', 400);
  return tx(ctx.db, () => {
    const r = enqueueJob(ctx, {
      projectId: imp.projectId,
      type: 'feedback.review',
      payload: { feedbackImportId: importId },
      idempotencyKey: `feedback.review:${importId}:${uid()}`,
      actor: ctx.config.ownerName,
    });
    if (r.created) saveReview(ctx, importId, { status: 'running', at: ctx.now().toISOString() });
    return r;
  });
}

export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'items', 'conflicts', 'questionsForClient', 'recommendation'],
  properties: {
    summary: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'verdict', 'understanding', 'reasoning', 'suggestion'],
        properties: {
          index: { type: 'integer' },
          verdict: { type: 'string', enum: ['agree', 'partly', 'disagree', 'question'] },
          understanding: { type: 'string' },
          reasoning: { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
    conflicts: { type: 'array', items: { type: 'string' } },
    questionsForClient: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string' },
  },
};

export const REVIEW_SYSTEM = [
  'You are a senior creative director and ad copywriter at an AI video production studio.',
  'The client sent notes on a video ad script. Before anything in the script changes, the studio owner (Ohad) wants your honest professional opinion on each note. He will read it, add his own decision, and only then agree the final version with the client.',
  'Do NOT rewrite the script. For every numbered client note return:',
  '- index: the number of the note.',
  '- understanding: what exactly the client is asking for, in one sentence.',
  '- verdict: "agree" (apply as is), "partly" (the intent is right, the execution needs adjusting), "disagree" (it would hurt the ad), or "question" (the client asked something that needs an answer, not a change).',
  '- reasoning: why, grounded in what makes this ad work: the hook, one clear message per scene, messages repeated between scenes, what the viewer actually sees, the right call to action for the product (an app is downloaded, a website is visited), brand consistency, claim risk, and timing.',
  "- suggestion: the concrete fix or answer. When it is wording, give the exact line in the script's own language. Empty string if the note should be applied exactly as written.",
  'Also return: summary (2-3 sentences); conflicts (with earlier client notes on this project, with the brief, between the notes themselves, or a message repeated across scenes); questionsForClient (short questions ready to send to the client on WhatsApp, only what genuinely needs his answer); recommendation (what you would do, in 2-3 sentences).',
  'Use the timing numbers you are given as facts; do not recompute them. Be direct and disagree when a note makes the ad worse. No flattery.',
  "Write everything in Hebrew, except quoted script wording, which stays in the script's language.",
].join('\n');

const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

function scriptAsText(c: ScriptContent, wps: number) {
  return c.scenes
    .map((s, i) =>
      [
        `Scene ${i + 1}${s.storyRole ? ` [${s.storyRole}]` : ''} · planned ${s.estDurationSec}s · narration ≈ ${Math.round((words(s.narration) / wps) * 10) / 10}s`,
        `  VO: ${s.narration || '—'}`,
        `  ON SCREEN: ${s.onScreenText || '—'}`,
        `  VISUAL: ${s.visualAction || '—'}`,
      ].join('\n'),
    )
    .join('\n');
}

export function reviewPrompt(pc: ProjectContext, base: ScriptVersion, items: FeedbackItem[], earlier: FeedbackImport[], timing: NonNullable<FeedbackReview['timing']>) {
  const wps = wordsPerSecond(pc.brief.language);
  const notes = items.map((it, i) => {
    const where = it.scenes.length ? `scene ${it.scenes.map((s) => s + 1).join(', ')}` : 'general';
    const quote = it.quote && it.kind !== 'edit' ? ` (about: "${it.quote.slice(0, 300)}")` : '';
    const mine = it.myNote ? `\n   Ohad already noted: ${it.myNote}` : '';
    return `${i + 1}. [${where} · ${KIND_LABEL[it.kind]}${it.author ? ` · ${it.author}` : ''}]${quote} ${it.text}${mine}`;
  });
  const past = earlier
    .filter((e) => e.items.some((it) => it.include))
    .slice(0, 3)
    .map((e) => {
      const list = e.items.filter((it) => it.include).map((it) => it.text.slice(0, 300));
      return `- ${e.createdAt.slice(0, 10)}${e.detectedLabel ? ` (on v${e.detectedLabel})` : ''}: ${list.join(' | ')}`;
    });
  return [
    `BRIEF:\n${briefToText(pc)}`,
    pc.lessons?.length ? `STUDIO RULES LEARNED FROM PAST NOTES:\n${pc.lessons.map((l) => `- ${l}`).join('\n')}` : '',
    `CURRENT SCRIPT (v${base.label}):\n${scriptAsText(base.content, wps)}`,
    `TIMING (facts): target ${timing.targetSec ?? 'not set'}s · narration now ≈ ${timing.beforeSec}s · with the client's direct edits ≈ ${timing.afterSec}s (${wps} words/second).`,
    past.length ? `EARLIER CLIENT NOTES ON THIS PROJECT (already handled in previous versions):\n${past.join('\n')}` : '',
    `CLIENT NOTES TO REVIEW NOW:\n${notes.join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

type ReviewOut = {
  summary: string;
  items: Array<{ index: number; verdict: ReviewVerdict; understanding: string; reasoning: string; suggestion: string }>;
  conflicts: string[];
  questionsForClient: string[];
  recommendation: string;
};

/** ריצת הניתוח מול ChatGPT (בלי כתיבה ל-DB) */
export async function runFeedbackReview(ctx: Ctx, importId: string, pc: ProjectContext): Promise<FeedbackReview> {
  const imp = getFeedbackImport(ctx, importId);
  if (!imp) throw new GateError('ייבוא ההערות נמחק');
  const base = getScript(ctx.db, imp.baseVersionId);
  if (!base) throw new GateError('גרסת הבסיס לא נמצאה');
  const chosen = imp.items.filter((it) => it.include && it.text);
  const target = pc.brief.durationSec ?? null;
  const timing = {
    targetSec: target,
    beforeSec: computeTiming(base.content, pc.brief.language, target).narrationSec,
    afterSec: computeTiming(withClientEdits(base.content, chosen), pc.brief.language, target).narrationSec,
  };
  const earlier = listFeedbackImports(ctx, imp.projectId).filter((e) => e.id !== imp.id && e.createdAt < imp.createdAt);
  const openai = ctx.providers.text.openai as unknown as JsonCapableProvider | undefined;
  if (!openai?.json || !openai.isConfigured()) throw new ProviderError('ChatGPT לא מחובר', false, 'not_configured');
  const project = getProject(ctx.db, imp.projectId);
  const model = project?.settings.textProvider === 'openai' ? project.settings.textModel || undefined : undefined;
  const r = await openai.json<ReviewOut>('feedback_review', REVIEW_SCHEMA, REVIEW_SYSTEM, reviewPrompt(pc, base, chosen, earlier, timing), model);
  return {
    status: 'done',
    at: ctx.now().toISOString(),
    model: r.model ?? '',
    timing,
    summary: r.data.summary,
    items: (r.data.items ?? []).flatMap((x) => {
      const it = chosen[x.index - 1];
      return it ? [{ itemId: it.id, verdict: x.verdict, understanding: x.understanding, reasoning: x.reasoning, suggestion: x.suggestion }] : [];
    }),
    conflicts: r.data.conflicts ?? [],
    questionsForClient: r.data.questionsForClient ?? [],
    recommendation: r.data.recommendation,
  };
}
