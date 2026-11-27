/**
 * Artboard Tool (קבוצת V יחד עם Move, Shift+V מחליף). גרירה על ה-Pasteboard = משטח חדש; לחיצה על משטח או על
 * התווית שלו = בחירה והזזה עם התוכן (Alt = שכפול); ידיות = שינוי גודל (התוכן לא זז); כפתורי + בארבעת הצדדים =
 * משטח צמוד באותו גודל. תוויות השמות מצוירות בכל כלי, וגרירת תווית עובדת גם בכלי Move.
 */
import type { Editor } from './editor';
import type { Pt, Rect } from './model';
import type { PtrEvt, Tool } from './tools';
import { OVERLAY_HOOKS } from './tool-registry';
import { type Artboard, abRect, artboardAt, artboardOf, artboardsOf, setArtboardRect } from './artboards';
import { addAdjacent, addArtboard, applyArtboardMove, autoNest, beginArtboardMove, duplicateArtboards, selectedArtboard, type AbMove } from './artboard-ops';

const HANDLES: Array<[number, number]> = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];
const RESIZE_CURSORS = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'];
const DIRS = ['top', 'right', 'bottom', 'left'] as const;
type Dir = (typeof DIRS)[number];
const LABEL_FONT = '500 11px -apple-system, "SF Pro Text", Inter, Assistant, sans-serif';

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/* ---------- גאומטריה במסך ---------- */

let measureCtx: CanvasRenderingContext2D | null = null;
function textW(s: string) {
  if (!measureCtx) { measureCtx = document.createElement('canvas').getContext('2d')!; }
  measureCtx.font = LABEL_FONT;
  return measureCtx.measureText(s).width;
}

/** תיבת התווית (מעל הפינה השמאלית העליונה של המשטח), בקואורדינטות מסך */
function labelBox(ed: Editor, a: Artboard): Rect {
  const p = ed.toScreen({ x: a.artboard.x, y: a.artboard.y });
  return { x: p.x, y: p.y - 19, w: Math.max(24, textW(a.name) + 6), h: 16 };
}

export function artboardLabelAt(ed: Editor, sp: Pt): Artboard | null {
  const d = ed.doc;
  if (!d || !ed.view.extras) return null;
  const list = artboardsOf(d).filter((a) => a.visible);
  for (let i = list.length - 1; i >= 0; i--) {
    const b = labelBox(ed, list[i]);
    if (sp.x >= b.x && sp.x <= b.x + b.w && sp.y >= b.y && sp.y <= b.y + b.h) return list[i];
  }
  return null;
}

