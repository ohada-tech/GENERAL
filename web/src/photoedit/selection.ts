/**
 * Selection Engine — בחירה כמסכת אלפא בגודל המסמך. כל פעולה מחזירה קנבס חדש (לא משנה במקום),
 * כדי שההיסטוריה תוכל לשמור הפניה זולה. כולל קווי "נמלים צועדות" שמחושבים פעם אחת לכל בחירה.
 */
import type { Doc, Pt, Rect } from './model';
import { ctx2d, newCanvas } from './model';
import { blurCanvas } from './adjust';

export type SelMode = 'new' | 'add' | 'sub' | 'int';

export function combine(doc: Doc, shape: HTMLCanvasElement, mode: SelMode): HTMLCanvasElement | null {
  if (mode === 'new' || !doc.selection) {
    if (mode === 'sub' || mode === 'int') return mode === 'sub' ? doc.selection : null;
    return isEmpty(shape) ? null : shape;
  }
  const out = newCanvas(doc.width, doc.height), x = out.getContext('2d')!;
  x.drawImage(doc.selection, 0, 0);
  x.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'sub' ? 'destination-out' : 'destination-in';
  x.drawImage(shape, 0, 0);
  return isEmpty(out) ? null : out;
}

export function shapeCanvas(doc: Doc, draw: (x: CanvasRenderingContext2D) => void, feather = 0): HTMLCanvasElement {
  const c = newCanvas(doc.width, doc.height), x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  x.beginPath();
  draw(x);
  x.fill();
  return feather > 0 ? blurCanvas(c, feather) : c;
}

export const rectSel = (doc: Doc, r: Rect, ellipse: boolean, feather = 0) =>
  shapeCanvas(doc, (x) => (ellipse ? x.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.abs(r.w / 2), Math.abs(r.h / 2), 0, 0, Math.PI * 2) : x.rect(r.x, r.y, r.w, r.h)), feather);

export const polySel = (doc: Doc, pts: Pt[], feather = 0) =>
  shapeCanvas(doc, (x) => { pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); }, feather);

export function allSel(doc: Doc) {
  const c = newCanvas(doc.width, doc.height), x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

export function invertSel(doc: Doc): HTMLCanvasElement | null {
  const c = allSel(doc);
  if (doc.selection) {
    const x = c.getContext('2d')!;
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(doc.selection, 0, 0);
  }
  return isEmpty(c) ? null : c;
}

const emptyCache = new WeakMap<HTMLCanvasElement, boolean>();
export function isEmpty(c: HTMLCanvasElement) {
  if (emptyCache.has(c)) return emptyCache.get(c)!;
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  let empty = true;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) { empty = false; break; }
  emptyCache.set(c, empty);
  return empty;
}

const boundsCache = new WeakMap<HTMLCanvasElement, Rect | null>();
export function selBounds(c: HTMLCanvasElement): Rect | null {
  if (boundsCache.has(c)) return boundsCache.get(c)!;
  const { width: w, height: h } = c;
  const d = ctx2d(c).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const r = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  boundsCache.set(c, r);
  return r;
}

/** קטעי הגבול של הבחירה (על קצוות הפיקסלים), מאוחדים לריצות — לציור חד בכל זום */
const edgeCache = new WeakMap<HTMLCanvasElement, Float32Array>();
export function selEdges(c: HTMLCanvasElement): Float32Array {
  const hit = edgeCache.get(c);
  if (hit) return hit;
  const { width: w, height: h } = c;
  const d = ctx2d(c).getImageData(0, 0, w, h).data;
  const inside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inside[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  const segs: number[] = [];
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : inside[y * w + x]);
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const e = x < w && at(x, y) !== at(x, y - 1);
      if (e && start < 0) start = x;
      if (!e && start >= 0) { segs.push(start, y, x, y); start = -1; }
    }
  }
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const e = y < h && at(x, y) !== at(x - 1, y);
      if (e && start < 0) start = y;
      if (!e && start >= 0) { segs.push(x, start, x, y); start = -1; }
    }
  }
  const out = new Float32Array(segs);
  edgeCache.set(c, out);
  return out;
}

/** Magic Wand: מילוי לפי סבולת צבע מתמונת מקור */
export function wandSel(doc: Doc, src: HTMLCanvasElement, p: Pt, tolerance: number, contiguous: boolean): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const d = ctx2d(src, true).getImageData(0, 0, w, h).data;
  const sx = Math.floor(p.x), sy = Math.floor(p.y);
  const out = newCanvas(w, h), ox = out.getContext('2d')!;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
  const i0 = (sy * w + sx) * 4;
  const r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2], a0 = d[i0 + 3];
  const match = (i: number) => Math.abs(d[i] - r0) <= tolerance && Math.abs(d[i + 1] - g0) <= tolerance && Math.abs(d[i + 2] - b0) <= tolerance && Math.abs(d[i + 3] - a0) <= tolerance;
  const img = ox.createImageData(w, h), o = img.data;
  const mark = (k: number) => { o[k * 4] = o[k * 4 + 1] = o[k * 4 + 2] = 255; o[k * 4 + 3] = 255; };
  if (!contiguous) {
    for (let k = 0; k < w * h; k++) if (match(k * 4)) mark(k);
  } else {
    const seen = new Uint8Array(w * h);
    const stack = [sy * w + sx];
    while (stack.length) {
      const k = stack.pop()!;
      if (seen[k]) continue;
      seen[k] = 1;
      if (!match(k * 4)) continue;
      mark(k);
      const x = k % w, y = (k / w) | 0;
      if (x > 0) stack.push(k - 1);
      if (x < w - 1) stack.push(k + 1);
      if (y > 0) stack.push(k - w);
      if (y < h - 1) stack.push(k + w);
    }
  }
  ox.putImageData(img, 0, 0);
  void doc;
  return out;
}

export const featherSel = (c: HTMLCanvasElement, r: number) => blurCanvas(c, r);

/** הרחבה/כיווץ בפיקסלים (dilate/erode בקירוב) */
export function growSel(doc: Doc, c: HTMLCanvasElement, px: number): HTMLCanvasElement | null {
  const grow = (src: HTMLCanvasElement, r: number) => {
    const out = newCanvas(src.width, src.height), x = out.getContext('2d')!;
    const steps = Math.min(48, Math.max(8, Math.round(r * 3)));
    x.drawImage(src, 0, 0);
    for (let i = 0; i < steps; i++) { const a = (i / steps) * Math.PI * 2; x.drawImage(src, Math.cos(a) * r, Math.sin(a) * r); }
    return out;
  };
  if (px >= 0) return grow(c, px);
  const inv = invertSel({ ...doc, selection: c });
  if (!inv) return c;
  const g = grow(inv, -px);
  return invertSel({ ...doc, selection: g });
}
