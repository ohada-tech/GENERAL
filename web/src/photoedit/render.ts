/**
 * Canvas Engine — מרכיב את המסמך מהשכבות: תוכן, מסכה, אפקטים, Clipping, קבוצות ושכבות התאמה.
 * מנותק מהממשק: מקבל מסמך ומחזיר קנבס. משמש גם לתצוגה (בסקאלה מוקטנת בזמן גרירה), גם לייצוא וגם לתמונות ממוזערות.
 */
import { applyAdjust, blurCanvas } from './adjust';
import type { AdjustLayer, Doc, Layer, Mask, Rect, ShapeLayer, XfLayer } from './model';
import { aabb, apply, cornersOf, ctx2d, gco, hasEffects, isXf, newCanvas, rgba, xfMatrix } from './model';
import { drawText, layoutText } from './text';
import { traceSubs, type Mat } from './paths';
import { deformCorners, deformSamples, drawDeformed, isDeformed } from './deform';

/* ---------- מידות ומטריצות ---------- */

export function localSize(l: XfLayer): { w: number; h: number } {
  if (l.type === 'raster') return { w: l.canvas.width, h: l.canvas.height };
  if (l.type === 'shape') return { w: l.w, h: l.h };
  const L = layoutText(l);
  return { w: L.w, h: L.h };
}

export function layerMatrix(l: XfLayer): DOMMatrix {
  const { w, h } = localSize(l);
  return xfMatrix(l.t, w, h);
}

/** תיבת התוכן במרחב המקומי. לפיקסלים — רק האזור הלא-שקוף (כמו תיבת הטרנספורם בפוטושופ) */
const boundsCache = new WeakMap<HTMLCanvasElement, Rect | null>();
export function contentBounds(c: HTMLCanvasElement): Rect | null {
  if (boundsCache.has(c)) return boundsCache.get(c)!;
  const { width: w, height: h } = c;
  const d = ctx2d(c).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (d[row + x * 4 + 3] > 2) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const r = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  boundsCache.set(c, r);
  return r;
}

export function localBox(l: XfLayer): Rect {
  if (l.type === 'raster') return contentBounds(l.canvas) ?? { x: 0, y: 0, w: l.canvas.width, h: l.canvas.height };
  const { w, h } = localSize(l);
  return { x: 0, y: 0, w, h };
}

/** ארבע הפינות של תיבת השכבה במסמך */
export function layerQuad(l: XfLayer) {
  const m = layerMatrix(l), b = localBox(l);
  // Distort/Perspective: תיבת הטרנספורם היא ה-Quad; Puppet: התיבה של הרשת המעוותת
  if (l.mesh) { const r = aabb(deformSamples(l, m, b)); return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }]; }
  if (l.quad) return deformCorners(l, m, b);
  return [
    apply(m, { x: b.x, y: b.y }), apply(m, { x: b.x + b.w, y: b.y }),
    apply(m, { x: b.x + b.w, y: b.y + b.h }), apply(m, { x: b.x, y: b.y + b.h }),
  ];
}

export function layerBounds(l: Layer): Rect | null {
  if (isXf(l)) return l.warp || l.mesh ? aabb([...layerQuad(l), ...deformSamples(l, layerMatrix(l), localBox(l))]) : aabb(layerQuad(l));
  if (l.type === 'group') {
    // משטח עבודה: התוכן נחתך לגבולות המשטח, ולכן התיבה שלו היא המלבן עצמו
    if (l.artboard) return { x: l.artboard.x, y: l.artboard.y, w: l.artboard.w, h: l.artboard.h };
    let r: Rect | null = null;
    for (const c of l.children) {
      const b = layerBounds(c);
      if (b) r = r ? { x: Math.min(r.x, b.x), y: Math.min(r.y, b.y), w: Math.max(r.x + r.w, b.x + b.w) - Math.min(r.x, b.x), h: Math.max(r.y + r.h, b.y + b.h) - Math.min(r.y, b.y) } : b;
    }
    return r;
  }
  return null;
}

/* ---------- מאגר קנבסים לכל מעבר רינדור ---------- */

class Pool {
  private free = new Map<string, HTMLCanvasElement[]>();
  private used: Array<[string, HTMLCanvasElement]> = [];
  get(w: number, h: number) {
    const k = `${w}x${h}`;
    const list = this.free.get(k);
    const c = list?.pop() ?? newCanvas(w, h);
    const x = c.getContext('2d')!;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, w, h);
    this.used.push([k, c]);
    return c;
  }
  reset() {
    for (const [k, c] of this.used) {
      if (!this.free.has(k)) this.free.set(k, []);
      const l = this.free.get(k)!;
      if (l.length < 24) l.push(c);
    }
    this.used = [];
  }
}
const pool = new Pool();

