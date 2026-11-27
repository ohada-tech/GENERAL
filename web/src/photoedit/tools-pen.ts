/**
 * Pen Tools + Path Selection — כלי העט של פוטושופ: Pen, Freeform Pen, Curvature Pen, Add/Delete Anchor Point,
 * Convert Point, Path Selection (A) ו-Direct Selection. עובדים על "היעד" (path-doc): Work Path / נתיב שמור,
 * צורה וקטורית או Vector Mask. כל עריכה = commit עם תווית בעברית; בזמן גרירה הכתיבה חיה (בלי commit).
 * Ctrl בכל כלי עט = Direct Selection זמני; Alt על נקודה = Convert Point (כמו בפוטושופ).
 */
import type { Editor } from './editor';
import type { PtrEvt, Tool, ToolId } from './tools';
import type { Xf, XfLayer } from './model';
import { touch } from './model';
import type { Anchor, CurvPt, P2, SubPath } from './paths';
import {
  alignOpposite, anchor, boundsOf, cloneSub, curvatureAnchors, deleteAnchorsBreaking, dist, flattenSub, freeformSub, hasIn, hasOut,
  insertAnchor, mapSubs, moveAnchor, nearestOnSubs, pointInSubs, removeAnchor, reshapeSegment, reverseSub, snap45, traceSubs,
} from './paths';
import {
  convertToShape, createPathShape, currentTarget, docSubs, explicitTarget, resolveTarget, setActivePath, setWorkPath, targetLocked,
  writeDocSubs, type Target,
} from './path-doc';
import { OVERLAY_HOOKS } from './tool-registry';

export const PEN_TOOL_IDS: ToolId[] = ['pen', 'freePen', 'curvPen', 'addAnchor', 'delAnchor', 'convertPt', 'pathSel', 'directSel'];
const isPathTool = (id: ToolId) => PEN_TOOL_IDS.includes(id);

const BLUE = '#1473e6';
const HIT = 6;

/* ======================= בחירת נקודות ותתי-נתיבים ======================= */

const akey = (si: number, pi: number) => `${si}:${pi}`;
let psel: { key: string; anchors: Set<string>; subs: Set<number> } = { key: '', anchors: new Set(), subs: new Set() };
function selOf(t: Target | null) {
  const k = t?.key ?? '';
  if (psel.key !== k) psel = { key: k, anchors: new Set(), subs: new Set() };
  return psel;
}
const anchorsOfSubs = (subs: SubPath[], idx: Set<number>) => {
  const out = new Set<string>();
  for (const si of idx) subs[si]?.pts.forEach((_, pi) => out.add(akey(si, pi)));
  return out;
};

/* ======================= ציור על המסך ======================= */

const toScreenSubs = (ed: Editor, subs: SubPath[]) => mapSubs(subs, ed.viewMatrix());

function outline(x: CanvasRenderingContext2D, ss: SubPath[], color = BLUE, w = 1) {
  x.beginPath();
  traceSubs(x, ss);
  x.lineWidth = w;
  x.strokeStyle = color;
  x.stroke();
}

function square(x: CanvasRenderingContext2D, p: P2, filled: boolean, s = 7) {
  x.fillStyle = filled ? BLUE : '#fff';
  x.strokeStyle = BLUE;
  x.lineWidth = 1;
  x.fillRect(Math.round(p.x - s / 2) + 0.5, Math.round(p.y - s / 2) + 0.5, s - 1, s - 1);
  x.strokeRect(Math.round(p.x - s / 2) + 0.5, Math.round(p.y - s / 2) + 0.5, s - 1, s - 1);
}

function handle(x: CanvasRenderingContext2D, a: P2, h: P2) {
  if (dist(a, h) < 0.5) return;
  x.strokeStyle = BLUE;
  x.lineWidth = 1;
  x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(h.x, h.y); x.stroke();
  x.fillStyle = BLUE;
  x.beginPath(); x.arc(h.x, h.y, 3, 0, Math.PI * 2); x.fill();
}

/** נתיב עם נקודות: selected = מלאות; handles = לאילו נקודות מוצגות ידיות */
function drawPathUI(ed: Editor, x: CanvasRenderingContext2D, subsDoc: SubPath[], o: { anchors: boolean; selected?: Set<string>; handles?: (si: number, pi: number) => boolean; round?: boolean }) {
  const ss = toScreenSubs(ed, subsDoc);
  outline(x, ss, 'rgba(255,255,255,.55)', 3);
  outline(x, ss);
  if (!o.anchors) return;
  ss.forEach((s, si) => s.pts.forEach((a, pi) => {
    if (o.handles?.(si, pi)) { handle(x, a, { x: a.ix, y: a.iy }); handle(x, a, { x: a.ox, y: a.oy }); }
  }));
  ss.forEach((s, si) => s.pts.forEach((a, pi) => {
    if (o.round) {
      x.fillStyle = o.selected?.has(akey(si, pi)) ? BLUE : '#fff';
      x.strokeStyle = BLUE;
      x.beginPath(); x.arc(a.x, a.y, 3.5, 0, Math.PI * 2); x.fill(); x.stroke();
    } else square(x, a, !!o.selected?.has(akey(si, pi)));
  }));
}

/** הנתיב הפעיל מוצג גם בכלים אחרים (קו דק), כמו בפוטושופ כשנתיב נבחר בפאנל */
OVERLAY_HOOKS.push((ed, x) => {
  if (!ed.doc || !ed.view.extras || isPathTool(ed.springTool ?? ed.tool)) return;
  const t = explicitTarget(ed);
  if (!t || t.kind === 'shape') return;
  outline(x, toScreenSubs(ed, docSubs(t)));
});

/* ======================= פגיעה ======================= */

interface PtHit { si: number; pi: number; part: 'anchor' | 'in' | 'out' }

