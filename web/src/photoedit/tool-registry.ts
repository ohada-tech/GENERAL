/**
 * רישום משותף לכלי הציור, הרטוש והמדידה: אפשרויות ברירת מחדל, קבוצות כלים (Shift+מקש מחליף בתוך קבוצה,
 * כמו בפוטושופ), שמות לסרגל המצב, ושכבות-על קבועות שמצוירות על הקנבס בכל כלי (Color Sampler).
 * המודול לא מייבא ערכים מ-tools.ts — כדי שלא תיווצר תלות מעגלית בזמן טעינה.
 */
import type { Editor } from './editor';
import type { ToolId } from './tools';
import type { ReplaceMode, ToneRange } from './pixel-algo';

type Brush = { size: number; hardness: number };

export interface ExtraOpts {
  pencil: Brush & { opacity: number; flow: number; autoErase: boolean };
  colorReplace: Brush & { mode: ReplaceMode; tolerance: number; sampling: 'continuous' | 'once'; antiAlias: boolean };
  bgEraser: Brush & { tolerance: number; limits: 'contiguous' | 'discontiguous'; protectFg: boolean; sampling: 'continuous' | 'once' };
  magicEraser: { tolerance: number; contiguous: boolean; allLayers: boolean; opacity: number };
  historyBrush: Brush & { opacity: number; flow: number };
  blur: Brush & { strength: number; allLayers: boolean };
  sharpen: Brush & { strength: number; allLayers: boolean };
  smudge: Brush & { strength: number; allLayers: boolean; finger: boolean };
  dodge: Brush & { range: ToneRange; exposure: number; protect: boolean };
  burn: Brush & { range: ToneRange; exposure: number; protect: boolean };
  sponge: Brush & { mode: 'saturate' | 'desaturate'; flow: number; vibrance: boolean };
  spotHeal: Brush & { allLayers: boolean };
  heal: Brush & { aligned: boolean; allLayers: boolean };
  redEye: { pupil: number; darken: number };
  patternStamp: Brush & { opacity: number; flow: number; aligned: boolean; pattern: string };
}

export const extraOpts = (): ExtraOpts => ({
  pencil: { size: 4, hardness: 1, opacity: 1, flow: 1, autoErase: false },
  colorReplace: { size: 40, hardness: 0.7, mode: 'color', tolerance: 30, sampling: 'continuous', antiAlias: true },
  bgEraser: { size: 60, hardness: 0.8, tolerance: 50, limits: 'contiguous', protectFg: false, sampling: 'continuous' },
  magicEraser: { tolerance: 32, contiguous: true, allLayers: false, opacity: 1 },
  historyBrush: { size: 60, hardness: 0.6, opacity: 1, flow: 1 },
  blur: { size: 50, hardness: 0.5, strength: 0.5, allLayers: false },
  sharpen: { size: 50, hardness: 0.5, strength: 0.5, allLayers: false },
  smudge: { size: 40, hardness: 0.5, strength: 0.5, allLayers: false, finger: false },
  dodge: { size: 60, hardness: 0.3, range: 'midtones', exposure: 0.5, protect: true },
  burn: { size: 60, hardness: 0.3, range: 'midtones', exposure: 0.5, protect: true },
  sponge: { size: 60, hardness: 0.3, mode: 'desaturate', flow: 0.5, vibrance: true },
  spotHeal: { size: 40, hardness: 0.8, allLayers: false },
  heal: { size: 40, hardness: 0.8, aligned: true, allLayers: false },
  redEye: { pupil: 50, darken: 50 },
  patternStamp: { size: 80, hardness: 0.7, opacity: 1, flow: 1, aligned: true, pattern: 'checker' },
});

/**
 * קבוצות כלים: key = המזהה שהקיצור מפעיל (tool.<key>). המקש בוחר את הכלי האחרון שהיה בשימוש בקבוצה,
 * ו-Shift+מקש עובר לבא בתור. fixedKey = לכל כלי בקבוצה יש מקש משלו (Hand=H, Rotate View=R).
 */
