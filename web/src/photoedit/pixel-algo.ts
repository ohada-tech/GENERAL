/**
 * אלגוריתמי פיקסלים טהורים (בלי DOM) לכלי הציור, הרטוש והמדידה: מערכים בלבד, כדי שאפשר לבדוק אותם מחוץ לדפדפן.
 * כל הפונקציות עובדות על RGBA לא מוכפל (כמו ImageData), במרחב המקומי של השכבה.
 */

export interface Img { data: Uint8ClampedArray; w: number; h: number }
export interface Rct { x0: number; y0: number; x1: number; y1: number }
/** טביעת מברשת: מרכז, רדיוס (בפיקסלים של השכבה), קשיחות, ומסכת בחירה אופציונלית (0–255 לכל פיקסל) */
export interface Dab { img: Img; cx: number; cy: number; r: number; hard: number; sel: Uint8Array | null }

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** משקל לפי מרחק מהמרכז: 1 עד רדיוס הקשיחות, ואז דעיכה חלקה ל-0 בקצה */
export function falloff(d: number, r: number, hard: number): number {
  if (d >= r) return 0;
  const inner = r * Math.min(0.999, hard);
  if (d <= inner) return 1;
  const t = (d - inner) / (r - inner);
  return 1 - t * t * (3 - 2 * t);
}

export function dabRect(d: Pick<Dab, 'img' | 'cx' | 'cy' | 'r'>): Rct {
  return {
    x0: Math.max(0, Math.floor(d.cx - d.r)), y0: Math.max(0, Math.floor(d.cy - d.r)),
    x1: Math.min(d.img.w, Math.ceil(d.cx + d.r + 1)), y1: Math.min(d.img.h, Math.ceil(d.cy + d.r + 1)),
  };
}

/** עובר על כל פיקסל בטביעה עם המשקל שלו (כולל מסכת הבחירה) */
export function eachDab(d: Dab, fn: (i: number, wgt: number, x: number, y: number) => void) {
  const R = dabRect(d);
  for (let y = R.y0; y < R.y1; y++) {
    for (let x = R.x0; x < R.x1; x++) {
      let w = falloff(Math.hypot(x + 0.5 - d.cx, y + 0.5 - d.cy), d.r, d.hard);
      if (w <= 0) continue;
      const p = y * d.img.w + x;
      if (d.sel) { w *= d.sel[p] / 255; if (w <= 0) continue; }
      fn(p, w, x, y);
    }
  }
}

export const unionRct = (a: Rct | null, b: Rct): Rct => (a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : { ...b });

/* ---------- צבע ---------- */

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** מרחק צבע כמו ב-Tolerance של פוטושופ: ההפרש הגדול בין הערוצים */
export const colorDist = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) => Math.max(Math.abs(r1 - r2), Math.abs(g1 - g2), Math.abs(b1 - b2));

export type ReplaceMode = 'hue' | 'saturation' | 'color' | 'luminosity';
/** Color Replacement: מחליף רכיב אחד (או שניים) של הצבע בפיקסל בזה של הצבע הקדמי */
export function replaceColor(r: number, g: number, b: number, fg: [number, number, number], mode: ReplaceMode): [number, number, number] {
  const [h, s, l] = rgbToHsl(r, g, b);
  const [fh, fs, fl] = rgbToHsl(...fg);
  if (mode === 'hue') return hslToRgb(fh, s, l);
  if (mode === 'saturation') return hslToRgb(h, fs, l);
  if (mode === 'color') return hslToRgb(fh, fs, l);
  return hslToRgb(h, s, fl);
}

/** ערבוב שני פיקסלים בצורה מוכפלת-אלפא (בלי שוליים כהים בשקיפות) */
export function mixInto(out: Uint8ClampedArray, j: number, a: Uint8ClampedArray, ja: number, b: Uint8ClampedArray, jb: number, t: number) {
  const aa = a[ja + 3] / 255, ab = b[jb + 3] / 255;
  const pa = aa * (1 - t) + ab * t;
  if (pa <= 1e-6) { out[j] = b[jb]; out[j + 1] = b[jb + 1]; out[j + 2] = b[jb + 2]; out[j + 3] = 0; return; }
  out[j] = (a[ja] * aa * (1 - t) + b[jb] * ab * t) / pa;
  out[j + 1] = (a[ja + 1] * aa * (1 - t) + b[jb + 1] * ab * t) / pa;
  out[j + 2] = (a[ja + 2] * aa * (1 - t) + b[jb + 2] * ab * t) / pa;
  out[j + 3] = pa * 255;
}

