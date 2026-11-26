/**
 * Adjustments + Filters. כל התאמה היא פונקציה טהורה על ImageData, כך שאותו קוד משמש
 * גם לשכבת התאמה (לא הרסני) וגם ל-Image > Adjustments (הרסני על שכבה).
 */
import type { AdjustKind } from './model';
import { clamp, hexToRgb, newCanvas, ctx2d } from './model';

export interface AdjustDef { kind: AdjustKind; name: string; en: string; defaults: () => Record<string, any> }

export const ADJUSTMENTS: AdjustDef[] = [
  { kind: 'brightness', name: 'בהירות/ניגודיות', en: 'Brightness/Contrast', defaults: () => ({ brightness: 0, contrast: 0 }) },
  { kind: 'levels', name: 'רמות', en: 'Levels', defaults: () => ({ inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 }) },
  { kind: 'curves', name: 'עקומות', en: 'Curves', defaults: () => ({ channel: 'rgb', rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] }) },
  { kind: 'exposure', name: 'חשיפה', en: 'Exposure', defaults: () => ({ exposure: 0, offset: 0, gamma: 1 }) },
  { kind: 'vibrance', name: 'חיוניות', en: 'Vibrance', defaults: () => ({ vibrance: 0, saturation: 0 }) },
  { kind: 'hueSat', name: 'גוון/רוויה', en: 'Hue/Saturation', defaults: () => ({ hue: 0, saturation: 0, lightness: 0, colorize: false }) },
  { kind: 'colorBalance', name: 'איזון צבע', en: 'Color Balance', defaults: () => ({ tone: 'midtones', shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserve: true }) },
  { kind: 'bw', name: 'שחור-לבן', en: 'Black & White', defaults: () => ({ reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, tint: false, tintColor: '#e1c39b' }) },
  { kind: 'shadowsHighlights', name: 'צללים/הארות', en: 'Shadows/Highlights', defaults: () => ({ shadows: 35, highlights: 0 }) },
  { kind: 'temperature', name: 'טמפרטורה/גוון', en: 'Temperature/Tint', defaults: () => ({ temperature: 0, tint: 0 }) },
  { kind: 'invert', name: 'היפוך', en: 'Invert', defaults: () => ({}) },
  { kind: 'posterize', name: 'פוסטריזציה', en: 'Posterize', defaults: () => ({ levels: 4 }) },
  { kind: 'threshold', name: 'סף', en: 'Threshold', defaults: () => ({ level: 128 }) },
  { kind: 'gradientMap', name: 'מפת מעבר צבע', en: 'Gradient Map', defaults: () => ({ c1: '#000000', c2: '#ffffff' }) },
];

export const adjustDef = (k: AdjustKind) => ADJUSTMENTS.find((a) => a.kind === k)!;

/* ---------- עזרי LUT ---------- */

const lut = (f: (v: number) => number) => {
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) t[i] = f(i);
  return t;
};

/** עקומה מונוטונית (Fritsch–Carlson) דרך הנקודות — כמו Curves בפוטושופ */
export function curveLut(points: number[][]): Uint8ClampedArray {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  const n = p.length;
  if (n < 2) return lut((v) => v);
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const d: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return lut((x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  });
}

function applyLuts(px: Uint8ClampedArray, r: Uint8ClampedArray, g = r, b = r) {
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    px[i] = r[px[i]]; px[i + 1] = g[px[i + 1]]; px[i + 2] = b[px[i + 2]];
  }
}

