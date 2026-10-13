/**
 * תבניות פרומפט וסכמות JSON לספקי טקסט.
 * הפלט חייב להיות מובנה (Structured Outputs) כדי שהתסריט והשוטים יישמרו כנתונים ולא כטקסט חופשי.
 */
import { type Brief, type ScriptContent, STORY_ROLES, wordsPerSecond } from '@apos/shared';
import type { ProjectContext } from './types.js';

export function briefToText(ctx: ProjectContext): string {
  const b: Brief = ctx.brief;
  const lines: Array<[string, string]> = [
    ['Project', ctx.name],
    ['Client', ctx.clientName],
    ['Video type', b.videoType],
    ['Goal', b.goal],
    ['Product / service', b.productOrService],
    ['Target audience', b.targetAudience],
    ['Key message', b.keyMessage],
    ['Platforms', b.platforms.join(', ')],
    ['Aspect ratio', b.aspectRatio],
    ['Target duration (seconds)', b.durationSec ? String(b.durationSec) : ''],
    ['Visual style', b.visualStyle],
    ['Inspirations', b.inspirations],
    ['Brand logo', b.brandLogo],
    ['Brand colors', b.brandColors],
    ['Brand fonts', b.brandFonts],
    ['Characters', b.characters.map((c) => `${c.name}: ${c.description}`).join(' | ')],
    ['Voice-over', b.voiceoverNeeded ? 'yes' : 'no (on-screen text / music only)'],
    ['Language', b.language],
    ['Tone', b.tone],
    ['Voice notes', b.voiceNotes],
    ['Budget / constraints', [b.budget, b.constraints].filter(Boolean).join(' — ')],
    ['Extra notes', b.notes],
  ];
  return lines
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
}

export function scriptSystemPrompt(ctx: ProjectContext): string {
  const wps = wordsPerSecond(ctx.brief.language);
  return [
    'You are a senior commercial scriptwriter and creative director for short AI-generated marketing videos.',
    'Write a production-ready script based strictly on the brief. Do not invent product claims, prices or facts that are not in the brief.',
    `Write narration and on-screen text in the brief's language (${ctx.brief.language || 'same language as the brief'}). Write visualAction and notes in the same language.`,
    'Narration must sound natural when read aloud: short sentences, spoken rhythm, no stage directions inside narration.',
    `Timing: assume about ${wps} spoken words per second. Each scene's estDurationSec must fit its narration, and the total must match the target duration within ±10%.`,
    'Structure the story with clear roles (hook in the first 1–3 seconds, then problem/solution/benefit/proof as relevant, end with a CTA when the goal requires one).',
    `storyRole must be one of: ${STORY_ROLES.join(', ')}.`,
    'visualAction describes what is seen on screen in one or two concrete, filmable sentences, suitable for AI image/video generation.',
    'notes: optional production notes (sound, transitions, emphasis). Use an empty string if none.',
  ].join('\n');
}

export function scriptUserPrompt(ctx: ProjectContext): string {
  return `BRIEF:\n${briefToText(ctx)}\n\nWrite the script now.`;
}

export function reviseUserPrompt(ctx: ProjectContext, base: ScriptContent, feedback: string): string {
  const current = JSON.stringify(
    {
      title: base.title,
      logline: base.logline,
      scenes: base.scenes.map(({ id: _id, ...s }) => s),
    },
    null,
    2,
  );
  return [
    `BRIEF:\n${briefToText(ctx)}`,
    `CURRENT SCRIPT (JSON):\n${current}`,
    `FEEDBACK TO APPLY:\n${feedback}`,
    'Produce a revised full script. Apply the feedback precisely; keep everything that the feedback does not ask to change.',
  ].join('\n\n');
}

export function storyboardSystemPrompt(defaults: { imageModel: string; animationModel: string }): string {
  return [
    'You are a cinematographer and storyboard artist preparing shots for AI image generation and AI video animation.',
    'Break each script scene into one or more shots. Keep shot durations realistic for AI video (usually 2–8 seconds) and the sum close to the scene duration.',
    'For every shot fill all fields concretely: shot type, camera angle, composition and subject placement, body/head/gaze movement, lens & depth of field when relevant, lighting, color & mood, character description and wardrobe, and consistency requirements versus other shots (same character identity, wardrobe, product look, logo).',
    'imagePrompt: a detailed English prompt for a photorealistic still frame (subject, action, environment, camera, lens, lighting, color grade, realistic human skin texture when people appear, aspect ratio). No brand names of AI tools inside the prompt.',
    'animationPrompt: an English prompt describing only the motion over the shot duration (subject motion, camera motion, pacing). Keep it consistent with the still frame.',
    `imageModel: default "${defaults.imageModel}" unless there is a clear reason otherwise.`,
    `animationModel: choose "Kling 2.6" for simple or moderate motion; "Seedance 1.5 Pro" when the shot needs very high realism, complex human motion, emotional performance or cinematic quality; "Hailuo 2.3" for simple, budget-friendly shots. Default "${defaults.animationModel}". Explain the choice briefly in animationModelReason.`,
    'Fields other than imagePrompt / animationPrompt may be written in the same language as the script.',
    'sceneIndex is the zero-based index of the script scene the shot belongs to; narration is the exact narration part covered by the shot (empty string if none).',
  ].join('\n');
}

