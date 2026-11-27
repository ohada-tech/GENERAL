/**
 * Pixel Stroke Engine — מנוע משותף לכלים שמעבדים את הפיקסלים שמתחת למברשת (טשטוש, הבהרה, ריפוי, מחק רקע, מברשת היסטוריה…).
 * עובד במרחב המקומי של השכבה (כמו מנוע ה-Stroke של המברשת), עם תצוגה חיה דרך ed.live.paint.
 * copy-on-write: הקנבס החי נוצר חדש בתחילת המשיחה ומוצב בשכבה רק בסיום — קנבס שבהיסטוריה לא משתנה.
 */
import type { Editor } from './editor';
import type { PtrEvt, Tool, ToolId } from './tools';
import type { Pt, RasterLayer } from './model';
import { apply, copyCanvas, ctx2d, newCanvas, touch } from './model';
import { layerMatrix, renderDoc } from './render';
import type { Dab, Img, Rct } from './pixel-algo';
import { dabRect, unionRct } from './pixel-algo';

export interface PxStroke {
  layerId: string;
  target: 'pixels' | 'mask';
  live: HTMLCanvasElement;
  inv: DOMMatrix;
  /** סקאלה מפיקסל מסמך לפיקסל מקומי */
  scale: number;
  img: Img;
  /** הפיקסלים כפי שהיו בתחילת המשיחה */
  orig: Uint8ClampedArray;
  /** אלפא הבחירה במרחב המקומי (null = אין בחירה) */
  sel: Uint8Array | null;
  /** מקור דגימה: Sample All Layers = הקומפוזיציה במרחב המקומי; אחרת null (השכבה עצמה) */
  sample: Img | null;
  last: Pt;
  dirty: Rct | null;
  data: Record<string, unknown>;
}

export interface PxStartOpts {
  allowMask?: boolean;
  sampleAll?: boolean;
  /** הסבר כשהשכבה אינה שכבת פיקסלים */
  what: string;
}

export function readImg(c: HTMLCanvasElement): Img {
  const d = ctx2d(c, true).getImageData(0, 0, c.width, c.height);
  return { data: d.data, w: c.width, h: c.height };
}

/** אלפא של קנבס במרחב המסמך, ממופה למרחב המקומי של השכבה */
export function localAlpha(src: HTMLCanvasElement, inv: DOMMatrix, w: number, h: number): Uint8Array {
  const c = newCanvas(w, h), x = c.getContext('2d')!;
  x.setTransform(inv);
  x.drawImage(src, 0, 0);
  const d = ctx2d(c, true).getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3];
  return out;
}

/** קומפוזיציית המסמך במרחב המקומי של השכבה (ל-Sample All Layers) */
export function localComposite(ed: Editor, inv: DOMMatrix, w: number, h: number): Img {
  const comp = renderDoc(ed.doc!, { scale: 1 });
  const c = newCanvas(w, h), x = c.getContext('2d')!;
  x.setTransform(inv);
  x.drawImage(comp, 0, 0);
  return readImg(c);
}

/** בוחר את היעד (שכבת פיקסלים או מסכה) ומכין את המשיחה. מחזיר null עם הודעה כשאי אפשר */
export function beginPx(ed: Editor, e: { doc: Pt }, o: PxStartOpts): PxStroke | null {
  const d = ed.doc!;
  if (ed.st!.qmask) { ed.toast(`במסכה מהירה עובדים עם מברשת, מחק או מעבר צבע · Q ליציאה`, 'error'); return null; }
  const l = ed.active;
  if (!l) { ed.toast('בחר שכבה', 'error'); return null; }
  if (l.locked) { ed.toast('השכבה נעולה', 'error'); return null; }
  const maskEdit = ed.st!.maskEdit && !!l.mask;
  if (maskEdit && !o.allowMask) { ed.toast(`${o.what} עובד על פיקסלים, לא על מסכה · לחץ על התמונה הממוזערת של השכבה`, 'error'); return null; }
  if (!maskEdit && l.type !== 'raster') { ed.toast(`${o.what} עובד על שכבת פיקסלים — Layer > Rasterize`, 'error'); return null; }
  let base: HTMLCanvasElement, inv: DOMMatrix;
  if (maskEdit) { base = l.mask!.canvas; inv = new DOMMatrix(); }
  else {
    const r = l as RasterLayer;
    ed.ensureCoverage(r);
    base = r.canvas;
    inv = layerMatrix(r).inverse();
  }
  const live = copyCanvas(base);
  const img = readImg(live);
  const sel = d.selection ? localAlpha(d.selection, inv, base.width, base.height) : null;
  const ps: PxStroke = {
    layerId: l.id, target: maskEdit ? 'mask' : 'pixels', live, inv,
    scale: Math.sqrt(Math.abs(inv.a * inv.d - inv.b * inv.c)), img, orig: img.data.slice(), sel,
    sample: o.sampleAll && !maskEdit ? localComposite(ed, inv, base.width, base.height) : null,
    last: e.doc, dirty: null, data: {},
  };
  ed.beginInteract();
  return ps;
}