/* ---------- ציור תוכן במרחב המקומי ---------- */

/** shape='path': ממרחב הנתיב (vw×vh) לפיקסלים המקומיים (w×h) */
export function pathViewMat(l: Pick<ShapeLayer, 'w' | 'h' | 'vw' | 'vh'>): Mat {
  return { a: l.w / Math.max(1e-6, l.vw ?? l.w), b: 0, c: 0, d: l.h / Math.max(1e-6, l.vh ?? l.h), e: 0, f: 0 };
}

export function shapePath(ctx: CanvasRenderingContext2D, l: Pick<ShapeLayer, 'shape' | 'w' | 'h' | 'radius' | 'sides'> & Partial<Pick<ShapeLayer, 'subs' | 'vw' | 'vh'>>) {
  const { w, h } = l;
  ctx.beginPath();
  switch (l.shape) {
    case 'path':
      // נקודות ממופות (לא ctx.scale) — עובי הקו לא מתעוות במתיחה
      traceSubs(ctx, l.subs ?? [], pathViewMat(l));
      break;
    case 'rect': {
      const r = Math.min(l.radius, w / 2, h / 2);
      if (r > 0) ctx.roundRect(0, 0, w, h, r);
      else ctx.rect(0, 0, w, h);
      break;
    }
    case 'ellipse':
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'line':
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      break;
    case 'triangle':
      ctx.moveTo(w / 2, 0); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      break;
    case 'polygon':
    case 'star': {
      const n = Math.max(3, Math.round(l.sides));
      const pts = l.shape === 'star' ? n * 2 : n;
      for (let i = 0; i < pts; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / pts;
        const k = l.shape === 'star' && i % 2 ? 0.45 : 1;
        const x = w / 2 + Math.cos(a) * (w / 2) * k, y = h / 2 + Math.sin(a) * (h / 2) * k;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
      break;
    }
  }
}

function drawShape(ctx: CanvasRenderingContext2D, l: ShapeLayer) {
  shapePath(ctx, l);
  const f = l.fill;
  if (l.shape === 'line') {
    ctx.strokeStyle = f.type === 'none' ? l.stroke.color : f.color;
    ctx.lineWidth = Math.max(1, l.h);
    ctx.lineCap = 'round';
    ctx.stroke();
    return;
  }
  if (f.type !== 'none') {
    if (f.type === 'solid') ctx.fillStyle = f.color;
    else {
      let g: CanvasGradient;
      if (f.type === 'linear') {
        const a = (f.angle * Math.PI) / 180, cx = l.w / 2, cy = l.h / 2;
        const r = Math.abs(Math.cos(a) * l.w / 2) + Math.abs(Math.sin(a) * l.h / 2);
        g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy + Math.sin(a) * r, cx + Math.cos(a) * r, cy - Math.sin(a) * r);
      } else g = ctx.createRadialGradient(l.w / 2, l.h / 2, 0, l.w / 2, l.h / 2, Math.max(l.w, l.h) / 2);
      g.addColorStop(0, f.color);
      g.addColorStop(1, f.color2);
      ctx.fillStyle = g;
    }
    ctx.fill();
  }
  if (l.stroke.on && l.stroke.width > 0) {
    ctx.strokeStyle = l.stroke.color;
    ctx.lineWidth = l.stroke.width;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

export interface RenderOpts {
  scale: number;
  /** שכבות להסתרה (טקסט שנערך כרגע על הקנבס) */
  hide?: Set<string>;
  /** ציור חי: תמונת פיקסלים/מסכה זמנית לשכבה */
  live?: { layerId: string; target: 'pixels' | 'mask'; canvas: HTMLCanvasElement } | null;
  /** פיקסלים צפים (Move עם בחירה) — במרחב המסמך, מעל השכבה */
  floating?: { layerId: string; canvas: HTMLCanvasElement; dx: number; dy: number } | null;
  /** בלי אפקטים ושכבות התאמה — לרינדור מהיר במיוחד */
  draft?: boolean;
}

/* ---------- Mipmaps: הקטנה איכותית פעם אחת לכל קנבס, לא בכל ציור ---------- */

const mipCache = new WeakMap<HTMLCanvasElement, Map<number, HTMLCanvasElement>>();
/**
 * גרסה מוקטנת מראש של קנבס גדול, בחזקה של 2 שגדולה או שווה ל-k (פיקסלי יעד לפיקסל מקור).
 * הקטנה ב-imageSmoothingQuality 'high' של תמונה של 8 מגה-פיקסל עולה עשרות מילישניות בכל ציור;
 * הקנבסים לא משתנים במקום (copy-on-write), ולכן המטמון לפי זהות הקנבס בטוח.
 */
export function mipFor(src: HTMLCanvasElement, k: number): HTMLCanvasElement {
  if (!(k < 0.5) || src.width * src.height < 512 * 512) return src;
  let lvl = 0.5;
  while (lvl / 2 >= k && lvl > 1 / 64) lvl /= 2;
  let m = mipCache.get(src);
  if (!m) { m = new Map(); mipCache.set(src, m); }
  const hit = m.get(lvl);
  if (hit) return hit;
  const prev = lvl >= 0.5 ? src : mipFor(src, lvl * 2);
  const c = newCanvas(Math.max(1, Math.round(src.width * lvl)), Math.max(1, Math.round(src.height * lvl)));
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.drawImage(prev, 0, 0, c.width, c.height);
  m.set(lvl, c);
  return c;
}
const devScaleOf = (ctx: CanvasRenderingContext2D) => { const t = ctx.getTransform(); return Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)); };

