/**
 * גשר בין אלגוריתמי הבחירה הטהורים (selection-algo.ts) לבין קנבסים: המרות אלפא⇄קנבס, מקור פיקסלים במטמון,
 * ושכבות התצוגה על הקנבס — Quick Mask אדום, תצוגה מקדימה של Select and Mask, ומסכה לבד / Overlay אדום (\).
 */
import type { Editor } from './editor';
import type { Doc, Layer } from './model';
import { ctx2d, newCanvas, walk } from './model';
import { effectiveMask, renderDoc, renderSingle } from './render';
import { sobel } from './selection-algo';

/* ---------- המרות ---------- */

/** ערוץ האלפא של קנבס כמערך (ערך אחד לפיקסל) */
export function alphaOf(c: HTMLCanvasElement): Uint8ClampedArray {
  const d = ctx2d(c, true).getImageData(0, 0, c.width, c.height).data;
  const out = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3];
  return out;
}

/** מסכת אלפא → קנבס לבן עם האלפא הזה (הפורמט של בחירה ומסכה במערכת) */
export function canvasFromAlpha(a: ArrayLike<number>, w: number, h: number): HTMLCanvasElement {
  const c = newCanvas(w, h), x = c.getContext('2d')!;
  const img = x.createImageData(w, h), o = img.data;
  for (let i = 0; i < a.length; i++) { const j = i * 4; o[j] = o[j + 1] = o[j + 2] = 255; o[j + 3] = a[i]; }
  x.putImageData(img, 0, 0);
  return c;
}

/** עדכון אזור בקנבס מתוך מסכת אלפא (לתצוגה חיה בזמן מריחה) */
export function blitAlpha(c: HTMLCanvasElement, a: ArrayLike<number>, x0: number, y0: number, x1: number, y1: number) {
  const w = c.width, bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (bw <= 0 || bh <= 0) return;
  const x = c.getContext('2d')!;
  const img = x.createImageData(bw, bh), o = img.data;
  for (let y = 0; y < bh; y++) for (let xx = 0; xx < bw; xx++) { const v = a[(y + y0) * w + xx + x0], j = (y * bw + xx) * 4; o[j] = o[j + 1] = o[j + 2] = 255; o[j + 3] = v; }
  x.putImageData(img, x0, y0);
}

export function pixelsOf(c: HTMLCanvasElement): Uint8ClampedArray {
  return ctx2d(c, true).getImageData(0, 0, c.width, c.height).data;
}

/* ---------- מקור פיקסלים וגרדיאנט במטמון (לפי גרסאות השכבות) ---------- */

let srcCache: { key: string; px: Uint8ClampedArray; grad: Float32Array | null; w: number; h: number } | null = null;

function docKey(doc: Doc, allLayers: boolean, active: Layer | null) {
  const revs: number[] = [];
  walk(doc.layers, (l) => revs.push(l.rev, l.visible ? 1 : 0));
  return `${doc.id}|${doc.width}x${doc.height}|${allLayers ? 'all' : active?.id ?? '-'}|${revs.join(',')}`;
}

/** הפיקסלים שהכלים דוגמים: הקומפוזיציה (Sample All Layers) או השכבה הפעילה */
export function sourceFor(ed: Editor, allLayers: boolean, withGrad: boolean) {
  const d = ed.doc!, a = ed.active;
  const useAll = allLayers || !a || a.type === 'adjust';
  const key = docKey(d, useAll, a);
  if (!srcCache || srcCache.key !== key) {
    const c = useAll ? renderDoc(d, { scale: 1 }) : renderSingle(a!, d);
    srcCache = { key, px: pixelsOf(c), grad: null, w: d.width, h: d.height };
  }
  if (withGrad && !srcCache.grad) srcCache.grad = sobel(srcCache.px, srcCache.w, srcCache.h);
  return srcCache as { key: string; px: Uint8ClampedArray; grad: Float32Array; w: number; h: number };
}

/* ---------- שכבות תצוגה על הקנבס ---------- */

const redCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
let redNull: HTMLCanvasElement | null = null;

/** אדום מלא מחוץ לאלפא (מה שלא נבחר / מה שהמסכה מסתירה) */
export function redOutside(c: HTMLCanvasElement | null, w: number, h: number): HTMLCanvasElement {
  if (!c) {
    if (!redNull || redNull.width !== w || redNull.height !== h) { redNull = newCanvas(w, h); const x = redNull.getContext('2d')!; x.fillStyle = '#ff0000'; x.fillRect(0, 0, w, h); }
    return redNull;
  }
  const hit = redCache.get(c);
  if (hit) return hit;
  const o = newCanvas(c.width, c.height), x = o.getContext('2d')!;
  x.fillStyle = '#ff0000';
  x.fillRect(0, 0, o.width, o.height);
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(c, 0, 0);
  redCache.set(c, o);
  return o;
}

const grayCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
/** המסכה לבד בגווני אפור: שחור = מוסתר, לבן = נראה */
export function grayOf(c: HTMLCanvasElement): HTMLCanvasElement {
  const hit = grayCache.get(c);
  if (hit) return hit;
  const o = newCanvas(c.width, c.height), x = o.getContext('2d')!;
  x.fillStyle = '#000';
  x.fillRect(0, 0, o.width, o.height);
  const t = newCanvas(c.width, c.height), tx = t.getContext('2d')!;
  tx.drawImage(c, 0, 0);
  tx.globalCompositeOperation = 'source-in';
  tx.fillStyle = '#fff';
  tx.fillRect(0, 0, t.width, t.height);
  x.drawImage(t, 0, 0);
  grayCache.set(c, o);
  return o;
}

const onBgCache = new WeakMap<HTMLCanvasElement, { key: string; c: HTMLCanvasElement }>();
/** הקומפוזיציה דרך הבחירה, על רקע שחור או לבן (Select and Mask: On Black / On White) */
function onBackground(comp: HTMLCanvasElement, sel: HTMLCanvasElement, bg: string): HTMLCanvasElement {
  const key = `${bg}|${comp.width}x${comp.height}`;
  const hit = onBgCache.get(sel);
  if (hit && hit.key === key) return hit.c;
  const m = newCanvas(comp.width, comp.height), mx = m.getContext('2d')!;
  mx.drawImage(comp, 0, 0);
  mx.globalCompositeOperation = 'destination-in';
  mx.drawImage(sel, 0, 0, m.width, m.height);
  const o = newCanvas(comp.width, comp.height), x = o.getContext('2d')!;
  x.fillStyle = bg;
  x.fillRect(0, 0, o.width, o.height);
  x.drawImage(m, 0, 0);
  onBgCache.set(sel, { key, c: o });
  return o;
}

/** מצויר מעל המסמך ב-Editor.paint — לפני הנמלים */
export function paintSelectionOverlays(ed: Editor, x: CanvasRenderingContext2D, z: number, dx: number, dy: number) {
  const st = ed.st, d = ed.doc;
  if (!st || !d) return;
  const W = d.width * z, H = d.height * z;
  const mv = ed.live.maskView, sp = ed.live.selPreview;
  const ml = mv ? ed.layer(mv.layerId) : null;
  if (!st.qmask && !sp && !(ml && ml.mask)) return;
  x.save();
  x.beginPath();
  x.rect(dx, dy, W, H);
  x.clip();
  x.imageSmoothingEnabled = z < 2;
  if (ml?.mask && mv) {
    const live = ed.live.paint && ed.live.paint.layerId === ml.id && ed.live.paint.target === 'mask' ? ed.live.paint.canvas : null;
    const m = effectiveMask(live ? { ...ml.mask, canvas: live } : ml.mask);
    if (mv.mode === 'alone') x.drawImage(grayOf(m), dx, dy, W, H);
    else { x.globalAlpha = 0.5; x.drawImage(redOutside(m, d.width, d.height), dx, dy, W, H); x.globalAlpha = 1; }
  }
  if (sp && sp.mode !== 'ants') {
    if (sp.mode === 'overlay') { x.globalAlpha = 0.5; x.drawImage(redOutside(sp.canvas, d.width, d.height), dx, dy, W, H); x.globalAlpha = 1; }
    else x.drawImage(onBackground(ed.comp, sp.canvas, sp.mode === 'black' ? '#000' : '#fff'), dx, dy, W, H);
  }
  if (st.qmask) {
    x.globalAlpha = 0.5;
    x.drawImage(redOutside(ed.live.qmask ?? d.selection, d.width, d.height), dx, dy, W, H);
    x.globalAlpha = 1;
  }
  x.restore();
}

/** איזו בחירה מקבלת נמלים צועדות: תצוגה מקדימה, אחרת הבחירה — ולא במצב Quick Mask */
export function antsSelection(ed: Editor): HTMLCanvasElement | null {
  const sp = ed.live.selPreview;
  if (sp) return sp.mode === 'ants' ? sp.canvas : null;
  if (ed.st?.qmask) return null;
  return ed.doc?.selection ?? null;
}

/** Quick Mask + Gradient: הבהירות של המעבר היא ערך הבחירה, והאלפא שלו (אטימות) היא משקל הערבוב */
export function blendLumaIntoSelection(sel: HTMLCanvasElement | null, src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const s = pixelsOf(src);
  const base = sel ? alphaOf(sel) : new Uint8ClampedArray(w * h);
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) {
    const j = i * 4, a = s[j + 3] / 255, lum = 0.299 * s[j] + 0.587 * s[j + 1] + 0.114 * s[j + 2];
    out[i] = base[i] * (1 - a) + lum * a;
  }
  return canvasFromAlpha(out, w, h);
}