function hitPoint(ed: Editor, subsDoc: SubPath[], sp: P2, handlesFor: (si: number, pi: number) => boolean): PtHit | null {
  const ss = toScreenSubs(ed, subsDoc);
  let best: PtHit | null = null, bd = HIT;
  ss.forEach((s, si) => s.pts.forEach((a, pi) => {
    if (handlesFor(si, pi)) {
      if (hasIn(subsDoc[si].pts[pi])) { const d = dist({ x: a.ix, y: a.iy }, sp); if (d < bd) { bd = d; best = { si, pi, part: 'in' }; } }
      if (hasOut(subsDoc[si].pts[pi])) { const d = dist({ x: a.ox, y: a.oy }, sp); if (d < bd) { bd = d; best = { si, pi, part: 'out' }; } }
    }
  }));
  // נקודת עיגון קודמת לידית כשהן חופפות
  ss.forEach((s, si) => s.pts.forEach((a, pi) => { const d = dist(a, sp); if (d <= Math.max(bd, 4.5) && (!best || best.part !== 'anchor' || d < bd)) { bd = d; best = { si, pi, part: 'anchor' }; } }));
  return best;
}

function hitSeg(ed: Editor, subsDoc: SubPath[], e: PtrEvt) {
  const h = nearestOnSubs(subsDoc, e.doc);
  return h && h.d * ed.st!.zoom <= HIT ? h : null;
}

/** תת-הנתיב שמתחת לסמן: קרוב לקו, או בתוך שטח סגור */
function hitSub(ed: Editor, subsDoc: SubPath[], e: PtrEvt): number {
  const s = hitSeg(ed, subsDoc, e);
  if (s) return s.si;
  for (let i = subsDoc.length - 1; i >= 0; i--) if (subsDoc[i].closed && pointInSubs([subsDoc[i]], e.doc)) return i;
  return -1;
}

function lockedToast(ed: Editor, t: Target | null) {
  if (!targetLocked(t)) return false;
  ed.toast('השכבה נעולה', 'error');
  return true;
}

/* ======================= Path Selection / Direct Selection ======================= */

interface Drag {
  kind: 'anchors' | 'handle' | 'segment' | 'subs' | 'rubber' | 'layer' | 'convert';
  t: Target | null;
  base: SubPath[];
  start: P2;
  startS: P2;
  cur?: P2;
  moved: boolean;
  label: string;
  si?: number; pi?: number; part?: 'in' | 'out'; seg?: number; tpar?: number;
  alt?: boolean; add?: boolean; direct?: boolean; dup?: boolean;
  layer?: { l: XfLayer; t0: Xf };
}
let drag: Drag | null = null;

function startDrag(d: Omit<Drag, 'moved' | 'startS'> & { startS?: P2 }, e: PtrEvt): Drag {
  drag = { ...d, startS: d.startS ?? e.screen, moved: false };
  if (d.kind !== 'rubber') ed0?.beginInteract();
  return drag;
}
/** ההפניה לעורך בזמן גרירה (ל-beginInteract/endInteract) */
let ed0: Editor | null = null;

function selDown(ed: Editor, e: PtrEvt, direct: boolean) {
  ed0 = ed;
  const t = currentTarget(ed);
  if (t) {
    const subs = docSubs(t), sel = selOf(t);
    if (direct) {
      const h = hitPoint(ed, subs, e.screen, (si, pi) => sel.anchors.has(akey(si, pi)));
      if (h) {
        if (lockedToast(ed, t)) return;
        if (h.part !== 'anchor') { startDrag({ kind: 'handle', t, base: subs, start: e.doc, si: h.si, pi: h.pi, part: h.part, alt: e.alt, label: 'הזזת ידית' }, e); return; }
        const k = akey(h.si, h.pi);
        if (e.shift) { if (sel.anchors.has(k)) sel.anchors.delete(k); else sel.anchors.add(k); }
        else if (!sel.anchors.has(k)) sel.anchors = new Set([k]);
        sel.subs.clear();
        startDrag({ kind: 'anchors', t, base: subs, start: e.doc, label: 'הזזת נקודות עיגון' }, e);
        ed.redraw(false); ed.emit();
        return;
      }
      const sg = hitSeg(ed, subs, e);
      if (sg) {
        if (lockedToast(ed, t)) return;
        const n = subs[sg.si].pts.length;
        if (!e.shift) sel.anchors = new Set();
        sel.anchors.add(akey(sg.si, sg.seg)); sel.anchors.add(akey(sg.si, (sg.seg + 1) % n));
        sel.subs.clear();
        startDrag({ kind: 'segment', t, base: subs, start: e.doc, si: sg.si, seg: sg.seg, tpar: sg.t, label: 'עיצוב קטע' }, e);
        ed.redraw(false);
        return;
      }
    } else {
      const si = hitSub(ed, subs, e);
      if (si >= 0) {
        if (lockedToast(ed, t)) return;
        if (e.shift) { if (sel.subs.has(si)) sel.subs.delete(si); else sel.subs.add(si); }
        else if (!sel.subs.has(si)) sel.subs = new Set([si]);
        let base = subs, dup = false;
        if (e.alt && sel.subs.size) {
          // Alt+גרירה = שכפול תתי-הנתיב הנבחרים
          const add = [...sel.subs].sort((a, b) => a - b).map((i) => cloneSub(subs[i]));
          base = [...subs, ...add];
          sel.subs = new Set(add.map((_, i) => subs.length + i));
          writeDocSubs(ed, t, base);
          dup = true;
        }
        sel.anchors = anchorsOfSubs(base, sel.subs);
        startDrag({ kind: 'subs', t, base, start: e.doc, dup, label: dup ? 'שכפול נתיב' : 'הזזת נתיב' }, e);
        ed.redraw(false); ed.emit();
        return;
      }
    }
  }
  // אין פגיעה ביעד: שכבת צורה מתחת לסמן הופכת ליעד (צורה חיה מומרת בבחירה הישירה)
  const hit = ed.hitTest(e.doc);
  if (hit && hit.type === 'shape' && hit !== t?.layer) {
    ed.selectLayer(hit.id);
    if (hit.shape !== 'path') {
      if (!direct) { startDrag({ kind: 'layer', t: null, base: [], start: e.doc, layer: { l: hit, t0: { ...hit.t } }, label: 'הזזת צורה' }, e); return; }
      if (convertToShape(ed, hit, false)) { ed.commit('המרה לצורה'); ed.toast('הצורה החיה הומרה לנתיב עריך (Convert to Shape)'); }
    }
    setActivePath(ed, `shape:${hit.id}`);
    const nt = currentTarget(ed);
    if (nt && !direct) {
      const ns = docSubs(nt), sel = selOf(nt);
      sel.subs = new Set(ns.map((_, i) => i));
      sel.anchors = anchorsOfSubs(ns, sel.subs);
      if (!lockedToast(ed, nt)) startDrag({ kind: 'subs', t: nt, base: ns, start: e.doc, label: 'הזזת נתיב' }, e);
    }
    ed.redraw(false); ed.emit();
    return;
  }
  if (t && !e.shift) { const s = selOf(t); s.anchors.clear(); s.subs.clear(); }
  startDrag({ kind: 'rubber', t, base: t ? docSubs(t) : [], start: e.doc, cur: e.screen, direct, add: e.shift, label: '' }, e);
  ed.redraw(false); ed.emit();
}