export function drawLayerContent(ctx: CanvasRenderingContext2D, l: XfLayer, o: RenderOpts) {
  if (l.type === 'raster') {
    if (o.live && o.live.layerId === l.id && o.live.target === 'pixels') ctx.drawImage(o.live.canvas, 0, 0);
    else ctx.drawImage(mipFor(l.canvas, devScaleOf(ctx)), 0, 0, l.canvas.width, l.canvas.height);
  }
  else if (l.type === 'shape') drawShape(ctx, l);
  else drawText(ctx, l);
}

/** שכבה לא-אפינית (Distort/Warp/Puppet): ctx במרחב המסמך; devScale = פיקסלי מכשיר ליחידת מסמך */
export function drawLayerDeformed(ctx: CanvasRenderingContext2D, l: XfLayer, o: RenderOpts, devScale: number) {
  const raster = l.type === 'raster' ? (o.live && o.live.layerId === l.id && o.live.target === 'pixels' ? o.live.canvas : l.canvas) : null;
  const pad = l.type === 'shape' ? Math.ceil((l.stroke.on ? l.stroke.width / 2 : 0) + 2) : l.type === 'text' ? Math.ceil(l.style.size * 0.25) : 0;
  drawDeformed(ctx, l, layerMatrix(l), localBox(l), devScale, raster, (x) => drawLayerContent(x, l, { scale: devScale }), pad);
}

const maskOf = (l: Layer, o: RenderOpts): Mask | null => {
  if (o.live && o.live.layerId === l.id && o.live.target === 'mask') return { canvas: effectiveMask({ ...(l.mask ?? { enabled: true }), canvas: o.live.canvas }), enabled: true };
  return l.mask && l.mask.enabled ? { canvas: effectiveMask(l.mask), enabled: true } : null;
};

/* ---------- Density / Feather של מסכה (לא הרסני, עם מטמון לפי קנבס וערכים) ---------- */

const effCache = new WeakMap<HTMLCanvasElement, { d: number; f: number; c: HTMLCanvasElement }>();

