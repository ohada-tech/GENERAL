/**
 * כלי מדידה ותצוגה: Color Sampler (עד 10 נקודות דגימה קבועות), Ruler (מרחק וזווית + Straighten Layer)
 * ו-Rotate View (מסובב רק את התצוגה, לא את הפיקסלים). הערכים מוצגים בסרגל האפשרויות ובפאנל Info.
 * נקודות דגימה והסרגל אינם חלק מהמסמך (כמו בפוטושופ) ולכן לא נכנסים להיסטוריה; Straighten כן.
 */
import type { DocState, Editor } from './editor';
import type { Pt, Rect } from './model';
import { touch, xfLeaves } from './model';
import { layerBounds } from './render';
import type { Tool } from './tools';
import { rulerInfo, straightenDelta } from './pixel-algo';
import { compPixel, drawCross } from './paint-engine';
import { OVERLAY_HOOKS } from './tool-registry';

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/* ======================= Color Sampler ======================= */

const samplers = new WeakMap<DocState, Pt[]>();
export const samplersOf = (st: DocState | null): Pt[] => {
  if (!st) return [];
  let s = samplers.get(st);
  if (!s) { s = []; samplers.set(st, s); }
  return s;
};
export const MAX_SAMPLERS = 10;

export function clearSamplers(ed: Editor) { if (ed.st) samplers.set(ed.st, []); ed.redraw(false); ed.emit(); }

function hitSampler(ed: Editor, sp: Pt): number {
  const list = samplersOf(ed.st);
  for (let i = list.length - 1; i >= 0; i--) if (dist(ed.toScreen(list[i]), sp) <= 8) return i;
  return -1;
}

let samplerDrag: number | null = null;

export const ColorSamplerTool: Tool = {
  id: 'colorSampler',
  cursor: () => 'crosshair',
  down(ed, e) {
    const list = samplersOf(ed.st);
    const hit = hitSampler(ed, e.screen);
    // Alt+לחיצה על נקודה = מחיקה (כמו בפוטושופ)
    if (hit >= 0 && e.alt) { list.splice(hit, 1); ed.redraw(false); ed.emit(); return; }
    if (hit >= 0) { samplerDrag = hit; return; }
    const d = ed.doc!;
    if (e.doc.x < 0 || e.doc.y < 0 || e.doc.x >= d.width || e.doc.y >= d.height) return;
    if (list.length >= MAX_SAMPLERS) { ed.toast(`אפשר עד ${MAX_SAMPLERS} נקודות דגימה · Alt+לחיצה מוחקת נקודה`, 'error'); return; }
    list.push({ x: Math.floor(e.doc.x) + 0.5, y: Math.floor(e.doc.y) + 0.5 });
    samplerDrag = list.length - 1;
    ed.redraw(false);
    ed.emit();
  },
  move(ed, e) {
    if (samplerDrag == null) return;
    const d = ed.doc!;
    samplersOf(ed.st)[samplerDrag] = { x: Math.min(d.width - 0.5, Math.max(0.5, Math.floor(e.doc.x) + 0.5)), y: Math.min(d.height - 0.5, Math.max(0.5, Math.floor(e.doc.y) + 0.5)) };
    ed.redraw(false);
    ed.emit();
  },
  up(ed, e) {
    if (samplerDrag != null) {
      // גרירה אל מחוץ למסמך מוחקת את הנקודה
      const d = ed.doc!;
      if (e.doc.x < 0 || e.doc.y < 0 || e.doc.x > d.width || e.doc.y > d.height) samplersOf(ed.st).splice(samplerDrag, 1);
    }
    samplerDrag = null;
    ed.redraw(false);
    ed.emit();
  },
};

/** הנקודות מצוירות בכל כלי כשיש תוספות תצוגה */
OVERLAY_HOOKS.push((ed, x) => {
  if (!ed.view.extras) return;
  const list = samplersOf(ed.st);
  list.forEach((p, i) => {
    const s = ed.toScreen(p);
    x.lineWidth = 1;
    x.strokeStyle = 'rgba(0,0,0,.7)';
    x.beginPath(); x.arc(s.x, s.y, 5, 0, Math.PI * 2); x.stroke();
    drawCross(x, s, 7);
    x.font = '600 10px -apple-system, "SF Pro Text", Inter, sans-serif';
    x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,.7)'; x.strokeText(String(i + 1), s.x + 7, s.y + 14);
    x.fillStyle = '#fff'; x.fillText(String(i + 1), s.x + 7, s.y + 14);
  });
});

export function samplerValues(ed: Editor): Array<{ p: Pt; rgb: [number, number, number, number] | null }> {
  return samplersOf(ed.st).map((p) => ({ p, rgb: compPixel(ed, p) }));
}

/* ======================= Ruler ======================= */

const rulers = new WeakMap<DocState, { a: Pt; b: Pt }>();
export const rulerOf = (st: DocState | null) => (st ? rulers.get(st) ?? null : null);
export function clearRuler(ed: Editor) { if (ed.st) rulers.delete(ed.st); ed.redraw(false); ed.emit(); }
export const rulerMeasure = (st: DocState | null) => { const r = rulerOf(st); return r ? rulerInfo(r.a, r.b) : null; };

let rulerDrag: { end: 'a' | 'b' } | null = null;