function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}
function hue2(p: number, q: number, t: number) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [hue2(p, q, h + 1 / 3) * 255, hue2(p, q, h) * 255, hue2(p, q, h - 1 / 3) * 255];
}
const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** מפעיל התאמה על הפיקסלים במקום */
export function applyAdjust(img: ImageData, kind: AdjustKind, p: Record<string, any>) {
  const px = img.data;
  switch (kind) {
    case 'brightness': {
      const b = Number(p.brightness) || 0, c = Number(p.contrast) || 0;
      const f = c >= 0 ? 1 + c / 50 : 1 + c / 100;
      applyLuts(px, lut((v) => (v + b * 0.75 - 127.5) * f + 127.5));
      break;
    }
    case 'levels': {
      const ib = +p.inBlack, iw = Math.max(ib + 1, +p.inWhite), g = Math.max(0.01, +p.gamma), ob = +p.outBlack, ow = +p.outWhite;
      applyLuts(px, lut((v) => ob + (ow - ob) * Math.pow(clamp((v - ib) / (iw - ib), 0, 1), 1 / g)));
      break;
    }
    case 'curves': {
      const m = curveLut(p.rgb), r = curveLut(p.r), g = curveLut(p.g), b = curveLut(p.b);
      applyLuts(px, lut((v) => r[m[v]]), lut((v) => g[m[v]]), lut((v) => b[m[v]]));
      break;
    }
    case 'exposure': {
      const k = Math.pow(2, +p.exposure || 0), off = +p.offset || 0, g = Math.max(0.01, +p.gamma || 1);
      applyLuts(px, lut((v) => 255 * Math.pow(clamp((v / 255) * k + off, 0, 1), 1 / g)));
      break;
    }
    case 'vibrance': {
      const vib = (+p.vibrance || 0) / 100, sat = (+p.saturation || 0) / 100;
      for (let i = 0; i < px.length; i += 4) {
        let r = px[i], g = px[i + 1], b = px[i + 2];
        const mx = Math.max(r, g, b), avg = (r + g + b) / 3;
        const amt = ((Math.abs(mx - avg) * 2) / 255) * -vib * 3 + vib; // חיוניות מגבירה בעיקר צבעים חלשים
        const k = 1 + sat + (vib > 0 ? vib * (1 - (mx - Math.min(r, g, b)) / 255) : amt);
        const L = lum(r, g, b);
        r = L + (r - L) * k; g = L + (g - L) * k; b = L + (b - L) * k;
        px[i] = r; px[i + 1] = g; px[i + 2] = b;
      }
      break;
    }
    case 'hueSat': {
      const dh = (+p.hue || 0) / 360, ds = (+p.saturation || 0) / 100, dl = (+p.lightness || 0) / 100;
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        let [h, s, l] = rgb2hsl(px[i], px[i + 1], px[i + 2]);
        if (p.colorize) { h = ((+p.hue || 0) + 360) % 360 / 360; s = clamp(0.25 + ds * 0.75, 0, 1); }
        else { h = (h + dh + 1) % 1; s = clamp(ds > 0 ? s + (1 - s) * ds * s : s * (1 + ds), 0, 1); }
        l = dl > 0 ? l + (1 - l) * dl : l * (1 + dl);
        const [r, g, b] = hsl2rgb(h, s, l);
        px[i] = r; px[i + 1] = g; px[i + 2] = b;
      }
      break;
    }
    case 'colorBalance': {
      const S = p.shadows as number[], M = p.midtones as number[], H = p.highlights as number[];
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        const r0 = px[i], g0 = px[i + 1], b0 = px[i + 2], L = lum(r0, g0, b0) / 255;
        const ws = clamp(1 - L * 2.2, 0, 1), wh = clamp(L * 2.2 - 1.2, 0, 1), wm = 1 - Math.abs(L - 0.5) * 2;
        const dr = (S[0] * ws + M[0] * wm + H[0] * wh) * 0.6, dg = (S[1] * ws + M[1] * wm + H[1] * wh) * 0.6, db = (S[2] * ws + M[2] * wm + H[2] * wh) * 0.6;
        let r = r0 + dr - (dg + db) / 2, g = g0 + dg - (dr + db) / 2, b = b0 + db - (dr + dg) / 2;
        if (p.preserve) { const k = lum(r0, g0, b0) - lum(r, g, b); r += k; g += k; b += k; }
        px[i] = r; px[i + 1] = g; px[i + 2] = b;
      }
      break;
    }
    case 'bw': {
      const w = [p.reds, p.yellows, p.greens, p.cyans, p.blues, p.magentas].map((v: number) => v / 100);
      const tint = p.tint ? hexToRgb(p.tintColor) : null;
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const [h, s] = rgb2hsl(r, g, b);
        const hh = h * 6, k = Math.floor(hh) % 6, f = hh - Math.floor(hh);
        const weight = w[k] * (1 - f) + w[(k + 1) % 6] * f;
        const L = lum(r, g, b);
        let v = L + (weight - 0.5) * s * 255 * 0.9;
        v = clamp(v, 0, 255);
        if (tint) { px[i] = (v * tint[0]) / 220; px[i + 1] = (v * tint[1]) / 220; px[i + 2] = (v * tint[2]) / 220; }
        else { px[i] = v; px[i + 1] = v; px[i + 2] = v; }
      }
      break;
    }
    case 'shadowsHighlights': {
      const sh = (+p.shadows || 0) / 100, hi = (+p.highlights || 0) / 100;
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        const r = px[i], g = px[i + 1], b = px[i + 2], L = lum(r, g, b) / 255;
        const lift = sh * Math.pow(1 - L, 2.5) * 0.9, drop = hi * Math.pow(L, 2.5) * 0.6;
        const target = clamp(L + lift * (1 - L) * 1.6 - drop * L, 0, 1);
        if (L > 0.004) { const k = target / L; px[i] = r * k; px[i + 1] = g * k; px[i + 2] = b * k; }
        else { const v = target * 255; px[i] = r + v; px[i + 1] = g + v; px[i + 2] = b + v; }
      }
      break;
    }
    case 'temperature': {
      const t = (+p.temperature || 0) * 0.6, n = (+p.tint || 0) * 0.5;
      applyLuts(px, lut((v) => v + t), lut((v) => v + n), lut((v) => v - t));
      break;
    }
    case 'invert':
      applyLuts(px, lut((v) => 255 - v));
      break;
    case 'posterize': {
      const n = Math.max(2, Math.round(+p.levels || 4));
      applyLuts(px, lut((v) => Math.round((Math.round((v / 255) * (n - 1)) / (n - 1)) * 255)));
      break;
    }
    case 'threshold': {
      const t = +p.level;
      for (let i = 0; i < px.length; i += 4) { const v = lum(px[i], px[i + 1], px[i + 2]) >= t ? 255 : 0; px[i] = px[i + 1] = px[i + 2] = v; }
      break;
    }
    case 'gradientMap': {
      const a = hexToRgb(p.c1), b = hexToRgb(p.c2);
      for (let i = 0; i < px.length; i += 4) {
        const k = lum(px[i], px[i + 1], px[i + 2]) / 255;
        px[i] = a[0] + (b[0] - a[0]) * k; px[i + 1] = a[1] + (b[1] - a[1]) * k; px[i + 2] = a[2] + (b[2] - a[2]) * k;
      }
      break;
    }
  }
}