/** מרכזי כפתורי + : 22px מחוץ לאמצע כל צלע */
function plusPoints(ed: Editor, a: Artboard): Record<Dir, Pt> {
  const r = abRect(a);
  const t = ed.toScreen({ x: r.x + r.w / 2, y: r.y }), b = ed.toScreen({ x: r.x + r.w / 2, y: r.y + r.h });
  const l = ed.toScreen({ x: r.x, y: r.y + r.h / 2 }), rr = ed.toScreen({ x: r.x + r.w, y: r.y + r.h / 2 });
  const c = ed.toScreen({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const out = (p: Pt): Pt => { const vx = p.x - c.x, vy = p.y - c.y, n = Math.hypot(vx, vy) || 1; return { x: p.x + (vx / n) * 22, y: p.y + (vy / n) * 22 }; };
  return { top: out(t), right: out(rr), bottom: out(b), left: out(l) };
}

const handlePts = (ed: Editor, r: Rect) => HANDLES.map(([hx, hy]) => ed.toScreen({ x: r.x + r.w * hx, y: r.y + r.h * hy }));

function hitPlus(ed: Editor, a: Artboard, sp: Pt): Dir | null {
  const p = plusPoints(ed, a);
  for (const d of DIRS) if (dist(p[d], sp) <= 10) return d;
  return null;
}

function hitHandle(ed: Editor, a: Artboard, sp: Pt): number {
  const pts = handlePts(ed, abRect(a));
  for (let i = 0; i < pts.length; i++) if (dist(pts[i], sp) <= 6) return i;
  return -1;
}

/* ---------- הצמדה ---------- */

function snapTargets(ed: Editor, exclude: Set<string>) {
  const t = ed.snapTargets(exclude);
  return { xs: t.xs, ys: t.ys };
}

/** הצמדת תיבה (קצוות ומרכז) ליעדים; מעדכן את קווי ה-Smart Guides */
function snapBox(ed: Editor, box: Rect, dx: number, dy: number, targets: { xs: number[]; ys: number[] }) {
  ed.live.smart = [];
  if (!ed.view.snap) return { dx, dy };
  const d = ed.doc!, thr = 6 / ed.st!.zoom;
  const ex = [box.x + dx, box.x + box.w / 2 + dx, box.x + box.w + dx];
  const ey = [box.y + dy, box.y + box.h / 2 + dy, box.y + box.h + dy];
  let bx: number | null = null, by: number | null = null, best = thr, bestY = thr;
  const lines: NonNullable<Editor['live']['smart']> = [];
  for (const t of targets.xs) for (const e of ex) if (Math.abs(t - e) < best) { best = Math.abs(t - e); bx = t - e; lines[0] = { x1: t, y1: 0, x2: t, y2: d.height }; }
  for (const t of targets.ys) for (const e of ey) if (Math.abs(t - e) < bestY) { bestY = Math.abs(t - e); by = t - e; lines[1] = { x1: 0, y1: t, x2: d.width, y2: t }; }
  ed.live.smart = lines.filter(Boolean);
  return { dx: dx + (bx ?? 0), dy: dy + (by ?? 0) };
}

/* ---------- הכלי ---------- */

type Drag =
  | { mode: 'create'; start: Pt; cur: Pt; targets: { xs: number[]; ys: number[] } }
  | { mode: 'move'; start: Pt; m: AbMove; targets: { xs: number[]; ys: number[] }; moved: boolean; dup: boolean }
  | { mode: 'resize'; a: Artboard; handle: number; r0: Rect; targets: { xs: number[]; ys: number[] }; moved: boolean };

let drag: Drag | null = null;

function normRect(a: Pt, b: Pt): Rect {
  const x = Math.round(Math.min(a.x, b.x)), y = Math.round(Math.min(a.y, b.y));
  return { x, y, w: Math.round(Math.max(a.x, b.x)) - x, h: Math.round(Math.max(a.y, b.y)) - y };
}

/** הצמדת נקודה בודדת (פינה בגרירה) לקצוות */
function snapPoint(ed: Editor, p: Pt, targets: { xs: number[]; ys: number[] }): Pt {
  const s = snapBox(ed, { x: p.x, y: p.y, w: 0, h: 0 }, 0, 0, targets);
  return { x: p.x + s.dx, y: p.y + s.dy };
}

function startMove(ed: Editor, a: Artboard, e: PtrEvt) {
  ed.selectLayer(a.id);
  let abs = [a];
  if (e.alt) abs = duplicateArtboards(ed, abs);
  const m = beginArtboardMove(abs, true);
  if (!m) { ed.toast('המשטח נעול', 'error'); return; }
  drag = { mode: 'move', start: e.doc, m, targets: snapTargets(ed, m.ids), moved: false, dup: e.alt };
  ed.beginInteract();
}

export const ArtboardTool: Tool = {
  id: 'artboard',
  cursor(ed, e) {
    if (!e || !ed.doc) return 'default';
    if (drag?.mode === 'move') return 'move';
    const sel = selectedArtboard(ed);
    if (sel) {
      if (hitPlus(ed, sel, e.screen)) return 'pointer';
      const h = hitHandle(ed, sel, e.screen);
      if (h >= 0) return RESIZE_CURSORS[h];
    }
    if (artboardLabelAt(ed, e.screen)) return 'move';
    if (artboardAt(ed.doc, e.doc)) return 'move';
    return 'crosshair';
  },
  down(ed, e) {
    const d = ed.doc!;
    const sel = selectedArtboard(ed);
    if (sel) {
      const dir = hitPlus(ed, sel, e.screen);
      if (dir) { addAdjacent(ed, sel, dir); return; }
      const h = hitHandle(ed, sel, e.screen);
      if (h >= 0 && !sel.locked) {
        drag = { mode: 'resize', a: sel, handle: h, r0: abRect(sel), targets: snapTargets(ed, new Set([sel.id])), moved: false };
        ed.beginInteract();
        return;
      }
    }
    const hit = artboardLabelAt(ed, e.screen) ?? artboardAt(d, e.doc);
    if (hit) { startMove(ed, hit, e); return; }
    const targets = snapTargets(ed, new Set());
    const p = snapPoint(ed, e.doc, targets);
    drag = { mode: 'create', start: p, cur: p, targets };
  },
  move(ed, e) {
    if (!drag) return;
    if (drag.mode === 'create') {
      let p = snapPoint(ed, e.doc, drag.targets);
      if (e.shift) {
        // Shift = ריבוע
        const s = Math.max(Math.abs(p.x - drag.start.x), Math.abs(p.y - drag.start.y));
        p = { x: drag.start.x + Math.sign(p.x - drag.start.x || 1) * s, y: drag.start.y + Math.sign(p.y - drag.start.y || 1) * s };
      }
      drag.cur = p;
      const r = normRect(drag.start, p);
      ed.status = `W ${r.w}  H ${r.h}`;
      ed.redraw(false);
      ed.emit();
      return;
    }
    if (drag.mode === 'move') {
      let dx = e.doc.x - drag.start.x, dy = e.doc.y - drag.start.y;
      if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      ({ dx, dy } = snapBox(ed, drag.m.box, dx, dy, drag.targets));
      applyArtboardMove(drag.m, dx, dy);
      drag.moved = true;
      ed.status = `ΔX ${Math.round(dx)}  ΔY ${Math.round(dy)}`;
      ed.redraw(true);
      ed.emit();
      return;
    }
    // resize: הצד/הפינה שנגררים זזים, הנגדיים נשארים
    const [hx, hy] = HANDLES[drag.handle];
    const r0 = drag.r0;
    const p = snapPoint(ed, e.doc, drag.targets);
    let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h;
    if (hx === 0) x0 = Math.min(p.x, x1 - 1); else if (hx === 1) x1 = Math.max(p.x, x0 + 1);
    if (hy === 0) y0 = Math.min(p.y, y1 - 1); else if (hy === 1) y1 = Math.max(p.y, y0 + 1);
    if (e.shift && hx !== 0.5 && hy !== 0.5) {
      // Shift בפינה = שמירה על יחס
      const k = Math.max((x1 - x0) / r0.w, (y1 - y0) / r0.h);
      const w = r0.w * k, h = r0.h * k;
      if (hx === 0) x0 = x1 - w; else x1 = x0 + w;
      if (hy === 0) y0 = y1 - h; else y1 = y0 + h;
    }
    setArtboardRect(drag.a, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    drag.moved = true;
    ed.status = `W ${drag.a.artboard.w}  H ${drag.a.artboard.h}`;
    ed.redraw(true);
    ed.emit();
  },
  up(ed) {
    const s = drag;
    drag = null;
    ed.live.smart = [];
    ed.status = '';
    if (!s) return;
    if (s.mode === 'create') {
      const r = normRect(s.start, s.cur);
      if (r.w >= 4 && r.h >= 4) addArtboard(ed, r, 'משטח עבודה חדש');
      else { ed.redraw(false); ed.emit(); }
      return;
    }
    ed.endInteract();
    if (s.mode === 'move') {
      if (!s.moved && !s.dup) { ed.redraw(true); ed.emit(); return; }
      ed.commit(s.dup ? 'שכפול משטח עבודה' : 'הזזת משטח עבודה');
      return;
    }
    if (s.moved) ed.commit('גודל משטח עבודה');
  },
  cancel() { drag = null; },
  overlay(ed, x) {
    const d = ed.doc;
    if (!d) return;
    if (drag?.mode === 'create') {
      const r = normRect(drag.start, drag.cur);
      const pts = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }].map((p) => ed.toScreen(p));
      x.beginPath();
      pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
      x.closePath();
      x.fillStyle = 'rgba(77,163,255,.10)';
      x.fill();
      x.strokeStyle = '#4da3ff';
      x.lineWidth = 1;
      x.stroke();
    }
    const sel = selectedArtboard(ed);
    if (!sel || drag?.mode === 'create') return;
    const r = abRect(sel);
    const corners = [handlePts(ed, r)[0], handlePts(ed, r)[2], handlePts(ed, r)[4], handlePts(ed, r)[6]];
    x.strokeStyle = '#1473e6';
    x.lineWidth = 1.5;
    x.beginPath();
    corners.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
    x.closePath();
    x.stroke();
    if (drag?.mode === 'move') return;
    for (const p of handlePts(ed, r)) {
      x.fillStyle = '#fff';
      x.strokeStyle = '#1473e6';
      x.lineWidth = 1;
      x.fillRect(Math.round(p.x - 3.5) + 0.5, Math.round(p.y - 3.5) + 0.5, 7, 7);
      x.strokeRect(Math.round(p.x - 3.5) + 0.5, Math.round(p.y - 3.5) + 0.5, 7, 7);
    }
    if (drag) return;
    const pp = plusPoints(ed, sel);
    for (const dir of DIRS) {
      const p = pp[dir];
      x.beginPath();
      x.arc(p.x, p.y, 9, 0, Math.PI * 2);
      x.fillStyle = 'rgba(30,32,40,.92)';
      x.fill();
      x.strokeStyle = 'rgba(255,255,255,.35)';
      x.lineWidth = 1;
      x.stroke();
      x.strokeStyle = '#ffffff';
      x.lineWidth = 1.6;
      x.lineCap = 'round';
      x.beginPath();
      x.moveTo(p.x - 4, p.y); x.lineTo(p.x + 4, p.y);
      x.moveTo(p.x, p.y - 4); x.lineTo(p.x, p.y + 4);
      x.stroke();
      x.lineCap = 'butt';
    }
  },
};

/** בסוף הזזה בכלי Move: שכבות שעברו אל משטח (או ממנו החוצה) מתקננות שם */
export function afterMoveToolDrag(ed: Editor) { autoNest(ed, ed.topSelected()); }

/* ---------- תוויות שמות — בכל כלי ---------- */

OVERLAY_HOOKS.push((ed, x) => {
  const d = ed.doc;
  if (!d || !ed.view.extras) return;
  const list = artboardsOf(d);
  if (!list.length) return;
  const st = ed.st!;
  const activeAb = artboardOf(d, st.active);
  x.font = LABEL_FONT;
  x.textBaseline = 'middle';
  x.textAlign = 'left';
  for (const a of list) {
    if (!a.visible) continue;
    const b = labelBox(ed, a);
    const on = st.selected.includes(a.id) || activeAb === a;
    x.fillStyle = on ? 'rgba(255,255,255,.95)' : 'rgba(235,238,245,.58)';
    x.fillText(a.name, b.x + 1, b.y + b.h / 2);
  }
});