export const TOOL_GROUPS: Array<{ key: ToolId; members: ToolId[]; fixedKey?: boolean }> = [
  { key: 'move', members: ['move', 'artboard'] },
  { key: 'brush', members: ['brush', 'pencil', 'colorReplace'] },
  { key: 'eraser', members: ['eraser', 'bgEraser', 'magicEraser'] },
  { key: 'clone', members: ['clone', 'patternStamp'] },
  { key: 'historyBrush', members: ['historyBrush'] },
  { key: 'blur', members: ['blur', 'sharpen', 'smudge'] },
  { key: 'dodge', members: ['dodge', 'burn', 'sponge'] },
  { key: 'spotHeal', members: ['spotHeal', 'heal', 'patch', 'redEye'] },
  { key: 'eyedropper', members: ['eyedropper', 'colorSampler', 'ruler'] },
  { key: 'text', members: ['text', 'vtext', 'htmask', 'vtmask'] },
  { key: 'hand', members: ['hand', 'rotateView'], fixedKey: true },
];

const current: Partial<Record<ToolId, ToolId>> = {};
export const groupOf = (id: ToolId) => TOOL_GROUPS.find((g) => g.members.includes(id)) ?? null;
export const groupByKey = (key: ToolId) => TOOL_GROUPS.find((g) => g.key === key) ?? null;
export const groupCurrent = (key: ToolId): ToolId => current[key] ?? key;
export function setGroupCurrent(id: ToolId) { const g = groupOf(id); if (g) current[g.key] = id; }
export function nextInGroup(id: ToolId): ToolId | null {
  const g = groupOf(id);
  if (!g || g.members.length < 2) return null;
  const cur = groupCurrent(g.key);
  return g.members[(g.members.indexOf(cur) + 1) % g.members.length];
}

/** שמות לסרגל המצב ולטולטיפים — Photoshop · עברית */
export const TOOL_NAMES: Partial<Record<ToolId, string>> = {
  brush: 'Brush Tool · מברשת', eraser: 'Eraser Tool · מחק', clone: 'Clone Stamp Tool · חותמת שכפול',
  eyedropper: 'Eyedropper Tool · דוגם צבע', text: 'Horizontal Type Tool · טקסט', hand: 'Hand Tool · יד',
  pencil: 'Pencil Tool · עיפרון', colorReplace: 'Color Replacement Tool · החלפת צבע',
  bgEraser: 'Background Eraser Tool · מחק רקע', magicEraser: 'Magic Eraser Tool · מחק קסם',
  historyBrush: 'History Brush Tool · מברשת היסטוריה',
  blur: 'Blur Tool · טשטוש', sharpen: 'Sharpen Tool · חידוד', smudge: 'Smudge Tool · מריחה',
  dodge: 'Dodge Tool · הבהרה', burn: 'Burn Tool · הכהיה', sponge: 'Sponge Tool · ספוג',
  spotHeal: 'Spot Healing Brush Tool · ריפוי נקודתי', heal: 'Healing Brush Tool · מברשת ריפוי', patch: 'Patch Tool · טלאי', redEye: 'Red Eye Tool · עיניים אדומות',
  patternStamp: 'Pattern Stamp Tool · חותמת דוגמה',
  colorSampler: 'Color Sampler Tool · דוגם צבע קבוע', ruler: 'Ruler Tool · סרגל',
  rotateView: 'Rotate View Tool · סיבוב תצוגה',
  move: 'Move Tool · הזזה', artboard: 'Artboard Tool · משטח עבודה',
  vtext: 'Vertical Type Tool · טקסט אנכי', htmask: 'Horizontal Type Mask Tool · מסכת טקסט', vtmask: 'Vertical Type Mask Tool · מסכת טקסט אנכית',
};

/** שכבות-על שמצוירות בכל כלי (אחרי הנמלים, לפני שכבת-העל של הכלי), בקואורדינטות מסך */
export const OVERLAY_HOOKS: Array<(ed: Editor, x: CanvasRenderingContext2D) => void> = [];