/* ---------- Color Replacement / Background Eraser ---------- */

export function colorReplaceDab(d: Dab, sample: [number, number, number], tol: number, fg: [number, number, number], mode: ReplaceMode, aa: boolean) {
  const px = d.img.data;
  eachDab(d, (i, w) => {
    const j = i * 4;
    if (px[j + 3] === 0) return;
    const dist = colorDist(px[j], px[j + 1], px[j + 2], ...sample);
    if (dist > tol) return;
    // Anti-alias: ריכוך בקצה הטולרנס
    const k = aa && tol > 0 ? w * clamp01((tol - dist) / Math.max(1, tol * 0.25)) : w;
    const [r, g, b] = replaceColor(px[j], px[j + 1], px[j + 2], fg, mode);
    px[j] += (r - px[j]) * k;
    px[j + 1] += (g - px[j + 1]) * k;
    px[j + 2] += (b - px[j + 2]) * k;
  });
}

/** Background Eraser: מוחק פיקסלים קרובים לצבע שנדגם במרכז. Contiguous = רק מה שמחובר למרכז */
export function bgEraseDab(d: Dab, sample: [number, number, number], tol: number, contiguous: boolean, protect: [number, number, number] | null) {
  const { data: px, w: W } = d.img;
  const R = dabRect(d);
  const bw = R.x1 - R.x0, bh = R.y1 - R.y0;
  if (bw <= 0 || bh <= 0) return;
  const ok = (x: number, y: number) => {
    const j = (y * W + x) * 4;
    if (px[j + 3] === 0) return false;
    if (colorDist(px[j], px[j + 1], px[j + 2], ...sample) > tol) return false;
    if (protect && colorDist(px[j], px[j + 1], px[j + 2], ...protect) <= Math.max(8, tol * 0.5)) return false;
    return true;
  };
  let allow: Uint8Array | null = null;
  if (contiguous) {
    allow = new Uint8Array(bw * bh);
    const sx = Math.floor(d.cx), sy = Math.floor(d.cy);
    if (sx < R.x0 || sy < R.y0 || sx >= R.x1 || sy >= R.y1 || !ok(sx, sy)) return;
    const stack = [sx, sy];
    allow[(sy - R.y0) * bw + (sx - R.x0)] = 1;
    while (stack.length) {
      const y = stack.pop()!, x = stack.pop()!;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < R.x0 || ny < R.y0 || nx >= R.x1 || ny >= R.y1) continue;
        const k = (ny - R.y0) * bw + (nx - R.x0);
        if (allow[k]) continue;
        if (Math.hypot(nx + 0.5 - d.cx, ny + 0.5 - d.cy) > d.r || !ok(nx, ny)) continue;
        allow[k] = 1;
        stack.push(nx, ny);
      }
    }
  }
  eachDab(d, (i, w, x, y) => {
    if (allow ? !allow[(y - R.y0) * bw + (x - R.x0)] : !ok(x, y)) return;
    px[i * 4 + 3] *= 1 - w;
  });
}

/* ---------- Blur / Sharpen / Smudge ---------- */