/** המסכה כפי שהיא חלה בפועל: ריכוך (Feather) ואז צפיפות (Density: 0 = לא מסתירה כלום) */
export function effectiveMask(m: Pick<Mask, 'canvas' | 'density' | 'feather'>): HTMLCanvasElement {
  const d = m.density ?? 1, f = m.feather ?? 0;
  if (d >= 1 && f <= 0) return m.canvas;
  const hit = effCache.get(m.canvas);
  if (hit && hit.d === d && hit.f === f) return hit.c;
  const w = m.canvas.width, h = m.canvas.height;
  let c = m.canvas;
  if (f > 0) {
    // ריפוד בהמשך הקצוות, כדי שמסכה שחושפת הכול לא תדהה בשולי המסמך
    const p = Math.ceil(f * 2.5) + 1;
    const big = newCanvas(w + 2 * p, h + 2 * p), bx = big.getContext('2d')!;
    bx.drawImage(c, p, p);
    bx.drawImage(c, 0, 0, 1, h, 0, p, p, h);
    bx.drawImage(c, w - 1, 0, 1, h, w + p, p, p, h);
    bx.drawImage(c, 0, 0, w, 1, p, 0, w, p);
    bx.drawImage(c, 0, h - 1, w, 1, p, h + p, w, p);
    bx.drawImage(c, 0, 0, 1, 1, 0, 0, p, p);
    bx.drawImage(c, w - 1, 0, 1, 1, w + p, 0, p, p);
    bx.drawImage(c, 0, h - 1, 1, 1, 0, h + p, p, p);
    bx.drawImage(c, w - 1, h - 1, 1, 1, w + p, h + p, p, p);
    const bl = blurCanvas(big, f);
    c = newCanvas(w, h);
    c.getContext('2d')!.drawImage(bl, -p, -p);
  }
  if (d < 1) {
    const o = newCanvas(w, h), x = o.getContext('2d')!;
    x.fillStyle = `rgba(255,255,255,${1 - d})`;
    x.fillRect(0, 0, w, h);
    x.globalAlpha = d;
    x.globalCompositeOperation = 'lighter';
    x.drawImage(c, 0, 0);
    c = o;
  }
  effCache.set(m.canvas, { d, f, c });
  return c;
}

/** שכבה אחת (או קבוצה) כקנבס בגודל המסמך, אחרי מסכה ואפקטים — לפני מיזוג */
function renderLayer(l: Layer, doc: Doc, o: RenderOpts): HTMLCanvasElement | null {
  const W = Math.round(doc.width * o.scale), H = Math.round(doc.height * o.scale);
  let c: HTMLCanvasElement;
  if (l.type === 'group') {
    c = pool.get(W, H);
    const ab = l.artboard;
    // משטח עבודה: רקע מתחת לילדים (כדי שמצבי מיזוג יחולו עליו), ואז חיתוך לגבולות המשטח
    const s = o.scale, abx = ab ? ab.x * s : 0, aby = ab ? ab.y * s : 0, abw = ab ? ab.w * s : 0, abh = ab ? ab.h * s : 0;
    if (ab && ab.bg !== 'transparent') {
      const x = c.getContext('2d')!;
      x.fillStyle = ab.bg === 'white' ? '#ffffff' : ab.bg === 'black' ? '#000000' : ab.bg;
      x.fillRect(abx, aby, abw, abh);
    }
    renderList(l.children, doc, o, c);
    if (ab) {
      const x = c.getContext('2d')!;
      x.globalCompositeOperation = 'destination-in';
      x.fillStyle = '#000';
      x.fillRect(abx, aby, abw, abh);
      x.globalCompositeOperation = 'source-over';
    }
  } else if (isXf(l)) {
    c = pool.get(W, H);
    const x = c.getContext('2d')!;
    const m = layerMatrix(l);
    x.imageSmoothingQuality = 'high';
    if (isDeformed(l)) { x.setTransform(o.scale, 0, 0, o.scale, 0, 0); drawLayerDeformed(x, l, o, o.scale); }
    else { x.setTransform(new DOMMatrix().scaleSelf(o.scale, o.scale).multiplySelf(m)); drawLayerContent(x, l, o); }
    if (o.floating && o.floating.layerId === l.id) {
      x.setTransform(o.scale, 0, 0, o.scale, 0, 0);
      x.drawImage(o.floating.canvas, o.floating.dx, o.floating.dy);
    }
    x.setTransform(1, 0, 0, 1, 0, 0);
  } else return null;

  const mask = maskOf(l, o);
  if (mask) {
    const x = c.getContext('2d')!;
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(mipFor(mask.canvas, W / mask.canvas.width), 0, 0, W, H);
    x.globalCompositeOperation = 'source-over';
  }
  // Vector Mask: חיתוך לפי נתיב במרחב המסמך (אחרי מסכת הפיקסלים, לפני אפקטים — כמו בפוטושופ)
  if (l.vmask?.enabled) {
    const x = c.getContext('2d')!;
    x.setTransform(o.scale, 0, 0, o.scale, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    x.fillStyle = '#000';
    x.beginPath();
    traceSubs(x, l.vmask.subs);
    x.fill('nonzero');
    x.globalCompositeOperation = 'source-over';
    x.setTransform(1, 0, 0, 1, 0, 0);
  }
  if (!o.draft && hasEffects(l.fx)) c = withEffects(c, l, o);
  return c;
}

function silhouette(src: HTMLCanvasElement, color: string, alpha = 1) {
  const s = pool.get(src.width, src.height), x = s.getContext('2d')!;
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = rgba(color, alpha);
  x.fillRect(0, 0, s.width, s.height);
  x.globalCompositeOperation = 'source-over';
  return s;
}

function withEffects(content: HTMLCanvasElement, l: Layer, o: RenderOpts): HTMLCanvasElement {
  const { width: W, height: H } = content;
  const fx = l.fx, s = o.scale;
  const out = pool.get(W, H), x = out.getContext('2d')!;
  const far = W + H + 200;
  if (fx.shadow.on) {
    const a = (fx.shadow.angle * Math.PI) / 180;
    x.save();
    x.shadowColor = rgba(fx.shadow.color, fx.shadow.opacity);
    x.shadowBlur = fx.shadow.blur * s;
    x.shadowOffsetX = -Math.cos(a) * fx.shadow.distance * s + far;
    x.shadowOffsetY = Math.sin(a) * fx.shadow.distance * s;
    x.drawImage(content, -far, 0);
    x.restore();
  }
  if (fx.glow.on) {
    x.save();
    x.shadowColor = rgba(fx.glow.color, fx.glow.opacity);
    x.shadowBlur = fx.glow.size * s;
    x.shadowOffsetX = far;
    x.drawImage(content, -far, 0);
    x.drawImage(content, -far, 0);
    x.restore();
  }
  if (fx.stroke.on && fx.stroke.width > 0) {
    const st = pool.get(W, H), sx = st.getContext('2d')!;
    if (l.type === 'text' && !(l.mask && l.mask.enabled) && !isDeformed(l)) {
      sx.setTransform(new DOMMatrix().scaleSelf(s, s).multiplySelf(layerMatrix(l)));
      drawText(sx, l, fx.stroke.color, { width: fx.stroke.width, color: fx.stroke.color });
      sx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      const sil = silhouette(content, fx.stroke.color);
      const r = fx.stroke.width * s;
      for (const k of r > 6 ? [1, 0.7, 0.4] : [1]) {
        const steps = Math.min(64, Math.max(12, Math.round(r * k * 3)));
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          sx.drawImage(sil, Math.cos(a) * r * k, Math.sin(a) * r * k);
        }
      }
    }
    x.globalAlpha = fx.stroke.opacity;
    x.drawImage(st, 0, 0);
    x.globalAlpha = 1;
  }
  x.drawImage(content, 0, 0);
  if (fx.overlay.on) x.drawImage(silhouette(content, fx.overlay.color, fx.overlay.opacity), 0, 0);
  return out;
}

