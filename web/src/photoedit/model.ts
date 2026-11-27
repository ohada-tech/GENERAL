/**
 * PHOTOEDIT — מודל המסמך. שכבות אמיתיות (פיקסלים, טקסט, צורה, התאמה, קבוצה), מסכות, אפקטים וטרנספורם לא הרסני.
 * כלל ברזל: קנבס של מצב שנשמר בהיסטוריה לא משתנה במקום. כל עריכת פיקסלים יוצרת קנבס חדש (copy-on-write),
 * וכך תמונת מצב בהיסטוריה היא שכפול זול של המאפיינים בלבד.
 */
import type { SavedPath, SubPath } from './paths';
import { cloneSubs } from './paths';

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
  | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

export const BLEND_MODES: Array<[BlendMode, string] | null> = [
  ['normal', 'Normal'], null,
  ['darken', 'Darken'], ['multiply', 'Multiply'], ['color-burn', 'Color Burn'], null,
  ['lighten', 'Lighten'], ['screen', 'Screen'], ['color-dodge', 'Color Dodge'], null,
  ['overlay', 'Overlay'], ['soft-light', 'Soft Light'], ['hard-light', 'Hard Light'], null,
  ['difference', 'Difference'], ['exclusion', 'Exclusion'], null,
  ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity'],
];

export const gco = (b: BlendMode): GlobalCompositeOperation => (b === 'normal' ? 'source-over' : b);

/** טרנספורם: x,y = מרכז השכבה בפיקסלים של המסמך; rot במעלות; sx/sy שליליים = היפוך */
export interface Xf { x: number; y: number; sx: number; sy: number; rot: number }

export interface Effects {
  shadow: { on: boolean; color: string; opacity: number; angle: number; distance: number; blur: number };
  stroke: { on: boolean; color: string; width: number; opacity: number };
  glow: { on: boolean; color: string; opacity: number; size: number };
  overlay: { on: boolean; color: string; opacity: number };
}

export const defaultEffects = (): Effects => ({
  shadow: { on: false, color: '#000000', opacity: 0.5, angle: 120, distance: 10, blur: 14 },
  stroke: { on: false, color: '#000000', width: 3, opacity: 1 },
  glow: { on: false, color: '#ffe9a8', opacity: 0.75, size: 18 },
  overlay: { on: false, color: '#ff0000', opacity: 1 },
});

export const hasEffects = (fx: Effects) => fx.shadow.on || fx.stroke.on || fx.glow.on || fx.overlay.on;

/** מסכת שכבה: קנבס בגודל המסמך; ערוץ האלפא = נראות (אטום = נראה) */
export interface Mask {
  canvas: HTMLCanvasElement;
  enabled: boolean;
  /** Density בפאנל Properties: 1 = מלא, 0 = המסכה לא מסתירה כלום (לא הרסני) */
  density?: number;
  /** Feather בפאנל Properties: ריכוך לא הרסני בפיקסלים */
  feather?: number;
}

/** ערוץ אלפא שמור (Select > Save Selection) — נשמר עם המסמך */
export interface Channel { id: string; name: string; canvas: HTMLCanvasElement }

interface Base {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: BlendMode;
  /** Clipping Mask: נחתך לפי השכבה הלא-חתוכה שמתחתיו */
  clip: boolean;
  mask: Mask | null;
  fx: Effects;
  /** מונה גרסה גלובלי — משתנה בכל שינוי, משמש למטמון רינדור ולתמונות ממוזערות */
  rev: number;
  /** Distort/Perspective/Skew: ארבע פינות התיבה במרחב המקומי המנורמל (0..1) — לא הרסני, נשמר בקובץ (warp-algo / deform.ts) */
  quad?: Pt[] | null;
  /** Warp: 16 נקודות בקרה של משטח בזייה 4×4 במרחב המנורמל, וה-Preset שיצר אותן */
  warp?: WarpData | null;
  /** Puppet Warp בזמן עריכה בלבד: רשת משולשים בפיקסלים של השכבה (לא נשמר; Enter מטמיע) */
  mesh?: MeshData | null;
  /** Vector Mask (Layer > Vector Mask): חיתוך לפי נתיב בזייה במרחב המסמך — לא הרסני, נשמר בקובץ (paths.ts) */
  vmask?: VectorMask | null;
}

export interface VectorMask { subs: SubPath[]; enabled: boolean }

export interface WarpData { pts: Pt[]; preset: string; bend: number; h: number; v: number; vertical: boolean }
export interface MeshData { src: Pt[]; dst: Pt[]; tris: number[] }

export interface RasterLayer extends Base { type: 'raster'; canvas: HTMLCanvasElement; t: Xf }

