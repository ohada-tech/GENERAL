/**
 * כלי בחירה נוספים בסגנון פוטושופ: Quick Selection, Magnetic Lasso, Single Row/Column Marquee, Transform Selection.
 * נרשמים ב-TOOLS (tools.ts) דרך byMode — באותו מזהה כלי כמו בפוטושופ (W, L, M), לפי האפשרות שנבחרה.
 */
import type { Editor } from './editor';
import type { Pt, Rect } from './model';
import { newCanvas } from './model';
import { blitAlpha, canvasFromAlpha, sourceFor } from './select-ops';
import { anchorSpacing, liveWire, pathLength, QuickSelectSession, smoothAlpha, snapToEdge, thin } from './selection-algo';
import { combine, featherSel, polySel, rectSel, selBounds, type SelMode } from './selection';
import type { PtrEvt, Tool } from './tools';

const modeOf = (e: PtrEvt): SelMode => (e.shift && e.alt ? 'int' : e.shift ? 'add' : e.alt ? 'sub' : 'new');
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** כלי אחד לשני מצבים (Lasso/Magnetic, Wand/Quick, Marquee/Row) — כל קריאה עוברת למצב הפעיל */
export function byMode(a: Tool, b: Tool, useB: (ed: Editor) => boolean): Tool {
  const pick = (ed: Editor) => (useB(ed) ? b : a);
  return {
    id: a.id,
    cursor: (ed, e) => pick(ed).cursor(ed, e),
    down: (ed, e) => pick(ed).down?.(ed, e),
    move: (ed, e) => pick(ed).move?.(ed, e),
    up: (ed, e) => pick(ed).up?.(ed, e),
    hover: (ed, e) => pick(ed).hover?.(ed, e),
    overlay: (ed, x) => pick(ed).overlay?.(ed, x),
    key: (ed, c, e) => pick(ed).key?.(ed, c, e) ?? false,
    activate: (ed) => pick(ed).activate?.(ed),
    deactivate: (ed) => { a.deactivate?.(ed); b.deactivate?.(ed); },
    cancel: (ed) => pick(ed).cancel?.(ed),
  };
}

function strokePath(ed: Editor, x: CanvasRenderingContext2D, pts: Pt[], closed: boolean, dashed: boolean) {
  if (pts.length < 2) return;
  const s = pts.map((p) => ed.toScreen(p));
  x.beginPath();
  s.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
  if (closed) x.closePath();
  x.lineWidth = 1;
  x.strokeStyle = '#fff';
  x.stroke();
  x.strokeStyle = '#000';
  if (dashed) x.setLineDash([4, 4]);
  else { x.lineWidth = 1; x.strokeStyle = 'rgba(0,0,0,.85)'; x.setLineDash([1, 2]); }
  x.stroke();
  x.setLineDash([]);
}

/* ======================= Quick Selection ======================= */

let qs: { s: QuickSelectSession; base: HTMLCanvasElement | null; mode: SelMode; last: Pt; acc: HTMLCanvasElement; t: number } | null = null;
let qsCursor: { p: Pt; alt: boolean; shift: boolean } | null = null;

function qsPreview(ed: Editor) {
  if (!qs) return;
  const d = ed.doc!;
  const c = newCanvas(d.width, d.height), x = c.getContext('2d')!;
  if (qs.mode !== 'new' && qs.base) x.drawImage(qs.base, 0, 0);
  x.globalCompositeOperation = qs.mode === 'sub' ? 'destination-out' : qs.mode === 'int' ? 'destination-in' : 'source-over';
  x.drawImage(qs.acc, 0, 0);
  ed.live.selPreview = { canvas: c, mode: 'ants' };
  ed.redraw(false);
}