function adjustInto(target: HTMLCanvasElement, l: AdjustLayer, doc: Doc, o: RenderOpts) {
  const x = target.getContext('2d')!;
  const img = x.getImageData(0, 0, target.width, target.height);
  applyAdjust(img, l.kind, l.p);
  const mask = maskOf(l, o);
  if (!mask && l.opacity >= 1) { x.putImageData(img, 0, 0); return; }
  const a = pool.get(target.width, target.height), ax = a.getContext('2d')!;
  ax.putImageData(img, 0, 0);
  if (mask) {
    ax.globalCompositeOperation = 'destination-in';
    ax.drawImage(mipFor(mask.canvas, a.width / mask.canvas.width), 0, 0, a.width, a.height);
  }
  x.globalAlpha = l.opacity;
  x.globalCompositeOperation = 'source-atop';
  x.drawImage(a, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  void doc;
}

/** האם אפשר לצייר את השכבה ישר ליעד — אותה תוצאה בדיוק כמו דרך קנבס ביניים */
function canDrawDirect(l: Layer, next: Layer | undefined, o: RenderOpts): boolean {
  if (!isXf(l) || isDeformed(l) || next?.clip) return false;
  if (maskOf(l, o) || l.vmask?.enabled) return false;
  if (!o.draft && hasEffects(l.fx)) return false;
  if (o.floating && o.floating.layerId === l.id) return false;
  // טקסט וצורה מצוירים בכמה משיכות שחופפות זו לזו — שקיפות או מצב מיזוג חייבים קנבס ביניים
  return l.type === 'raster' || (l.opacity >= 1 && gco(l.blend) === 'source-over');
}

function renderList(layers: Layer[], doc: Doc, o: RenderOpts, target: HTMLCanvasElement) {
  const tx = target.getContext('2d')!;
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (l.clip && i > 0 && layers[i - 1] && !(layers[i - 1].type === 'adjust' && !layers[i - 1].clip)) continue;
    if (!l.visible || o.hide?.has(l.id)) {
      // הסתרת בסיס מסתירה גם את השכבות שחתוכות אליו
      continue;
    }
    if (l.type === 'adjust') {
      if (!o.draft) adjustInto(target, l, doc, o);
      continue;
    }
    if (canDrawDirect(l, layers[i + 1], o)) {
      // שכבה פשוטה (בלי מסכה, אפקטים או שכבות חתוכות): ישר ליעד, בלי קנבס ביניים בגודל המסמך
      tx.save();
      tx.globalAlpha = l.opacity;
      tx.globalCompositeOperation = gco(l.blend);
      tx.imageSmoothingQuality = 'high';
      tx.setTransform(new DOMMatrix().scaleSelf(o.scale, o.scale).multiplySelf(layerMatrix(l as XfLayer)));
      drawLayerContent(tx, l as XfLayer, o);
      tx.restore();
      continue;
    }
    const b = renderLayer(l, doc, o);
    if (!b) continue;
    for (let j = i + 1; j < layers.length && layers[j].clip; j++) {
      const cl = layers[j];
      if (!cl.visible || o.hide?.has(cl.id)) continue;
      if (cl.type === 'adjust') { if (!o.draft) adjustInto(b, cl, doc, o); continue; }
      const lc = renderLayer(cl, doc, o);
      if (!lc) continue;
      const lx = lc.getContext('2d')!;
      lx.globalCompositeOperation = 'destination-in';
      lx.drawImage(b, 0, 0);
      lx.globalCompositeOperation = 'source-over';
      const bx = b.getContext('2d')!;
      bx.globalAlpha = cl.opacity;
      bx.globalCompositeOperation = gco(cl.blend);
      bx.drawImage(lc, 0, 0);
      bx.globalAlpha = 1;
      bx.globalCompositeOperation = 'source-over';
    }
    tx.globalAlpha = l.opacity;
    tx.globalCompositeOperation = gco(l.blend);
    tx.drawImage(b, 0, 0);
    tx.globalAlpha = 1;
    tx.globalCompositeOperation = 'source-over';
  }
}