function constrain(dx: number, dy: number, shift: boolean) {
  if (!shift) return { dx, dy };
  const p = snap45({ x: 0, y: 0 }, { x: dx, y: dy });
  return { dx: p.x, dy: p.y };
}

function dragMove(ed: Editor, e: PtrEvt) {
  const g = drag;
  if (!g) return;
  if (dist(e.screen, g.startS) > 2) g.moved = true;
  if (g.kind === 'rubber') { g.cur = e.screen; ed.redraw(false); return; }
  if (!g.moved) return;
  const { dx, dy } = constrain(e.doc.x - g.start.x, e.doc.y - g.start.y, e.shift && g.kind !== 'handle' && g.kind !== 'convert');
  if (g.kind === 'layer') {
    const L = g.layer!;
    L.l.t = { ...L.t0, x: L.t0.x + dx, y: L.t0.y + dy };
    touch(L.l);
    ed.redraw(true);
    return;
  }
  const t = g.t!;
  const sel = selOf(t);
  let next: SubPath[] = g.base;
  if (g.kind === 'anchors' || g.kind === 'subs') {
    next = g.base.map((s, si) => ({ closed: s.closed, pts: s.pts.map((a, pi) => (g.kind === 'subs' ? sel.subs.has(si) : sel.anchors.has(akey(si, pi))) ? moveAnchor(a, dx, dy) : a) }));
  } else if (g.kind === 'handle' || g.kind === 'convert') {
    next = g.base.map(cloneSub);
    const a: Anchor = next[g.si!].pts[g.pi!];
    let p = e.doc;
    if (e.shift) p = snap45(a, p);
    if (g.kind === 'convert' && g.part === undefined) {
      // גרירה מנקודה (Convert Point) = ידיות סימטריות חדשות
      a.ox = p.x; a.oy = p.y; a.ix = 2 * a.x - p.x; a.iy = 2 * a.y - p.y; a.smooth = true;
    } else if (g.part === 'out') { a.ox = p.x; a.oy = p.y; }
    else { a.ix = p.x; a.iy = p.y; }
    if (g.part) {
      // Direct Selection: נקודה חלקה שומרת על קו ישר בין הידיות (Alt שובר); Convert Point תמיד שובר
      if (g.kind === 'convert' || g.alt) a.smooth = false;
      else if (a.smooth) next[g.si!].pts[g.pi!] = alignOpposite(a, g.part);
    }
  } else if (g.kind === 'segment') {
    const s = g.base[g.si!];
    const j = (g.seg! + 1) % s.pts.length;
    const straight = !hasOut(s.pts[g.seg!]) && !hasIn(s.pts[j]);
    next = g.base.map(cloneSub);
    if (straight) { next[g.si!].pts[g.seg!] = moveAnchor(s.pts[g.seg!], dx, dy); next[g.si!].pts[j] = moveAnchor(s.pts[j], dx, dy); }
    else next[g.si!] = reshapeSegment(s, g.seg!, g.tpar!, dx, dy);
  }
  writeDocSubs(ed, t, next);
  ed.status = `Δ ${Math.round(dx)}, ${Math.round(dy)}`;
  ed.emit();
}