export const QuickSelectTool: Tool = {
  id: 'wand',
  cursor: () => 'none',
  down(ed, e) {
    const d = ed.doc!, o = ed.opts.quick;
    const mode: SelMode = e.alt ? 'sub' : e.shift ? 'add' : o.mode;
    if (mode === 'sub' && !d.selection) { ed.toast('אין בחירה להחסיר ממנה', 'error'); return; }
    const src = sourceFor(ed, o.allLayers, true);
    const s = new QuickSelectSession(src.px, src.w, src.h, src.grad);
    qs = { s, base: d.selection, mode, last: e.doc, acc: newCanvas(d.width, d.height), t: 0 };
    const b = s.dab(e.doc.x, e.doc.y, o.size / 2);
    if (b) blitAlpha(qs.acc, s.acc, b.x0, b.y0, b.x1, b.y1);
    qsPreview(ed);
    ed.status = mode === 'sub' ? 'Quick Selection · חיסור' : 'Quick Selection';
    ed.emit();
  },
  move(ed, e) {
    qsCursor = { p: e.screen, alt: e.alt, shift: e.shift };
    if (!qs) { ed.redraw(false); return; }
    const b = qs.s.stroke(qs.last, e.doc, ed.opts.quick.size / 2);
    qs.last = e.doc;
    if (b) blitAlpha(qs.acc, qs.s.acc, b.x0, b.y0, b.x1, b.y1);
    // תצוגה מקדימה של הנמלים לכל היותר כל 50ms (חישוב הקווים עובר על כל המסמך)
    const now = performance.now();
    if (now - qs.t > 50) { qs.t = now; qsPreview(ed); } else ed.redraw(false);
  },
  hover(ed, e) { qsCursor = { p: e.screen, alt: e.alt, shift: e.shift }; ed.redraw(false); },
  up(ed) {
    if (!qs) return;
    const d = ed.doc!, o = ed.opts.quick;
    const s = qs;
    qs = null;
    ed.live.selPreview = null;
    ed.status = '';
    let shape = s.acc;
    if (o.autoEnhance) shape = featherSel(canvasFromAlpha(smoothAlpha(s.s.acc, d.width, d.height, 2), d.width, d.height), 0.8);
    const next = combine({ ...d, selection: s.base }, shape, s.mode);
    // כמו בפוטושופ: אחרי המשיכה הראשונה הכלי עובר אוטומטית להוספה
    if (o.mode === 'new') o.mode = 'add';
    ed.setSelection(next, s.mode === 'sub' ? 'בחירה מהירה · חיסור' : 'בחירה מהירה');
  },
  cancel(ed) { qs = null; ed.live.selPreview = null; },
  deactivate(ed) { if (qs) { qs = null; ed.live.selPreview = null; } qsCursor = null; },
  overlay(ed, x) {
    if (!qsCursor || !ed.st) return;
    const r = Math.max(2, (ed.opts.quick.size / 2) * ed.st.zoom);
    const { p } = qsCursor;
    x.lineWidth = 1;
    x.strokeStyle = 'rgba(0,0,0,.75)';
    x.beginPath(); x.arc(p.x, p.y, r, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.85)';
    x.beginPath(); x.arc(p.x, p.y, r + 1, 0, Math.PI * 2); x.stroke();
    const sub = qs ? qs.mode === 'sub' : qsCursor.alt;
    const add = qs ? qs.mode === 'add' : qsCursor.shift || ed.opts.quick.mode === 'add';
    x.beginPath();
    x.moveTo(p.x - 4, p.y); x.lineTo(p.x + 4, p.y);
    if (!sub && add) { x.moveTo(p.x, p.y - 4); x.lineTo(p.x, p.y + 4); }
    x.strokeStyle = '#000'; x.lineWidth = 3; x.stroke();
    x.strokeStyle = '#fff'; x.lineWidth = 1; x.stroke();
  },
};

/* ======================= Magnetic Lasso ======================= */

interface MagState { anchors: Pt[]; path: Pt[]; segStarts: number[]; live: Pt[]; mode: SelMode; grad: Float32Array; w: number; h: number; cursor: Pt | null }
let mag: MagState | null = null;

const px = (p: Pt): Pt => ({ x: Math.floor(p.x), y: Math.floor(p.y) });

function magWire(ed: Editor, m: MagState, a: Pt, b: Pt) {
  const o = ed.opts.lasso;
  return liveWire(m.grad, m.w, m.h, a, b, Math.max(8, o.width), o.contrast / 100);
}

