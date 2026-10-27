/**
 * תבניות פרומפט וסכמות JSON לספקי טקסט.
 * הפלט חייב להיות מובנה (Structured Outputs) כדי שהתסריט והשוטים יישמרו כנתונים ולא כטקסט חופשי.
 */
import {
  ANIMATION_MODEL_OPTIONS,
  BANNED_HE,
  CONCEPT_CRITERIA,
  QA_DETECTORS,
  QA_RUBRIC,
  QA_STAGES,
  type Brief,
  type Concept,
  type ConceptCriterion,
  type ProductIntel,
  type QaCriterion,
  type QaDetector,
  type ScriptContent,
  STORY_ROLES,
  wordsPerSecond,
} from '@apos/shared';
import type { ProjectContext, RevisionKind } from './types.js';

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
    b.intel ? `PRODUCT INTELLIGENCE (extracted before writing — claims must come from the verified facts):\n${intelToText(b.intel)}` : '',
    ctx.playbook?.trim()
      ? `STUDIO PLAYBOOK — the owner's production know-how (apply the creative and client knowledge; ignore anything about operating tools):\n${ctx.playbook.trim()}`
      : '',
    ctx.lessons?.length ? lessonsBlock(ctx.lessons) : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * סדר העדיפויות בין ההוראות. בלי זה, אפיון או כלל שנלמד שמכתיבים "מבנה מחייב" גוברים על הרעיון,
 * והתסריט הופך לסיור בפיצ'רים (הכשל של "קבע לי תור" v5.2).
 */
export function priorityRule(): string {
  return [
    'PRIORITY OF INSTRUCTIONS (when they conflict, the higher one wins):',
    '1. Facts, the offer, must-say items, terminology and legal limits from the brief and the product intelligence are binding. Never contradict them, never invent capabilities, prices, numbers or claims.',
    '2. The chosen creative direction decides the story: the opening moment, the tension, the order of scenes.',
    '3. The copy rules.',
    '4. House rules and the studio playbook.',
    'If the brief or a house rule dictates a scene-by-scene structure, a fixed order of features or a template, treat it as a list of things the viewer must understand by the end — NOT as the structure of the ad. Clarity requirements (who it is for, what the product is) are met inside the story of the idea.',
  ].join('\n');
}

/** כללי הבית שנלמדו מהערות קודמות — מחייבים לעובדות, מונחים, טון וטעם; לא למבנה */
export function lessonsBlock(lessons: string[]): string {
  return [
    "HOUSE RULES LEARNED FROM THE OWNER'S AND CLIENT'S PAST FEEDBACK. Follow them for facts, terminology, tone and taste — the owner must never have to give the same note twice. A house rule never dictates the ad's structure or scene order (see PRIORITY OF INSTRUCTIONS):",
    ...lessons.map((l) => `- ${l}`),
  ].join('\n');
}

/** תקציב מילים מציאותי: קצב הקריינות × האורך, פחות 10% לנשימה, לכרטיס הסיום ולוויזואל */
export function wordBudget(brief: Pick<ProjectContext['brief'], 'durationSec' | 'language' | 'voiceoverNeeded'>): number {
  if (!brief.durationSec || brief.voiceoverNeeded === false) return 0;
  return Math.floor(brief.durationSec * wordsPerSecond(brief.language) * 0.9);
}

/**
 * כללי הקופי של הבית: מה מבדיל תסריט שנשמע כמו אדם מתסריט שנשמע כמו ברושור.
 * משותף לכתיבה, לתיקון ולביקורת — כדי שכולם ימדדו באותו סרגל. חלקם נבדקים גם בקוד (creative-checks.ts).
 */