function dragUp(ed: Editor) {
  const g = drag;
  drag = null;
  if (!g) return;
  ed.status = '';
  if (g.kind !== 'rubber') ed.endInteract();
  if (g.kind === 'rubber') {
    const t = g.t;
    if (t && g.moved && g.cur) {
      const sel = selOf(t);
      const x0 = Math.min(g.startS.x, g.cur.x), x1 = Math.max(g.startS.x, g.cur.x), y0 = Math.min(g.startS.y, g.cur.y), y1 = Math.max(g.startS.y, g.cur.y);
      const ss = toScreenSubs(ed, g.base);
      ss.forEach((s, si) => {
        if (g.direct) s.pts.forEach((a, pi) => { if (a.x >= x0 && a.x <= x1 && a.y >= y0 && a.y <= y1) sel.anchors.add(akey(si, pi)); });
        else {
          const b = boundsOf([s]);
          if (b && b.x <= x1 && b.x + b.w >= x0 && b.y <= y1 && b.y + b.h >= y0 && flattenSub(s, 1).some((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)) sel.subs.add(si);
        }
      });
      if (!g.direct) sel.anchors = anchorsOfSubs(g.base, sel.subs);
    }
    ed.redraw(false); ed.emit();
    return;
  }
  if (g.kind === 'convert' && !g.moved && g.part === undefined) {
    // לחיצה בלי גרירה: נקודה חלקה הופכת לפינה
    const next = g.base.map(cloneSub);
    const a = next[g.si!].pts[g.pi!];
    if (hasIn(a) || hasOut(a)) {
      a.ix = a.x; a.iy = a.y; a.ox = a.x; a.oy = a.y; a.smooth = false;
      writeDocSubs(ed, g.t!, next);
      ed.commit('המרת נקודה לפינה');
    }
    return;
  }
  if (g.moved || g.dup) ed.commit(g.kind === 'convert' ? 'המרת נקודה' : g.label);
  else ed.redraw(true);
}

function drawRubber(ed: Editor, x: CanvasRenderingContext2D) {
  if (drag?.kind !== 'rubber' || !drag.moved || !drag.cur) return;
  const a = drag.startS, b = drag.cur;
  x.fillStyle = 'rgba(77,163,255,.12)';
  x.strokeStyle = '#4da3ff';
  x.lineWidth = 1;
  x.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  x.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
}

function selOverlay(ed: Editor, x: CanvasRenderingContext2D, direct: boolean) {
  const t = currentTarget(ed);
  if (t) {
    const sel = selOf(t);
    drawPathUI(ed, x, docSubs(t), { anchors: direct || sel.subs.size > 0, selected: sel.anchors, handles: direct ? (si, pi) => sel.anchors.has(akey(si, pi)) : undefined });
  }
  drawRubber(ed, x);
}

/** מקשים משותפים: חיצים מזיזים, Delete מוחק, Esc מבטל בחירה */
function selKey(ed: Editor, combo: string, direct: boolean): boolean {
  const t = currentTarget(ed);
  if (!t) return false;
  const sel = selOf(t);
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const k = combo.replace('Shift+', '');
  if (arrows[k] && !combo.includes('Ctrl') && !combo.includes('Alt')) {
    if (!sel.anchors.size && !sel.subs.size) return false;
    if (lockedToast(ed, t)) return true;
    const m = combo.startsWith('Shift+') ? 10 : 1;
    const [dx, dy] = [arrows[k][0] * m, arrows[k][1] * m];
    const subs = docSubs(t);
    writeDocSubs(ed, t, subs.map((s, si) => ({ closed: s.closed, pts: s.pts.map((a, pi) => ((!direct && sel.subs.size ? sel.subs.has(si) : sel.anchors.has(akey(si, pi))) ? moveAnchor(a, dx, dy) : a)) })));
    ed.commit(direct ? 'הזזת נקודות עיגון' : 'הזזת נתיב');
    return true;
  }
  if (combo === 'Delete' || combo === 'Backspace') {
    if (!sel.anchors.size && !sel.subs.size) return false;
    if (lockedToast(ed, t)) return true;
    const subs = docSubs(t);
    let next: SubPath[];
    if (!direct && sel.subs.size) next = subs.filter((_, si) => !sel.subs.has(si));
    else next = subs.flatMap((s, si) => deleteAnchorsBreaking(s, new Set(s.pts.map((_, pi) => pi).filter((pi) => sel.anchors.has(akey(si, pi))))));
    sel.anchors.clear(); sel.subs.clear();
    writeDocSubs(ed, t, next);
    ed.commit(!direct && next.length < subs.length ? 'מחיקת רכיב נתיב' : 'מחיקת נקודות עיגון');
    return true;
  }
  if (combo === 'Escape' && (sel.anchors.size || sel.subs.size)) { sel.anchors.clear(); sel.subs.clear(); ed.redraw(false); return true; }
  if (combo === 'Ctrl+A' && direct) {
    // Direct Selection: Ctrl+A בוחר את כל נקודות הנתיב (לא את כל המסמך) — רק כשיש כבר בחירת נקודות
    if (!sel.anchors.size) return false;
    sel.anchors = anchorsOfSubs(docSubs(t), new Set(docSubs(t).map((_, i) => i)));
    ed.redraw(false);
    return true;
  }
  return false;
}

const ARROW_CURSOR = (filled: boolean) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M3 2 L3 16 L7 12.5 L9.6 18 L12 17 L9.4 11.6 L14.5 11.4 Z" fill="${filled ? 'black' : 'white'}" stroke="${filled ? 'white' : 'black'}" stroke-width="1.2" stroke-linejoin="round"/></svg>`)}") 3 2, default`;

const selTool = (id: 'pathSel' | 'directSel'): Tool => {
  const direct = id === 'directSel';
  return {
    id,
    cursor: (_ed, e) => ARROW_CURSOR(!(direct !== !!e?.ctrl)),
    down(ed, e) { selDown(ed, e, direct !== e.ctrl); },
    move(ed, e) { dragMove(ed, e); },
    up(ed) { dragUp(ed); },
    overlay(ed, x) { selOverlay(ed, x, direct); },
    key(ed, combo) { return selKey(ed, combo, direct); },
    deactivate(ed) { if (drag) dragUp(ed); },
  };
};

/* ======================= Pen ======================= */

interface PenSession {
  sub: SubPath;
  mode: 'path' | 'shape';
  /** היעד שאליו נכנס תת-הנתיב בסיום (null = Work Path חדש / שכבת צורה חדשה) */
  targetKey: string | null;
  addToShape: boolean;
  drag: { idx: number; closing: boolean; alt: boolean } | null;
  hover: P2 | null;
  resumed: boolean;
}
let pen: PenSession | null = null;
/** Ctrl / Alt בכלי עט: מעבירים את הגרירה לכלי אחר עד שחרור */
let delegate: { move(ed: Editor, e: PtrEvt): void; up(ed: Editor, e: PtrEvt): void } | null = null;

const SEL_DELEGATE = { move: dragMove, up: (ed: Editor) => dragUp(ed) };

/** תת-נתיב שהסתיים → ליעד, לשכבת צורה חדשה או ל-Work Path */
function commitSub(ed: Editor, sub: SubPath, mode: 'path' | 'shape', targetKey: string | null, addToShape: boolean, resumed = false) {
  if (sub.pts.length < 2 && !resumed) { ed.redraw(false); return; }
  const t = targetKey ? resolveTarget(ed, targetKey) : null;
  if (resumed && t && !targetLocked(t)) {
    writeDocSubs(ed, t, [...docSubs(t), sub]);
    ed.commit('המשך נתיב');
    return;
  }
  if (mode === 'shape' && !(addToShape && t?.kind === 'shape')) {
    createPathShape(ed, [sub]);
    ed.commit('עט: צורה חדשה');
    return;
  }
  if (t && !targetLocked(t)) {
    writeDocSubs(ed, t, [...docSubs(t), sub]);
    ed.commit(t.kind === 'vmask' ? 'עט: מסכה וקטורית' : t.kind === 'shape' ? 'עט: הוספה לצורה' : 'עט: נתיב');
    return;
  }
  setWorkPath(ed, [sub]);
  ed.commit('נתיב עבודה חדש');
  ed.openPanel('Paths');
}

function penFinish(ed: Editor) {
  const s = pen;
  pen = null;
  ed.status = '';
  if (!s) return;
  commitSub(ed, s.sub, s.mode, s.targetKey, s.addToShape, s.resumed);
}

/** היעד של כלי העט בתחילת תת-נתיב */
function penTargetKey(ed: Editor, mode: 'path' | 'shape', shift: boolean): string | null {
  const t = currentTarget(ed);
  if (!t) return null;
  if (mode === 'shape') return shift && t.kind === 'shape' ? t.key : null;
  return t.key;
}

/** Auto Add/Delete + המשך נתיב פתוח מהקצה. מחזיר true אם הלחיצה טופלה */
function penAutoEdit(ed: Editor, e: PtrEvt): boolean {
  const t = currentTarget(ed);
  if (!t || (ed.opts.pen.mode === 'shape' && t.kind !== 'shape')) return false;
  const subs = docSubs(t);
  const h = hitPoint(ed, subs, e.screen, () => false);
  if (h) {
    if (lockedToast(ed, t)) return true;
    const s = subs[h.si];
    if (e.alt) { convertDown(ed, e, t, subs, h); return true; }
    if (!s.closed && (h.pi === 0 || h.pi === s.pts.length - 1) && s.pts.length >= 1) {
      // לחיצה על קצה של נתיב פתוח = המשך הציור ממנו
      const sub = h.pi === 0 ? reverseSub(s) : cloneSub(s);
      writeDocSubs(ed, t, subs.filter((_, i) => i !== h.si));
      pen = { sub, mode: 'path', targetKey: t.key, addToShape: false, drag: null, hover: e.doc, resumed: true };
      ed.status = 'ממשיך את הנתיב · Enter לסיום';
      ed.redraw(false);
      return true;
    }
    if (!ed.opts.pen.autoAddDelete) return false;
    const r = removeAnchor(s, h.pi);
    writeDocSubs(ed, t, r ? subs.map((x, i) => (i === h.si ? r : x)) : subs.filter((_, i) => i !== h.si));
    selOf(t).anchors.clear();
    ed.commit('מחיקת נקודת עיגון');
    return true;
  }
  if (!ed.opts.pen.autoAddDelete) return false;
  const sg = hitSeg(ed, subs, e);
  if (sg) {
    if (lockedToast(ed, t)) return true;
    addAnchorAndDrag(ed, e, t, subs, sg);
    return true;
  }
  return false;
}

function addAnchorAndDrag(ed: Editor, e: PtrEvt, t: Target, subs: SubPath[], sg: { si: number; seg: number; t: number }) {
  const next = subs.map((s, i) => (i === sg.si ? insertAnchor(s, sg.seg, sg.t) : s));
  writeDocSubs(ed, t, next);
  const sel = selOf(t);
  sel.anchors = new Set([akey(sg.si, sg.seg + 1)]);
  sel.subs.clear();
  ed0 = ed;
  startDrag({ kind: 'anchors', t, base: next, start: e.doc, dup: true, label: 'הוספת נקודת עיגון' }, e);
  delegate = SEL_DELEGATE;
}

function convertDown(ed: Editor, e: PtrEvt, t: Target, subs: SubPath[], h: PtHit) {
  ed0 = ed;
  selOf(t).anchors = new Set([akey(h.si, h.pi)]);
  startDrag({ kind: 'convert', t, base: subs, start: e.doc, si: h.si, pi: h.pi, part: h.part === 'anchor' ? undefined : h.part, label: 'המרת נקודה' }, e);
  delegate = SEL_DELEGATE;
}

const PEN_SVG = (badge: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M2 2 L6.5 13.5 L10 12 L14.5 16.5 L16.5 14.5 L12 10 L13.5 6.5 Z" fill="white" stroke="black" stroke-width="1.2" stroke-linejoin="round"/><circle cx="7" cy="7" r="1.2" fill="black"/>${badge ? `<text x="17" y="23" font-size="10" font-family="Arial" font-weight="bold" fill="black" stroke="white" stroke-width="2.5" paint-order="stroke">${badge}</text>` : ''}</svg>`)}") 2 2, crosshair`;