/** טשטוש תיבה של אזור הטביעה (מוכפל אלפא), מחזיר RGBA צף לכל פיקסל ב-rect */
export function boxBlurRect(src: Img, R: Rct, kr: number): Float32Array {
  const bw = R.x1 - R.x0, bh = R.y1 - R.y0;
  const out = new Float32Array(bw * bh * 4);
  const { data, w: W, h: H } = src;
  for (let y = R.y0; y < R.y1; y++) {
    for (let x = R.x0; x < R.x1; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = Math.max(0, y - kr); yy <= Math.min(H - 1, y + kr); yy++) {
        for (let xx = Math.max(0, x - kr); xx <= Math.min(W - 1, x + kr); xx++) {
          const j = (yy * W + xx) * 4, al = data[j + 3];
          r += data[j] * al; g += data[j + 1] * al; b += data[j + 2] * al; a += al; n++;
        }
      }
      const o = ((y - R.y0) * bw + (x - R.x0)) * 4;
      out[o] = a ? r / a : 0; out[o + 1] = a ? g / a : 0; out[o + 2] = a ? b / a : 0; out[o + 3] = n ? a / n : 0;
    }
  }
  return out;
}

export function blurSharpenDab(d: Dab, src: Img, strength: number, sharpen: boolean) {
  const R = dabRect(d);
  const kr = Math.max(1, Math.min(4, Math.round(d.r / 12)));
  const bl = boxBlurRect(src, R, kr);
  const bw = R.x1 - R.x0, px = d.img.data, s = src.data;
  eachDab(d, (i, w, x, y) => {
    const j = i * 4, o = ((y - R.y0) * bw + (x - R.x0)) * 4;
    const k = w * strength;
    if (!sharpen) {
      for (let c = 0; c < 4; c++) px[j + c] += (bl[o + c] - px[j + c]) * k * 0.5;
    } else {
      // Unsharp עדין: מוסיף את ההפרש מהטשטוש
      for (let c = 0; c < 3; c++) px[j + c] = px[j + c] + (s[j + c] - bl[o + c]) * k * 0.6;
    }
  });
}

/** Smudge: "צבע נישא" שנמרח מטביעה לטביעה. carry באורך (2R+1)²×4 יחסית למרכז */
export function smudgeDab(d: Dab, carry: Float32Array, R: number, strength: number) {
  const px = d.img.data, S = 2 * R + 1;
  const cx = Math.floor(d.cx), cy = Math.floor(d.cy);
  eachDab(d, (i, w, x, y) => {
    const ox = x - cx + R, oy = y - cy + R;
    if (ox < 0 || oy < 0 || ox >= S || oy >= S) return;
    const j = i * 4, o = (oy * S + ox) * 4;
    const k = w * strength;
    const before = [px[j], px[j + 1], px[j + 2], px[j + 3]];
    for (let c = 0; c < 4; c++) px[j + c] += (carry[o + c] - px[j + c]) * k;
    // הצבע הנישא קולט מעט מהפיקסל שמתחת — ככה המריחה נחלשת בהדרגה
    for (let c = 0; c < 4; c++) carry[o + c] += (before[c] - carry[o + c]) * (1 - strength) * w;
  });
}

export function fillCarry(img: Img, cx: number, cy: number, R: number, color: [number, number, number] | null): Float32Array {
  const S = 2 * R + 1, out = new Float32Array(S * S * 4);
  const fx = Math.floor(cx), fy = Math.floor(cy);
  for (let oy = 0; oy < S; oy++) {
    for (let ox = 0; ox < S; ox++) {
      const o = (oy * S + ox) * 4;
      if (color) { out[o] = color[0]; out[o + 1] = color[1]; out[o + 2] = color[2]; out[o + 3] = 255; continue; }
      const x = Math.min(img.w - 1, Math.max(0, fx - R + ox)), y = Math.min(img.h - 1, Math.max(0, fy - R + oy));
      const j = (y * img.w + x) * 4;
      out[o] = img.data[j]; out[o + 1] = img.data[j + 1]; out[o + 2] = img.data[j + 2]; out[o + 3] = img.data[j + 3];
    }
  }
  return out;
}

/* ---------- Dodge / Burn / Sponge ---------- */

export type ToneRange = 'shadows' | 'midtones' | 'highlights';
export function rangeWeight(L: number, range: ToneRange): number {
  const v = L / 255;
  if (range === 'shadows') return (1 - v) * (1 - v);
  if (range === 'highlights') return v * v;
  return Math.max(0, 1 - Math.abs(v * 2 - 1) ** 1.5);
}

