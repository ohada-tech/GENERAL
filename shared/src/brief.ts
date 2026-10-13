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
  targetAudience: z.string().default(''),
  keyMessage: z.string().default(''),
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
  targetAudience: 'קהל יעד',
  keyMessage: 'המסר המרכזי',
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
    'keyMessage',
    'platforms',
    'aspectRatio',
    'durationSec',
    'visualStyle',
    'language',
    'dueDate',
  ];
  if (brief.voiceoverNeeded) required.push('tone');
  const recommended: Array<keyof Brief> = ['inspirations', 'brandLogo', 'brandColors', 'characters', 'budget'];

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