export function storyboardUserPrompt(ctx: ProjectContext, script: ScriptContent): string {
  const scenes = script.scenes.map((s, i) => ({
    sceneIndex: i,
    storyRole: s.storyRole,
    narration: s.narration,
    onScreenText: s.onScreenText,
    visualAction: s.visualAction,
    estDurationSec: s.estDurationSec,
  }));
  return `BRIEF:\n${briefToText(ctx)}\n\nAPPROVED SCRIPT "${script.title}":\n${JSON.stringify(scenes, null, 2)}\n\nCreate the storyboard shots.`;
}

const str = { type: 'string' } as const;

export const SCRIPT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'logline', 'scenes'],
  properties: {
    title: str,
    logline: str,
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['storyRole', 'narration', 'onScreenText', 'visualAction', 'estDurationSec', 'notes'],
        properties: {
          storyRole: { type: 'string', enum: [...STORY_ROLES] },
          narration: str,
          onScreenText: str,
          visualAction: str,
          estDurationSec: { type: 'number' },
          notes: str,
        },
      },
    },
  },
} as const;

export const SHOT_KEYS = [
  'sceneIndex',
  'narration',
  'durationSec',
  'action',
  'shotType',
  'cameraAngle',
  'composition',
  'movement',
  'lens',
  'lighting',
  'colorMood',
  'character',
  'wardrobe',
  'consistencyNotes',
  'imagePrompt',
  'animationPrompt',
  'imageModel',
  'animationModel',
  'animationModelReason',
] as const;

export const STORYBOARD_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['shots'],
  properties: {
    shots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [...SHOT_KEYS],
        properties: Object.fromEntries(
          SHOT_KEYS.map((k) => [
            k,
            k === 'sceneIndex' ? { type: 'integer' } : k === 'durationSec' ? { type: 'number' } : str,
          ]),
        ),
      },
    },
  },
} as const;

/* ---------- שיתוף פעולה: מודל אחד כותב, השני מבקר ומשפר ---------- */

export const SCRIPT_REVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reviewNotes', 'script'],
  properties: {
    reviewNotes: { type: 'array', items: str },
    script: SCRIPT_JSON_SCHEMA,
  },
} as const;

export const STORYBOARD_REVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reviewNotes', 'shots'],
  properties: {
    reviewNotes: { type: 'array', items: str },
    shots: STORYBOARD_JSON_SCHEMA.properties.shots,
  },
} as const;

const reviewNotesRule = (lang: string) =>
  `reviewNotes: 2–6 short bullet points, written in ${lang || 'the brief language'}, saying what you changed and why (or confirming what was already strong). No preamble.`;

export function scriptReviewSystemPrompt(ctx: ProjectContext): string {
  return [
    scriptSystemPrompt(ctx),
    '',
    'ROLE NOW: you are the reviewing creative director. Another AI wrote the draft below. Review it strictly against the brief and return an improved, complete script.',
    'Check: the hook lands in the first 1–3 seconds; the key message is clear; every claim is supported by the brief; tone and language fit the audience; narration sounds natural aloud; timing per scene and in total fits the target duration; visualAction is concrete and filmable for AI generation; the CTA matches the goal.',
    'Keep what works. Do not rewrite for the sake of rewriting.',
    reviewNotesRule(ctx.brief.language),
  ].join('\n');
}

export function scriptReviewUserPrompt(ctx: ProjectContext, draft: ScriptContent | { title: string; logline: string; scenes: unknown[] }, feedback?: string): string {
  const scenes = (draft.scenes as Array<Record<string, unknown>>).map(({ id: _id, ...s }) => s);
  return [
    `BRIEF:\n${briefToText(ctx)}`,
    feedback ? `CLIENT/OWNER FEEDBACK THAT THE DRAFT HAD TO APPLY:\n${feedback}` : '',
    `DRAFT SCRIPT (JSON):\n${JSON.stringify({ title: draft.title, logline: draft.logline, scenes }, null, 2)}`,
    'Return reviewNotes and the improved full script.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function storyboardReviewSystemPrompt(defaults: { imageModel: string; animationModel: string }, lang: string): string {
  return [
    storyboardSystemPrompt(defaults),
    '',
    'ROLE NOW: you are the reviewing director of photography. Another AI drafted the shots below. Review and return the improved complete shot list.',
    'Check: every scene is covered and shot durations add up; imagePrompt is specific enough for a consistent photorealistic frame (same character identity, wardrobe, product look across shots); animationPrompt describes motion only and is achievable in the shot duration; camera choices vary with purpose; the chosen animation model fits the motion complexity.',
    'Keep what works.',
    reviewNotesRule(lang),
  ].join('\n');
}

export function storyboardReviewUserPrompt(ctx: ProjectContext, script: ScriptContent, shots: unknown[]): string {
  return [
    storyboardUserPrompt(ctx, script),
    `DRAFT SHOTS (JSON):\n${JSON.stringify(shots, null, 2)}`,
    'Return reviewNotes and the improved full shot list.',
  ].join('\n\n');
}