/* ---------- Filters (הרסני, על קנבס) ---------- */

export interface FilterDef { id: string; name: string; en: string; params: Array<{ key: string; label: string; min: number; max: number; step: number; def: number }> }

export const FILTERS: FilterDef[] = [
  { id: 'gaussian', name: 'טשטוש גאוסיאני', en: 'Gaussian Blur', params: [{ key: 'radius', label: 'רדיוס (px)', min: 0.1, max: 250, step: 0.1, def: 4 }] },
  { id: 'motion', name: 'טשטוש תנועה', en: 'Motion Blur', params: [{ key: 'angle', label: 'זווית', min: -180, max: 180, step: 1, def: 0 }, { key: 'distance', label: 'מרחק (px)', min: 1, max: 400, step: 1, def: 20 }] },
  { id: 'unsharp', name: 'חידוד (Unsharp Mask)', en: 'Unsharp Mask', params: [{ key: 'amount', label: 'כמות %', min: 1, max: 500, step: 1, def: 80 }, { key: 'radius', label: 'רדיוס (px)', min: 0.1, max: 50, step: 0.1, def: 1.5 }, { key: 'threshold', label: 'סף', min: 0, max: 255, step: 1, def: 0 }] },
  { id: 'noise', name: 'הוספת רעש', en: 'Add Noise', params: [{ key: 'amount', label: 'כמות %', min: 0, max: 100, step: 0.5, def: 6 }, { key: 'mono', label: 'מונוכרום (0/1)', min: 0, max: 1, step: 1, def: 1 }] },
  { id: 'pixelate', name: 'פיקסליזציה', en: 'Mosaic', params: [{ key: 'size', label: 'גודל תא (px)', min: 2, max: 200, step: 1, def: 12 }] },
];