/** מרכיב את כל המסמך לתוך target (שיוגדל לגודל המסמך כפול scale) */
export function renderDoc(doc: Doc, o: RenderOpts, target?: HTMLCanvasElement): HTMLCanvasElement {
  const W = Math.max(1, Math.round(doc.width * o.scale)), H = Math.max(1, Math.round(doc.height * o.scale));
  const out = target ?? newCanvas(W, H);
  if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
  const x = out.getContext('2d')!;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, W, H);
  try {
    renderList(doc.layers, doc, o, out);
  } finally {
    pool.reset();
  }
  return out;
}

/** שכבה בודדת כקנבס בגודל המסמך (להמרה לפיקסלים, מיזוג, ייצוא SVG) */
export function renderSingle(l: Layer, doc: Doc, scale = 1): HTMLCanvasElement {
  const tmp: Doc = { ...doc, layers: [{ ...l, visible: true, clip: false }] as Layer[] };
  return renderDoc(tmp, { scale });
}

/** תמונה ממוזערת של שכבה (לפאנל) */
export function drawThumb(l: Layer, doc: Doc, c: HTMLCanvasElement) {
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, c.width, c.height);
  const k = Math.min(c.width / doc.width, c.height / doc.height);
  const w = doc.width * k, h = doc.height * k;
  x.save();
  x.translate((c.width - w) / 2, (c.height - h) / 2);
  x.scale(k, k);
  if (isXf(l)) {
    if (isDeformed(l)) drawLayerDeformed(x, l, { scale: k }, k);
    else { x.transform(...matrixArgs(layerMatrix(l))); drawLayerContent(x, l, { scale: k }); }
  } else if (l.type === 'group') {
    const r = renderDoc({ ...doc, layers: l.children }, { scale: k, draft: true });
    x.setTransform(1, 0, 0, 1, (c.width - w) / 2, (c.height - h) / 2);
    x.drawImage(r, 0, 0);
  }
  x.restore();
}

export const matrixArgs = (m: DOMMatrix): [number, number, number, number, number, number] => [m.a, m.b, m.c, m.d, m.e, m.f];

export { cornersOf };