export function dodgeBurnDab(d: Dab, dodge: boolean, range: ToneRange, exposure: number, protect: boolean) {
  const px = d.img.data;
  eachDab(d, (i, w) => {
    const j = i * 4;
    const r = px[j], g = px[j + 1], b = px[j + 2];
    const L = luma(r, g, b);
    const a = exposure * w * rangeWeight(L, range) * 0.35;
    if (a <= 0) return;
    if (protect) {
      // Protect Tones: משנים רק את הבהירות ושומרים על הגוון והרוויה
      const nL = dodge ? L + (255 - L) * a : L * (1 - a);
      if (L < 0.5) { if (dodge) { px[j] = px[j + 1] = px[j + 2] = nL; } return; }
      const k = nL / L;
      const mx = Math.max(r, g, b);
      if (mx * k > 255) {
        // חריגה: מערבבים לכיוון אפור באותה בהירות במקום לקצוץ ערוץ (שמשנה גוון)
        const t = (mx * k - 255) / Math.max(1, mx * k - nL);
        px[j] = r * k + (nL - r * k) * t; px[j + 1] = g * k + (nL - g * k) * t; px[j + 2] = b * k + (nL - b * k) * t;
        return;
      }
      px[j] = r * k; px[j + 1] = g * k; px[j + 2] = b * k;
    } else if (dodge) { px[j] = r + (255 - r) * a; px[j + 1] = g + (255 - g) * a; px[j + 2] = b + (255 - b) * a; }
    else { px[j] = r * (1 - a); px[j + 1] = g * (1 - a); px[j + 2] = b * (1 - a); }
  });
}

export function spongeDab(d: Dab, saturate: boolean, flow: number, vibrance: boolean) {
  const px = d.img.data;
  eachDab(d, (i, w) => {
    const j = i * 4;
    const r = px[j], g = px[j + 1], b = px[j + 2];
    const gray = luma(r, g, b);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx ? (mx - mn) / mx : 0;
    let a = flow * w * 0.25;
    // Vibrance: מגן על צבעים שכבר רוויים (ומונע קיצוץ)
    if (vibrance) a *= saturate ? (1 - sat) ** 2 : 0.5 + sat * 0.5;
    const k = saturate ? 1 + a : 1 - a;
    px[j] = gray + (r - gray) * k; px[j + 1] = gray + (g - gray) * k; px[j + 2] = gray + (b - gray) * k;
  });
}

/* ---------- כיסוי משיחה (History Brush, Healing, Pattern) ---------- */

/** מצטבר כמו Flow: כל טביעה מוסיפה w·flow מהמרחק שנשאר עד 1 */
export function coverDab(cov: Float32Array, d: Dab, flow: number) {
  eachDab(d, (i, w) => { cov[i] += (1 - cov[i]) * w * flow; });
}

/** out = base ↔ src לפי הכיסוי × האטימות, רק בתוך rect */
export function mixCoverage(out: Uint8ClampedArray, base: Uint8ClampedArray, src: Uint8ClampedArray, cov: Float32Array, opacity: number, W: number, R: Rct) {
  for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) {
    const i = y * W + x, j = i * 4;
    const t = cov[i] * opacity;
    if (t <= 0) { out[j] = base[j]; out[j + 1] = base[j + 1]; out[j + 2] = base[j + 2]; out[j + 3] = base[j + 3]; continue; }
    mixInto(out, j, base, j, src, j, Math.min(1, t));
  }
}

/* ---------- Healing: מרקם מהמקור + צבע/טון מהיעד (תדר נמוך) ---------- */

/**
 * Push-pull: משלים ערכים חסרים (wt<1) מתוך הידועים, כמו קרום חלק. vals = n×C, wt = 0..1.
 * זה החלק ה"נמוך" בהפרדת התדרים: ההפרש בין היעד למקור נמתח בעדינות לתוך החור.
 */