function penCursor(ed: Editor, e: PtrEvt | null): string {
  if (!e || !ed.doc) return PEN_SVG('');
  if (e.ctrl) return ARROW_CURSOR(false);
  if (pen) {
    if (pen.sub.pts.length >= 2 && dist(ed.toScreen(pen.sub.pts[0]), e.screen) < 8) return PEN_SVG('o');
    return PEN_SVG('');
  }
  const t = currentTarget(ed);
  if (t && !(ed.opts.pen.mode === 'shape' && t.kind !== 'shape')) {
    const subs = docSubs(t);
    const h = hitPoint(ed, subs, e.screen, () => false);
    if (h) {
      const s = subs[h.si];
      if (e.alt) return PEN_SVG('^');
      if (!s.closed && (h.pi === 0 || h.pi === s.pts.length - 1)) return PEN_SVG('/');
      if (ed.opts.pen.autoAddDelete) return PEN_SVG('−');
    } else if (ed.opts.pen.autoAddDelete && hitSeg(ed, subs, e)) return PEN_SVG('+');
  }
  return PEN_SVG('*');
}

const PenTool: Tool = {
  id: 'pen',
  cursor: penCursor,
  down(ed, e) {
    if (e.ctrl) { selDown(ed, { ...e, ctrl: false }, true); delegate = SEL_DELEGATE; return; }
    if (!pen) {
      if (penAutoEdit(ed, e)) return;
      const mode = ed.opts.pen.mode;
      pen = { sub: { closed: false, pts: [anchor(e.doc.x, e.doc.y)] }, mode, targetKey: penTargetKey(ed, mode, e.shift), addToShape: mode === 'shape' && e.shift, drag: { idx: 0, closing: false, alt: e.alt }, hover: e.doc, resumed: false };
      ed.status = 'לחיצה = פינה · גרירה = נקודה חלקה · Alt+גרירה שוברת ידית · לחיצה על הנקודה הראשונה סוגרת · Enter מסיים';
      ed.redraw(false); ed.emit();
      return;
    }
    const pts = pen.sub.pts;
    const first = pts[0], last = pts[pts.length - 1];
    if (pts.length >= 2 && dist(ed.toScreen(first), e.screen) < 8) {
      pen.sub.closed = true;
      pen.drag = { idx: 0, closing: true, alt: e.alt };
      ed.redraw(false);
      return;
    }
    if (dist(ed.toScreen(last), e.screen) < 6) {
      // Alt+לחיצה (או לחיצה) על הנקודה האחרונה: מבטלת את הידית היוצאת — הקטע הבא מתחיל בפינה
      if (e.alt || hasOut(last)) { last.ox = last.x; last.oy = last.y; last.smooth = false; }
      pen.drag = { idx: pts.length - 1, closing: false, alt: true };
      ed.redraw(false);
      return;
    }
    const p = e.shift ? snap45(last, e.doc) : e.doc;
    pts.push(anchor(p.x, p.y));
    pen.drag = { idx: pts.length - 1, closing: false, alt: e.alt };
    ed.redraw(false);
  },
  move(ed, e) {
    if (delegate) { delegate.move(ed, e); return; }
    if (!pen?.drag) return;
    const a = pen.sub.pts[pen.drag.idx];
    let c = e.doc;
    if (e.shift) c = snap45(a, c);
    if (dist(ed.toScreen(a), ed.toScreen(c)) < 2) return;
    a.ox = c.x; a.oy = c.y;
    if (pen.drag.alt || e.alt) a.smooth = false;
    else { a.ix = 2 * a.x - c.x; a.iy = 2 * a.y - c.y; a.smooth = true; }
    pen.hover = e.doc;
    ed.redraw(false);
  },
  hover(ed, e) {
    if (!pen) return;
    const last = pen.sub.pts[pen.sub.pts.length - 1];
    pen.hover = e.shift ? snap45(last, e.doc) : e.doc;
    ed.redraw(false);
  },
  up(ed, e) {
    if (delegate) { const d = delegate; delegate = null; d.up(ed, e); return; }
    if (!pen) return;
    const closing = pen.drag?.closing;
    pen.drag = null;
    if (closing) penFinish(ed);
  },
  key(ed, combo) {
    if (!pen) return false;
    if (combo === 'Enter' || combo === 'Escape') { penFinish(ed); return true; }
    if (combo === 'Ctrl+Enter') { penFinish(ed); return false; }
    if (combo === 'Backspace' || combo === 'Delete') {
      pen.sub.pts.pop();
      if (!pen.sub.pts.length) { pen = null; ed.status = ''; }
      ed.redraw(false);
      return true;
    }
    return false;
  },
  overlay(ed, x) { penOverlay(ed, x); },
  deactivate(ed) { penFinish(ed); },
  cancel(ed) { pen = null; ed.status = ''; },
};

