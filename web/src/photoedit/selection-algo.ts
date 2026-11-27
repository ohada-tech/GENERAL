/**
 * אלגוריתמי בחירה טהורים — בלי DOM ובלי קנבס. עובדים על מערכי פיקסלים (RGBA) ומסכות אלפא (ערך אחד לפיקסל),
 * כדי שאפשר לבדוק אותם מחוץ לדפדפן (npx tsx). הדבק לקנבס נמצא ב-select-ops.ts.
 *
 * Quick Selection (גידול אזור לפי צבע ושוליים), Magnetic Lasso (Live-Wire על עוצמת הגרדיאנט),
 * Color Range, Select and Mask (Smooth/Feather/Contrast/Shift Edge), Grow/Similar, Smooth, Border.
 */

export type Pixels = Uint8ClampedArray | Uint8Array;
export interface Pt { x: number; y: number }
export interface Box { x0: number; y0: number; x1: number; y1: number }

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/* ======================= בסיס: בהירות, גרדיאנט, טשטוש, מורפולוגיה ======================= */

export function lumaOf(px: Pixels, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]) * (px[j + 3] / 255);
  return out;
}

/** Sobel על הבהירות, מנורמל ל-0..1 (ביחס לקצה החזק בתמונה, עם רצפה כדי שתמונה שטוחה לא תגביר רעש) */
export function sobel(px: Pixels, w: number, h: number): Float32Array {
  const L = lumaOf(px, w, h);
  const g = new Float32Array(w * h);
  let max = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = L[i - w - 1], b = L[i - w], c = L[i - w + 1], d = L[i - 1], f = L[i + 1], gg = L[i + w - 1], hh = L[i + w], k = L[i + w + 1];
      const gx = c + 2 * f + k - a - 2 * d - gg;
      const gy = gg + 2 * hh + k - a - 2 * b - c;
      const m = Math.sqrt(gx * gx + gy * gy);
      g[i] = m;
      if (m > max) max = m;
    }
  }
  const norm = 1 / Math.max(max, 120);
  for (let i = 0; i < g.length; i++) g[i] = Math.min(1, g[i] * norm);
  return g;
}