function magUpdate(ed: Editor, cursor: Pt) {
  const m = mag!, o = ed.opts.lasso;
  m.cursor = cursor;
  const target = snapToEdge(m.grad, m.w, m.h, px(cursor), o.width, o.contrast / 100);
  const spacing = anchorSpacing(o.frequency);
  let last = m.anchors[m.anchors.length - 1];
  let live = magWire(ed, m, last, target);
  // עוגנים אוטומטיים לפי Frequency: מקבעים את המסלול עד נקודה במרחק spacing
  for (let k = 0; k < 6 && pathLength(live) > spacing; k++) {
    let acc = 0, cut = live.length - 1;
    for (let i = 1; i < live.length; i++) { acc += dist(live[i], live[i - 1]); if (acc >= spacing * 0.8) { cut = i; break; } }
    if (cut <= 0 || cut >= live.length - 1) break;
    m.segStarts.push(m.path.length);
    m.path.push(...live.slice(1, cut + 1));
    last = live[cut];
    m.anchors.push(last);
    live = magWire(ed, m, last, target);
  }
  m.live = live;
  ed.redraw(false);
}

function magCommitLive(m: MagState) {
  if (m.live.length < 2) return;
  m.segStarts.push(m.path.length);
  m.path.push(...m.live.slice(1));
  m.anchors.push(m.live[m.live.length - 1]);
  m.live = [];
}

function magClose(ed: Editor) {
  const m = mag;
  if (!m) return;
  magCommitLive(m);
  const start = m.anchors[0];
  const back = magWire(ed, m, m.path[m.path.length - 1], start);
  const pts = thin([...m.path, ...back.slice(1)]).map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
  mag = null;
  ed.live.marquee = null;
  ed.status = '';
  const d = ed.doc!;
  if (pts.length < 3) { ed.redraw(false); return; }
  ed.setSelection(combine(d, polySel(d, pts, ed.opts.lasso.feather), m.mode), 'לאסו מגנטי');
}

export const MagneticLassoTool: Tool = {
  id: 'lasso',
  cursor: () => 'crosshair',
  down(ed, e) {
    const d = ed.doc!;
    if (!mag) {
      const src = sourceFor(ed, true, true);
      const p = snapToEdge(src.grad, d.width, d.height, px(e.doc), ed.opts.lasso.width, ed.opts.lasso.contrast / 100);
      mag = { anchors: [p], path: [p], segStarts: [0], live: [], mode: modeOf(e), grad: src.grad, w: d.width, h: d.height, cursor: e.doc };
      ed.status = 'לאסו מגנטי · דאבל-קליק או Enter לסגירה';
      ed.emit();
      ed.redraw(false);
      return;
    }
    const nearStart = mag.path.length > 8 && dist(ed.toScreen(mag.anchors[0]), e.screen) < 9;
    if (e.clicks >= 2 || nearStart) { magClose(ed); return; }
    // לחיצה = עוגן ידני בנקודה הנוכחית
    magUpdate(ed, e.doc);
    magCommitLive(mag);
    ed.redraw(false);
  },
  move(ed, e) { if (mag) magUpdate(ed, e.doc); },
  hover(ed, e) { if (mag) magUpdate(ed, e.doc); },
  key(ed, combo) {
    if (!mag) return false;
    if (combo === 'Enter') { magClose(ed); return true; }
    if (combo === 'Escape') { mag = null; ed.status = ''; ed.emit(); ed.redraw(false); return true; }
    if (combo === 'Backspace' || combo === 'Delete') {
      if (mag.anchors.length <= 1) { mag = null; ed.status = ''; ed.emit(); }
      else { mag.path.length = mag.segStarts.pop()!; mag.anchors.pop(); if (mag.cursor) magUpdate(ed, mag.cursor); }
      ed.redraw(false);
      return true;
    }
    return false;
  },
  deactivate(ed) { if (mag) { mag = null; ed.status = ''; } },
  overlay(ed, x) {
    if (!mag) return;
    const c = (p: Pt) => ({ x: p.x + 0.5, y: p.y + 0.5 });
    strokePath(ed, x, [...mag.path, ...mag.live.slice(1)].map(c), false, false);
    for (const a of mag.anchors) {
      const s = ed.toScreen(c(a));
      x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 1;
      x.fillRect(Math.round(s.x) - 2.5, Math.round(s.y) - 2.5, 5, 5);
      x.strokeRect(Math.round(s.x) - 2.5, Math.round(s.y) - 2.5, 5, 5);
    }
    if (mag.cursor && ed.st) {
      const s = ed.toScreen(mag.cursor), r = ed.opts.lasso.width * ed.st.zoom;
      if (r > 4) { x.strokeStyle = 'rgba(255,255,255,.5)'; x.beginPath(); x.arc(s.x, s.y, r, 0, Math.PI * 2); x.stroke(); }
    }
  },
};