export function copyRules(ctx: ProjectContext): string {
  const hebrew = !ctx.brief.language || /עברית|hebrew/i.test(ctx.brief.language);
  const wps = wordsPerSecond(ctx.brief.language);
  const budget = wordBudget(ctx.brief);
  return [
    'COPY RULES (non-negotiable — this is what separates a human ad from a brochure):',
    '- ONE idea per ad. The viewer must be able to repeat the ad in one sentence. Use at most 2 product features that serve that idea; everything else the brief lists goes to on-screen text, the end card, or is dropped.',
    '- Talk like a real person talking to ONE viewer — the way a sharp copywriter talks to a friend who owns that kind of business. Spoken, warm, a bit cheeky when the tone allows. Never like a feature list or a product page.',
    '- Concrete beats abstract: a real moment, a real detail, a real number from the brief. "הטלפון מצלצל כשהמספריים ביד" beats "ניהול תורים יעיל".',
    '- Every scene has one clear job: advance the story, show the pain or the desire, show a product benefit, build trust, strengthen the offer, or drive action. A scene with no job is cut.',
    '- Every line earns its place. Narration never describes what the viewer already sees on screen.',
    '- Vary the rhythm: mix very short lines (2–4 words) with normal ones. No two consecutive lines with the same structure or the same opening word.',
    '- Avoid the automatic solutions unless there is a specific creative reason: opening on a routine problem, a montage of professionals, a list of features, a generic "join now" ending.',
    '- The hook belongs to THIS idea: if it could open any competitor\'s ad, it is not a hook.',
    '- CTA: one short spoken line that pays off the idea. Offer details (trial, no credit card, URL) go to on-screen text.',
    budget ? `- Length: at most ${budget} spoken words in total (${wps} words/second × ${ctx.brief.durationSec}s, minus breathing room). Count them. Over that = cut, never speed up.` : '',
    hebrew
      ? [
          '- Hebrew: everyday spoken Israeli Hebrew, the way people actually talk — not translated, not formal, not "שפת פרסומות". Do not repeat "אתם" / "שלכם" in every line; real people say it once and move on.',
          `- BANNED phrases and patterns (they instantly sound like a brochure): ${BANNED_HE.map((b) => `"${b}"`).join(', ')}, "תנו ל... לעשות את העבודה", chains of three adjectives, features joined by "ו" in one sentence, a rhetorical question answered right away by "עם X...".`,
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
    'Write a production-ready script from the brief. Do not invent product claims, prices or facts that are not in the brief.',
    `Write narration and on-screen text in the brief's language (${ctx.brief.language || 'same language as the brief'}). Write visualAction and notes in the same language.`,
    'Narration must sound natural when read aloud: short sentences, spoken rhythm, no stage directions inside narration.',
    priorityRule(),
    copyRules(ctx),
    `Timing: about ${wps} spoken words per second. Each scene's estDurationSec must fit its narration, and the total must match the target duration within ±10%.`,
    'Structure: a hook in the first 1–3 seconds and a CTA at the end when the goal requires one. Between them, follow the story of the one idea — not a fixed problem/solution/benefit template.',
    `storyRole must be one of: ${STORY_ROLES.join(', ')}.`,
    'visualAction: the key image of the scene in one or two concrete, filmable sentences. No shot lists and no per-shot durations — the storyboard breaks scenes into shots later.',
    'notes: optional production notes (sound, transitions, emphasis). Use an empty string if none.',
  ].join('\n');
}

/* ---------- כתיבה בשני שלבים: קודם טקסט חופשי (כמו בצ'אט), אחר כך חלוקה לסצנות מילה במילה ---------- */

export function creativeSystemPrompt(ctx: ProjectContext): string {
  return [
    'You are one of the best commercial copywriters and creative directors in the market, writing a short video ad for social media.',
    'Write it the way you would in a conversation with the studio owner: a finished, human, persuasive script — not a template, not JSON.',
    `Language of narration and on-screen text: ${ctx.brief.language || 'same language as the brief'}.`,
    ctx.brief.voiceoverNeeded === false ? 'There is NO voice-over: tell the story with visuals and short on-screen text only (every narration line is —).' : '',
    priorityRule(),
    copyRules(ctx),
    '',
    ctx.brief.concept?.trim()
      ? 'Build the whole ad on the CHOSEN CREATIVE DIRECTION in the brief: its hook, its tension and its promise. Do not drift back to a generic product walkthrough.'
      : 'Before writing, decide silently: who exactly is watching, which moment of their day we open on, and the ONE sentence the viewer should remember. Then write.',
    'OUTPUT FORMAT (plain text, nothing else):',
    'כותרת: <short title>',
    'הרעיון: <the one sentence the viewer remembers>',
    'then for each scene:',
    'סצנה N',
    'קריינות: <exact spoken words, or —>',
    'על המסך: <short on-screen text, or —>',
    'רואים: <one or two sentences: the key image only, no shot list>',
    'שניות: <seconds, realistic for the narration>',
  ]
    .filter(Boolean)
    .join('\n');
}

export function creativeUserPrompt(ctx: ProjectContext): string {
  return [
    `BRIEF:\n${briefToText(ctx)}`,
    ctx.rewriteNotes?.trim()
      ? `THE PREVIOUS ATTEMPT WAS REJECTED. Write a NEW script from the brief and the chosen direction — do not reuse its wording, its scene order or its structure. Why it was rejected:\n${ctx.rewriteNotes.trim()}`
      : '',
    'Write the ad now.',
  ]
    .filter(Boolean)
    .join('\n\n');
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

/* ---------- A. הבנת המוצר: עובדות / הנחות / שאלות פתוחות, לפני כל רעיון ---------- */

const s0 = { type: 'string' } as const;
const arr0 = { type: 'array', items: s0 } as const;

export const INTEL_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['audience', 'problem', 'desire', 'whatItDoes', 'advantage', 'proofs', 'offer', 'action', 'limits', 'facts', 'assumptions', 'openQuestions'],
  properties: {
    audience: s0,
    problem: s0,
    desire: s0,
    whatItDoes: s0,
    advantage: s0,
    proofs: arr0,
    offer: s0,
    action: s0,
    limits: s0,
    facts: arr0,
    assumptions: arr0,
    openQuestions: arr0,
  },
} as const;

export function intelSystemPrompt(ctx: ProjectContext): string {
  return [
    'You are the strategist of an ad studio. Before anyone has an idea, you extract what is true about the product and its buyer.',
    'Fill: audience (exactly who, not a category list), problem (what they actually live through), desire (the result they want), whatItDoes (what the product really does), advantage (the real edge over the alternatives they use today), proofs (claims that can be shown credibly), offer, action (the one thing the viewer should do), limits (budget, format, length, production).',
    'facts: only what the brief or the client website states. assumptions: reasonable but NOT stated — mark them as such. openQuestions: what is missing and matters for the ad.',
    'Never invent capabilities, numbers, testimonials or claims. If the sources do not say it, it goes to assumptions or openQuestions.',
    `Write in ${ctx.brief.language?.match(/english|אנגל/i) ? 'English' : 'Hebrew'}. Short, concrete sentences.`,
  ].join('\n');
}

export function intelUserPrompt(ctx: ProjectContext, site: string): string {
  return [`BRIEF:\n${briefToText({ ...ctx, brief: { ...ctx.brief, intel: null, concept: '' } })}`, site ? `CLIENT WEBSITE (text):\n${site}` : '', 'Extract the product intelligence now.']
    .filter(Boolean)
    .join('\n\n');
}

export function intelToText(i: ProductIntel | null | undefined): string {
  if (!i) return '';
  const list = (t: string, a: string[]) => (a.length ? `${t}:\n${a.map((x) => `  - ${x}`).join('\n')}` : '');
  return [
    i.audience && `Audience: ${i.audience}`,
    i.problem && `Problem: ${i.problem}`,
    i.desire && `Desire: ${i.desire}`,
    i.whatItDoes && `What it does: ${i.whatItDoes}`,
    i.advantage && `Real advantage: ${i.advantage}`,
    list('Proofs that can be shown', i.proofs),
    i.offer && `Offer: ${i.offer}`,
    i.action && `Action: ${i.action}`,
    i.limits && `Limits: ${i.limits}`,
    list('VERIFIED FACTS (only these may be claimed)', i.facts),
    list('Assumptions (do not state as fact)', i.assumptions),
    list('Open questions', i.openQuestions),
  ]
    .filter(Boolean)
    .join('\n');
}

/* ---------- B. כיווני קריאייטיב: 3 רעיונות שונים מהותית ---------- */

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
        required: ['title', 'idea', 'insight', 'hook', 'tension', 'productRole', 'promise', 'standout'],
        properties: { title: s0, idea: s0, insight: s0, hook: s0, tension: s0, productRole: s0, promise: s0, standout: s0 },
      },
    },
  },
} as const;