export function pushPull(vals: Float32Array, wt: Float32Array, w: number, h: number, C: number) {
  if (w <= 1 && h <= 1) return;
  const nw = Math.max(1, Math.ceil(w / 2)), nh = Math.max(1, Math.ceil(h / 2));
  const cv = new Float32Array(nw * nh * C), cw = new Float32Array(nw * nh);
  let missing = false;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let sw = 0;
    const acc = new Float32Array(C);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const fx = x * 2 + dx, fy = y * 2 + dy;
      if (fx >= w || fy >= h) continue;
      const i = fy * w + fx, ww = wt[i];
      if (ww <= 0) continue;
      sw += ww;
      for (let c = 0; c < C; c++) acc[c] += vals[i * C + c] * ww;
    }
    const k = y * nw + x;
    cw[k] = Math.min(1, sw);
    if (sw > 0) for (let c = 0; c < C; c++) cv[k * C + c] = acc[c] / sw;
    if (cw[k] < 1) missing = true;
  }
  if (missing && (nw > 1 || nh > 1)) pushPull(cv, cw, nw, nh, C);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, ww = wt[i];
    if (ww >= 1) continue;
    // דגימה בילינארית מהרמה הגסה
    const gx = Math.min(nw - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), gy = Math.min(nh - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
    const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(nw - 1, x0 + 1), y1 = Math.min(nh - 1, y0 + 1);
    const tx = gx - x0, ty = gy - y0;
    for (let c = 0; c < C; c++) {
      const v = (cv[(y0 * nw + x0) * C + c] * (1 - tx) + cv[(y0 * nw + x1) * C + c] * tx) * (1 - ty) + (cv[(y1 * nw + x0) * C + c] * (1 - tx) + cv[(y1 * nw + x1) * C + c] * tx) * ty;
      vals[i * C + c] = vals[i * C + c] * ww + v * (1 - ww);
    }
    wt[i] = 1;
  }
}

/**
 * Healing בתוך אזור: tgt = התמונה, tex = המרקם (באותן קואורדינטות), m = מסכת האזור לריפוי (0..1).
 * תוצאה: tex + קרום חלק של (tgt − tex) מהשוליים, משולב לפי m. כותב לתוך tgt. רק ב-rect.
 */
export function healInto(tgt: Img, tex: Uint8ClampedArray, m: Float32Array, R: Rct) {
  const bw = R.x1 - R.x0, bh = R.y1 - R.y0;
  if (bw <= 0 || bh <= 0) return;
  const W = tgt.w, t = tgt.data, C = 4;
  const vals = new Float32Array(bw * bh * C), wt = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = (y + R.y0) * W + (x + R.x0), k = y * bw + x;
    if (m[i] > 0.001) continue;
    wt[k] = 1;
    for (let c = 0; c < C; c++) vals[k * C + c] = t[i * 4 + c] - tex[i * 4 + c];
  }
  pushPull(vals, wt, bw, bh, C);
  // החלקה קצרה בתוך החור כדי להעלים את מבנה הבלוקים של הפירמידה
  const iters = Math.min(40, Math.max(6, Math.round(Math.max(bw, bh) / 6)));
  const tmp = new Float32Array(vals.length);
  for (let it = 0; it < iters; it++) {
    tmp.set(vals);
    for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
      const i = (y + R.y0) * W + (x + R.x0);
      if (m[i] <= 0.001) continue;
      const k = y * bw + x;
      for (let c = 0; c < C; c++) vals[k * C + c] = (tmp[(k - 1) * C + c] + tmp[(k + 1) * C + c] + tmp[(k - bw) * C + c] + tmp[(k + bw) * C + c]) / 4;
    }
  }
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = (y + R.y0) * W + (x + R.x0), k = y * bw + x, a = m[i];
    if (a <= 0.001) continue;
    for (let c = 0; c < C; c++) {
      const healed = tex[i * 4 + c] + vals[k * C + c];
      t[i * 4 + c] = t[i * 4 + c] * (1 - a) + healed * a;
    }
  }
}

export function maskBounds(m: Float32Array, w: number, h: number, pad = 0): Rct | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x] > 0.001) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  return { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), x1: Math.min(w, x1 + 1 + pad), y1: Math.min(h, y1 + 1 + pad) };
}

