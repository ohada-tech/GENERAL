/**
 * כלי רטוש: Blur / Sharpen / Smudge, Dodge / Burn / Sponge, Spot Healing / Healing Brush / Patch / Red Eye.
 * Healing בסגנון הפרדת תדרים: התדר הגבוה (מרקם) מהמקור, התדר הנמוך (צבע וטון) מהיעד — ראו healInto ב-pixel-algo.
 * לא Content-Aware של אדובי, אבל מהיר ב-1080×1350 ונותן תוצאה טבעית על עור, שמיים וקירות.
 */
import type { Editor } from './editor';
import type { Pt } from './model';
import { apply, ctx2d, hexToRgb } from './model';
import { combine, polySel, selEdges, type SelMode } from './selection';
import type { PtrEvt, Tool } from './tools';
import {
  blurSharpenDab, coverDab, dabRect, dodgeBurnDab, fillCarry, findPatchOffset, healInto, maskBounds, mixCoverage, mixInto,
  redEyeFix, shiftedTexture, smudgeDab, spongeDab, type Img, type Rct,
} from './pixel-algo';
import { beginPx, cancelPx, drawCross, endPx, localAlpha, markDirty, pxBrush, toLocal, type PxStroke } from './paint-engine';

/* ======================= Blur / Sharpen / Smudge ======================= */

export const BlurTool: Tool = pxBrush({
  id: 'blur', label: 'טשטוש', what: 'Blur', allowMask: true, spacing: 0.25,
  opts: (ed) => ed.opts.blur,
  dab(ed, ps, d) { blurSharpenDab(d, ps.sample ?? ps.img, ed.opts.blur.strength, false); },
});

export const SharpenTool: Tool = pxBrush({
  id: 'sharpen', label: 'חידוד', what: 'Sharpen', allowMask: true, spacing: 0.25,
  opts: (ed) => ed.opts.sharpen,
  start(_ed, ps) { ps.data.base = ps.sample ?? { data: ps.orig, w: ps.img.w, h: ps.img.h }; return true; },
  // חידוד מהמקור המקורי (לא מצטבר על עצמו בכל טביעה — אחרת נוצר רעש)
  dab(ed, ps, d) { blurSharpenDab(d, ps.data.base as Img, ed.opts.sharpen.strength * 0.5, true); },
});

export const SmudgeTool: Tool = pxBrush({
  id: 'smudge', label: 'מריחה', what: 'Smudge', allowMask: true, spacing: 0.1,
  opts: (ed) => ed.opts.smudge,
  start(ed, ps, e) {
    const o = ed.opts.smudge;
    const q = toLocal(ps, e.doc);
    const R = Math.max(1, Math.ceil((o.size / 2) * ps.scale));
    ps.data.R = R;
    // Finger Painting: מתחילים מהצבע הקדמי במקום מהפיקסלים שמתחת
    ps.data.carry = fillCarry(ps.sample ?? ps.img, q.x, q.y, R, o.finger ? hexToRgb(ed.fg) : null);
    ps.data.first = true;
    return true;
  },
  dab(ed, ps, d) {
    if (ps.data.first) { ps.data.first = false; return; }
    const R = ps.data.R as number;
    smudgeDab({ ...d, r: Math.min(d.r, R) }, ps.data.carry as Float32Array, R, ed.opts.smudge.strength);
  },
});

/* ======================= Dodge / Burn / Sponge ======================= */

export const DodgeTool: Tool = pxBrush({
  id: 'dodge', label: 'הבהרה', what: 'Dodge', spacing: 0.25,
  opts: (ed) => ed.opts.dodge,
  dab(ed, _ps, d) { const o = ed.opts.dodge; dodgeBurnDab(d, true, o.range, o.exposure, o.protect); },
});

export const BurnTool: Tool = pxBrush({
  id: 'burn', label: 'הכהיה', what: 'Burn', spacing: 0.25,
  opts: (ed) => ed.opts.burn,
  dab(ed, _ps, d) { const o = ed.opts.burn; dodgeBurnDab(d, false, o.range, o.exposure, o.protect); },
});

