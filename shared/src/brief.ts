import { z } from 'zod';

export const ASPECT_RATIOS = ['9:16', '16:9', '1:1', '4:5', '4:3', '21:9'] as const;

export const characterSchema = z.object({
  name: z.string().default(''),
  description: z.string().default(''),
});

export const linkSchema = z.object({
  label: z.string().default(''),
  url: z.string().default(''),
});

/**
 * האפיון נשמר כ-JSON על הפרויקט. כל השדות אופציונליים ברמת השמירה
 * (כדי לאפשר שמירת טיוטה), והשלמות נבדקת ב-validateBrief.
 */
export const briefSchema = z.object({
  videoType: z.string().default(''),
  goal: z.string().default(''),
  productOrService: z.string().default(''),
  /** אתר הלקוח — מקור לשפה, למסרים ולמראה של המותג */
  website: z.string().default(''),
  targetAudience: z.string().default(''),
  /** איפה הקהל: מדינה / שוק (ישראל, ארה"ב, אירופה…) — קובע שפה, תרבות, מטבע ורגולציה */
  targetMarket: z.string().default(''),
  keyMessage: z.string().default(''),
  /** מה הצופה צריך לעשות בסוף (להשאיר פרטים, לקנות, להוריד…) */
  cta: z.string().default(''),
  platforms: z.array(z.string()).default([]),
  aspectRatio: z.string().default(''),
  durationSec: z.number().int().nonnegative().nullable().default(null),
  visualStyle: z.string().default(''),
  inspirations: z.string().default(''),
  brandLogo: z.string().default(''),
  brandFonts: z.string().default(''),
  brandColors: z.string().default(''),
  brandImages: z.string().default(''),
  characters: z.array(characterSchema).default([]),
  voiceoverNeeded: z.boolean().default(true),
  language: z.string().default(''),
  tone: z.string().default(''),
  voiceNotes: z.string().default(''),
  budget: z.string().default(''),
  constraints: z.string().default(''),
  dueDate: z.string().default(''),
  links: z.array(linkSchema).default([]),
  /** מזהי קבצים שהועלו (טבלת assets) */
  attachmentIds: z.array(z.string()).default([]),
  notes: z.string().default(''),
});

export type Brief = z.infer<typeof briefSchema>;

export function emptyBrief(): Brief {
  return briefSchema.parse({});
}

export interface BriefFieldCheck {
  field: keyof Brief;
  label: string;
  level: 'required' | 'recommended';
  ok: boolean;
}

export interface BriefValidation {
  complete: boolean;
  missingRequired: BriefFieldCheck[];
  missingRecommended: BriefFieldCheck[];
  requiredDone: number;
  requiredTotal: number;
}

const filled = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return v > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
};

export const BRIEF_FIELD_LABELS: Partial<Record<keyof Brief, string>> = {
  videoType: 'סוג הסרטון',
  goal: 'מטרת הסרטון',
  productOrService: 'מוצר / שירות',
  website: 'אתר הלקוח',
  targetAudience: 'קהל יעד',
  targetMarket: 'שוק / מדינת יעד',
  keyMessage: 'המסר המרכזי',
  cta: 'קריאה לפעולה',
  platforms: 'פלטפורמת הפצה',
  aspectRatio: 'פורמט (יחס תמונה)',
  durationSec: 'אורך הסרטון',
  visualStyle: 'סגנון חזותי',
  inspirations: 'השראות',
  brandLogo: 'לוגו',
  brandColors: 'צבעי מותג',
  brandFonts: 'פונטים',
  characters: 'דמויות',
  language: 'שפת קריינות',
  tone: 'טון',
  dueDate: 'תאריך יעד',
  budget: 'תקציב / מגבלות',
  links: 'קישורים',
};

export function validateBrief(brief: Brief): BriefValidation {
  const required: Array<keyof Brief> = [
    'videoType',
    'goal',
    'productOrService',
    'targetAudience',
    'targetMarket',
    'keyMessage',
    'platforms',
    'aspectRatio',
    'durationSec',
    'visualStyle',
    'language',
    'dueDate',
  ];
  if (brief.voiceoverNeeded) required.push('tone');
  const recommended: Array<keyof Brief> = ['cta', 'inspirations', 'brandLogo', 'brandColors', 'characters', 'budget'];

  const check = (field: keyof Brief, level: 'required' | 'recommended'): BriefFieldCheck => ({
    field,
    label: BRIEF_FIELD_LABELS[field] ?? String(field),
    level,
    ok: filled(brief[field]),
  });

  const req = required.map((f) => check(f, 'required'));
  const rec = recommended.map((f) => check(f, 'recommended'));
  const missingRequired = req.filter((c) => !c.ok);
  return {
    complete: missingRequired.length === 0,
    missingRequired,
    missingRecommended: rec.filter((c) => !c.ok),
    requiredDone: req.length - missingRequired.length,
    requiredTotal: req.length,
  };
}