/**
 * Spot Healing: מחפש היסט שממנו להעתיק מרקם — המועמד שהשוליים שלו הכי דומים לשוליים של החור.
 * לא Content-Aware של אדובי, אבל מהיר ועובד יפה על עור, שמיים וקירות.
 */
export function findPatchOffset(img: Img, m: Float32Array, R: Rct): { dx: number; dy: number } {
  const { w: W, h: H, data } = img;
  const bw = R.x1 - R.x0, bh = R.y1 - R.y0;
  // טבעת: פיקסלים מחוץ לחור במרחק עד 3 ממנו
  const ring: number[] = [];
  const band = 3;
  for (let y = Math.max(0, R.y0 - band); y < Math.min(H, R.y1 + band); y++) {
    for (let x = Math.max(0, R.x0 - band); x < Math.min(W, R.x1 + band); x++) {
      if (m[y * W + x] > 0.001) continue;
      let near = false;
      for (let yy = Math.max(0, y - band); yy <= Math.min(H - 1, y + band) && !near; yy++) for (let xx = Math.max(0, x - band); xx <= Math.min(W - 1, x + band); xx++) if (m[yy * W + xx] > 0.001) { near = true; break; }
      if (near) ring.push(x, y);
    }
  }
  const size = Math.max(bw, bh);
  const cands: Array<[number, number]> = [];
  for (const k of [1.15, 1.6, 2.2]) for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    cands.push([Math.round(Math.cos(ang) * size * k + Math.sign(Math.cos(ang)) * band), Math.round(Math.sin(ang) * size * k + Math.sign(Math.sin(ang)) * band)]);
  }
  let best = { dx: Math.round(size * 1.2), dy: 0 }, bestScore = Infinity;
  const step = Math.max(1, Math.floor(ring.length / 2 / 600));
  for (const [dx, dy] of cands) {
    if (R.x0 - band + dx < 0 || R.y0 - band + dy < 0 || R.x1 + band + dx > W || R.y1 + band + dy > H) continue;
    let s = 0, n = 0;
    for (let k = 0; k < ring.length; k += 2 * step) {
      const x = ring[k], y = ring[k + 1];
      const i = (y * W + x) * 4, o = ((y + dy) * W + (x + dx)) * 4;
      if (m[(y + dy) * W + (x + dx)] > 0.001) { s += 3 * 255 * 255; n++; continue; }
      const er = data[i] - data[o], eg = data[i + 1] - data[o + 1], eb = data[i + 2] - data[o + 2];
      s += er * er + eg * eg + eb * eb + (data[i + 3] - data[o + 3]) ** 2;
      n++;
    }
    // העדפה קלה למועמדים קרובים
    const score = n ? s / n + Math.hypot(dx, dy) * 0.5 : Infinity;
    if (score < bestScore) { bestScore = score; best = { dx, dy }; }
  }
  return best;
}

/** מרקם מוזז: tex(p) = src(p + (dx,dy)), עם הצמדה לשוליים */
export function shiftedTexture(src: Img, dx: number, dy: number, R: Rct, out: Uint8ClampedArray) {
  const { w: W, h: H, data } = src;
  for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) {
    const sx = Math.min(W - 1, Math.max(0, Math.round(x + dx))), sy = Math.min(H - 1, Math.max(0, Math.round(y + dy)));
    const i = (y * W + x) * 4, o = (sy * W + sx) * 4;
    out[i] = data[o]; out[i + 1] = data[o + 1]; out[i + 2] = data[o + 2]; out[i + 3] = data[o + 3];
  }
}

/* ---------- Red Eye ---------- */