export const magneticActive = () => !!mag;

/* ======================= Single Row / Single Column Marquee ======================= */

let rowDrag: { mode: SelMode; at: Pt } | null = null;

function rowRect(ed: Editor, p: Pt): Rect {
  const d = ed.doc!;
  return ed.opts.marquee.shape === 'row'
    ? { x: 0, y: Math.max(0, Math.min(d.height - 1, Math.floor(p.y))), w: d.width, h: 1 }
    : { x: Math.max(0, Math.min(d.width - 1, Math.floor(p.x))), y: 0, w: 1, h: d.height };
}

function rowLive(ed: Editor, p: Pt) {
  const r = rowRect(ed, p);
  ed.live.marquee = { pts: [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }], closed: true };
  ed.status = ed.opts.marquee.shape === 'row' ? `Y ${r.y}` : `X ${r.x}`;
  ed.redraw(false);
  ed.emit();
}

export const RowColMarqueeTool: Tool = {
  id: 'marquee',
  cursor: () => 'crosshair',
  down(ed, e) { rowDrag = { mode: modeOf(e), at: e.doc }; rowLive(ed, e.doc); },
  move(ed, e) { if (rowDrag) { rowDrag.at = e.doc; rowLive(ed, e.doc); } },
  up(ed) {
    if (!rowDrag) return;
    const d = ed.doc!, s = rowDrag;
    rowDrag = null;
    ed.live.marquee = null;
    ed.status = '';
    const row = ed.opts.marquee.shape === 'row';
    ed.setSelection(combine(d, rectSel(d, rowRect(ed, s.at), false), s.mode), row ? 'בחירת שורה בודדת' : 'בחירת עמודה בודדת');
  },
  deactivate(ed) { rowDrag = null; ed.live.marquee = null; },
  overlay(ed, x) { const m = ed.live.marquee; if (m) strokePath(ed, x, m.pts, true, true); },
};

/* ======================= Transform Selection ======================= */

export interface SelXf { orig: HTMLCanvasElement; b: Rect; x: number; y: number; sx: number; sy: number; rot: number; prev: string }

const HANDLES: Array<[number, number]> = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];
const CURSORS = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'];

