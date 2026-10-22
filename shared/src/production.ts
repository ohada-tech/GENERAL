/**
 * שלבי ההפקה 05–09: תוצרי מדיה (פריים, קליפ, קריינות, מוזיקה, סרטון סופי),
 * קטלוג המודלים שמופעלים דרך KIE ומחירון לחישוב עלות לפני כל אישור.
 * המחירים בקרדיטים של KIE (קרדיט = $0.005). העלות בפועל נקראת מתשובת KIE ונשמרת.
 */
export const KIE_USD_PER_CREDIT = 0.005;

export type MediaKind = 'frame' | 'clip' | 'voiceover' | 'music' | 'final';
export type MediaStatus = 'generating' | 'ready' | 'approved' | 'rejected' | 'failed';

export interface Media {
  id: string;
  projectId: string;
  shotId: string | null;
  kind: MediaKind;
  version: number;
  status: MediaStatus;
  provider: string;
  model: string;
  prompt: string;
  params: Record<string, unknown>;
  assetId: string | null;
  mime: string | null;
  durationSec: number | null;
  costCredits: number | null;
  error: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImageModelDef {
  id: string;
  apiModel: string;
  label: string;
  credits: number;
  /** שם שדה יחס התמונה ושדה תמונות הייחוס ב-API */
  aspectField: 'aspect_ratio' | 'image_size';
  refsField: 'image_input' | 'image_urls' | null;
  extra?: Record<string, unknown>;
  aspects: string[];
}

export const IMAGE_MODELS: ImageModelDef[] = [
  {
    id: 'nano-banana-2',
    apiModel: 'nano-banana-2',
    label: 'Nano Banana 2 · איכות טובה, זול',
    credits: 4,
    aspectField: 'aspect_ratio',
    refsField: 'image_input',
    extra: { resolution: '2K', output_format: 'png' },
    aspects: ['1:1', '9:16', '16:9', '4:5', '3:4', '4:3', '21:9'],
  },
  {
    id: 'nano-banana-pro',
    apiModel: 'nano-banana-pro',
    label: 'Nano Banana Pro · האיכות הגבוהה ביותר',
    credits: 24,
    aspectField: 'aspect_ratio',
    refsField: 'image_input',
    extra: { resolution: '2K', output_format: 'png' },
    aspects: ['1:1', '9:16', '16:9', '4:5', '3:4', '4:3', '21:9'],
  },
  {
    id: 'seedream-5-lite',
    apiModel: 'seedream/5-lite-text-to-image',
    label: 'Seedream 5 Lite · ריאליסטי, זול',
    credits: 5,
    aspectField: 'aspect_ratio',
    refsField: null,
    extra: { quality: 'basic' },
    aspects: ['1:1', '9:16', '16:9', '4:3', '3:4', '21:9'],
  },
];

export interface VideoModelDef {
  id: string;
  apiModel: string;
  label: string;
  /** קרדיטים לשנייה */
  creditsPerSec: number;
  /** משכי וידאו נתמכים (שניות) */
  durations: number[];
  /** שדה התמונה הראשונה בבקשה: מערך (image_urls / input_urls) או כתובת בודדת (image_url / first_frame_url) */
  imageField: 'image_urls' | 'input_urls' | 'image_url' | 'first_frame_url';
  durationAsString: boolean;
  hasAspect: boolean;
  extra?: Record<string, unknown>;
  /** מילות מפתח בשדה animationModel של השוט שמפנות למודל הזה */
  match: string[];
}

/**
 * מודלי ההנפשה (KIE, docs.kie.ai, נבדק 23.10.2026). שלושתם גם ב-Higgsfield Unlimited, כך שאותה המלצה
 * בסטורי בורד מתאימה גם לייצור ידני בלי קרדיטים. הסדר קובע: הראשון הוא ברירת המחדל, ו-Mini לפני Seedance 2.0
 * כדי ש"Seedance 2.0 Mini" לא ייתפס כ-Seedance 2.0. מזהים ישנים (kling-2.6, seedance-1.5-pro, hailuo-2.3)
 * נופלים לברירת המחדל, ו"Kling 2.6" / "Seedance 1.5 Pro" בשוטים ישנים מנותבים למודל החדש לפי מילת המפתח.
 */
export const VIDEO_MODELS: VideoModelDef[] = [
  {
    id: 'kling-3.0',
    apiModel: 'kling-3.0/video',
    label: 'Kling 3.0 · ברירת מחדל, תנועה ומצלמה קולנועיות',
    creditsPerSec: 18, // pro בלי סאונד, 1080p
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    imageField: 'image_urls',
    durationAsString: true,
    // עם תמונה ראשונה הקליפ מקבל את יחס התמונה, ו-KIE מתעלם מ-aspect_ratio
    hasAspect: false,
    extra: { sound: false, mode: 'pro', multi_shots: false },
    match: ['kling'],
  },
  {
    id: 'seedance-2-mini',
    apiModel: 'bytedance/seedance-2-mini',
    label: 'Seedance 2.0 Mini · שוטים פשוטים, חסכוני',
    creditsPerSec: 8.2, // 720p
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    imageField: 'first_frame_url',
    durationAsString: false,
    hasAspect: true,
    extra: { resolution: '720p', generate_audio: false },
    match: ['seedance 2.0 mini', 'seedance mini', 'seedance-2-mini'],
  },
  {
    id: 'seedance-2',
    apiModel: 'bytedance/seedance-2',
    label: 'Seedance 2.0 · ריאליזם גבוה, תנועה אנושית ומוצר',
    creditsPerSec: 24.8, // 720p, בלי וידאו רפרנס
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    imageField: 'first_frame_url',
    durationAsString: false,
    hasAspect: true,
    extra: { resolution: '720p', generate_audio: false },
    match: ['seedance'],
  },
];

export interface VoiceDef {
  id: string;
  name: string;
  vibe: string;
}

/** קולות ש-KIE מאפשר (רשימה סגורה — מזהה ElevenLabs אחר נדחה) */
export const VOICES: VoiceDef[] = [
  { id: 'EkK5I93UQWFDigLMpZcX', name: 'James', vibe: 'גברי, נמרץ ונועז' },
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', vibe: 'גברי, עמוק ומרגיע' },
  { id: '6F5Zhi321D3Oq7v1oNT4', name: 'Hank', vibe: 'גברי, קריין עמוק' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', vibe: 'גברי, אנרגטי — סושיאל' },
  { id: 'x70vRnQBMBu4FAYhjJbO', name: 'Nathan', vibe: 'גברי, שדרן רדיו' },
  { id: 'hpp4J3VqNfWAUOO0d1Us', name: 'Bella', vibe: 'נשי, מקצועי וחם' },
  { id: 'BZgkqPqms7Kj9ulSkVzn', name: 'Eve', vibe: 'נשי, אותנטי ושמח' },
  { id: '1wGbFxmAM3Fgw63G1zZJ', name: 'Allison', vibe: 'נשי, רגוע ומרגיע' },
];

/** עברית נתמכת רק ב-ElevenLabs v3; שאר השפות — Multilingual v2 */
export const TTS_V3 = { apiModel: 'elevenlabs/text-to-dialogue-v3', creditsPer1000: 14 };
export const TTS_V2 = { apiModel: 'elevenlabs/text-to-speech-multilingual-v2', creditsPer1000: 12 };
export const MUSIC = { model: 'V5', credits: 10 };

export const imageModel = (id: string) => IMAGE_MODELS.find((m) => m.id === id) ?? IMAGE_MODELS[0];
export const videoModel = (id: string) => VIDEO_MODELS.find((m) => m.id === id) ?? VIDEO_MODELS[0];

/** מודל וידאו לשוט: לפי ההמלצה שבסטורי בורד, אחרת ברירת המחדל של הפרויקט. */
export function videoModelForShot(animationModelText: string, projectDefault: string): VideoModelDef {
  const t = animationModelText.toLowerCase();
  return VIDEO_MODELS.find((m) => m.match.some((k) => t.includes(k))) ?? videoModel(projectDefault);
}

/** משך הקליפ שיוזמן: המשך הנתמך הקצר ביותר שמכסה את השוט (העודף נחתך בעריכה). */
export function clipDuration(model: VideoModelDef, shotSec: number): number {
  return model.durations.find((d) => d >= shotSec) ?? model.durations[model.durations.length - 1];
}

export const isHebrew = (language: string) => /עברית|hebrew|^he\b|^iw\b/i.test(language.trim());

export function ttsModelFor(language: string) {
  return isHebrew(language) ? TTS_V3 : TTS_V2;
}

/** יחס תמונה לתמונה / לווידאו / למסגרת הסופית */
export function aspectFor(briefAspect: string) {
  const a = briefAspect || '9:16';
  const [w, h] = a.split(':').map(Number);
  const portrait = h > w;
  const square = w === h;
  const video = square ? '1:1' : portrait ? '9:16' : '16:9';
  const long = 1920;
  const out = square ? { w: 1080, h: 1080 } : portrait ? { w: Math.round((1080 * 1) / 2) * 2, h: Math.round((1080 * h) / w / 2) * 2 } : { w: long, h: Math.round((long * h) / w / 2) * 2 };
  return { image: a, video, out };
}

export const creditsToUsd = (credits: number) => Math.round(credits * KIE_USD_PER_CREDIT * 100) / 100;

export interface CostLine {
  label: string;
  count: number;
  credits: number;
}

export interface CostEstimate {
  lines: CostLine[];
  credits: number;
  usd: number;
}

export const STAGE_ACTION_LABELS: Record<'images' | 'animation' | 'audio' | 'editing', string> = {
  images: 'יצירת תמונות לכל השוטים',
  animation: 'הנפשת כל השוטים',
  audio: 'קריינות ומוזיקה',
  editing: 'עריכת הסרטון',
};