export const SpongeTool: Tool = pxBrush({
  id: 'sponge', label: 'ספוג', what: 'Sponge', spacing: 0.25,
  opts: (ed) => ed.opts.sponge,
  dab(ed, _ps, d) { const o = ed.opts.sponge; spongeDab(d, o.mode === 'saturate', o.flow, o.vibrance); },
});

/* ======================= ריפוי: עזר משותף ======================= */

/**
 * מסיים ריפוי: target = (קומפוזיציה או השכבה) בתחילת המשיחה, tex = מרקם המקור, cov = אזור הריפוי.
 * הריפוי מחושב על עותק ואז מעורבב לשכבה לפי הכיסוי — כך גם Sample All Layers על שכבה ריקה עובד.
 */
function finishHeal(ps: PxStroke, tex: Uint8ClampedArray, cov: Float32Array, R: Rct) {
  const W = ps.img.w;
  const tgt: Img = { data: (ps.sample ? ps.sample.data : ps.orig).slice(), w: W, h: ps.img.h };
  const hard = new Float32Array(cov.length);
  for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) { const i = y * W + x; if (cov[i] > 0.02) hard[i] = 1; }
  healInto(tgt, tex, hard, R);
  for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) {
    const i = y * W + x, j = i * 4;
    const t = Math.min(1, cov[i]);
    if (t <= 0.001) { for (let c = 0; c < 4; c++) ps.img.data[j + c] = ps.orig[j + c]; continue; }
    mixInto(ps.img.data, j, ps.orig, j, tgt.data, j, t);
  }
  markDirty(ps, R);
}

/* ======================= Spot Healing Brush ======================= */

export const SpotHealTool: Tool = pxBrush({
  id: 'spotHeal', label: 'ריפוי נקודתי', what: 'Spot Healing Brush', spacing: 0.15,
  opts: (ed) => ed.opts.spotHeal,
  start(_ed, ps) { ps.data.cov = new Float32Array(ps.img.w * ps.img.h); return true; },
  dab(_ed, ps, d) {
    const cov = ps.data.cov as Float32Array;
    coverDab(cov, d, 1);
    // תצוגה בזמן המשיחה: האזור שיתוקן מסומן בכהה-שקוף (כמו בפוטושופ)
    const R = dabRect(d), W = ps.img.w, px = ps.img.data, o = ps.orig;
    for (let y = R.y0; y < R.y1; y++) for (let x = R.x0; x < R.x1; x++) {
      const i = y * W + x, j = i * 4, t = Math.min(1, cov[i]) * 0.45;
      px[j] = o[j] * (1 - t) + 60 * t; px[j + 1] = o[j + 1] * (1 - t) + 60 * t; px[j + 2] = o[j + 2] * (1 - t) + 60 * t;
      px[j + 3] = Math.max(o[j + 3], 255 * t);
    }
  },
  finish(ed, ps) {
    const cov = ps.data.cov as Float32Array;
    const R = maskBounds(cov, ps.img.w, ps.img.h, 6);
    if (!R) return false;
    const src: Img = ps.sample ?? { data: ps.orig, w: ps.img.w, h: ps.img.h };
    const off = findPatchOffset(src, cov, R);
    const tex = new Uint8ClampedArray(ps.img.data.length);
    shiftedTexture(src, off.dx, off.dy, R, tex);
    finishHeal(ps, tex, cov, R);
    void ed;
    return true;
  },
});

/* ======================= Healing Brush ======================= */

let healSrc: Pt | null = null;
let healOffset: Pt | null = null;
let healCursor: Pt | null = null;