/** טשטוש קופסה נפרד (אופקי ואנכי), O(n) לכל מעבר, קצוות נצמדים */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  r = Math.round(r);
  if (r < 1) return src.slice();
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      acc += src[row + clamp(x + r + 1, 0, w - 1)] - src[row + clamp(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

/** קירוב גאוסי: שלושה מעברי קופסה. radius ≈ סיגמה בפיקסלים */
export function gaussBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return src.slice();
  const r = Math.max(1, Math.round(Math.sqrt((12 * radius * radius) / 3 + 1) / 2));
  return boxBlur(boxBlur(boxBlur(src, w, h, r), w, h, r), w, h, r);
}

/** מקסימום/מינימום בחלון ריבועי (הרחבה/כיווץ), עם תור מונוטוני — O(n) */
export function morph(src: Float32Array, w: number, h: number, r: number, dilate: boolean): Float32Array {
  r = Math.round(r);
  if (r < 1) return src.slice();
  const better = dilate ? (a: number, b: number) => a >= b : (a: number, b: number) => a <= b;
  const pass = (get: (i: number) => number, set: (i: number, v: number) => void, n: number) => {
    const dq = new Int32Array(n);
    let head = 0, tail = 0;
    for (let i = 0; i < n + r; i++) {
      if (i < n) {
        const v = get(i);
        while (tail > head && better(v, get(dq[tail - 1]))) tail--;
        dq[tail++] = i;
      }
      const c = i - r;
      if (c >= 0) {
        while (dq[head] < c - r) head++;
        set(c, get(dq[head]));
      }
    }
  };
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { const row = y * w; pass((i) => src[row + i], (i, v) => { tmp[row + i] = v; }, w); }
  for (let x = 0; x < w; x++) pass((i) => tmp[i * w + x], (i, v) => { out[i * w + x] = v; }, h);
  return out;
}

export const toFloat = (a: ArrayLike<number>): Float32Array => { const f = new Float32Array(a.length); for (let i = 0; i < a.length; i++) f[i] = a[i] / 255; return f; };
export const toByte = (f: Float32Array): Uint8ClampedArray => { const a = new Uint8ClampedArray(f.length); for (let i = 0; i < f.length; i++) a[i] = Math.round(clamp(f[i], 0, 1) * 255); return a; };

const smoothstep = (e0: number, e1: number, v: number) => { const t = clamp((v - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/* ======================= Select > Modify ======================= */

/** Smooth: כל פיקסל לפי הרוב ברדיוס (טשטוש ואז סף) */
export function smoothAlpha(alpha: ArrayLike<number>, w: number, h: number, r: number): Uint8ClampedArray {
  const f = boxBlur(toFloat(alpha), w, h, r);
  const out = new Uint8ClampedArray(f.length);
  for (let i = 0; i < f.length; i++) out[i] = f[i] >= 0.5 ? 255 : 0;
  return out;
}

/** Border: רצועה ברוחב width סביב קו הבחירה (חצי פנימה, חצי החוצה), עם קצה רך כמו בפוטושופ */
export function borderAlpha(alpha: ArrayLike<number>, w: number, h: number, width: number): Uint8ClampedArray {
  const f = toFloat(alpha);
  const half = Math.max(1, width / 2);
  const outer = morph(f, w, h, half, true), inner = morph(f, w, h, half, false);
  const band = new Float32Array(f.length);
  for (let i = 0; i < f.length; i++) band[i] = clamp(outer[i] - inner[i], 0, 1);
  return toByte(gaussBlur(band, w, h, Math.min(2, half / 3)));
}

/* ======================= Select and Mask ======================= */

export interface RefineOpts { smooth: number; feather: number; contrast: number; shift: number }

/** Smooth 0..100, Feather בפיקסלים, Contrast 0..100%, Shift Edge -100..100% */
export function refineAlpha(alpha: ArrayLike<number>, w: number, h: number, o: RefineOpts): Uint8ClampedArray {
  let f = toFloat(alpha);
  if (o.smooth > 0) {
    const r = Math.max(1, Math.round((o.smooth / 100) * 12));
    f = boxBlur(boxBlur(f, w, h, r), w, h, r);
    for (let i = 0; i < f.length; i++) f[i] = smoothstep(0.38, 0.62, f[i]);
  }
  if (o.shift) {
    const px = (Math.abs(o.shift) / 100) * 10;
    if (px >= 1) f = morph(f, w, h, px, o.shift > 0);
    else { const g = Math.pow(2, -o.shift / 25); for (let i = 0; i < f.length; i++) f[i] = Math.pow(f[i], g); }
  }
  if (o.feather > 0) f = gaussBlur(f, w, h, o.feather);
  if (o.contrast > 0) {
    const k = 1 / (1 - Math.min(0.99, o.contrast / 100));
    for (let i = 0; i < f.length; i++) f[i] = clamp((f[i] - 0.5) * k + 0.5, 0, 1);
  }
  return toByte(f);
}

/* ======================= Color Range ======================= */

export type RangePreset = 'sampled' | 'highlights' | 'midtones' | 'shadows' | 'skin';
export interface ColorRangeOpts { preset: RangePreset; samples: number[][]; subs: number[][]; fuzz: number; invert: boolean }

/** 1 עד חצי הסבולת, יורד ליניארית ל-0 בסבולת המלאה (כמו Fuzziness בפוטושופ) */
function falloff(d: number, fuzz: number) {
  if (fuzz <= 0) return d < 1 ? 1 : 0;
  const half = fuzz / 2;
  return d <= half ? 1 : d >= fuzz ? 0 : 1 - (d - half) / half;
}

function minDist(r: number, g: number, b: number, list: number[][]) {
  let best = Infinity;
  for (const s of list) { const dr = r - s[0], dg = g - s[1], db = b - s[2]; const d = dr * dr + dg * dg + db * db; if (d < best) best = d; }
  return Math.sqrt(best);
}

export function colorRange(px: Pixels, w: number, h: number, o: ColorRangeOpts): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    const r = px[j], g = px[j + 1], b = px[j + 2];
    if (px[j + 3] === 0) { out[i] = o.invert ? 255 : 0; continue; }
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    let a: number;
    switch (o.preset) {
      case 'highlights': a = smoothstep(165, 215, L); break;
      case 'shadows': a = 1 - smoothstep(40, 90, L); break;
      case 'midtones': a = smoothstep(45, 95, L) * (1 - smoothstep(160, 210, L)); break;
      case 'skin': {
        // טווח עור משוער במרחב YCbCr (Cb 77–127, Cr 133–173), עם שוליים רכים לפי Fuzziness
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        const fall = Math.max(3, o.fuzz / 6);
        const dcb = Math.max(77 - cb, cb - 127, 0), dcr = Math.max(133 - cr, cr - 173, 0);
        a = clamp(1 - Math.hypot(dcb, dcr) / fall, 0, 1) * smoothstep(25, 60, L) * (1 - smoothstep(235, 252, L));
        break;
      }
      default: {
        a = o.samples.length ? falloff(minDist(r, g, b, o.samples), o.fuzz) : 0;
        if (a > 0 && o.subs.length) a *= 1 - falloff(minDist(r, g, b, o.subs), o.fuzz);
      }
    }
    out[i] = Math.round((o.invert ? 1 - a : a) * 255);
  }
  return out;
}

/* ======================= Grow / Similar ======================= */

/** טווח הצבעים של הבחירה (אחוזון 2–98 לכל ערוץ) מורחב בסבולת. contiguous = Grow, אחרת Similar */
export function growSimilar(px: Pixels, w: number, h: number, sel: ArrayLike<number>, tol: number, contiguous: boolean): Uint8ClampedArray {
  const n = w * h;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let count = 0;
  for (let i = 0; i < n; i++) if (sel[i] > 127) { const j = i * 4; hist[0][px[j]]++; hist[1][px[j + 1]]++; hist[2][px[j + 2]]++; count++; }
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) out[i] = sel[i];
  if (!count) return out;
  const pct = (hst: Uint32Array, p: number) => { const target = count * p; let acc = 0; for (let v = 0; v < 256; v++) { acc += hst[v]; if (acc >= target) return v; } return 255; };
  const lo = hist.map((hh) => pct(hh, 0.02) - tol), hi = hist.map((hh) => pct(hh, 0.98) + tol);
  const match = (i: number) => {
    const j = i * 4;
    return px[j + 3] > 0 && px[j] >= lo[0] && px[j] <= hi[0] && px[j + 1] >= lo[1] && px[j + 1] <= hi[1] && px[j + 2] >= lo[2] && px[j + 2] <= hi[2];
  };
  if (!contiguous) { for (let i = 0; i < n; i++) if (match(i)) out[i] = 255; return out; }
  const stack = new Int32Array(n);
  let sp = 0;
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (sel[i] > 127) { seen[i] = 1; stack[sp++] = i; }
  while (sp) {
    const k = stack[--sp];
    const x = k % w;
    const nb = [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, k >= w ? k - w : -1, k < n - w ? k + w : -1];
    for (const q of nb) {
      if (q < 0 || seen[q]) continue;
      seen[q] = 1;
      if (match(q)) { out[q] = 255; stack[sp++] = q; }
    }
  }
  return out;
}

/* ======================= Quick Selection ======================= */

/**
 * מברשת שמגדלת בחירה: כל מריחה זורעת את הפיקסלים שמתחת למברשת, לומדת את הצבעים שלהם (עד 8 מרכזים),
 * ומתפשטת לשכנים בצבע דומה, בתוך חלון סביב המברשת, ונעצרת בשוליים חזקים (גרדיאנט).
 */
export class QuickSelectSession {
  /** 255 = נבחר במשיכה הנוכחית */
  readonly acc: Uint8Array;
  /** חותמת ביקור לכל מריחה (16 ביט, מתאפס כשנגמר) — חוסך ניקוי מערך בכל מריחה */
  private visit: Uint16Array;
  private stamp = 0;
  private centers: Array<{ r: number; g: number; b: number; n: number }> = [];
  private spread = 0;
  private spreadN = 0;
  private queue: Int32Array;

  constructor(readonly px: Pixels, readonly w: number, readonly h: number, readonly grad: Float32Array) {
    this.acc = new Uint8Array(w * h);
    this.visit = new Uint16Array(w * h);
    this.queue = new Int32Array(1024);
  }

  private nearest(r: number, g: number, b: number) {
    let best = Infinity, bi = -1;
    for (let i = 0; i < this.centers.length; i++) {
      const c = this.centers[i], dr = r - c.r, dg = g - c.g, db = b - c.b;
      const d = dr * dr + dg * dg + db * db;
      if (d < best) { best = d; bi = i; }
    }
    return { d: Math.sqrt(best), i: bi };
  }

  private learn(r: number, g: number, b: number) {
    const { d, i } = this.nearest(r, g, b);
    if (i >= 0 && (d < 26 || this.centers.length >= 8)) {
      const c = this.centers[i];
      c.n++;
      c.r += (r - c.r) / c.n; c.g += (g - c.g) / c.n; c.b += (b - c.b) / c.n;
      this.spread += d; this.spreadN++;
    } else this.centers.push({ r, g, b, n: 1 });
  }

  /** סבולת הצבע: לפי הפיזור של צבעי הזרעים, בגבולות סבירים */
  get tolerance() { return clamp(20 + 1.6 * (this.spreadN ? this.spread / this.spreadN : 0), 22, 64); }

  /** מריחה אחת ברדיוס r סביב (cx,cy). מחזיר את האזור שהשתנה */
  dab(cx: number, cy: number, r: number): Box | null {
    const { w, h, px, grad, acc } = this;
    r = Math.max(1, r);
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
    if (x0 > x1 || y0 > y1) return null;
    // כמו בפוטושופ: מריחה בתוך אזור אחיד ממלאת את כל האזור עד הקצוות, לא רק סביב המברשת
    const reach = Math.max(r * 2.5, 900);
    const box = { x0: Math.max(0, Math.floor(cx - r - reach)), y0: Math.max(0, Math.floor(cy - r - reach)), x1: Math.min(w - 1, Math.ceil(cx + r + reach)), y1: Math.min(h - 1, Math.ceil(cy + r + reach)) };
    if (this.stamp >= 65535) { this.visit.fill(0); this.stamp = 0; }
    const stamp = ++this.stamp;
    // התור לא יכול להיות גדול מהחלון — מגדילים את המאגר רק כשצריך
    const area = (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1);
    if (this.queue.length < area) this.queue = new Int32Array(area);
    let qn = 0;
    const r2 = r * r;
    const step = r > 12 ? 2 : 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r2) continue;
        const i = y * w + x;
        if ((x % step === 0 && y % step === 0) && px[i * 4 + 3] > 0) this.learn(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
        acc[i] = 255;
        this.visit[i] = stamp;
        this.queue[qn++] = i;
      }
    }
    const T = this.tolerance;
    let head = 0;
    while (head < qn) {
      const k = this.queue[head++];
      const x = k % w, y = (k / w) | 0;
      for (let dir = 0; dir < 4; dir++) {
        const nx = dir === 0 ? x - 1 : dir === 1 ? x + 1 : x, ny = dir === 2 ? y - 1 : dir === 3 ? y + 1 : y;
        if (nx < box.x0 || nx > box.x1 || ny < box.y0 || ny > box.y1) continue;
        const q = ny * w + nx;
        if (this.visit[q] === stamp) continue;
        this.visit[q] = stamp;
        const j = q * 4;
        if (px[j + 3] === 0) continue;
        const cd = this.nearest(px[j], px[j + 1], px[j + 2]).d;
        // מתפשטים בצבע דומה; שוליים חזקים עוצרים, אלא אם הצבע כמעט זהה
        if (cd > T || (grad[q] > 0.32 && cd > T * 0.45)) continue;
        acc[q] = 255;
        this.queue[qn++] = q;
      }
    }
    return box;
  }

  /** מריחה לאורך קו, כל רבע קוטר */
  stroke(a: Pt, b: Pt, r: number): Box | null {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(d / Math.max(1, r / 2)));
    let dirty: Box | null = null;
    for (let i = 1; i <= n; i++) {
      const bx = this.dab(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n, r);
      if (bx) dirty = dirty ? { x0: Math.min(dirty.x0, bx.x0), y0: Math.min(dirty.y0, bx.y0), x1: Math.max(dirty.x1, bx.x1), y1: Math.max(dirty.y1, bx.y1) } : bx;
    }
    return dirty;
  }
}