export const RulerTool: Tool = {
  id: 'ruler',
  cursor: () => 'crosshair',
  down(ed, e) {
    const st = ed.st!;
    const r = rulers.get(st);
    if (r && dist(ed.toScreen(r.a), e.screen) <= 7) { rulerDrag = { end: 'a' }; return; }
    if (r && dist(ed.toScreen(r.b), e.screen) <= 7) { rulerDrag = { end: 'b' }; return; }
    rulers.set(st, { a: e.doc, b: e.doc });
    rulerDrag = { end: 'b' };
    ed.redraw(false);
    ed.emit();
  },
  move(ed, e) {
    const r = rulerOf(ed.st);
    if (!rulerDrag || !r) return;
    const fixed = rulerDrag.end === 'a' ? r.b : r.a;
    let p = e.doc;
    if (e.shift) {
      const a = Math.atan2(p.y - fixed.y, p.x - fixed.x), len = dist(fixed, p), s = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
      p = { x: fixed.x + Math.cos(s) * len, y: fixed.y + Math.sin(s) * len };
    }
    r[rulerDrag.end] = p;
    ed.redraw(false);
    ed.emit();
  },
  up(ed) {
    rulerDrag = null;
    const r = rulerOf(ed.st);
    if (r && dist(r.a, r.b) * ed.st!.zoom < 2) rulers.delete(ed.st!);
    ed.redraw(false);
    ed.emit();
  },
  key(ed, combo) {
    if (combo === 'Escape' && rulerOf(ed.st)) { clearRuler(ed); return true; }
    return false;
  },
  overlay(ed, x) {
    const r = rulerOf(ed.st);
    if (!r) return;
    const a = ed.toScreen(r.a), b = ed.toScreen(r.b);
    x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,.55)';
    x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
    x.lineWidth = 1; x.strokeStyle = '#fff';
    x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
    for (const p of [a, b]) { x.beginPath(); x.moveTo(p.x - 5, p.y); x.lineTo(p.x + 5, p.y); x.moveTo(p.x, p.y - 5); x.lineTo(p.x, p.y + 5); x.stroke(); }
  },
};

/** Straighten Layer: מסובב את השכבות הנבחרות סביב מרכזן כך שקו הסרגל יהיה אופקי (או אנכי) */
export function straightenLayer(ed: Editor) {
  const r = rulerOf(ed.st);
  if (!r) { ed.toast('מתחו קו עם הסרגל לאורך מה שצריך להיות ישר', 'error'); return; }
  const leaves = ed.topSelected().filter((l) => !l.locked).flatMap(xfLeaves).filter((l) => !l.locked);
  if (!leaves.length) { ed.toast('בחר שכבה ליישור', 'error'); return; }
  const delta = straightenDelta(r.a, r.b);
  if (Math.abs(delta) < 0.01) { ed.toast('הקו כבר ישר'); return; }
  let box: Rect | null = null;
  for (const l of leaves) { const b = layerBounds(l); if (!b) continue; box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) } : b; }
  const c = box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : { x: ed.doc!.width / 2, y: ed.doc!.height / 2 };
  const ar = (delta * Math.PI) / 180;
  for (const l of leaves) {
    const dx = l.t.x - c.x, dy = l.t.y - c.y;
    l.t.x = c.x + dx * Math.cos(ar) - dy * Math.sin(ar);
    l.t.y = c.y + dx * Math.sin(ar) + dy * Math.cos(ar);
    l.t.rot = (l.t.rot + delta) % 360;
    touch(l);
  }
  rulers.delete(ed.st!);
  ed.commit(`יישור שכבה ${delta > 0 ? '+' : ''}${delta.toFixed(1)}°`);
}

/* ======================= Rotate View ======================= */

let rotDrag: { a0: number; r0: number } | null = null;

const centerOf = (ed: Editor): Pt => ({ x: (ed.canvas?.clientWidth ?? 0) / 2, y: (ed.canvas?.clientHeight ?? 0) / 2 });

export const RotateViewTool: Tool = {
  id: 'rotateView',
  cursor: () => (rotDrag ? 'grabbing' : 'grab'),
  down(ed, e) {
    const c = centerOf(ed);
    rotDrag = { a0: Math.atan2(e.screen.y - c.y, e.screen.x - c.x), r0: ed.st!.rot ?? 0 };
    // לחיצה כפולה = איפוס (כמו לחיצה על Reset View)
    if (e.clicks >= 2) { rotDrag = null; ed.setViewRotation(0); }
  },
  move(ed, e) {
    if (!rotDrag) return;
    const c = centerOf(ed);
    let r = rotDrag.r0 + ((Math.atan2(e.screen.y - c.y, e.screen.x - c.x) - rotDrag.a0) * 180) / Math.PI;
    if (e.shift) r = Math.round(r / 15) * 15;
    ed.setViewRotation(r);
  },
  up(ed) { rotDrag = null; ed.emit(); },
  key(ed, combo) {
    if (combo === 'Escape') { ed.setViewRotation(0); return true; }
    return false;
  },
  overlay(ed, x) {
    if (!rotDrag) return;
    // מצפן: החץ האדום מצביע לכיוון "למעלה" של המסמך
    const c = centerOf(ed), rot = ((ed.st?.rot ?? 0) * Math.PI) / 180;
    x.save();
    x.translate(c.x, c.y);
    x.fillStyle = 'rgba(20,20,24,.55)';
    x.beginPath(); x.arc(0, 0, 44, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = 1.5; x.stroke();
    x.rotate(rot);
    x.fillStyle = '#ff453a';
    x.beginPath(); x.moveTo(0, -38); x.lineTo(7, 0); x.lineTo(-7, 0); x.closePath(); x.fill();
    x.fillStyle = '#fff';
    x.beginPath(); x.moveTo(0, 38); x.lineTo(7, 0); x.lineTo(-7, 0); x.closePath(); x.fill();
    x.restore();
  },
};