/**
 * שאלון אפיון לבעל העסק — כדי לא לפספס שום נקודה קריטית (למשל: הקהל בארה"ב ובאנגלית ולא בישראל).
 * שאלה שמחוברת לשדה נחשבת "נענתה" כשהשדה מולא.
 */
export interface DiscoveryQuestion {
  group: string;
  q: string;
  field?: keyof Brief;
  critical?: boolean;
}

export const DISCOVERY_QUESTIONS: DiscoveryQuestion[] = [
  { group: 'מטרה', q: 'מה המטרה העסקית של הסרטון — לידים, מכירות, הורדות, מודעות, גיוס?', field: 'goal', critical: true },
  { group: 'מטרה', q: 'מה הצופה צריך לעשות מיד אחרי הצפייה? (להשאיר פרטים, לקנות, להוריד, להתקשר)', field: 'cta', critical: true },
  { group: 'מטרה', q: 'איך תמדדו הצלחה? (מספר לידים, מחיר לליד, צפיות, מכירות)' },
  { group: 'קהל', q: 'באיזו מדינה / שוק נמצא הקהל? (ישראל, ארה"ב, אירופה, עולמי)', field: 'targetMarket', critical: true },
  { group: 'קהל', q: 'מי בדיוק הקהל — גיל, מקצוע, תפקיד, מה הכאב העיקרי שלו?', field: 'targetAudience', critical: true },
  { group: 'קהל', q: 'מה הקהל כבר יודע עליכם? (לא מכיר בכלל / מכיר / לקוח קיים)' },
  { group: 'מוצר ומסר', q: 'מה בדיוק המוצר / השירות, ומה מבדל אותו מהמתחרים?', field: 'productOrService', critical: true },
  { group: 'מוצר ומסר', q: 'אם הצופה זוכר רק משפט אחד — מה הוא?', field: 'keyMessage', critical: true },
  { group: 'מוצר ומסר', q: 'אילו טענות, מספרים, מחירים או מבצעים מותר להזכיר — ומה אסור?' },
  { group: 'מוצר ומסר', q: 'מי המתחרים, והאם יש סרטונים שלהם (או אחרים) שאהבתם / לא אהבתם?', field: 'inspirations' },
  { group: 'שפה וטון', q: 'באיזו שפה הסרטון — קריינות וטקסטים על המסך? (גם אם הקהל בחו"ל)', field: 'language', critical: true },
  { group: 'שפה וטון', q: 'איזה טון — רציני, חם, אנרגטי, יוקרתי, הומוריסטי?', field: 'tone' },
  { group: 'שפה וטון', q: 'קול קריין: גבר / אישה, גיל, מבטא (אמריקאי, בריטי…)?', field: 'voiceNotes' },
  { group: 'הפצה ופורמט', q: 'איפה הסרטון יעלה? (אינסטגרם, טיקטוק, יוטיוב, לינקדאין, אתר, מודעות ממומנות)', field: 'platforms', critical: true },
  { group: 'הפצה ופורמט', q: 'איזה אורך ואיזה פורמט — אנכי 9:16, אופקי 16:9, ריבועי? צריך כמה גרסאות?', field: 'durationSec', critical: true },
  { group: 'מותג', q: 'יש לוגו, צבעים, פונטים וחומרים (תמונות מוצר, צילומי מסך) שחייבים להופיע?', field: 'brandLogo' },
  { group: 'מותג', q: 'דמויות / אנשים בסרטון — מי, איך הם נראים, יש צורך בדמות קבועה?', field: 'characters' },
  { group: 'לוחות זמנים ואישורים', q: 'מתי הסרטון חייב להיות מוכן, ולמה (השקה, קמפיין, אירוע)?', field: 'dueDate', critical: true },
  { group: 'לוחות זמנים ואישורים', q: 'מי מאשר את התסריט ואת הסרטון מטעם הלקוח?' },
  { group: 'לוחות זמנים ואישורים', q: 'יש מגבלות רגולציה / משפטיות / ניסוח שחייבים לבדוק?', field: 'constraints' },
];

const answered = (brief: Brief, q: DiscoveryQuestion) => (q.field ? filled(brief[q.field]) : false);

/** השאלות שעוד לא נענו באפיון (קודם הקריטיות) */
export function openDiscoveryQuestions(brief: Brief): DiscoveryQuestion[] {
  return DISCOVERY_QUESTIONS.filter((q) => !answered(brief, q)).sort((a, b) => Number(!!b.critical) - Number(!!a.critical));
}