/** נקודת מסמך → מקומי + רדיוס מקומי */
export const toLocal = (ps: PxStroke, p: Pt) => apply(ps.inv, p);

/** טביעות לאורך הקו מהנקודה האחרונה, במרווח קבוע (בפיקסלים של המסמך) */
export function dabsTo(ps: PxStroke, p: Pt, spacing: number, fn: (docPt: Pt) => void) {
  const d = Math.hypot(p.x - ps.last.x, p.y - ps.last.y);
  const n = Math.floor(d / spacing);
  for (let i = 1; i <= n; i++) fn({ x: ps.last.x + ((p.x - ps.last.x) * i * spacing) / d, y: ps.last.y + ((p.y - ps.last.y) * i * spacing) / d });
  if (n) ps.last = { x: ps.last.x + ((p.x - ps.last.x) * n * spacing) / d, y: ps.last.y + ((p.y - ps.last.y) * n * spacing) / d };
}

export function markDirty(ps: PxStroke, R: Rct) { ps.dirty = unionRct(ps.dirty, R); }

/** מעתיק את האזור שהשתנה לקנבס החי ומרענן את התצוגה */
export function flushPx(ed: Editor, ps: PxStroke) {
  const R = ps.dirty;
  if (R && R.x1 > R.x0 && R.y1 > R.y0) {
    const id = new ImageData(ps.img.data as Uint8ClampedArray<ArrayBuffer>, ps.img.w, ps.img.h);
    ctx2d(ps.live).putImageData(id, 0, 0, R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);
  }
  ps.dirty = null;
  ed.live.paint = { layerId: ps.layerId, target: ps.target, canvas: ps.live };
  ed.redraw(true);
}

/** מסיים: הקנבס החי (חדש) נכנס לשכבה + פעולה בהיסטוריה */
export function endPx(ed: Editor, ps: PxStroke, label: string) {
  flushPx(ed, ps);
  const l = ed.layer(ps.layerId);
  ed.live.paint = null;
  ed.endInteract();
  if (!l) return;
  if (ps.target === 'mask' && l.mask) l.mask = { ...l.mask, canvas: ps.live };
  else (l as RasterLayer).canvas = ps.live;
  touch(l);
  ed.commit(label);
}

export function cancelPx(ed: Editor) {
  ed.live.paint = null;
  ed.endInteract();
  ed.redraw(true);
}

/** עיגול המברשת סביב הסמן (כמו במברשת הרגילה) */
export function drawBrushCursor(ed: Editor, x: CanvasRenderingContext2D, screen: Pt | null, sizeDoc: number) {
  if (!screen || !ed.st) return;
  const r = Math.max(1, (sizeDoc / 2) * ed.st.zoom);
  x.lineWidth = 1;
  x.strokeStyle = 'rgba(0,0,0,.7)';
  x.beginPath(); x.arc(screen.x, screen.y, r, 0, Math.PI * 2); x.stroke();
  x.strokeStyle = 'rgba(255,255,255,.8)';
  x.beginPath(); x.arc(screen.x, screen.y, r + 1, 0, Math.PI * 2); x.stroke();
}

export function drawCross(x: CanvasRenderingContext2D, s: Pt, n = 8) {
  x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,.55)';
  x.beginPath(); x.moveTo(s.x - n, s.y); x.lineTo(s.x + n, s.y); x.moveTo(s.x, s.y - n); x.lineTo(s.x, s.y + n); x.stroke();
  x.lineWidth = 1; x.strokeStyle = '#fff';
  x.beginPath(); x.moveTo(s.x - n, s.y); x.lineTo(s.x + n, s.y); x.moveTo(s.x, s.y - n); x.lineTo(s.x, s.y + n); x.stroke();
}