/* ======================= Magnetic Lasso ======================= */

/** הנקודה עם הקצה החזק ביותר ברדיוס (מעל סף הניגודיות); אחרת הנקודה עצמה */
export function snapToEdge(grad: Float32Array, w: number, h: number, p: Pt, radius: number, contrast: number): Pt {
  const cx = Math.round(p.x), cy = Math.round(p.y), r = Math.max(1, Math.round(radius));
  let best = -1, bx = cx, by = cy;
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
      const dd = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (dd > r * r) continue;
      const g = grad[y * w + x];
      if (g < contrast) continue;
      const score = g - (Math.sqrt(dd) / r) * 0.15;
      if (score > best) { best = score; bx = x; by = y; }
    }
  }
  return { x: clamp(bx, 0, w - 1), y: clamp(by, 0, h - 1) };
}

/** ערימה בינארית מינימלית קטנה (מפתחות Float, ערכים Int) */
class Heap {
  k: number[] = []; v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lk;
        if (l < n && k[l] < mk) { m = l; mk = k[l]; }
        if (r < n && k[r] < mk) { m = r; mk = k[r]; }
        if (m === i) break;
        k[i] = k[m]; v[i] = v[m]; i = m;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

/**
 * Live-Wire: המסלול הזול ביותר מ-a ל-b, כשמחיר פיקסל נמוך על קצה חזק. רק בחלון סביב שתי הנקודות (pad),
 * ואם החלון גדול מדי — קו ישר. מחזיר נקודות שלמות מ-a עד b.
 */
export function liveWire(grad: Float32Array, w: number, h: number, a: Pt, b: Pt, pad: number, contrast = 0.1, maxArea = 360_000): Pt[] {
  const ax = clamp(Math.round(a.x), 0, w - 1), ay = clamp(Math.round(a.y), 0, h - 1);
  const bx = clamp(Math.round(b.x), 0, w - 1), by = clamp(Math.round(b.y), 0, h - 1);
  if (ax === bx && ay === by) return [{ x: ax, y: ay }];
  const x0 = Math.max(0, Math.min(ax, bx) - pad), x1 = Math.min(w - 1, Math.max(ax, bx) + pad);
  const y0 = Math.max(0, Math.min(ay, by) - pad), y1 = Math.min(h - 1, Math.max(ay, by) + pad);
  const RW = x1 - x0 + 1, RH = y1 - y0 + 1;
  if (RW * RH > maxArea) return straight({ x: ax, y: ay }, { x: bx, y: by });
  const N = RW * RH;
  const dist = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  const li = (x: number, y: number) => (y - y0) * RW + (x - x0);
  const start = li(ax, ay), goal = li(bx, by);
  dist[start] = 0;
  const heap = new Heap();
  heap.push(0, start);
  const DX = [-1, 1, 0, 0, -1, 1, -1, 1], DY = [0, 0, -1, 1, -1, -1, 1, 1];
  while (heap.size) {
    const u = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === goal) break;
    const ux = (u % RW) + x0, uy = ((u / RW) | 0) + y0;
    for (let d = 0; d < 8; d++) {
      const nx = ux + DX[d], ny = uy + DY[d];
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
      const v = li(nx, ny);
      if (done[v]) continue;
      const g = grad[ny * w + nx];
      const edge = g >= contrast ? g : g * 0.3;
      const c = (1 - edge) * (1 - edge) * 0.95 + 0.05;
      const nd = dist[u] + c * (d < 4 ? 1 : Math.SQRT2);
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(nd, v); }
    }
  }
  if (prev[goal] < 0) return straight({ x: ax, y: ay }, { x: bx, y: by });
  const out: Pt[] = [];
  for (let u = goal; u >= 0; u = prev[u]) { out.push({ x: (u % RW) + x0, y: ((u / RW) | 0) + y0 }); if (u === start) break; }
  return out.reverse();
}

export function straight(a: Pt, b: Pt): Pt[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
  return out;
}

export function pathLength(p: Pt[]) {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  return s;
}

/** Frequency 0..100 של פוטושופ → מרחק בין עוגנים אוטומטיים (פיקסלים במסמך) */
export const anchorSpacing = (freq: number) => 10 + (1 - clamp(freq, 0, 100) / 100) * 140;

/** פישוט נקודות קרובות (לציור ולמצולע) */
export function thin(p: Pt[], minStep = 1.5): Pt[] {
  if (p.length < 3) return p.slice();
  const out = [p[0]];
  for (let i = 1; i < p.length - 1; i++) { const l = out[out.length - 1]; if (Math.hypot(p[i].x - l.x, p[i].y - l.y) >= minStep) out.push(p[i]); }
  out.push(p[p.length - 1]);
  return out;
}

/** האם כל הפיקסלים נבחרים (מעל 250) */
export function isFull(alpha: ArrayLike<number>) {
  for (let i = 0; i < alpha.length; i++) if (alpha[i] < 250) return false;
  return true;
}