function fillPreview(ed: Editor, x: CanvasRenderingContext2D, subs: SubPath[]) {
  const f = ed.opts.shape.fill;
  if (f.type === 'none') return;
  x.save();
  x.globalAlpha = 0.55;
  x.fillStyle = f.color;
  x.beginPath();
  traceSubs(x, toScreenSubs(ed, subs));
  x.fill('nonzero');
  x.restore();
}

function targetOverlay(ed: Editor, x: CanvasRenderingContext2D, round = false) {
  const t = currentTarget(ed);
  if (t) { const sel = selOf(t); drawPathUI(ed, x, docSubs(t), { anchors: true, selected: sel.anchors, round }); }
}

function penOverlay(ed: Editor, x: CanvasRenderingContext2D) {
  targetOverlay(ed, x);
  drawRubber(ed, x);
  if (!pen) return;
  const s = pen.sub;
  if (pen.mode === 'shape' && s.pts.length >= 2) fillPreview(ed, x, [s]);
  // Rubber Band: הקטע הבא בתצוגה מקדימה עד הסמן
  if (pen.hover && !s.closed && (ed.opts.pen.rubberBand || pen.drag) && !pen.drag) {
    const last = s.pts[s.pts.length - 1];
    const ghost: SubPath = { closed: false, pts: [{ ...last, ix: last.x, iy: last.y }, anchor(pen.hover.x, pen.hover.y)] };
    const gs = toScreenSubs(ed, [ghost]);
    x.setLineDash([3, 3]);
    outline(x, gs, '#4da3ff');
    x.setLineDash([]);
  }
  const n = s.pts.length;
  drawPathUI(ed, x, [s], { anchors: true, selected: new Set([akey(0, n - 1)]), handles: (_si, pi) => pi === n - 1 || pi === n - 2 || (s.closed && pi === 0) || pen?.drag?.idx === pi });
  if (n >= 2 && pen.hover && !s.closed && dist(ed.toScreen(s.pts[0]), ed.toScreen(pen.hover)) < 8) {
    const p = ed.toScreen(s.pts[0]);
    x.strokeStyle = BLUE; x.lineWidth = 1.5;
    x.beginPath(); x.arc(p.x, p.y, 7, 0, Math.PI * 2); x.stroke();
  }
}