export const HealTool: Tool = pxBrush({
  id: 'heal', label: 'מברשת ריפוי', what: 'Healing Brush', spacing: 0.15,
  opts: (ed) => ed.opts.heal,
  alt(ed, e) { healSrc = e.doc; healOffset = null; ed.toast('נקודת מקור נקבעה'); ed.redraw(false); return true; },
  start(ed, ps, e) {
    if (!healSrc) { ed.toast('Alt+לחיצה כדי לבחור את נקודת המקור', 'error'); return false; }
    if (!ed.opts.heal.aligned || !healOffset) healOffset = { x: healSrc.x - e.doc.x, y: healSrc.y - e.doc.y };
    const a = toLocal(ps, e.doc), b = toLocal(ps, { x: e.doc.x + healOffset.x, y: e.doc.y + healOffset.y });
    ps.data.off = { x: b.x - a.x, y: b.y - a.y };
    ps.data.cov = new Float32Array(ps.img.w * ps.img.h);
    ps.data.tex = new Uint8ClampedArray(ps.img.data.length);
    ps.data.src = ps.sample ?? { data: ps.orig, w: ps.img.w, h: ps.img.h };
    return true;
  },
  dab(_ed, ps, d) {
    const cov = ps.data.cov as Float32Array, tex = ps.data.tex as Uint8ClampedArray, off = ps.data.off as Pt;
    const R = dabRect(d);
    shiftedTexture(ps.data.src as Img, off.x, off.y, R, tex);
    coverDab(cov, d, 1);
    // בזמן המשיחה: שכפול רגיל; הריפוי (התאמת צבע וטון) מחושב כשמשחררים
    mixCoverage(ps.img.data, ps.orig, tex, cov, 1, ps.img.w, R);
  },
  finish(_ed, ps) {
    const cov = ps.data.cov as Float32Array;
    const R = maskBounds(cov, ps.img.w, ps.img.h, 6);
    if (!R) return false;
    finishHeal(ps, ps.data.tex as Uint8ClampedArray, cov, R);
    return true;
  },
  hover(_ed, e) { healCursor = healOffset ? { x: e.doc.x + healOffset.x, y: e.doc.y + healOffset.y } : null; },
  overlay(ed, x) {
    if (!healSrc) return;
    drawCross(x, ed.toScreen(healCursor ?? healSrc));
  },
});

/* ======================= Patch ======================= */

let patch: { mode: 'draw'; pts: Pt[]; sel: SelMode } | { mode: 'drag'; start: Pt; off: Pt } | null = null;

const modeOf = (e: PtrEvt): SelMode => (e.shift && e.alt ? 'int' : e.shift ? 'add' : e.alt ? 'sub' : 'new');

function applyPatch(ed: Editor, off: Pt) {
  const d = ed.doc!;
  if (!d.selection) return;
  const ps = beginPx(ed, { doc: { x: 0, y: 0 } }, { what: 'Patch' });
  if (!ps) return;
  const W = ps.img.w, H = ps.img.h;
  const a = localAlpha(d.selection, ps.inv, W, H);
  const m = new Float32Array(W * H);
  for (let i = 0; i < m.length; i++) m[i] = a[i] / 255;
  const R = maskBounds(m, W, H, 4);
  if (!R) { cancelPx(ed); return; }
  const p0 = apply(ps.inv, { x: 0, y: 0 }), p1 = apply(ps.inv, off);
  const tex = new Uint8ClampedArray(ps.img.data.length);
  // Source: האזור שנבחר מתמלא במרקם מהמקום שאליו גררו
  shiftedTexture({ data: ps.orig, w: W, h: H }, p1.x - p0.x, p1.y - p0.y, R, tex);
  finishHeal(ps, tex, m, R);
  endPx(ed, ps, 'טלאי');
}

