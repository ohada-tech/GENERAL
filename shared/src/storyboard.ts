import { z } from 'zod';

export const shotFieldsSchema = z.object({
  sceneIndex: z.number().int().nonnegative().default(0),
  narration: z.string().default(''),
  durationSec: z.number().nonnegative().default(0),
  action: z.string().default(''),
  shotType: z.string().default(''),
  cameraAngle: z.string().default(''),
  composition: z.string().default(''),
  movement: z.string().default(''),
  lens: z.string().default(''),
  lighting: z.string().default(''),
  colorMood: z.string().default(''),
  character: z.string().default(''),
  wardrobe: z.string().default(''),
  consistencyNotes: z.string().default(''),
  imagePrompt: z.string().default(''),
  animationPrompt: z.string().default(''),
  imageModel: z.string().default(''),
  animationModel: z.string().default(''),
  animationModelReason: z.string().default(''),
});

export type ShotFields = z.infer<typeof shotFieldsSchema>;

export const shotPatchSchema = shotFieldsSchema.partial().extend({
  previewAssetId: z.string().nullable().optional(),
});

export type ShotApproval = 'pending' | 'approved' | 'needs_revision';

export const SHOT_APPROVAL_LABELS: Record<ShotApproval, string> = {
  pending: 'ממתין לבדיקה',
  approved: 'מאושר',
  needs_revision: 'נדרש תיקון',
};

export interface Shot extends ShotFields {
  id: string;
  storyboardId: string;
  projectId: string;
  number: number;
  approval: ShotApproval;
  revisionNote: string;
  previewAssetId: string | null;
  updatedAt: string;
}

export type StoryboardStatus = 'draft' | 'approved' | 'superseded';

export interface Storyboard {
  id: string;
  projectId: string;
  version: number;
  scriptVersionId: string;
  source: 'ai' | 'skeleton' | 'demo';
  provider: string | null;
  model: string | null;
  status: StoryboardStatus;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

export const REFERENCE_CATEGORIES: Record<string, string> = {
  portrait: 'פורטרט / טקסטורת עור',
  angle: 'זווית וקומפוזיציה',
  pose: 'תנוחת גוף',
  expression: 'מבט והבעה',
  lighting: 'תאורה',
  environment: 'סביבה',
  styling: 'לבוש וסטיילינג',
  product: 'מוצר / מותג',
  other: 'אחר',
};

/** אימות מקור: לא טוענים "צילום אמיתי" בלי אימות — ברירת מחדל unverified. */
export const VERIFICATION_LABELS: Record<string, string> = {
  unverified: 'לא מאומת',
  likely_real: 'כנראה צילום אמיתי',
  verified_real: 'אומת כצילום אמיתי',
  suspected_ai: 'חשד ל-AI',
};

export const referenceInputSchema = z.object({
  url: z.string().url(),
  imageUrl: z.string().default(''),
  category: z.string().default('other'),
  description: z.string().default(''),
  verification: z.enum(['unverified', 'likely_real', 'verified_real', 'suspected_ai']).default('unverified'),
  matchScore: z.number().min(0).max(10).nullable().default(null),
  qualityScore: z.number().min(0).max(10).nullable().default(null),
  rightsNote: z.string().default(''),
});

export const referencePatchSchema = referenceInputSchema.partial().extend({
  status: z.enum(['candidate', 'approved', 'rejected']).optional(),
});

export interface Reference {
  id: string;
  projectId: string;
  shotId: string;
  url: string;
  imageUrl: string;
  platform: string;
  category: string;
  description: string;
  status: 'candidate' | 'approved' | 'rejected';
  verification: 'unverified' | 'likely_real' | 'verified_real' | 'suspected_ai';
  matchScore: number | null;
  qualityScore: number | null;
  rightsNote: string;
  origin: string;
  createdAt: string;
}

export function detectPlatform(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (/pinterest\./.test(host) || host === 'pin.it') return 'Pinterest';
    if (/unsplash\.com$/.test(host)) return 'Unsplash';
    if (/pexels\.com$/.test(host)) return 'Pexels';
    if (/instagram\.com$/.test(host)) return 'Instagram';
    if (/behance\.net$/.test(host)) return 'Behance';
    if (/flickr\.com$/.test(host)) return 'Flickr';
    if (/shotdeck\.com$/.test(host)) return 'ShotDeck';
    return host;
  } catch {
    return 'unknown';
  }
}

/** ברירות מחדל לכלי יצירה — ניתן לשנות לכל פרויקט ולכל שוט. */
export const IMAGE_MODEL_OPTIONS = ['Higgsfield · Nano Banana Pro', 'Higgsfield · Seedream', 'GPT Image', 'ידני / אחר'];
export const ANIMATION_MODEL_OPTIONS = ['Kling (Unlimited)', 'Seedance', 'ידני / אחר'];