/* ======================= Freeform Pen ======================= */

let free: { pts: P2[]; mode: 'path' | 'shape'; targetKey: string | null; addToShape: boolean } | null = null;

const FreePenTool: Tool = {
  id: 'freePen',
  cursor: (ed, e) => (e?.ctrl ? ARROW_CURSOR(false) : PEN_SVG('~')),
  down(ed, e) {
    if (e.ctrl) { selDown(ed, { ...e, ctrl: false }, true); delegate = SEL_DELEGATE; return; }
    const mode = ed.opts.pen.mode;
    free = { pts: [e.doc], mode, targetKey: penTargetKey(ed, mode, e.shift), addToShape: mode === 'shape' && e.shift };
  },
  move(ed, e) {
    if (delegate) { delegate.move(ed, e); return; }
    if (!free) return;
    const last = free.pts[free.pts.length - 1];
    if (dist(ed.toScreen(last), e.screen) >= 1) { free.pts.push(e.doc); ed.redraw(false); }
  },
  up(ed, e) {
    if (delegate) { const d = delegate; delegate = null; d.up(ed, e); return; }
    if (!free) return;
    const f = free;
    free = null;
    if (f.pts.length < 2) { ed.redraw(false); return; }
    const z = ed.st!.zoom;
    const closeIt = f.pts.length > 4 && dist(ed.toScreen(f.pts[0]), ed.toScreen(f.pts[f.pts.length - 1])) < 10;
    if (closeIt) f.pts.push(f.pts[0]);
    // Curve Fit בפיקסלי מסך (כמו בפוטושופ): 2px = נאמן לתנועת היד
    const sub = freeformSub(f.pts, ed.opts.pen.curveFit / z);
    if (!sub) { ed.redraw(false); return; }
    if (closeIt && sub.pts.length > 2) {
      const lastA = sub.pts.pop()!;
      sub.pts[0].ix = lastA.ix; sub.pts[0].iy = lastA.iy;
      sub.closed = true;
    }
    commitSub(ed, sub, f.mode, f.targetKey, f.addToShape);
  },
  overlay(ed, x) {
    targetOverlay(ed, x);
    drawRubber(ed, x);
    if (!free || free.pts.length < 2) return;
    const ps = free.pts.map((p) => ed.toScreen(p));
    x.beginPath();
    ps.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
    x.strokeStyle = BLUE; x.lineWidth = 1.5;
    x.stroke();
  },
  deactivate() { free = null; },
};

/* ======================= Curvature Pen ======================= */

let curv: { pts: CurvPt[]; closed: boolean; mode: 'path' | 'shape'; targetKey: string | null; addToShape: boolean; drag: number | null; hover: P2 | null } | null = null;

const curvSub = (c: NonNullable<typeof curv>): SubPath => ({ closed: c.closed, pts: curvatureAnchors(c.pts, c.closed) });

function curvFinish(ed: Editor) {
  const c = curv;
  curv = null;
  ed.status = '';
  if (!c) return;
  commitSub(ed, curvSub(c), c.mode, c.targetKey, c.addToShape);
}

const CurvPenTool: Tool = {
  id: 'curvPen',
  cursor: (ed, e) => (e?.ctrl ? ARROW_CURSOR(false) : PEN_SVG('◠')),
  down(ed, e) {
    if (e.ctrl) { selDown(ed, { ...e, ctrl: false }, true); delegate = SEL_DELEGATE; return; }
    if (!curv) {
      const mode = ed.opts.pen.mode;
      curv = { pts: [{ x: e.doc.x, y: e.doc.y, corner: false }], closed: false, mode, targetKey: penTargetKey(ed, mode, e.shift), addToShape: mode === 'shape' && e.shift, drag: 0, hover: e.doc };
      ed.status = 'לחיצה מוסיפה נקודה — העקומה עוברת דרכה · דאבל-קליק = פינה · גרירת נקודה מזיזה אותה · Enter מסיים';
      ed.redraw(false); ed.emit();
      return;
    }
    const i = curv.pts.findIndex((p) => dist(ed.toScreen(p), e.screen) < 8);
    if (i >= 0) {
      if (i === 0 && curv.pts.length >= 3 && !curv.closed && e.clicks < 2) { curv.closed = true; curvFinish(ed); return; }
      if (e.clicks >= 2) curv.pts[i] = { ...curv.pts[i], corner: !curv.pts[i].corner };
      curv.drag = i;
      ed.redraw(false);
      return;
    }
    // לחיצה על העקומה מוסיפה נקודה ביניים
    const sub = curvSub(curv);
    const sg = hitSeg(ed, [sub], e);
    if (sg) { curv.pts.splice(sg.seg + 1, 0, { x: e.doc.x, y: e.doc.y, corner: false }); curv.drag = sg.seg + 1; }
    else { curv.pts.push({ x: e.doc.x, y: e.doc.y, corner: false }); curv.drag = curv.pts.length - 1; }
    ed.redraw(false);
  },
  move(ed, e) {
    if (delegate) { delegate.move(ed, e); return; }
    if (!curv || curv.drag === null) return;
    curv.pts[curv.drag] = { ...curv.pts[curv.drag], x: e.doc.x, y: e.doc.y };
    ed.redraw(false);
  },
  hover(ed, e) { if (curv) { curv.hover = e.doc; ed.redraw(false); } },
  up(ed, e) {
    if (delegate) { const d = delegate; delegate = null; d.up(ed, e); return; }
    if (curv) curv.drag = null;
  },
  key(ed, combo) {
    if (!curv) return false;
    if (combo === 'Enter' || combo === 'Escape') { curvFinish(ed); return true; }
    if (combo === 'Ctrl+Enter') { curvFinish(ed); return false; }
    if (combo === 'Backspace' || combo === 'Delete') {
      curv.pts.pop();
      if (!curv.pts.length) { curv = null; ed.status = ''; }
      ed.redraw(false);
      return true;
    }
    return false;
  },
  overlay(ed, x) {
    targetOverlay(ed, x);
    drawRubber(ed, x);
    if (!curv) return;
    const preview: CurvPt[] = curv.hover && curv.drag === null && !curv.closed ? [...curv.pts, { ...curv.hover, corner: false }] : curv.pts;
    const sub: SubPath = { closed: curv.closed, pts: curvatureAnchors(preview, curv.closed) };
    if (curv.mode === 'shape' && preview.length >= 2) fillPreview(ed, x, [sub]);
    outline(x, toScreenSubs(ed, [sub]));
    for (const p of curv.pts) {
      const s = ed.toScreen(p);
      x.fillStyle = p.corner ? BLUE : '#fff'; x.strokeStyle = BLUE; x.lineWidth = 1;
      x.beginPath();
      if (p.corner) x.rect(s.x - 3.5, s.y - 3.5, 7, 7); else x.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
      x.fill(); x.stroke();
    }
  },
  deactivate(ed) { curvFinish(ed); },
  cancel(ed) { curv = null; ed.status = ''; },
};

