/**
 * כלי ציור נוספים בקבוצות B / E / Y: Color Replacement, Background Eraser, Magic Eraser, History Brush.
 * (Pencil ו-Pattern Stamp יושבים במנוע ה-Stroke של המברשת ב-tools.ts.) כולם על מנוע הפיקסלים המשותף ב-paint-engine.
 */
import type { DocState, Editor } from './editor';
import type { Snap } from './history';
import type { Layer, RasterLayer } from './model';
import { copyCanvas, findLayer, hexToRgb, newCanvas, touch } from './model';
import { layerMatrix, renderDoc, renderSingle } from './render';
import { wandSel } from './selection';
import type { Tool } from './tools';
import { bgEraseDab, colorReplaceDab, coverDab, dabRect, mixCoverage } from './pixel-algo';
import { pxBrush, readImg, type PxStroke } from './paint-engine';

const sampleAt = (ps: PxStroke, x: number, y: number): [number, number, number] | null => {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= ps.img.w || iy >= ps.img.h) return null;
  const j = (iy * ps.img.w + ix) * 4, o = ps.orig;
  return o[j + 3] ? [o[j], o[j + 1], o[j + 2]] : null;
};

/* ======================= Color Replacement ======================= */

export const ColorReplaceTool: Tool = pxBrush({
  id: 'colorReplace', label: 'החלפת צבע', what: 'Color Replacement',
  opts: (ed) => ed.opts.colorReplace,
  start(ed, ps, e) {
    const q = ps.inv.transformPoint(new DOMPoint(e.doc.x, e.doc.y));
    ps.data.sample = sampleAt(ps, q.x, q.y);
    ps.data.fg = hexToRgb(ed.fg);
    return true;
  },
  dab(ed, ps, d) {
    const o = ed.opts.colorReplace;
    const s = (o.sampling === 'continuous' ? sampleAt(ps, d.cx, d.cy) : null) ?? (ps.data.sample as [number, number, number] | null);
    if (!s) return;
    if (o.sampling === 'continuous') ps.data.sample = s;
    colorReplaceDab(d, s, o.tolerance * 2.55, ps.data.fg as [number, number, number], o.mode, o.antiAlias);
  },
});

/* ======================= Background Eraser ======================= */

export const BgEraserTool: Tool = pxBrush({
  id: 'bgEraser', label: 'מחק רקע', what: 'Background Eraser',
  opts: (ed) => ed.opts.bgEraser,
  spacing: 0.15,
  start(ed, ps, e) {
    const q = ps.inv.transformPoint(new DOMPoint(e.doc.x, e.doc.y));
    ps.data.sample = sampleAt(ps, q.x, q.y);
    void ed;
    return true;
  },
  dab(ed, ps, d) {
    const o = ed.opts.bgEraser;
    const s = (o.sampling === 'continuous' ? sampleAt(ps, d.cx, d.cy) : null) ?? (ps.data.sample as [number, number, number] | null);
    if (!s) return;
    if (o.sampling === 'continuous') ps.data.sample = s;
    bgEraseDab(d, s, o.tolerance * 2.55, o.limits === 'contiguous', o.protectFg ? hexToRgb(ed.fg) : null);
  },
});

/* ======================= Magic Eraser ======================= */

export const MagicEraserTool: Tool = {
  id: 'magicEraser',
  cursor: () => 'crosshair',
  down(ed, e) {
    const d = ed.doc!, o = ed.opts.magicEraser;
    if (ed.st!.qmask) { ed.toast('במסכה מהירה עובדים עם מברשת, מחק או מעבר צבע · Q ליציאה', 'error'); return; }
    const l = ed.active;
    if (!l) { ed.toast('בחר שכבה', 'error'); return; }
    if (l.locked) { ed.toast('השכבה נעולה', 'error'); return; }
    if (l.type !== 'raster') { ed.toast('Magic Eraser עובד על שכבת פיקסלים — Layer > Rasterize', 'error'); return; }
    ed.ensureCoverage(l);
    const src = o.allLayers ? renderDoc(d, { scale: 1 }) : renderSingle(l, d);
    const region = wandSel(d, src, e.doc, o.tolerance, o.contiguous);
    const rx = region.getContext('2d')!;
    if (d.selection) { rx.globalCompositeOperation = 'destination-in'; rx.drawImage(d.selection, 0, 0); }
    const c = copyCanvas(l.canvas), x = c.getContext('2d')!;
    x.setTransform(layerMatrix(l).inverse());
    x.globalAlpha = o.opacity;
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(region, 0, 0);
    l.canvas = c;
    touch(l);
    ed.commit('מחק קסם');
  },
};

/* ======================= History Brush ======================= */

/** מקור מברשת ההיסטוריה לכל מסמך (ברירת מחדל: מצב הפתיחה) */
const histSource = new WeakMap<DocState, Snap>();

export function historySource(st: DocState): Snap {
  const s = histSource.get(st);
  return s && st.history.states.includes(s) ? s : st.history.states[0];
}
export function setHistorySource(ed: Editor, i: number) {
  const st = ed.st;
  if (!st?.history.states[i]) return;
  histSource.set(st, st.history.states[i]);
  ed.toast(`מקור מברשת ההיסטוריה: ${st.history.states[i].label}`);
  ed.emit();
}

/** הפיקסלים של השכבה במצב המקור, במרחב המקומי של השכבה הנוכחית */
function sourcePixels(ed: Editor, ps: PxStroke, snap: Snap): Uint8ClampedArray | string {
  const d = ed.doc!;
  if (snap.width !== d.width || snap.height !== d.height) return 'מצב המקור בגודל קנבס אחר — אי אפשר לצייר ממנו. בחר מקור אחר בפאנל History';
  const f = findLayer(snap.layers, ps.layerId);
  if (!f) return 'השכבה הזו לא הייתה קיימת במצב שנבחר כמקור. בחר מקור אחר בפאנל History (העמודה הקטנה מימין לשם המצב)';
  const src: Layer = f.layer;
  const c = newCanvas(ps.img.w, ps.img.h), x = c.getContext('2d')!;
  if (ps.target === 'mask') {
    if (!src.mask) return 'לשכבה לא הייתה מסכה במצב המקור';
    x.drawImage(src.mask.canvas, 0, 0);
  } else if (src.type === 'raster') {
    x.setTransform(ps.inv.multiply(layerMatrix(src as RasterLayer)));
    x.drawImage((src as RasterLayer).canvas, 0, 0);
  } else {
    x.setTransform(ps.inv);
    x.drawImage(renderSingle(src, { ...d, layers: snap.layers }), 0, 0);
  }
  return readImg(c).data;
}

export const HistoryBrushTool: Tool = pxBrush({
  id: 'historyBrush', label: 'מברשת היסטוריה', what: 'History Brush', allowMask: true,
  opts: (ed) => ed.opts.historyBrush,
  spacing: 0.1,
  start(ed, ps) {
    const src = sourcePixels(ed, ps, historySource(ed.st!));
    if (typeof src === 'string') { ed.toast(src, 'error'); return false; }
    ps.data.src = src;
    ps.data.cov = new Float32Array(ps.img.w * ps.img.h);
    return true;
  },
  dab(ed, ps, d) {
    const o = ed.opts.historyBrush;
    const cov = ps.data.cov as Float32Array;
    coverDab(cov, d, o.flow);
    mixCoverage(ps.img.data, ps.orig, ps.data.src as Uint8ClampedArray, cov, o.opacity, ps.img.w, dabRect(d));
  },
});