/** נקודה במרחב המקומי (יחסית למרכז המקורי, בפיקסלים לפני סקאלה) → מסמך */
function xfPoint(t: SelXf, lx: number, ly: number): Pt {
  const a = (t.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const X = lx * t.sx, Y = ly * t.sy;
  return { x: t.x + X * c - Y * s, y: t.y + X * s + Y * c };
}
const handleLocal = (t: SelXf, hx: number, hy: number) => ({ x: (hx - 0.5) * t.b.w, y: (hy - 0.5) * t.b.h });
const quad = (t: SelXf) => [[0, 0], [1, 0], [1, 1], [0, 1]].map(([hx, hy]) => { const l = handleLocal(t, hx, hy); return xfPoint(t, l.x, l.y); });

export function transformedSelection(ed: Editor, t: SelXf): HTMLCanvasElement {
  const d = ed.doc!;
  const c = newCanvas(d.width, d.height), x = c.getContext('2d')!;
  x.translate(t.x, t.y);
  x.rotate((t.rot * Math.PI) / 180);
  x.scale(t.sx, t.sy);
  x.translate(-(t.b.x + t.b.w / 2), -(t.b.y + t.b.h / 2));
  x.imageSmoothingQuality = 'high';
  x.drawImage(t.orig, 0, 0);
  return c;
}

function pointInPoly(p: Pt, q: Pt[]) {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) if (q[i].y > p.y !== q[j].y > p.y && p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
  return inside;
}

function hitXf(ed: Editor, t: SelXf, sp: Pt): { kind: 'scale' | 'rotate' | 'move'; i: number } | null {
  for (let i = 0; i < HANDLES.length; i++) { const l = handleLocal(t, ...HANDLES[i]); if (dist(ed.toScreen(xfPoint(t, l.x, l.y)), sp) <= 7) return { kind: 'scale', i }; }
  const qs4 = quad(t).map((p) => ed.toScreen(p));
  if (pointInPoly(sp, qs4)) return { kind: 'move', i: -1 };
  for (let i = 0; i < 4; i++) if (dist(qs4[i], sp) <= 26) return { kind: 'rotate', i };
  return null;
}

let xfDrag: { kind: 'scale' | 'rotate' | 'move'; i: number; start: Pt; t0: SelXf } | null = null;

function xfPreview(ed: Editor) {
  const t = ed.live.selxf;
  if (!t) return;
  ed.live.selPreview = { canvas: transformedSelection(ed, t), mode: 'ants' };
  ed.status = `W ${Math.round(Math.abs(t.sx) * 100)}%  H ${Math.round(Math.abs(t.sy) * 100)}%  ${Math.round(t.rot)}°`;
  ed.redraw(false);
  ed.emit();
}

export function startSelTransform(ed: Editor) {
  const d = ed.doc;
  if (!d?.selection) { ed.toast('אין בחירה לשינוי', 'error'); return; }
  const b = selBounds(d.selection);
  if (!b) return;
  const prev = ed.tool === 'selxf' ? 'marquee' : ed.tool;
  ed.setTool('selxf');
  ed.live.selxf = { orig: d.selection, b, x: b.x + b.w / 2, y: b.y + b.h / 2, sx: 1, sy: 1, rot: 0, prev };
  xfPreview(ed);
}

export function endSelTransform(ed: Editor, apply: boolean) {
  const t = ed.live.selxf;
  if (!t) return;
  const next = apply ? transformedSelection(ed, t) : null;
  ed.live.selxf = null;
  ed.live.selPreview = null;
  ed.status = '';
  xfDrag = null;
  ed.setTool(t.prev as Parameters<Editor['setTool']>[0]);
  if (apply && next) ed.setSelection(next, 'Transform Selection · שינוי בחירה');
  else { ed.redraw(false); ed.emit(); }
}

export const SelTransformTool: Tool = {
  id: 'selxf',
  cursor(ed, e) {
    const t = ed.live.selxf;
    if (!t || !e) return 'default';
    const h = hitXf(ed, t, e.screen);
    if (!h) return 'default';
    if (h.kind === 'scale') { const k = Math.round((((t.rot % 180) + 180) % 180) / 45); return CURSORS[(h.i + k * 1) % 8]; }
    return h.kind === 'move' ? 'move' : 'alias';
  },
  down(ed, e) {
    const t = ed.live.selxf;
    if (!t) return;
    const h = hitXf(ed, t, e.screen);
    if (h?.kind === 'move' && e.clicks >= 2) { endSelTransform(ed, true); return; }
    if (!h) return;
    xfDrag = { kind: h.kind, i: h.i, start: e.doc, t0: { ...t } };
  },
  move(ed, e) {
    const t = ed.live.selxf;
    if (!t || !xfDrag) return;
    const t0 = xfDrag.t0;
    if (xfDrag.kind === 'move') { t.x = t0.x + e.doc.x - xfDrag.start.x; t.y = t0.y + e.doc.y - xfDrag.start.y; }
    else if (xfDrag.kind === 'rotate') {
      let da = (Math.atan2(e.doc.y - t0.y, e.doc.x - t0.x) - Math.atan2(xfDrag.start.y - t0.y, xfDrag.start.x - t0.x)) * (180 / Math.PI);
      let rot = t0.rot + da;
      if (e.shift) rot = Math.round(rot / 15) * 15;
      da = rot;
      t.rot = da;
    } else {
      const [hx, hy] = HANDLES[xfDrag.i];
      const corner = hx !== 0.5 && hy !== 0.5;
      const prop = corner ? !e.shift : e.shift;
      const H = handleLocal(t0, hx, hy);
      const A = e.alt ? { x: 0, y: 0 } : handleLocal(t0, 1 - hx, 1 - hy);
      const Ad = xfPoint(t0, A.x, A.y);
      const a = (-t0.rot * Math.PI) / 180;
      const vx = e.doc.x - Ad.x, vy = e.doc.y - Ad.y;
      const mx = vx * Math.cos(a) - vy * Math.sin(a), my = vx * Math.sin(a) + vy * Math.cos(a);
      const hvx = H.x - A.x, hvy = H.y - A.y;
      let sx = hx === 0.5 || !hvx ? t0.sx : mx / hvx, sy = hy === 0.5 || !hvy ? t0.sy : my / hvy;
      if (prop) {
        const f = hx === 0.5 ? Math.abs(sy / t0.sy) : hy === 0.5 ? Math.abs(sx / t0.sx) : Math.max(Math.abs(sx / t0.sx), Math.abs(sy / t0.sy));
        sx = t0.sx * f * (hx === 0.5 ? 1 : Math.sign(sx / t0.sx) || 1);
        sy = t0.sy * f * (hy === 0.5 ? 1 : Math.sign(sy / t0.sy) || 1);
      }
      if (Math.abs(sx) < 0.002) sx = 0.002 * (Math.sign(sx) || 1);
      if (Math.abs(sy) < 0.002) sy = 0.002 * (Math.sign(sy) || 1);
      t.sx = sx; t.sy = sy;
      // העוגן נשאר במקומו
      const ang = (t.rot * Math.PI) / 180;
      const X = A.x * sx, Y = A.y * sy;
      t.x = Ad.x - (X * Math.cos(ang) - Y * Math.sin(ang));
      t.y = Ad.y - (X * Math.sin(ang) + Y * Math.cos(ang));
    }
    xfPreview(ed);
  },
  up() { xfDrag = null; },
  cancel(ed) {
    // ביטול מבחוץ (Undo, מעבר מסמך): הבחירה המקורית נשארת וחוזרים לכלי הקודם
    const t = ed.live.selxf;
    ed.live.selxf = null;
    ed.live.selPreview = null;
    xfDrag = null;
    ed.status = '';
    if (t) queueMicrotask(() => { if (ed.tool === 'selxf') ed.setTool(t.prev as Parameters<Editor['setTool']>[0]); });
  },
  key(ed, combo) {
    if (!ed.live.selxf) return false;
    if (combo === 'Enter') { endSelTransform(ed, true); return true; }
    if (combo === 'Escape') { endSelTransform(ed, false); return true; }
    const nudge: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const k = combo.replace('Shift+', '');
    if (nudge[k]) { const m = combo.startsWith('Shift+') ? 10 : 1; ed.live.selxf.x += nudge[k][0] * m; ed.live.selxf.y += nudge[k][1] * m; xfPreview(ed); return true; }
    return false;
  },
  deactivate(ed) {
    // יציאה מהכלי בלי Enter = ביטול (הבחירה המקורית נשארת)
    if (ed.live.selxf) { ed.live.selxf = null; ed.live.selPreview = null; ed.status = ''; xfDrag = null; }
  },
  overlay(ed, x) {
    const t = ed.live.selxf;
    if (!t) return;
    const q = quad(t).map((p) => ed.toScreen(p));
    x.lineWidth = 1;
    x.strokeStyle = '#1473e6';
    x.beginPath();
    q.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
    x.closePath();
    x.stroke();
    for (const [hx, hy] of HANDLES) {
      const l = handleLocal(t, hx, hy), s = ed.toScreen(xfPoint(t, l.x, l.y));
      x.fillStyle = '#fff';
      x.fillRect(Math.round(s.x - 3.5) + 0.5, Math.round(s.y - 3.5) + 0.5, 7, 7);
      x.strokeRect(Math.round(s.x - 3.5) + 0.5, Math.round(s.y - 3.5) + 0.5, 7, 7);
    }
    const c = ed.toScreen({ x: t.x, y: t.y });
    x.beginPath();
    x.arc(c.x, c.y, 4, 0, Math.PI * 2);
    x.moveTo(c.x - 7, c.y); x.lineTo(c.x + 7, c.y); x.moveTo(c.x, c.y - 7); x.lineTo(c.x, c.y + 7);
    x.stroke();
  },
};