export function conceptsSystemPrompt(ctx: ProjectContext): string {
  return [
    'You are a top creative director. Propose exactly 3 creative directions for this video ad.',
    'They must be GENUINELY different: a different situation, a different opening moment, a different emotion or angle. Three wordings of the same situation is a failure.',
    'Avoid the automatic solutions unless you can name the specific reason they fit: opening on a routine problem, a montage of professionals, a feature list, a generic "join now" ending.',
    'Each direction: title (2–4 words); idea (the ONE sentence the viewer remembers); insight (the human or business truth it rests on); hook (the exact first spoken line, or the first image if there is no voice-over — specific to THIS idea, not swappable to any brand); tension (the conflict that keeps people watching); productRole (how the product enters the story — as the turn, not as a feature list); promise (the marketing promise); standout (why it would stand out against competitor ads in the feed).',
    'Use only the verified facts. No invented claims or numbers.',
    copyRules(ctx),
    `Write everything in ${ctx.brief.language || 'the brief language'}.`,
  ].join('\n');
}

export function conceptsUserPrompt(ctx: ProjectContext, avoid: string[] = []): string {
  return [
    `BRIEF:\n${briefToText({ ...ctx, brief: { ...ctx.brief, concept: '' } })}`,
    avoid.length ? `DIRECTIONS ALREADY REJECTED — do not repeat them or their situations:\n${avoid.map((a) => `- ${a}`).join('\n')}` : '',
    'Propose the 3 directions now.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/* ---------- C. בחירת כיוון לפי קריטריונים מפורשים ---------- */

const CRITERIA_KEYS = Object.keys(CONCEPT_CRITERIA) as ConceptCriterion[];

export const SELECT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['evaluations'],
  properties: {
    evaluations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'scores', 'verdict'],
        properties: {
          index: { type: 'integer' },
          scores: { type: 'object', additionalProperties: false, required: CRITERIA_KEYS, properties: Object.fromEntries(CRITERIA_KEYS.map((k) => [k, { type: 'integer' }])) },
          verdict: s0,
        },
      },
    },
  },
} as const;

