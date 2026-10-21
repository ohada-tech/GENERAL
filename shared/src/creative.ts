/**
 * התהליך הקריאייטיבי לפני ואחרי כתיבת תסריט:
 * הבנת מוצר → 3 כיוונים → בחירה לפי קריטריונים → כתיבה → QA (ChatGPT) עם שער מעבר.
 * הטיפוסים והסרגל משותפים לשרת ולממשק, כדי שכולם ימדדו באותו סרגל.
 */
import { z } from 'zod';

/** הבנת המוצר: עובדות מאומתות מופרדות מהנחות ומשאלות פתוחות */
export const productIntelSchema = z.object({
  audience: z.string().default(''),
  problem: z.string().default(''),
  desire: z.string().default(''),
  whatItDoes: z.string().default(''),
  advantage: z.string().default(''),
  proofs: z.array(z.string()).default([]),
  offer: z.string().default(''),
  action: z.string().default(''),
  limits: z.string().default(''),
  facts: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});
export type ProductIntel = z.infer<typeof productIntelSchema>;

/** קריטריוני בחירת כיוון (כל אחד 1–10) */
export const CONCEPT_CRITERIA = {
  originality: 'מקוריות',
  relevance: 'רלוונטיות לקהל',
  stopScroll: 'עצירת גלילה',
  persuasion: 'פוטנציאל שכנוע',
  differentiation: 'בידול',
  feasibility: 'ישימות הפקתית',
} as const;
export type ConceptCriterion = keyof typeof CONCEPT_CRITERIA;
/** כיוון שממוצע הציונים שלו נמוך מזה — לא עומד ברף, ומפתחים כיוונים חדשים */
export const CONCEPT_MIN_AVG = 7;

export const conceptSchema = z.object({
  title: z.string().default(''),
  idea: z.string().default(''),
  insight: z.string().default(''),
  hook: z.string().default(''),
  tension: z.string().default(''),
  productRole: z.string().default(''),
  promise: z.string().default(''),
  standout: z.string().default(''),
  scores: z.record(z.string(), z.number()).default({}),
  verdict: z.string().default(''),
  rejected: z.boolean().default(false),
});
export type Concept = z.infer<typeof conceptSchema>;

export const conceptAvg = (c: Pick<Concept, 'scores'>) => {
  const v = (Object.keys(CONCEPT_CRITERIA) as ConceptCriterion[]).map((k) => Number(c.scores?.[k]) || 0);
  return v.reduce((a, b) => a + b, 0) / v.length;
};

/** הכיוון כטקסט שנכנס לאפיון (brief.concept) */
export const conceptText = (c: Concept) =>
  [
    `${c.title}: ${c.idea}`,
    c.insight && `תובנה: ${c.insight}`,
    c.hook && `הוק: ${c.hook}`,
    c.tension && `המתח: ${c.tension}`,
    c.productRole && `איך המוצר נכנס: ${c.productRole}`,
    c.promise && `ההבטחה: ${c.promise}`,
  ]
    .filter(Boolean)
    .join('\n');

/** סרגל ה-QA: 100 נקודות */
export const QA_RUBRIC = {
  idea: { label: 'מקוריות ועוצמת הרעיון', max: 25 },
  hook: { label: 'הוק ועצירת גלילה', max: 15 },
  story: { label: 'סיפור, מתח והתפתחות', max: 15 },
  product: { label: 'הבנת המוצר ודיוק המסר', max: 15 },
  persuasion: { label: 'שכנוע והנעה לפעולה', max: 15 },
  voice: { label: 'קריינות טבעית', max: 5 },
  production: { label: 'ישימות הפקתית והמשכיות', max: 10 },
} as const;
export type QaCriterion = keyof typeof QA_RUBRIC;
export const QA_PASS_TOTAL = 85;
export const QA_PASS_EACH = 0.7;

/** מה ה-QA חייב לזהות (כל אחד: נמצא / לא + ראיה) */
export const QA_DETECTORS = {
  swappableHook: 'הוק שאפשר להחליף בכל מותג אחר',
  noReasonToWatch: 'אין סיבה לצפות עד הסוף',
  cuttableStory: 'אפשר לקצר בלי לאבד דבר',
  featureList: 'פיצ׳רים כרשימת יתרונות במקום סיפור',
  prettyNoPurpose: 'סצנות יפות בלי תפקיד שיווקי',
  narrationExplainsVisual: 'קריינות שמסבירה את מה שכבר רואים',
  weakEnding: 'סיום שלא מממש את הרעיון / לא מניע לפעולה',
  looksProNotPersuasive: 'נראה מקצועי ומפורט אבל לא משכנע',
} as const;
export type QaDetector = keyof typeof QA_DETECTORS;

/** לאן חוזרים כשה-QA נכשל */
export const QA_STAGES = { product: 'הבנת המוצר', concept: 'פיתוח הרעיון', selection: 'בחירת הכיוון', writing: 'הכתיבה', none: '—' } as const;
export type QaStage = keyof typeof QA_STAGES;

export const qaReportSchema = z.object({
  total: z.number().default(0),
  passed: z.boolean().default(false),
  scores: z.record(z.string(), z.object({ score: z.number(), evidence: z.string().default('') })).default({}),
  detectors: z.record(z.string(), z.object({ found: z.boolean(), evidence: z.string().default('') })).default({}),
  critical: z.array(z.string()).default([]),
  unsupportedClaims: z.array(z.string()).default([]),
  codeChecks: z.array(z.string()).default([]),
  failStage: z.string().default('none'),
  fixes: z.array(z.string()).default([]),
  rounds: z.number().default(1),
  /** החלטה אנושית נדרשת: עברו 2 סבבים ועדיין לא עבר */
  needsOwner: z.boolean().default(false),
  judge: z.string().default(''),
});
export type QaReport = z.infer<typeof qaReportSchema>;

/** ביטויים שמסגירים ברושור — נבדקים גם בקוד, לא רק בפרומפט */
export const BANNED_HE = [
  'בשונה מ',
  'הכל במקום אחד',
  'הכול במקום אחד',
  'פשוט, מהיר ונוח',
  'בקלות ובמהירות',
  'הפתרון המושלם',
  'חוויית משתמש',
  'בלחיצת כפתור',
  'הגיע הזמן',
  'עשרים וארבע שבע',
  'ויש עוד משהו',
];
