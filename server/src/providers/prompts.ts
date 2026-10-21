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
    ['Client website', b.website],
    ['Target audience', b.targetAudience],
    ['Target market / country', b.targetMarket],
    ['Key message', b.keyMessage],
    ['Call to action', b.cta],
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
    ['CHOSEN CREATIVE DIRECTION (the owner picked it — build the whole script on this idea)', b.concept],
    ['Links', b.links.filter((l) => l.url.trim()).map((l) => (l.label ? `${l.label}: ${l.url}` : l.url)).join(' | ')],
  ];
  const brief = lines
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  return [
    brief,
    ctx.playbook?.trim()
      ? `STUDIO PLAYBOOK — the owner's production know-how (apply the creative and client knowledge; ignore anything about operating tools):\n${ctx.playbook.trim()}`
      : '',
    ctx.lessons?.length ? lessonsBlock(ctx.lessons) : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** כללי הבית שנלמדו מהערות קודמות — מחייבים כמו האפיון, אלא אם האפיון אומר אחרת במפורש */
export function lessonsBlock(lessons: string[]): string {
  return [
    'HOUSE RULES LEARNED FROM THE OWNER\'S AND CLIENT\'S PAST FEEDBACK. They are mandatory: the owner must never have to give the same note twice. Follow them unless this brief explicitly says otherwise:',
    ...lessons.map((l) => `- ${l}`),
  ].join('\n');
}

/**
 * כללי הקופי של הבית: מה מבדיל תסריט שנשמע כמו אדם מתסריט שנשמע כמו ברושור.
 * משותף לכתיבה, לתיקון ולביקורת — כדי שכולם ימדדו באותו סרגל.
 */
export function copyRules(ctx: ProjectContext): string {
  const hebrew = !ctx.brief.language || /עברית|hebrew/i.test(ctx.brief.language);
  const wps = wordsPerSecond(ctx.brief.language);
  const max = ctx.brief.durationSec ? Math.round(ctx.brief.durationSec * wps) : 0;
  return [
    'COPY RULES (non-negotiable — this is what separates a human ad from a brochure):',
    '- ONE idea per ad. The viewer must be able to repeat the ad in one sentence. Use at most 2 product features that serve that idea; drop the rest, even if the brief lists them.',
    '- Talk like a real person talking to ONE viewer — the way a sharp copywriter talks to a friend who owns that kind of business. Spoken, warm, a bit cheeky when the tone allows. Never like a feature list or a product page.',
    '- Concrete beats abstract: a real moment, a real detail, a real number from the brief. "הטלפון מצלצל כשהמספריים ביד" beats "ניהול תורים יעיל".',
    '- Every line earns its place: a line that only explains what the product does is rewritten as what the viewer gets or feels, or cut.',
    '- Vary the rhythm: mix very short lines (2–4 words) with normal ones. No two consecutive lines with the same structure.',
    '- The hook is a moment or a line the viewer recognises from their own day — not a generic question.',
    '- CTA: one short spoken line. Offer details (trial, no credit card, URL) go to on-screen text, not all into narration.',
    max ? `- Length: about ${max} spoken words in total (${wps} words/second × ${ctx.brief.durationSec}s). Over that = cut, never speed up.` : '',
    hebrew
      ? [
          '- Hebrew: everyday spoken Israeli Hebrew, the way people actually talk — not translated, not formal, not "שפת פרסומות". Address the viewer naturally (אתם / את / אתה); slang only where it sounds natural.',
          '- BANNED phrases and patterns (they instantly sound like a brochure): "בשונה מ...", "הכל במקום אחד", "פשוט, מהיר ונוח", "בקלות ובמהירות", "הפתרון המושלם", "חוויית משתמש", "בלחיצת כפתור", "תנו ל... לעשות את העבודה", "הגיע הזמן", "עשרים וארבע שבע" in narration, chains of three adjectives, features joined by "ו" in one sentence, a rhetorical question answered right away by "עם X...".',
        ].join('\n')
      : '- BANNED: brochure clichés ("all in one place", "seamless", "the perfect solution", "say goodbye to", "game-changer"), feature lists, chains of adjectives.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function scriptSystemPrompt(ctx: ProjectContext): string {
  const wps = wordsPerSecond(ctx.brief.language);
  return [
    'You are a senior commercial scriptwriter and creative director for short AI-generated marketing videos.',
    'Write a production-ready script based strictly on the brief. Do not invent product claims, prices or facts that are not in the brief.',
    `Write narration and on-screen text in the brief's language (${ctx.brief.language || 'same language as the brief'}). Write visualAction and notes in the same language.`,
    'Narration must sound natural when read aloud: short sentences, spoken rhythm, no stage directions inside narration.',
    copyRules(ctx),
    `Timing: assume about ${wps} spoken words per second. Each scene's estDurationSec must fit its narration, and the total must match the target duration within ±10%.`,
    'Structure: a hook in the first 1–3 seconds and a CTA at the end when the goal requires one. Between them, follow the story of the one idea — not a fixed problem/solution/benefit template.',
    `storyRole must be one of: ${STORY_ROLES.join(', ')}.`,
    'visualAction describes what is seen on screen in one or two concrete, filmable sentences, suitable for AI image/video generation.',
    'notes: optional production notes (sound, transitions, emphasis). Use an empty string if none.',
  ].join('\n');
}

/* ---------- כתיבה בשני שלבים: קודם טקסט חופשי (כמו בצ'אט), אחר כך חלוקה לסצנות מילה במילה ---------- */

export function creativeSystemPrompt(ctx: ProjectContext): string {
  return [
    'You are one of the best commercial copywriters and creative directors in the market, writing a short video ad for social media.',
    'Write it the way you would in a conversation with the studio owner: a finished, human, persuasive script — not a template, not JSON.',
    'Base it strictly on the brief: no invented claims, prices, numbers or facts.',
    `Language of narration and on-screen text: ${ctx.brief.language || 'same language as the brief'}.`,
    ctx.brief.voiceoverNeeded === false ? 'There is NO voice-over: tell the story with visuals and short on-screen text only (every narration line is —).' : '',
    copyRules(ctx),
    '',
    'Before writing, decide silently: who exactly is watching, which moment of their day we open on, and the ONE sentence the viewer should remember. Then write.',
    'OUTPUT FORMAT (plain text, nothing else):',
    'כותרת: <short title>',
    'הרעיון: <the one sentence the viewer remembers>',
    'then for each scene:',
    'סצנה N',
    'קריינות: <exact spoken words, or —>',
    'על המסך: <short on-screen text, or —>',
    'רואים: <one or two concrete, filmable sentences>',
    'שניות: <estimated seconds>',
  ]
    .filter(Boolean)
    .join('\n');
}

export function creativeUserPrompt(ctx: ProjectContext): string {
  return `BRIEF:\n${briefToText(ctx)}\n\nWrite the ad now.`;
}

export function structureSystemPrompt(): string {
  return [
    'You convert a finished ad script from plain text into structured JSON scenes. You are a typist, not a writer.',
    'Copy narration, on-screen text and visuals WORD FOR WORD from the text. Do not rewrite, shorten, translate, polish or "fix" any wording. "—" means an empty string.',
    'title: the title line. logline: the "הרעיון" line.',
    `storyRole: pick the closest of: ${STORY_ROLES.join(', ')}.`,
    'estDurationSec: the seconds written for the scene (a number). notes: empty string unless the text has production notes for that scene.',
  ].join('\n');
}

export function structureUserPrompt(text: string): string {
  return `SCRIPT (plain text):\n${text}\n\nReturn the JSON.`;
}

/* ---------- כיווני קריאייטיב: 3 רעיונות שונים לפני שכותבים תסריט ---------- */

export const CONCEPTS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['concepts'],
  properties: {
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'idea', 'hook', 'story', 'why'],
        properties: {
          title: { type: 'string' },
          idea: { type: 'string' },
          hook: { type: 'string' },
          story: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
  },
} as const;

export function conceptsSystemPrompt(ctx: ProjectContext): string {
  return [
    'You are a top creative director. Propose exactly 3 creative directions for this video ad — genuinely different from each other (different angle, different opening moment, different emotion), not 3 variations of one idea.',
    'Base them strictly on the brief: no invented claims or numbers.',
    copyRules(ctx),
    `Write everything in ${ctx.brief.language || 'the brief language'}.`,
    'title: 2–4 words. idea: the ONE sentence the viewer remembers. hook: the exact first spoken line (or the first image if there is no voice-over). story: 2–3 sentences on how the ad unfolds. why: one sentence on why it works for this audience.',
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
    'Produce a revised full script. SURGICAL EDIT: change ONLY what the feedback explicitly targets (if it names specific lines, scenes or words, touch only those). Every other scene, line, word, timing and visual must stay exactly as in the current script, character for character. Do not "improve" anything that was not asked.',
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
  `reviewNotes: 1–3 bullet points in ${lang || 'the brief language'}, each at most 10 words, stating only what you changed (e.g. "סצנה 6: תוקנה שגיאת כתיב"). No praise, no explanations, no restating the feedback. If you changed nothing, return one bullet: "ללא שינוי".`;

/**
 * ביקורת תסריט. "visual": Claude — עובד רק על מה שרואים (הקופי של ChatGPT נשאר כמו שהוא, נאכף גם בקוד).
 * "copy": ChatGPT כעורך קופי ("שפר עם ChatGPT").
 */
export function scriptReviewSystemPrompt(ctx: ProjectContext, mode: 'copy' | 'visual' = 'copy'): string {
  const lang = ctx.brief.language || 'the brief language';
  if (mode === 'visual') {
    return [
      'You are the visual director of a short AI-generated video ad. A copywriter wrote the script below; the words are final.',
      'DO NOT TOUCH THE WORDS: copy title, logline, narration, onScreenText, storyRole and estDurationSec exactly, character for character, and keep the same scenes in the same order. Any change there is discarded anyway.',
      'You work ONLY on visualAction (and notes). For every scene make visualAction: concrete and filmable for AI image/video generation in one or two sentences; showing exactly the moment the narration talks about; consistent across scenes (same characters, wardrobe, locations, product look); varied in shot size and camera so the ad has rhythm; realistic and believable for the target market.',
      `Write visualAction and notes in ${lang}.`,
      `reviewNotes: up to 5 short bullets in ${lang}: what you changed in the visuals, plus concrete visual suggestions for the owner (e.g. "סצנה 3: לצלם מעל הכתף, שיראו את המסך"). No notes about the copy. If nothing needed changing, one bullet: "ללא שינוי בוויזואל".`,
    ].join('\n');
  }
  return [
    scriptSystemPrompt(ctx),
    '',
    'ROLE NOW: you are the editor. Another writer wrote the draft below. Your job is to protect its voice, not to replace it.',
    'Read every narration line aloud in your head. Change a line ONLY if it: breaks a COPY RULE (banned phrase, feature list, brochure tone, sounds translated or formal), makes a claim the brief does not support, or pushes the total over the target length. Everything else stays word for word.',
    'Also check: the ad can be summed up in one sentence (if not, cut the scene that dilutes it); the hook is a recognisable moment; the CTA is one short spoken line; visualAction is concrete and filmable for AI generation.',
    'When you change a line, write it the way a person would say it: shorter and more concrete. Never make a line longer or more formal. Do not rewrite for the sake of rewriting.',
    reviewNotesRule(ctx.brief.language),
  ].join('\n');
}

type ScriptLike = ScriptContent | { title: string; logline: string; scenes: unknown[] };
const scriptJson = (x: ScriptLike) =>
  JSON.stringify({ title: x.title, logline: x.logline, scenes: (x.scenes as Array<Record<string, unknown>>).map(({ id: _id, ...s }) => s) }, null, 2);

export function scriptReviewUserPrompt(ctx: ProjectContext, draft: ScriptLike, feedback?: string, base?: ScriptLike): string {
  const scenes = (draft.scenes as Array<Record<string, unknown>>).map(({ id: _id, ...s }) => s);
  return [
    `BRIEF:\n${briefToText(ctx)}`,
    base
      ? `THIS IS A REVISION. PREVIOUS APPROVED-FOR-REVIEW VERSION (JSON):\n${scriptJson(base)}\n\nREVISION RULE: only what the feedback explicitly targets may differ from the previous version. If the draft changed anything else, restore it exactly from the previous version. Inside the changed parts you may only fix clear errors (typos, timing). Do not polish or rewrite anything else.`
      : '',
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