export const PatchTool: Tool = {
  id: 'patch',
  cursor: () => 'crosshair',
  down(ed, e) {
    const d = ed.doc!;
    if (d.selection && modeOf(e) === 'new') {
      const a = ctx2d(d.selection).getImageData(Math.floor(e.doc.x), Math.floor(e.doc.y), 1, 1).data[3];
      if (a > 127) { patch = { mode: 'drag', start: e.doc, off: { x: 0, y: 0 } }; return; }
    }
    patch = { mode: 'draw', pts: [e.doc], sel: modeOf(e) };
  },
  move(ed, e) {
    if (!patch) return;
    if (patch.mode === 'draw') { patch.pts.push(e.doc); ed.live.marquee = { pts: patch.pts, closed: false }; }
    else { patch.off = { x: Math.round(e.doc.x - patch.start.x), y: Math.round(e.doc.y - patch.start.y) }; ed.status = `ΔX ${patch.off.x}  ΔY ${patch.off.y}`; ed.emit(); }
    ed.redraw(false);
  },
  up(ed) {
    const p = patch;
    patch = null;
    ed.live.marquee = null;
    ed.status = '';
    if (!p) return;
    const d = ed.doc!;
    if (p.mode === 'draw') {
      if (p.pts.length < 3) { if (p.sel === 'new' && d.selection) ed.run('select.deselect'); else ed.redraw(false); return; }
      ed.setSelection(combine(d, polySel(d, p.pts, 0), p.sel), 'בחירת טלאי');
      return;
    }
    if (Math.hypot(p.off.x, p.off.y) < 1) { ed.redraw(false); return; }
    applyPatch(ed, p.off);
  },
  cancel(ed) { patch = null; ed.live.marquee = null; },
  deactivate(ed) { patch = null; ed.live.marquee = null; },
  overlay(ed, x) {
    const m = ed.live.marquee;
    if (m && m.pts.length > 1) {
      const pts = m.pts.map((q) => ed.toScreen(q));
      x.beginPath(); pts.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)));
      x.lineWidth = 1; x.strokeStyle = '#fff'; x.stroke(); x.strokeStyle = '#000'; x.setLineDash([4, 4]); x.stroke(); x.setLineDash([]);
    }
    const d = ed.doc;
    if (patch?.mode === 'drag' && d?.selection) {
      const e = selEdges(d.selection), o = patch.off;
      x.lineWidth = 1; x.strokeStyle = '#4da3ff';
      x.beginPath();
      for (let i = 0; i < e.length; i += 4) {
        const a = ed.toScreen({ x: e[i] + o.x, y: e[i + 1] + o.y }), b = ed.toScreen({ x: e[i + 2] + o.x, y: e[i + 3] + o.y });
        x.moveTo(a.x, a.y); x.lineTo(b.x, b.y);
      }
      x.stroke();
    }
  },
};

/* ======================= Red Eye ======================= */

let redDrag: { a: Pt; b: Pt } | null = null;

export const RedEyeTool: Tool = {
  id: 'redEye',
  cursor: () => 'crosshair',
  down(_ed, e) { redDrag = { a: e.doc, b: e.doc }; },
  move(ed, e) { if (redDrag) { redDrag.b = e.doc; ed.redraw(false); } },
  up(ed) {
    const r = redDrag;
    redDrag = null;
    if (!r) return;
    const d = ed.doc!;
    const big = Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y) * ed.st!.zoom > 6;
    const c = big ? { x: (r.a.x + r.b.x) / 2, y: (r.a.y + r.b.y) / 2 } : r.a;
    const rad = big ? Math.max(Math.abs(r.b.x - r.a.x), Math.abs(r.b.y - r.a.y)) / 2 : Math.max(14, Math.min(d.width, d.height) * 0.035);
    const ps = beginPx(ed, { doc: c }, { what: 'Red Eye' });
    if (!ps) { ed.redraw(false); return; }
    const q = toLocal(ps, c);
    const o = ed.opts.redEye;
    const n = redEyeFix(ps.img, q.x, q.y, rad * ps.scale, o.pupil, o.darken);
    if (!n) { cancelPx(ed); ed.toast('לא נמצא אדום באזור · לחצו במרכז האישון או גררו מלבן סביב העין'); return; }
    markDirty(ps, { x0: 0, y0: 0, x1: ps.img.w, y1: ps.img.h });
    endPx(ed, ps, 'עיניים אדומות');
  },
  overlay(ed, x) {
    if (!redDrag) return;
    const pts = [redDrag.a, { x: redDrag.b.x, y: redDrag.a.y }, redDrag.b, { x: redDrag.a.x, y: redDrag.b.y }].map((p) => ed.toScreen(p));
    x.setLineDash([3, 3]); x.strokeStyle = '#fff'; x.lineWidth = 1;
    x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.stroke();
    x.setLineDash([]);
  },
};