export function selectSystemPrompt(ctx: ProjectContext): string {
  return [
    'You are the head of strategy judging creative directions before any script is written. Judge harshly and independently.',
    `Score each direction 1–10 on: ${CRITERIA_KEYS.map((k) => `${k} (${CONCEPT_CRITERIA[k]})`).join(', ')}.`,
    'Scale: 5 = an average ad nobody remembers, 7 = good enough to run, 9+ = rare. Most directions deserve 4–7.',
    'Do not confuse an idea that is easy to produce with an idea that is worth producing: feasibility is one criterion of six.',
    'A hook that could open any competitor\'s ad scores at most 4 on stopScroll and differentiation.',
    `verdict: one sentence in ${ctx.brief.language?.match(/english|אנגל/i) ? 'English' : 'Hebrew'} — the strongest reason for or against.`,
  ].join('\n');
}

export function selectUserPrompt(ctx: ProjectContext, concepts: Array<Pick<Concept, 'title' | 'idea' | 'insight' | 'hook' | 'tension' | 'productRole' | 'promise' | 'standout'>>): string {
  return [
    `BRIEF:\n${briefToText({ ...ctx, brief: { ...ctx.brief, concept: '' } })}`,
    `DIRECTIONS:\n${JSON.stringify(concepts.map((c, index) => ({ index, ...c })), null, 2)}`,
    'Score every direction.',
  ].join('\n\n');
}

