/**
 * הגדרת שלבי ה-Pipeline. מקור אמת יחיד לשרת ולממשק.
 * availability מבדיל בין שלב שנבנה במערכת לבין שלב שעדיין מתוכנן —
 * כדי שהממשק לא יציג יכולת שלא קיימת בפועל.
 */
export const STAGE_KEYS = [
  'brief',
  'script',
  'storyboard',
  'references',
  'images',
  'animation',
  'audio',
  'editing',
  'delivery',
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];

export type StageAvailability = 'available' | 'planned';

export interface StageDefinition {
  key: StageKey;
  number: string;
  label: string;
  labelEn: string;
  description: string;
  availability: StageAvailability;
  /** באיזה Phase השלב מתוכנן להיבנות */
  phase: number;
  /** אילו אישורים נדרשים לפני מעבר לשלב הבא */
  gates: Array<'internal' | 'client' | 'qc'>;
}

export const STAGES: StageDefinition[] = [
  {
    key: 'brief',
    number: '01',
    label: 'אפיון ובריף',
    labelEn: 'Project Setup & Brief',
    description: 'מילוי האפיון. סימון "אפיון הושלם" מפעיל את כתיבת התסריט.',
    availability: 'available',
    phase: 1,
    gates: ['internal'],
  },
  {
    key: 'script',
    number: '02',
    label: 'תסריט',
    labelEn: 'Script Writing',
    description: 'טיוטה ב-ChatGPT, עריכה, אישור פנימי ואישור לקוח.',
    availability: 'available',
    phase: 1,
    gates: ['internal', 'client'],
  },
  {
    key: 'storyboard',
    number: '03',
    label: 'סטורי בורד',
    labelEn: 'Storyboard Development',
    description: 'שוטים מפורטים עם פרומפטים. אישור לפני יצירת תמונות.',
    availability: 'available',
    phase: 1,
    gates: ['internal'],
  },
  {
    key: 'references',
    number: '04',
    label: 'רפרנסים',
    labelEn: 'Reference Research',
    description: 'רפרנסים צילומיים לכל שוט — כרגע הוספה ואישור ידניים.',
    availability: 'available',
    phase: 3,
    gates: ['internal'],
  },
  {
    key: 'images',
    number: '05',
    label: 'יצירת תמונות',
    labelEn: 'Image Generation',
    description: 'Higgsfield + Nano Banana, Skills לעקביות דמות ומותג.',
    availability: 'planned',
    phase: 3,
    gates: ['internal'],
  },
  {
    key: 'animation',
    number: '06',
    label: 'הנפשה',
    labelEn: 'Animation Production',
    description: 'Kling Unlimited / Seedance לפי שוט.',
    availability: 'planned',
    phase: 4,
    gates: ['internal'],
  },
  {
    key: 'audio',
    number: '07',
    label: 'סאונד',
    labelEn: 'Audio & Sound Design',
    description: 'קריינות, מוזיקה, אפקטים ו-Ambience.',
    availability: 'planned',
    phase: 4,
    gates: ['internal'],
  },
  {
    key: 'editing',
    number: '08',
    label: 'עריכה',
    labelEn: 'Editing & Post-Production',
    description: 'הצעת עריכה וחבילת הפקה לכלי העריכה.',
    availability: 'planned',
    phase: 4,
    gates: ['internal'],
  },
  {
    key: 'delivery',
    number: '09',
    label: 'מסירה',
    labelEn: 'Final Delivery',
    description: "צ'קליסט מסירה והעלאת הסרטון הסופי.",
    availability: 'planned',
    phase: 5,
    gates: ['qc', 'client'],
  },
];

export const STAGE_BY_KEY: Record<StageKey, StageDefinition> = Object.fromEntries(
  STAGES.map((s) => [s.key, s]),
) as Record<StageKey, StageDefinition>;

export const STATUSES = [
  'not_started',
  'in_progress',
  'waiting_internal',
  'waiting_client',
  'needs_revision',
  'blocked',
  'completed',
] as const;

export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, { he: string; en: string }> = {
  not_started: { he: 'טרם התחיל', en: 'Not Started' },
  in_progress: { he: 'בתהליך', en: 'In Progress' },
  waiting_internal: { he: 'ממתין לאישור שלי', en: 'Waiting for Internal Approval' },
  waiting_client: { he: 'ממתין לאישור לקוח', en: 'Waiting for Client Approval' },
  needs_revision: { he: 'נדרש תיקון', en: 'Needs Revision' },
  blocked: { he: 'חסום', en: 'Blocked' },
  completed: { he: 'הושלם', en: 'Completed' },
};

export type PipelineState = 'active' | 'paused' | 'stopped';