export interface TextStyle {
  family: string;
  weight: number;
  italic: boolean;
  size: number;
  color: string;
  /** Tracking באלפיות em, כמו בפוטושופ */
  tracking: number;
  /** Leading בפיקסלים; 0 = אוטומטי (120%) */
  leading: number;
  align: 'left' | 'center' | 'right' | 'justify';
  dir: 'rtl' | 'ltr';
  kerning: boolean;
  underline: boolean;
  caps: boolean;
}

export interface TextLayer extends Base {
  type: 'text';
  t: Xf;
  text: string;
  style: TextStyle;
  /** null = Point Text (בלי גלישה); מספר = רוחב תיבת פסקה */
  boxW: number | null;
  /** כיוון הטקסט: h = אופקי (ברירת מחדל, גם לקבצים ישנים), v = אנכי — תווים מלמעלה למטה, עמודות מימין לשמאל */
  orientation?: 'h' | 'v';
}

/** path = צורה וקטורית חופשית (עט, Custom Shape, Convert to Shape) */
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'triangle' | 'polygon' | 'star' | 'path';
export interface Fill { type: 'solid' | 'linear' | 'radial' | 'none'; color: string; color2: string; angle: number }

export interface ShapeLayer extends Base {
  type: 'shape';
  t: Xf;
  shape: ShapeKind;
  w: number;
  h: number;
  radius: number;
  sides: number;
  fill: Fill;
  stroke: { on: boolean; color: string; width: number };
  /** shape='path': תתי-נתיבים במרחב המקומי (0..vw × 0..vh), מצוירים מתוחים ל-w×h */
  subs?: SubPath[];
  vw?: number;
  vh?: number;
}

export type AdjustKind =
  | 'brightness' | 'levels' | 'curves' | 'exposure' | 'vibrance' | 'hueSat' | 'colorBalance' | 'bw'
  | 'shadowsHighlights' | 'temperature' | 'invert' | 'posterize' | 'threshold' | 'gradientMap';

export interface AdjustLayer extends Base { type: 'adjust'; kind: AdjustKind; p: Record<string, any> }

/**
 * Artboard (משטח עבודה): קבוצה ברמה העליונה עם מלבן משלה במרחב המסמך. הילדים נחתכים לגבולות המלבן
 * ומעליהם/מתחתם רקע (bg = צבע או 'transparent'). שכבות מחוץ לכל משטח = Pasteboard, לא מיוצאות.
 */
export interface ArtboardSpec { x: number; y: number; w: number; h: number; bg: string }

export interface GroupLayer extends Base { type: 'group'; children: Layer[]; open: boolean; artboard?: ArtboardSpec }

export type Layer = RasterLayer | TextLayer | ShapeLayer | AdjustLayer | GroupLayer;
export type XfLayer = RasterLayer | TextLayer | ShapeLayer;

export const isXf = (l: Layer): l is XfLayer => l.type === 'raster' || l.type === 'text' || l.type === 'shape';

export interface Doc {
  id: string;
  name: string;
  width: number;
  height: number;
  dpi: number;
  layers: Layer[]; // אינדקס 0 = תחתונה
  guides: { v: number[]; h: number[] };
  selection: HTMLCanvasElement | null;
  /** בחירות שמורות (Save/Load Selection) */
  channels?: Channel[];
  /** פאנל Paths: Work Path ונתיבים שמורים, במרחב המסמך */
  paths?: SavedPath[];
  fonts: Array<{ family: string; data: string }>;
  projectId: string | null;
  serverId: string | null;
}

/* ---------- כלים כלליים ---------- */

let revCounter = 1;
export const nextRev = () => ++revCounter;
export const touch = (l: Layer) => { l.rev = nextRev(); };