/* ---------- QA קריאייטיבי עצמאי (ChatGPT): 100 נקודות, ראיות מתוך התסריט, ושער מעבר בקוד ---------- */

const RUBRIC_KEYS = Object.keys(QA_RUBRIC) as QaCriterion[];
const DETECTOR_KEYS = Object.keys(QA_DETECTORS) as QaDetector[];

export const QA_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scores', 'detectors', 'critical', 'unsupportedClaims', 'failStage', 'fixes'],
  properties: {
    scores: {
      type: 'object',
      additionalProperties: false,
      required: RUBRIC_KEYS,
      properties: Object.fromEntries(
        RUBRIC_KEYS.map((k) => [k, { type: 'object', additionalProperties: false, required: ['score', 'evidence'], properties: { score: { type: 'integer' }, evidence: s0 } }]),
      ),
    },
    detectors: {
      type: 'object',
      additionalProperties: false,
      required: DETECTOR_KEYS,
      properties: Object.fromEntries(
        DETECTOR_KEYS.map((k) => [k, { type: 'object', additionalProperties: false, required: ['found', 'evidence'], properties: { found: { type: 'boolean' }, evidence: s0 } }]),
      ),
    },
    critical: arr0,
    unsupportedClaims: arr0,
    failStage: { type: 'string', enum: Object.keys(QA_STAGES) },
    fixes: arr0,
  },
} as const;

export function qaSystemPrompt(ctx: ProjectContext): string {
  const lang = ctx.brief.language?.match(/english|אנגל/i) ? 'English' : 'Hebrew';
  return [
    'You are an independent creative QA judge at an ad agency. You did not write this script and you do not assume it is good. Your job is to stop weak work from reaching the client.',
    'A script that is complete, well-structured and full of detailed shots but would not make a real viewer stop, care and act is a FAIL. Judge the ad, not the formatting.',
    `Score out of 100: ${RUBRIC_KEYS.map((k) => `${k} = ${QA_RUBRIC[k].label} (0–${QA_RUBRIC[k].max})`).join('; ')}.`,
    'Every score needs evidence: quote the exact words or scene numbers from the script that justify it. A number without a quote is invalid.',
    'Calibration: an average, forgettable but correct ad scores about 60–70 in total. 85+ means you would put it in front of the client without changes.',
    `detectors — for each, found=true/false with evidence: ${DETECTOR_KEYS.map((k) => `${k} (${QA_DETECTORS[k]})`).join('; ')}.`,
    'critical: failures that alone block the script (e.g. the viewer would not understand what the product is, a claim that contradicts the facts, the ad has no idea at all, it is far over the length).',
    'unsupportedClaims: every product claim in the script that is NOT in the verified facts (quote it).',
    'failStage — where the failure comes from, so the system goes back to the right step instead of rewording: "product" (the product or audience is misunderstood), "concept" (the idea itself is weak or generic — rewording will not fix it), "selection" (one of the other directions would clearly be stronger), "writing" (the idea is good, the execution is weak), "none" (passes).',
    `fixes: up to 5 concrete instructions for the next attempt, aimed at the root cause. Write evidence, critical, unsupportedClaims and fixes in ${lang}.`,
    'The CODE CHECKS list is measured, not opinion: treat each item as true.',
  ].join('\n');
}