let filterSupport: boolean | null = null;
const canFilter = () => {
  if (filterSupport === null) {
    const c = newCanvas(2, 2).getContext('2d')!;
    filterSupport = typeof c.filter === 'string';
  }
  return filterSupport;
};

/** טשטוש: ctx.filter כשנתמך, אחרת שלוש מעברי box-blur */
export function blurCanvas(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const out = newCanvas(src.width, src.height);
  const o = out.getContext('2d')!;
  if (radius <= 0) { o.drawImage(src, 0, 0); return out; }
  if (canFilter()) {
    o.filter = `blur(${radius}px)`;
    o.drawImage(src, 0, 0);
    o.filter = 'none';
    return out;
  }
  o.drawImage(src, 0, 0);
  const img = o.getImageData(0, 0, out.width, out.height);
  const r = Math.max(1, Math.round(radius / 1.7));
  for (let k = 0; k < 3; k++) boxBlur(img, r);
  o.putImageData(img, 0, 0);
  return out;
}

function boxBlur(img: ImageData, r: number) {
  const { width: w, height: h, data } = img;
  const tmp = new Float32Array(data.length);
  const pass = (src: ArrayLike<number>, dst: { [i: number]: number }, horiz: boolean) => {
    const len = horiz ? w : h, lines = horiz ? h : w;
    for (let line = 0; line < lines; line++) {
      for (let c = 0; c < 4; c++) {
        let acc = 0;
        const idx = (i: number) => (horiz ? (line * w + clamp(i, 0, w - 1)) * 4 : (clamp(i, 0, h - 1) * w + line) * 4) + c;
        for (let i = -r; i <= r; i++) acc += src[idx(i)];
        for (let i = 0; i < len; i++) {
          dst[idx(i)] = acc / (2 * r + 1);
          acc += src[idx(i + r + 1)] - src[idx(i - r)];
        }
      }
    }
  };
  pass(data, tmp, true);
  pass(tmp, data, false);
}

export function applyFilter(src: HTMLCanvasElement, id: string, p: Record<string, number>): HTMLCanvasElement {
  const w = src.width, h = src.height;
  if (id === 'gaussian') return blurCanvas(src, p.radius);
  if (id === 'motion') {
    const out = newCanvas(w, h), o = out.getContext('2d')!;
    const n = Math.min(60, Math.max(4, Math.round(p.distance / 2)));
    const a = (p.angle * Math.PI) / 180;
    o.globalAlpha = 1 / n;
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1) - 0.5) * p.distance;
      o.globalCompositeOperation = i === 0 ? 'source-over' : 'lighter';
      o.drawImage(src, Math.cos(a) * t, -Math.sin(a) * t);
    }
    return out;
  }
  if (id === 'pixelate') {
    const s = Math.max(2, Math.round(p.size));
    const small = newCanvas(Math.ceil(w / s), Math.ceil(h / s));
    const sc = small.getContext('2d')!;
    sc.imageSmoothingQuality = 'high';
    sc.drawImage(src, 0, 0, small.width, small.height);
    const out = newCanvas(w, h), o = out.getContext('2d')!;
    o.imageSmoothingEnabled = false;
    o.drawImage(small, 0, 0, small.width * s, small.height * s);
    return out;
  }
  const out = newCanvas(w, h), o = ctx2d(out, true);
  o.drawImage(src, 0, 0);
  const img = o.getImageData(0, 0, w, h), px = img.data;
  if (id === 'unsharp') {
    const blurred = ctx2d(blurCanvas(src, p.radius), true).getImageData(0, 0, w, h).data;
    const k = p.amount / 100, th = p.threshold;
    for (let i = 0; i < px.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const d = px[i + c] - blurred[i + c];
        if (Math.abs(d) >= th) px[i + c] = px[i + c] + d * k;
      }
    }
  } else if (id === 'noise') {
    const amt = (p.amount / 100) * 255;
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      if (p.mono) { const n = (Math.random() - 0.5) * 2 * amt; px[i] += n; px[i + 1] += n; px[i + 2] += n; }
      else for (let c = 0; c < 3; c++) px[i + c] += (Math.random() - 0.5) * 2 * amt;
    }
  }
  o.putImageData(img, 0, 0);
  return out;
}