/** הפיקסל בקומפוזיציה המוצגת (מהיר — בלי רינדור מחדש) */
export function compPixel(ed: Editor, p: Pt): [number, number, number, number] | null {
  const d = ed.doc;
  if (!d || p.x < 0 || p.y < 0 || p.x >= d.width || p.y >= d.height) return null;
  const k = ed.compScale;
  const c = ed.comp;
  const x = Math.min(c.width - 1, Math.floor(p.x * k)), y = Math.min(c.height - 1, Math.floor(p.y * k));
  const v = ctx2d(c).getImageData(x, y, 1, 1).data;
  return [v[0], v[1], v[2], v[3]];
}

/* ======================= מפעל כלי מברשת-פיקסלים ======================= */

export interface PxBrushCfg {
  id: ToolId;
  label: string;
  what: string;
  opts(ed: Editor): { size: number; hardness: number; allLayers?: boolean };
  allowMask?: boolean;
  /** מרווח בין טביעות כחלק מהקוטר */
  spacing?: number;
  /** Alt+לחיצה (נקודת מקור וכו'); מחזיר true אם טופל */
  alt?(ed: Editor, e: PtrEvt): boolean;
  start?(ed: Editor, ps: PxStroke, e: PtrEvt): boolean;
  dab(ed: Editor, ps: PxStroke, d: Dab): void;
  finish?(ed: Editor, ps: PxStroke): boolean | void;
  overlay?(ed: Editor, x: CanvasRenderingContext2D, ps: PxStroke | null): void;
  hover?(ed: Editor, e: PtrEvt): void;
  hint?: string;
}

export function pxBrush(cfg: PxBrushCfg): Tool {
  let ps: PxStroke | null = null;
  let cursor: Pt | null = null;
  let lastEnd: Pt | null = null;
  const stamp = (ed: Editor, p: Pt) => {
    const o = cfg.opts(ed);
    const q = toLocal(ps!, p);
    const d: Dab = { img: ps!.img, cx: q.x, cy: q.y, r: Math.max(0.5, (o.size / 2) * ps!.scale), hard: o.hardness, sel: ps!.sel };
    cfg.dab(ed, ps!, d);
    markDirty(ps!, dabRect(d));
  };
  return {
    id: cfg.id,
    cursor: () => 'crosshair',
    down(ed, e) {
      if (e.alt && cfg.alt?.(ed, e)) return;
      const o = cfg.opts(ed);
      ps = beginPx(ed, e, { allowMask: cfg.allowMask, sampleAll: !!o.allLayers, what: cfg.what });
      if (!ps) return;
      if (cfg.start && !cfg.start(ed, ps, e)) { ps = null; cancelPx(ed); return; }
      if (e.shift && lastEnd) { ps.last = lastEnd; stamp(ed, lastEnd); dabsTo(ps, e.doc, Math.max(0.5, o.size * (cfg.spacing ?? 0.2)), (p) => stamp(ed, p)); }
      else stamp(ed, e.doc);
      flushPx(ed, ps);
    },
    move(ed, e) {
      cursor = e.screen;
      if (!ps) { ed.redraw(false); return; }
      const o = cfg.opts(ed);
      dabsTo(ps, e.doc, Math.max(0.5, o.size * (cfg.spacing ?? 0.2)), (p) => stamp(ed, p));
      flushPx(ed, ps);
    },
    hover(ed, e) { cursor = e.screen; cfg.hover?.(ed, e); ed.redraw(false); },
    up(ed, e) {
      if (!ps) return;
      const s = ps;
      ps = null;
      lastEnd = e.doc;
      if (cfg.finish && cfg.finish(ed, s) === false) { cancelPx(ed); return; }
      endPx(ed, s, cfg.label);
    },
    cancel(ed) { if (ps) { ps = null; cancelPx(ed); } },
    overlay(ed, x) {
      drawBrushCursor(ed, x, cursor, cfg.opts(ed).size);
      cfg.overlay?.(ed, x, ps);
    },
    deactivate() { cursor = null; },
  };
}