export function qaUserPrompt(ctx: ProjectContext, script: ScriptLike, codeChecks: string[], otherConcepts: Concept[]): string {
  return [
    `BRIEF (with product intelligence and the chosen direction):\n${briefToText(ctx)}`,
    otherConcepts.length ? `OTHER DIRECTIONS THAT WERE CONSIDERED:\n${otherConcepts.map((c) => `- ${c.title}: ${c.idea}`).join('\n')}` : '',
    `SCRIPT (JSON):\n${scriptJson(script)}`,
    `CODE CHECKS:\n${codeChecks.length ? codeChecks.map((c) => `- ${c}`).join('\n') : '- (none failed)'}`,
    'Judge it now.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function scriptUserPrompt(ctx: ProjectContext): string {
  return `BRIEF:\n${briefToText(ctx)}\n\nWrite the script now.`;
}

/**
 * תיקון נקודתי ≠ הערה כללית ≠ כתיבה מחדש. בלי ההפרדה, בקשת סגנון כללית קיבלה "SURGICAL EDIT"
 * והתסריט שמר את השלד והקצב הישנים.
 */
const REVISE_INSTRUCTION: Record<RevisionKind, string> = {
  surgical:
    'Produce a revised full script. SURGICAL EDIT: change ONLY what the feedback explicitly targets (if it names specific lines, scenes or words, touch only those). Every other scene, line, word, timing and visual must stay exactly as in the current script, character for character. Do not "improve" anything that was not asked.',
  global:
    'Produce a revised full script. This is a GENERAL NOTE about the whole script, not a fix to one spot: apply it everywhere it is relevant. Rephrase lines, change the rhythm, merge, split or cut scenes when the note calls for it — a line the note concerns must actually change, not keep its old wording or sentence pattern. Keep the chosen idea, the facts and the parts the note clearly does not concern. Follow the COPY RULES in every line you write.',
  rewrite:
    'The owner asked for a REWRITE. Write a NEW script from the brief and the chosen direction, guided by the feedback. The current script is shown only so you know what was rejected: do not reuse its wording, its scene order, its rhythm or its structure. Follow the COPY RULES.',
};

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
    REVISE_INSTRUCTION[ctx.revision ?? 'surgical'],
  ].join('\n\n');
}

/** פרויקטים ישנים שמורים עם "Kling 2.6" וכו' — מודל שלא ברשימה הנוכחית מוחלף בברירת המחדל */
const animationDefault = (model: string) => (ANIMATION_MODEL_OPTIONS.includes(model) ? model : ANIMATION_MODEL_OPTIONS[0]);

export function storyboardSystemPrompt(defaults: { imageModel: string; animationModel: string }): string {
  return [
    'You are a cinematographer and storyboard artist preparing shots for AI image generation and AI video animation.',
    'Break each script scene into one or more shots. Keep shot durations realistic for AI video (usually 2–8 seconds) and the sum close to the scene duration.',
    'For every shot fill all fields concretely: shot type, camera angle, composition and subject placement, body/head/gaze movement, lens & depth of field when relevant, lighting, color & mood, character description and wardrobe, and consistency requirements versus other shots (same character identity, wardrobe, product look, logo).',
    'imagePrompt: a detailed English prompt for a photorealistic still frame (subject, action, environment, camera, lens, lighting, color grade, realistic human skin texture when people appear, aspect ratio). No brand names of AI tools inside the prompt.',
    'animationPrompt: an English prompt describing only the motion over the shot duration — the still frame already carries the look. ONE subject action written as beats and ONE camera move (name, start → end, speed); stacked camera moves cause jitter and drift. Phrase it positively ("locked camera", not "the camera does not move"). Keep it consistent with the still frame.',
    `imageModel: default "${defaults.imageModel}" unless there is a clear reason otherwise.`,
    `animationModel: choose "Kling 3.0" for most shots (cinematic camera moves, moderate motion, product moves); "Seedance 2.0" when the shot needs very high realism, complex human motion, emotional performance or exact product identity; "Seedance 2.0 Mini" for simple, budget-friendly shots. Default "${animationDefault(defaults.animationModel)}". Explain the choice briefly in animationModelReason.`,
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
      'visualAction stays ONE or TWO sentences: the key image of the scene. No shot lists, no per-shot durations, no camera breakdowns — the storyboard does that later.',
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