/* ======================= Add / Delete Anchor, Convert Point ======================= */

/** בלי יעד: לחיצה על שכבת צורה בוחרת אותה (והנתיב שלה הופך ליעד) */
function pickShapeTarget(ed: Editor, e: PtrEvt): Target | null {
  const hit = ed.hitTest(e.doc);
  if (hit && hit.type === 'shape') {
    ed.selectLayer(hit.id);
    if (hit.shape !== 'path' && convertToShape(ed, hit, false)) ed.commit('המרה לצורה');
    setActivePath(ed, `shape:${hit.id}`);
  }
  return currentTarget(ed);
}

const AddAnchorTool: Tool = {
  id: 'addAnchor',
  cursor: (ed, e) => (e?.ctrl ? ARROW_CURSOR(false) : PEN_SVG('+')),
  down(ed, e) {
    if (e.ctrl) { selDown(ed, { ...e, ctrl: false }, true); delegate = SEL_DELEGATE; return; }
    const t = currentTarget(ed);
    if (!t) { pickShapeTarget(ed, e); return; }
    const subs = docSubs(t);
    if (e.alt) { const h = hitPoint(ed, subs, e.screen, () => true); if (h && !lockedToast(ed, t)) convertDown(ed, e, t, subs, h); return; }
    const sg = hitSeg(ed, subs, e);
    if (!sg) { if (!pickShapeTarget(ed, e)) ed.toast('לחצו על קטע של הנתיב כדי להוסיף נקודה'); return; }
    if (lockedToast(ed, t)) return;
    addAnchorAndDrag(ed, e, t, subs, sg);
  },
  move(ed, e) { if (delegate) delegate.move(ed, e); },
  up(ed, e) { if (delegate) { const d = delegate; delegate = null; d.up(ed, e); } },
  overlay(ed, x) { targetOverlay(ed, x); drawRubber(ed, x); },
};

const DelAnchorTool: Tool = {
  id: 'delAnchor',
  cursor: (ed, e) => (e?.ctrl ? ARROW_CURSOR(false) : PEN_SVG('−')),
  down(ed, e) {
    if (e.ctrl) { selDown(ed, { ...e, ctrl: false }, true); delegate = SEL_DELEGATE; return; }
    const t = currentTarget(ed);
    if (!t) { pickShapeTarget(ed, e); return; }
    const subs = docSubs(t);
    const h = hitPoint(ed, subs, e.screen, () => false);
    if (!h) { if (!pickShapeTarget(ed, e)) ed.toast('לחצו על נקודת עיגון כדי למחוק אותה'); return; }
    if (lockedToast(ed, t)) return;
    if (e.alt) { convertDown(ed, e, t, subs, h); return; }
    const r = removeAnchor(subs[h.si], h.pi);
    writeDocSubs(ed, t, r ? subs.map((x, i) => (i === h.si ? r : x)) : subs.filter((_, i) => i !== h.si));
    selOf(t).anchors.clear();
    ed.commit('מחיקת נקודת עיגון');
  },
  move(ed, e) { if (delegate) delegate.move(ed, e); },
  up(ed, e) { if (delegate) { const d = delegate; delegate = null; d.up(ed, e); } },
  overlay(ed, x) { targetOverlay(ed, x); drawRubber(ed, x); },
};

const ConvertTool: Tool = {
  id: 'convertPt',
  cursor: (ed, e) => (e?.ctrl ? ARROW_CURSOR(false) : PEN_SVG('^')),
  down(ed, e) {
    if (e.ctrl) { selDown(ed, { ...e, ctrl: false }, true); delegate = SEL_DELEGATE; return; }
    const t = currentTarget(ed);
    if (!t) { pickShapeTarget(ed, e); return; }
    const subs = docSubs(t);
    const h = hitPoint(ed, subs, e.screen, () => true);
    if (!h) { pickShapeTarget(ed, e); return; }
    if (lockedToast(ed, t)) return;
    convertDown(ed, e, t, subs, h);
  },
  move(ed, e) { if (delegate) delegate.move(ed, e); },
  up(ed, e) { if (delegate) { const d = delegate; delegate = null; d.up(ed, e); } },
  overlay(ed, x) {
    const t = currentTarget(ed);
    // Convert Point מציג את כל הידיות
    if (t) drawPathUI(ed, x, docSubs(t), { anchors: true, selected: selOf(t).anchors, handles: () => true });
    drawRubber(ed, x);
  },
};

/* ======================= רישום ======================= */

export const PEN_TOOLS: Record<'pen' | 'freePen' | 'curvPen' | 'addAnchor' | 'delAnchor' | 'convertPt' | 'pathSel' | 'directSel', Tool> = {
  pen: PenTool,
  freePen: FreePenTool,
  curvPen: CurvPenTool,
  addAnchor: AddAnchorTool,
  delAnchor: DelAnchorTool,
  convertPt: ConvertTool,
  pathSel: selTool('pathSel'),
  directSel: selTool('directSel'),
};