/** מאתר אדום סביב (cx,cy) ברדיוס, מוריד רוויה ומכהה. pupil = 1..100 (%), darken = 1..100 (%) */
export function redEyeFix(img: Img, cx: number, cy: number, radius: number, pupil: number, darken: number): number {
  const { w: W, h: H, data } = img;
  const R: Rct = { x0: Math.max(0, Math.floor(cx - radius)), y0: Math.max(0, Math.floor(cy - radius)), x1: Math.min(W, Math.ceil(cx + radius)), y1: Math.min(H, Math.ceil(cy + radius)) };
  const bw = R.x1 - R.x0, bh = R.y1 - R.y0;
  if (bw <= 0 || bh <= 0) return 0;
  const red = new Float32Array(bw * bh);
  let sx = 0, sy = 0, sw = 0;
  for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) {
    const j = (y * W + x) * 4, r = data[j], g = data[j + 1], b = data[j + 2];
    const other = Math.max(g, b);
    // "אדמומיות": אדום חזק ביחס לשאר הערוצים
    const v = r > 60 && r > other * 1.35 ? clamp01((r - other) / (r * 0.6)) : 0;
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d > radius) continue;
    red[(y - R.y0) * bw + (x - R.x0)] = v;
    sx += x * v; sy += y * v; sw += v;
  }
  if (sw < 2) return 0;
  // מרכז ורדיוס האישון האדום בפועל
  const mx = sx / sw, my = sy / sw;
  let sr = 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const v = red[y * bw + x]; if (v) sr += v * Math.hypot(x + R.x0 - mx, y + R.y0 - my); }
  const blobR = Math.max(1.5, (sr / sw) * 1.6);
  const limit = blobR * (0.5 + pupil / 100);
  let n = 0;
  for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) {
    const v0 = red[(y - R.y0) * bw + (x - R.x0)];
    if (!v0) continue;
    const d = Math.hypot(x - mx, y - my);
    const k = v0 * falloff(d, limit, 0.6);
    if (k <= 0) continue;
    const j = (y * W + x) * 4, g = data[j + 1], b = data[j + 2];
    const base = (g + b) / 2 * (1 - (darken / 100) * 0.75);
    data[j] += (base - data[j]) * k;
    data[j + 1] += (Math.min(g, base * 1.05) - g) * k;
    data[j + 2] += (Math.min(b, base * 1.05) - b) * k;
    n++;
  }
  return n;
}

/* ---------- דפוסים (Pattern) ---------- */

export type PatternKind = 'checker' | 'dots' | 'stripes' | 'grid' | 'bricks' | 'noise';
export function patternPixels(kind: PatternKind, size: number, c1: [number, number, number], c2: [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let t = 0;
    const u = (x + 0.5) / size, v = (y + 0.5) / size;
    if (kind === 'checker') t = (u < 0.5) !== (v < 0.5) ? 1 : 0;
    else if (kind === 'dots') t = clamp01((0.28 - Math.hypot(u - 0.5, v - 0.5)) * size * 0.5 + 0.5);
    else if (kind === 'stripes') t = ((u + v) % 0.5) < 0.25 ? 1 : 0;
    else if (kind === 'grid') t = u < 0.08 || v < 0.08 ? 1 : 0;
    else if (kind === 'bricks') { const row = v < 0.5 ? 0 : 1; const uu = (u + row * 0.5) % 1; t = v % 0.5 < 0.06 || uu < 0.04 ? 1 : 0; }
    else t = rnd();
    const j = (y * size + x) * 4;
    out[j] = c1[0] + (c2[0] - c1[0]) * t; out[j + 1] = c1[1] + (c2[1] - c1[1]) * t; out[j + 2] = c1[2] + (c2[2] - c1[2]) * t; out[j + 3] = 255;
  }
  return out;
}

/* ---------- מדידה ---------- */

/** מרחק וזווית כמו בסרגל של פוטושופ: זווית נגד כיוון השעון מהאופק, ‎−180..180 */
export function rulerInfo(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return { dist: Math.hypot(dx, dy), angle: (-Math.atan2(dy, dx) * 180) / Math.PI, w: dx, h: dy };
}

/** Straighten Layer: בכמה מעלות (חיובי = עם השעון) לסובב כדי שהקו יהיה אופקי (או אנכי אם הוא קרוב יותר לאנכי) */
export function straightenDelta(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const th = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI; // עם השעון, ‎−180..180
  // הזווית הקרובה ביותר מתוך 0/±90/180
  const targets = [-180, -90, 0, 90, 180];
  let best = 0, bd = Infinity;
  for (const t of targets) if (Math.abs(th - t) < bd) { bd = Math.abs(th - t); best = t; }
  return best - th;
}