export const uid = () =>
  (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = newCanvas(src.width, src.height);
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

export const ctx2d = (c: HTMLCanvasElement, read = false) => c.getContext('2d', read ? { willReadFrequently: true } : undefined)!;

const base = (name: string): Omit<Base, 'id'> & { id: string } => ({
  id: uid(), name, visible: true, locked: false, opacity: 1, blend: 'normal', clip: false, mask: null, fx: defaultEffects(), rev: nextRev(),
});

export function makeRaster(name: string, canvas: HTMLCanvasElement, cx: number, cy: number): RasterLayer {
  return { ...base(name), type: 'raster', canvas, t: { x: cx, y: cy, sx: 1, sy: 1, rot: 0 } };
}

export const defaultTextStyle = (): TextStyle => ({
  family: 'Assistant', weight: 700, italic: false, size: 72, color: '#000000', tracking: 0, leading: 0,
  align: 'right', dir: 'rtl', kerning: true, underline: false, caps: false,
});

export function makeText(text: string, style: TextStyle, x: number, y: number, boxW: number | null): TextLayer {
  const name = text.split('\n')[0].slice(0, 40) || 'טקסט';
  return { ...base(name), type: 'text', text, style, boxW, t: { x, y, sx: 1, sy: 1, rot: 0 } };
}

export function makeShape(shape: ShapeKind, x: number, y: number, w: number, h: number, fill: Fill, stroke: ShapeLayer['stroke'], radius = 0, sides = 5): ShapeLayer {
  const names: Record<ShapeKind, string> = { rect: 'מלבן', ellipse: 'אליפסה', line: 'קו', triangle: 'משולש', polygon: 'מצולע', star: 'כוכב', path: 'צורה' };
  return { ...base(names[shape]), type: 'shape', shape, w, h, radius, sides, fill, stroke, t: { x, y, sx: 1, sy: 1, rot: 0 } };
}

export function makeGroup(children: Layer[], name = 'קבוצה'): GroupLayer {
  return { ...base(name), type: 'group', children, open: true };
}

export function makeAdjust(kind: AdjustKind, p: Record<string, any>, name: string): AdjustLayer {
  return { ...base(name), type: 'adjust', kind, p };
}

/* ---------- עץ השכבות ---------- */

export function walk(layers: Layer[], fn: (l: Layer, parent: Layer[], i: number) => void) {
  layers.forEach((l, i) => {
    fn(l, layers, i);
    if (l.type === 'group') walk(l.children, fn);
  });
}

export function findLayer(layers: Layer[], id: string): { layer: Layer; parent: Layer[]; index: number; group: GroupLayer | null } | null {
  const rec = (arr: Layer[], group: GroupLayer | null): ReturnType<typeof findLayer> => {
    for (let i = 0; i < arr.length; i++) {
      const l = arr[i];
      if (l.id === id) return { layer: l, parent: arr, index: i, group };
      if (l.type === 'group') {
        const r = rec(l.children, l);
        if (r) return r;
      }
    }
    return null;
  };
  return rec(layers, null);
}

/** כל השכבות בסדר תצוגה (עליונה ראשונה) עם עומק — לפאנל השכבות */
export function flatForPanel(layers: Layer[], depth = 0, out: Array<{ layer: Layer; depth: number }> = []) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    out.push({ layer: l, depth });
    if (l.type === 'group' && l.open) flatForPanel(l.children, depth + 1, out);
  }
  return out;
}

/** כל השכבות שאפשר להזיז (צאצאי קבוצה נכללים כשנבחרה הקבוצה) */
export function xfLeaves(l: Layer): XfLayer[] {
  if (isXf(l)) return [l];
  if (l.type === 'group') return l.children.flatMap(xfLeaves);
  return [];
}

export function cloneLayer(l: Layer, newId = false): Layer {
  const common = {
    ...l,
    id: newId ? uid() : l.id,
    fx: JSON.parse(JSON.stringify(l.fx)) as Effects,
    mask: l.mask ? { ...l.mask } : null,
    ...(l.quad ? { quad: l.quad.map((p) => ({ ...p })) } : {}),
    ...(l.warp ? { warp: { ...l.warp, pts: l.warp.pts.map((p) => ({ ...p })) } } : {}),
    ...(l.vmask ? { vmask: { enabled: l.vmask.enabled, subs: cloneSubs(l.vmask.subs) } } : {}),
  };
  switch (l.type) {
    case 'raster': return { ...(common as RasterLayer), t: { ...l.t } };
    case 'text': return { ...(common as TextLayer), t: { ...l.t }, style: { ...l.style } };
    case 'shape': return { ...(common as ShapeLayer), t: { ...l.t }, fill: { ...l.fill }, stroke: { ...l.stroke }, ...(l.subs ? { subs: cloneSubs(l.subs) } : {}) };
    case 'adjust': return { ...(common as AdjustLayer), p: JSON.parse(JSON.stringify(l.p)) };
    case 'group': return { ...(common as GroupLayer), ...(l.artboard ? { artboard: { ...l.artboard } } : {}), children: l.children.map((c) => cloneLayer(c, newId)) };
  }
}

export const cloneTree = (layers: Layer[]) => layers.map((l) => cloneLayer(l));

/* ---------- גאומטריה ---------- */

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export function xfMatrix(t: Xf, w: number, h: number): DOMMatrix {
  return new DOMMatrix().translateSelf(t.x, t.y).rotateSelf(t.rot).scaleSelf(t.sx, t.sy).translateSelf(-w / 2, -h / 2);
}

export const apply = (m: DOMMatrix, p: Pt): Pt => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });

export function cornersOf(m: DOMMatrix, w: number, h: number): Pt[] {
  return [apply(m, { x: 0, y: 0 }), apply(m, { x: w, y: 0 }), apply(m, { x: w, y: h }), apply(m, { x: 0, y: h })];
}

export function aabb(pts: Pt[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const unionRect = (a: Rect | null, b: Rect): Rect => {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ---------- צבע ---------- */

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

export const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
