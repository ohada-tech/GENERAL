/**
 * טרנספורמים מתקדמים: Skew / Distort / Perspective בתוך Free Transform, Warp (רשת בזייה 4×4 עם Presets)
 * ו-Puppet Warp (נעצים + MLS קשיח על רשת משולשים). Liquify נמצא ב-ui/liquify-dialog.tsx.
 * Distort ו-Warp לא הרסניים (נשמרים על השכבה, גם בטקסט ובצורה שנשארים ניתנים לעריכה); Puppet מוטמע ב-Enter.
 */
import type { Editor } from './editor';
import type { Layer, Pt, RasterLayer, Xf, XfLayer } from './model';
import { apply, cloneLayer, isXf, newCanvas, touch } from './model';
import { layerMatrix, localBox } from './render';
import { deformCorners, deformMap, deformOutline, isDeformed, pointInPoly } from './deform';
import type { PtrEvt, Tool, ToolId } from './tools';
import {
  applyH, dragPatch, identityWarp, invert3, isIdentityQuad, isIdentityWarp, mlsRigid, presetPoints, puppetMesh,
  quadOk, squareToQuad, type WarpParams, type WarpPreset,
} from './warp-algo';

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const unit = (a: Pt): Pt => { const L = Math.hypot(a.x, a.y) || 1; return { x: a.x / L, y: a.y / L }; };

/** אותו סדר ידיות כמו ב-MoveTool: פינה, צלע, פינה… עם כיוון השעון מלמעלה-שמאל */
const HANDLES: Array<[number, number]> = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];
const CORNER_OF: Record<number, number> = { 0: 0, 2: 1, 4: 2, 6: 3 };
const SIDE_OF: Record<number, [number, number]> = { 1: [0, 1], 3: [1, 2], 5: [2, 3], 7: [3, 0] };

function quadPoint(q: Pt[], hx: number, hy: number): Pt {
  const top = { x: q[0].x + (q[1].x - q[0].x) * hx, y: q[0].y + (q[1].y - q[0].y) * hx };
  const bot = { x: q[3].x + (q[2].x - q[3].x) * hx, y: q[3].y + (q[2].y - q[3].y) * hx };
  return { x: top.x + (bot.x - top.x) * hy, y: top.y + (bot.y - top.y) * hy };
}

export const FT_LABELS = {
  distort: 'Distort · עיוות', perspective: 'Perspective · פרספקטיבה', skew: 'Skew · הטיה', scale: 'Free Transform',
} as const;

/* ======================= Skew / Distort / Perspective (בתוך Free Transform) ======================= */

export type QuadOp = 'distort' | 'perspective' | 'skew' | 'scale';
export interface QuadDrag { l: XfLayer; handle: number; op: QuadOp; start: Pt; D0: Pt[]; constrain: boolean }

/** האם גרירת ידית צריכה לעבור דרך ה-Quad (ולא דרך הסקאלה האפינית של MoveTool) */
export function quadOpFor(ed: Editor, l: XfLayer | null | undefined, handle: number, e: PtrEvt): { op: QuadOp; constrain: boolean } | null {
  if (!l || l.mesh) return null;
  const corner = handle % 2 === 0;
  const mode = ed.live.freeTransform?.mode ?? null;
  if (e.ctrl) {
    if (corner) return { op: e.alt && e.shift ? 'perspective' : 'distort', constrain: false };
    return { op: 'skew', constrain: false };
  }
  if (mode && ed.live.freeTransform) {
    if (!corner) return { op: 'skew', constrain: mode === 'skew' };
    return { op: mode, constrain: mode === 'skew' };
  }
  if (l.quad) return { op: 'scale', constrain: false };
  return null;
}

export function quadDragStart(l: XfLayer, handle: number, op: QuadOp, constrain: boolean, start: Pt): QuadDrag {
  return { l, handle, op, start, D0: deformCorners(l, layerMatrix(l), localBox(l)), constrain };
}

/** כותב את ארבע הפינות (במסמך) חזרה לשכבה כ-Quad מנורמל; מסרב לארבעון לא קמור */
export function setQuadFromDoc(l: XfLayer, D: Pt[]): boolean {
  if (!quadOk(D)) return false;
  const inv = layerMatrix(l).inverse(), b = localBox(l);
  const q = D.map((p) => { const lp = apply(inv, p); return { x: (lp.x - b.x) / (b.w || 1), y: (lp.y - b.y) / (b.h || 1) }; });
  l.quad = isIdentityQuad(q) ? null : q;
  touch(l);
  return true;
}

export function quadDragMove(ed: Editor, qd: QuadDrag, e: PtrEvt) {
  const D0 = qd.D0, d = sub(e.doc, qd.start), D = D0.map((p) => ({ ...p }));
  const h = qd.handle;
  if (qd.op === 'scale') {
    // סקאלה של שכבה שכבר עוותה: אפינית במסמך, בצירים של הסיבוב, סביב הפינה/הצלע הנגדית (Alt = המרכז)
    const [hx, hy] = HANDLES[h];
    const corner = h % 2 === 0;
    const prop = corner ? !e.shift : e.shift;
    const a = (qd.l.t.rot * Math.PI) / 180, ex = { x: Math.cos(a), y: Math.sin(a) }, ey = { x: -Math.sin(a), y: Math.cos(a) };
    const Hp = quadPoint(D0, hx, hy);
    const A = e.alt ? quadPoint(D0, 0.5, 0.5) : quadPoint(D0, 1 - hx, 1 - hy);
    const hv = sub(Hp, A), mv = sub(e.doc, A);
    let fx = hx === 0.5 ? 1 : dot(mv, ex) / (dot(hv, ex) || 1);
    let fy = hy === 0.5 ? 1 : dot(mv, ey) / (dot(hv, ey) || 1);
    if (prop) {
      const f = hx === 0.5 ? Math.abs(fy) : hy === 0.5 ? Math.abs(fx) : Math.max(Math.abs(fx), Math.abs(fy));
      fx = (hx === 0.5 ? 1 : Math.sign(fx) || 1) * f;
      fy = (hy === 0.5 ? 1 : Math.sign(fy) || 1) * f;
    }
    for (let i = 0; i < 4; i++) { const v = sub(D0[i], A); D[i] = add(A, add(mul(ex, fx * dot(v, ex)), mul(ey, fy * dot(v, ey)))); }
    ed.status = `${Math.round(fx * 100)}% × ${Math.round(fy * 100)}%`;
  } else if (h % 2 === 0) {
    const c = CORNER_OF[h];
    const nh = [1, 0, 3, 2][c], nv = [3, 2, 1, 0][c];
    const eH = unit(sub(D0[nh], D0[c])), eV = unit(sub(D0[nv], D0[c]));
    if (qd.op === 'distort') D[c] = add(D0[c], d);
    else if (qd.op === 'perspective') {
      // הפינה הסמוכה על אותה צלע זזה בסימטריה הפוכה — כמו Ctrl+Alt+Shift בפוטושופ
      const ph = dot(d, eH), pv = dot(d, eV);
      if (Math.abs(ph) >= Math.abs(pv)) { D[c] = add(D0[c], mul(eH, ph)); D[nh] = sub(D0[nh], mul(eH, ph)); }
      else { D[c] = add(D0[c], mul(eV, pv)); D[nv] = sub(D0[nv], mul(eV, pv)); }
    } else {
      // Skew בפינה: לאורך הצלע שהכיוון שלה קרוב יותר לגרירה
      const ph = dot(d, eH), pv = dot(d, eV);
      D[c] = add(D0[c], Math.abs(ph) >= Math.abs(pv) ? mul(eH, ph) : mul(eV, pv));
    }
  } else {
    const [a, b] = SIDE_OF[h];
    const mv = qd.constrain ? mul(unit(sub(D0[b], D0[a])), dot(d, unit(sub(D0[b], D0[a])))) : d;
    D[a] = add(D0[a], mv);
    D[b] = add(D0[b], mv);
  }
  if (setQuadFromDoc(qd.l, D)) {
    const ft = ed.live.freeTransform;
    if (ft && qd.op !== 'scale') ft.label = FT_LABELS[qd.op];
    if (qd.op !== 'scale') ed.status = qd.op === 'distort' ? 'Distort · עיוות' : qd.op === 'perspective' ? 'Perspective · פרספקטיבה' : 'Skew · הטיה';
  }
  ed.redraw(true);
  ed.emit();
}

/** סיבוב של שכבת Quad סביב נקודה c (הסיבוב הרגיל מניח מרכז תיבה אפיני) */
export function rotateAbout(l: XfLayer, t0: Xf, c: Pt, da: number) {
  const a = (da * Math.PI) / 180, dx = t0.x - c.x, dy = t0.y - c.y;
  l.t.x = c.x + dx * Math.cos(a) - dy * Math.sin(a);
  l.t.y = c.y + dx * Math.sin(a) + dy * Math.cos(a);
  l.t.rot = t0.rot + da;
  touch(l);
}

/** Edit > Transform > Skew / Distort / Perspective: נכנס ל-Free Transform במצב שבו גרירה רגילה של ידית עושה את הפעולה */
export function setTransformMode(ed: Editor, mode: 'skew' | 'distort' | 'perspective') {
  if (!ed.live.freeTransform) ed.startFreeTransform();
  const ft = ed.live.freeTransform;
  if (!ft) return;
  if (ed.transformable().length !== 1) { ed.toast(`${FT_LABELS[mode]} עובד על שכבה אחת`, 'error'); return; }
  ft.mode = ft.mode === mode ? null : mode;
  ed.toast(ft.mode ? `${FT_LABELS[mode]}: גרירה של ידית · Enter לאישור, Esc לביטול` : 'חזרה ל-Free Transform רגיל');
  ed.emit();
  ed.redraw(false);
}

/* ======================= מצב משותף ל-Warp ול-Puppet ======================= */

function singleLayer(ed: Editor, what: string): XfLayer | null {
  const items = ed.transformable();
  if (items.length !== 1 || ed.topSelected().length !== 1 || !isXf(ed.topSelected()[0])) { ed.toast(`${what} עובד על שכבה אחת (פיקסלים, טקסט או צורה)`, 'error'); return null; }
  return items[0];
}

function snapshotOf(ed: Editor): Layer[] {
  const ft = ed.live.freeTransform;
  return ft ? ft.snapshot : ed.doc!.layers.map((l) => cloneLayer(l));
}

const curLayer = (ed: Editor, id: string) => { const l = ed.layer(id); return l && isXf(l) ? l : null; };

/** נקודה במרחב ה-Warp (לפני ה-Quad) ↔ מסמך */
function warpToDoc(l: XfLayer, p: Pt): Pt {
  const b = localBox(l);
  const q = l.quad ? applyH(squareToQuad(l.quad), p.x, p.y) : p;
  return apply(layerMatrix(l), { x: b.x + q.x * b.w, y: b.y + q.y * b.h });
}
function docToWarp(l: XfLayer, d: Pt): Pt {
  const b = localBox(l), lp = apply(layerMatrix(l).inverse(), d);
  const n = { x: (lp.x - b.x) / (b.w || 1), y: (lp.y - b.y) / (b.h || 1) };
  if (!l.quad) return n;
  const inv = invert3(squareToQuad(l.quad));
  return inv ? applyH(inv, n.x, n.y) : n;
}

/* ======================= Warp ======================= */

interface WarpSess { docId: string; layerId: string; snapshot: Layer[]; prev: ToolId; stack: Pt[][] }
let ws: WarpSess | null = null;
let wdrag: { kind: 'pt'; k: number; grab: Pt; pts0: Pt[] } | { kind: 'mesh'; u: number; v: number; start: Pt; pts0: Pt[] } | null = null;

export const warpParams = (l: XfLayer | null): WarpParams => {
  const w = l?.warp;
  return { preset: (w?.preset ?? 'none') as WarpPreset, bend: w?.bend ?? 50, h: w?.h ?? 0, v: w?.v ?? 0, vertical: !!w?.vertical };
};

export function warpLayer(ed: Editor): XfLayer | null {
  if (!ws || ed.doc?.id !== ws.docId) return null;
  return curLayer(ed, ws.layerId);
}

export function startWarp(ed: Editor) {
  const d = ed.doc;
  if (!d) return;
  const l = singleLayer(ed, 'Warp');
  if (!l) return;
  if (l.mesh) return;
  const snapshot = snapshotOf(ed);
  ed.live.freeTransform = null;
  if (!l.warp) { l.warp = { pts: identityWarp(), preset: 'none', bend: 50, h: 0, v: 0, vertical: false }; touch(l); }
  const prev = ed.tool === 'warp' || ed.tool === 'puppet' ? 'move' : ed.tool;
  ws = { docId: d.id, layerId: l.id, snapshot, prev, stack: [] };
  ed.setTool('warp');
  ed.redraw(true);
  ed.emit();
}

export function endWarp(ed: Editor, applyIt: boolean) {
  const s = ws;
  if (!s) return;
  ws = null;
  wdrag = null;
  const d = ed.doc;
  if (d && d.id === s.docId) {
    if (applyIt) {
      const l = curLayer(ed, s.layerId);
      if (l?.warp && isIdentityWarp(l.warp.pts)) { l.warp = null; touch(l); }
    } else d.layers = s.snapshot;
  }
  ed.status = '';
  ed.setTool(s.prev);
  if (applyIt && d?.id === s.docId) ed.commit('Warp · עיקום');
  else { ed.redraw(true); ed.emit(); }
}

/** שינוי Preset / Bend / H / V / כיוון מסרגל האפשרויות */
export function setWarpParams(ed: Editor, p: Partial<WarpParams>) {
  const l = warpLayer(ed);
  if (!l) return;
  const np = { ...warpParams(l), ...p };
  if (l.warp) ws!.stack.push(l.warp.pts);
  // מעבר ל-Custom שומר את הצורה הנוכחית כדי להמשיך לגרור ממנה
  const pts = np.preset === 'custom' ? (l.warp?.pts ?? identityWarp()) : presetPoints(np);
  l.warp = { pts, preset: np.preset, bend: np.bend, h: np.h, v: np.v, vertical: np.vertical };
  touch(l);
  ed.redraw(true);
  ed.emit();
}

function warpScreenPts(ed: Editor, l: XfLayer): Pt[] {
  return (l.warp?.pts ?? identityWarp()).map((p) => ed.toScreen(warpToDoc(l, p)));
}

function hitWarpPoint(ed: Editor, l: XfLayer, sp: Pt): number {
  const pts = warpScreenPts(ed, l);
  let best = -1, bd = 8;
  // פינות קודם (הן מעל הידיות), אחר כך הידיות, ואז נקודות פנימיות
  for (const k of [0, 3, 12, 15, 1, 2, 4, 8, 7, 11, 13, 14, 5, 6, 9, 10]) { const dd = dist(pts[k], sp); if (dd < bd) { bd = dd; best = k; } }
  return best;
}

/** (u,v) של הנקודה על המשטח הקרובה ביותר לעכבר (חיפוש גס ואז עדין) */
function patchUV(ed: Editor, l: XfLayer, sp: Pt): { u: number; v: number } | null {
  const f = deformMap(l, layerMatrix(l), localBox(l));
  if (!pointInPoly(ed.toDoc(sp.x, sp.y), deformOutline(l, layerMatrix(l), localBox(l)))) return null;
  let bu = 0, bv = 0, bd = Infinity;
  const N = 24;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const p = ed.toScreen(f(i / N, j / N)), dd = dist(p, sp); if (dd < bd) { bd = dd; bu = i / N; bv = j / N; } }
  for (let step = 1 / N; step > 1e-3; step /= 2) {
    for (const [du, dv] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const u = Math.min(1, Math.max(0, bu + du)), v = Math.min(1, Math.max(0, bv + dv)), dd = dist(ed.toScreen(f(u, v)), sp);
      if (dd < bd) { bd = dd; bu = u; bv = v; }
    }
  }
  return { u: bu, v: bv };
}

const ADJ: Record<number, number[]> = { 0: [1, 4], 3: [2, 7], 12: [8, 13], 15: [11, 14] };

export const WarpTool: Tool = {
  id: 'warp',
  cursor(ed, e) {
    const l = warpLayer(ed);
    if (!l || !e) return 'default';
    if (hitWarpPoint(ed, l, e.screen) >= 0) return 'pointer';
    return patchUV(ed, l, e.screen) ? 'move' : 'default';
  },
  down(ed, e) {
    const l = warpLayer(ed);
    if (!l || !l.warp) return;
    const k = hitWarpPoint(ed, l, e.screen);
    const pts0 = l.warp.pts.map((p) => ({ ...p }));
    if (k >= 0) { wdrag = { kind: 'pt', k, grab: sub(pts0[k], docToWarp(l, e.doc)), pts0 }; ed.beginInteract(); return; }
    const uv = patchUV(ed, l, e.screen);
    if (uv) { wdrag = { kind: 'mesh', u: uv.u, v: uv.v, start: docToWarp(l, e.doc), pts0 }; ed.beginInteract(); }
  },
  move(ed, e) {
    const l = warpLayer(ed);
    if (!l || !wdrag || !l.warp) return;
    let pts: Pt[];
    if (wdrag.kind === 'pt') {
      const np = add(docToWarp(l, e.doc), wdrag.grab), dlt = sub(np, wdrag.pts0[wdrag.k]);
      pts = wdrag.pts0.map((p) => ({ ...p }));
      pts[wdrag.k] = np;
      // פינה גוררת איתה את שתי הידיות שלה
      for (const a of ADJ[wdrag.k] ?? []) pts[a] = add(wdrag.pts0[a], dlt);
    } else {
      const c = sub(docToWarp(l, e.doc), wdrag.start);
      pts = dragPatch(wdrag.pts0, wdrag.u, wdrag.v, c.x, c.y);
    }
    l.warp = { ...l.warp, pts, preset: 'custom' };
    touch(l);
    ed.redraw(true);
    ed.emit();
  },
  up(ed) {
    if (wdrag && ws) ws.stack.push(wdrag.pts0);
    wdrag = null;
    ed.endInteract();
    ed.emit();
  },
  key(ed, combo) {
    if (!ws) return false;
    if (combo === 'Enter') { endWarp(ed, true); return true; }
    if (combo === 'Escape') { endWarp(ed, false); return true; }
    if (combo === 'Ctrl+Z') {
      const l = warpLayer(ed), p = ws.stack.pop();
      if (l?.warp && p) { l.warp = { ...l.warp, pts: p, preset: 'custom' }; touch(l); ed.redraw(true); ed.emit(); }
      return true;
    }
    return combo === 'Ctrl+Shift+Z' || combo === 'Ctrl+T';
  },
  deactivate(ed) { if (ws) endWarp(ed, true); },
  overlay(ed, x) {
    const l = warpLayer(ed);
    if (!l?.warp) return;
    const m = layerMatrix(l), b = localBox(l), f = deformMap(l, m, b);
    x.lineWidth = 1;
    x.strokeStyle = 'rgba(20,115,230,.9)';
    x.beginPath();
    for (let g = 0; g <= 3; g++) {
      for (let i = 0; i <= 30; i++) { const p = ed.toScreen(f(g / 3, i / 30)); if (i) x.lineTo(p.x, p.y); else x.moveTo(p.x, p.y); }
      for (let i = 0; i <= 30; i++) { const p = ed.toScreen(f(i / 30, g / 3)); if (i) x.lineTo(p.x, p.y); else x.moveTo(p.x, p.y); }
    }
    x.stroke();
    const sp = warpScreenPts(ed, l);
    x.strokeStyle = 'rgba(255,255,255,.75)';
    x.beginPath();
    for (const [c, hs] of Object.entries(ADJ)) for (const hk of hs) { x.moveTo(sp[+c].x, sp[+c].y); x.lineTo(sp[hk].x, sp[hk].y); }
    x.stroke();
    sp.forEach((p, k) => {
      const corner = k in ADJ;
      x.fillStyle = corner ? '#fff' : '#1473e6';
      x.strokeStyle = corner ? '#1473e6' : '#fff';
      x.beginPath();
      if (corner) x.rect(Math.round(p.x) - 3.5, Math.round(p.y) - 3.5, 7, 7);
      else x.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      x.fill();
      x.stroke();
    });
  },
};

/* ======================= Puppet Warp ======================= */

export interface PuppetOpts { density: 'fewer' | 'normal' | 'more'; expansion: number; showMesh: boolean }
export const puppetOpts: PuppetOpts = { density: 'normal', expansion: 2, showMesh: true };

interface PuppetSess {
  docId: string; layerId: string; snapshot: Layer[]; prev: ToolId;
  pins: Array<{ p: Pt; q: Pt }>; sel: number;
  src: Pt[]; tris: number[];
}
let ps: PuppetSess | null = null;
let pdrag: { i: number; grab: Pt } | null = null;

export const puppetActive = (ed: Editor) => !!ps && ed.doc?.id === ps.docId;
export const puppetPinCount = () => ps?.pins.length ?? 0;
const puppetLayer = (ed: Editor): RasterLayer | null => { if (!ps || ed.doc?.id !== ps.docId) return null; const l = ed.layer(ps.layerId); return l?.type === 'raster' ? l : null; };

/** כיסוי התוכן (אלפא) בתאים — עם Expansion בפיקסלים — לבניית הרשת */
function buildMesh(l: RasterLayer, o: PuppetOpts): { src: Pt[]; tris: number[] } {
  const W = l.canvas.width, H = l.canvas.height;
  const k = Math.min(1, 1024 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const c = newCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(l.canvas, 0, 0, w, h);
  const a = x.getImageData(0, 0, w, h).data;
  // אינטגרל של פיקסלים עם תוכן — שאילתת מלבן ב-O(1)
  const I = new Int32Array((w + 1) * (h + 1));
  for (let j = 0; j < h; j++) { let row = 0; for (let i = 0; i < w; i++) { row += a[(j * w + i) * 4 + 3] > 8 ? 1 : 0; I[(j + 1) * (w + 1) + i + 1] = I[j * (w + 1) + i + 1] + row; } }
  const q = (x0: number, y0: number, x1: number, y1: number) => {
    const X0 = Math.max(0, Math.floor(x0 * k)), Y0 = Math.max(0, Math.floor(y0 * k)), X1 = Math.min(w, Math.ceil(x1 * k)), Y1 = Math.min(h, Math.ceil(y1 * k));
    if (X1 <= X0 || Y1 <= Y0) return 0;
    return I[Y1 * (w + 1) + X1] - I[Y0 * (w + 1) + X1] - I[Y1 * (w + 1) + X0] + I[Y0 * (w + 1) + X0];
  };
  const cells = { fewer: 12, normal: 20, more: 32 }[o.density];
  const step = Math.max(6, Math.round(Math.max(W, H) / cells));
  const e = o.expansion;
  const r = puppetMesh(W, H, step, (x0, y0, x1, y1) => q(x0 - e, y0 - e, x1 + e, y1 + e) > 0);
  return { src: r.pts, tris: r.tris };
}

function puppetUpdate(ed: Editor) {
  const l = puppetLayer(ed);
  if (!l || !ps) return;
  const P = ps.pins.map((p) => p.p), Q = ps.pins.map((p) => p.q);
  l.mesh = { src: ps.src, dst: ps.src.map((v) => mlsRigid(v, P, Q)), tris: ps.tris };
  touch(l);
  ed.redraw(true);
  ed.emit();
}

export function startPuppet(ed: Editor) {
  const d = ed.doc;
  if (!d) return;
  let l: Layer | null = singleLayer(ed, 'Puppet Warp');
  if (!l) return;
  const snapshot = snapshotOf(ed);
  ed.live.freeTransform = null;
  // טקסט, צורה או שכבה מעוותת — קודם לפיקסלים (Esc מחזיר את המקור)
  if (l.type !== 'raster' || isDeformed(l)) {
    const id = l.id;
    ed.rasterize(l);
    l = ed.layer(id);
    if (l?.type !== 'raster') return;
    ed.toast('השכבה הומרה לפיקסלים בשביל Puppet Warp (Esc מבטל)');
  }
  const r = l as RasterLayer;
  const { src, tris } = buildMesh(r, puppetOpts);
  if (!tris.length) { d.layers = snapshot; ed.toast('אין בשכבה פיקסלים לעיוות', 'error'); ed.redraw(true); return; }
  const prev = ed.tool === 'warp' || ed.tool === 'puppet' ? 'move' : ed.tool;
  ps = { docId: d.id, layerId: r.id, snapshot, prev, pins: [], sel: -1, src, tris };
  ed.setTool('puppet');
  puppetUpdate(ed);
}

export function endPuppet(ed: Editor, applyIt: boolean) {
  const s = ps;
  if (!s) return;
  ps = null;
  pdrag = null;
  const d = ed.doc;
  const ok = d && d.id === s.docId;
  if (ok) {
    const l = ed.layer(s.layerId);
    if (applyIt && l?.type === 'raster' && s.pins.length) ed.bakeDeform(l);
    else if (applyIt && l) { l.mesh = null; touch(l); }
    else d!.layers = s.snapshot;
  }
  ed.status = '';
  ed.setTool(s.prev);
  if (applyIt && ok) ed.commit('Puppet Warp · עיוות בובה');
  else { ed.redraw(true); ed.emit(); }
}

/** Density / Expansion השתנו: בונים רשת חדשה, הנעצים נשארים */
export function rebuildPuppet(ed: Editor) {
  const l = puppetLayer(ed);
  if (!l || !ps) return;
  const { src, tris } = buildMesh(l, puppetOpts);
  if (!tris.length) return;
  ps.src = src; ps.tris = tris;
  puppetUpdate(ed);
}

export function clearPins(ed: Editor) { if (!ps) return; ps.pins = []; ps.sel = -1; puppetUpdate(ed); }

function pinAt(ed: Editor, l: RasterLayer, sp: Pt): number {
  if (!ps) return -1;
  const m = layerMatrix(l);
  for (let i = ps.pins.length - 1; i >= 0; i--) if (dist(ed.toScreen(apply(m, ps.pins[i].q)), sp) <= 8) return i;
  return -1;
}

/** נקודה בפיקסלים של השכבה (מצב נוכחי) → נקודת המנוחה שלה ברשת המקורית, לפי המשולש שמכיל אותה */
function restPoint(l: RasterLayer, q: Pt): Pt | null {
  if (!ps || !l.mesh) return null;
  const S = ps.src, D = l.mesh.dst, T = ps.tris;
  for (let t = 0; t < T.length; t += 3) {
    const a = D[T[t]], b = D[T[t + 1]], c = D[T[t + 2]];
    const v0 = sub(b, a), v1 = sub(c, a), v2 = sub(q, a);
    const den = v0.x * v1.y - v1.x * v0.y;
    if (Math.abs(den) < 1e-9) continue;
    const s = (v2.x * v1.y - v1.x * v2.y) / den, u = (v0.x * v2.y - v2.x * v0.y) / den;
    if (s < -1e-6 || u < -1e-6 || s + u > 1 + 1e-6) continue;
    const A = S[T[t]], B = S[T[t + 1]], C = S[T[t + 2]];
    return { x: A.x + s * (B.x - A.x) + u * (C.x - A.x), y: A.y + s * (B.y - A.y) + u * (C.y - A.y) };
  }
  return null;
}

export const PuppetTool: Tool = {
  id: 'puppet',
  cursor(ed, e) {
    const l = puppetLayer(ed);
    if (!l || !e) return 'default';
    if (pinAt(ed, l, e.screen) >= 0) return e.alt ? 'not-allowed' : 'move';
    return 'crosshair';
  },
  down(ed, e) {
    const l = puppetLayer(ed);
    if (!l || !ps) return;
    const i = pinAt(ed, l, e.screen);
    if (i >= 0) {
      if (e.alt) { ps.pins.splice(i, 1); ps.sel = -1; puppetUpdate(ed); return; }
      ps.sel = i;
      const lp = apply(layerMatrix(l).inverse(), e.doc);
      pdrag = { i, grab: sub(ps.pins[i].q, lp) };
      ed.beginInteract();
      ed.emit();
      return;
    }
    if (e.alt) return;
    const q = apply(layerMatrix(l).inverse(), e.doc);
    const p = restPoint(l, q);
    if (!p) { ed.toast('נעץ מוסיפים על הרשת של השכבה', 'error'); return; }
    ps.pins.push({ p, q });
    ps.sel = ps.pins.length - 1;
    pdrag = { i: ps.sel, grab: { x: 0, y: 0 } };
    puppetUpdate(ed);
    ed.beginInteract();
  },
  move(ed, e) {
    const l = puppetLayer(ed);
    if (!l || !ps || !pdrag) return;
    const lp = apply(layerMatrix(l).inverse(), e.doc);
    ps.pins[pdrag.i].q = add(lp, pdrag.grab);
    puppetUpdate(ed);
  },
  up(ed) { pdrag = null; ed.endInteract(); },
  key(ed, combo) {
    if (!ps) return false;
    if (combo === 'Enter') { endPuppet(ed, true); return true; }
    if (combo === 'Escape') { endPuppet(ed, false); return true; }
    if ((combo === 'Delete' || combo === 'Backspace') && ps.sel >= 0) { ps.pins.splice(ps.sel, 1); ps.sel = -1; puppetUpdate(ed); return true; }
    return combo === 'Ctrl+Z' || combo === 'Ctrl+T';
  },
  deactivate(ed) { if (ps) endPuppet(ed, true); },
  overlay(ed, x) {
    const l = puppetLayer(ed);
    if (!l || !ps || !l.mesh) return;
    const m = layerMatrix(l);
    if (puppetOpts.showMesh) {
      const D = l.mesh.dst.map((p) => ed.toScreen(apply(m, p))), T = l.mesh.tris;
      x.lineWidth = 1;
      x.strokeStyle = 'rgba(255,255,255,.28)';
      x.beginPath();
      for (let t = 0; t < T.length; t += 3) { const a = D[T[t]], b = D[T[t + 1]], c = D[T[t + 2]]; x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.lineTo(c.x, c.y); x.closePath(); }
      x.stroke();
    }
    ps.pins.forEach((pin, i) => {
      const p = ed.toScreen(apply(m, pin.q));
      x.beginPath();
      x.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
      x.fillStyle = i === ps!.sel ? '#1473e6' : '#ffd60a';
      x.strokeStyle = '#000';
      x.lineWidth = 1.5;
      x.fill();
      x.stroke();
      x.beginPath();
      x.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
      x.fillStyle = '#000';
      x.fill();
    });
  },
};

/* ======================= פקודות ======================= */

export function runWarpCmd(ed: Editor, id: string): boolean {
  switch (id) {
    case 'edit.skew': setTransformMode(ed, 'skew'); return true;
    case 'edit.distort': setTransformMode(ed, 'distort'); return true;
    case 'edit.perspective': setTransformMode(ed, 'perspective'); return true;
    case 'edit.warp': startWarp(ed); return true;
    case 'edit.puppetWarp': startPuppet(ed); return true;
    case 'edit.resetDeform': {
      // ביטול Distort ו-Warp של השכבות הנבחרות (חוזרים לתיבה הרגילה)
      const ls = ed.topSelected().filter((l): l is XfLayer => isXf(l) && !!(l.quad || l.warp) && !l.locked);
      if (!ls.length) return true;
      for (const l of ls) { l.quad = null; l.warp = null; touch(l); }
      ed.commit('ביטול עיוות · Remove Transform');
      return true;
    }
    case 'filter.liquify': {
      const a = ed.active;
      if (!a || !isXf(a)) { ed.toast('Liquify עובד על שכבת פיקסלים, טקסט או צורה', 'error'); return true; }
      if (a.locked) { ed.toast('השכבה נעולה', 'error'); return true; }
      ed.openDialog('liquify', { layerId: a.id });
      return true;
    }
  }
  return false;
}

/** לבדיקות ולממשק: האם יש לשכבה Distort/Warp שאפשר לאפס */
export const hasDeform = (l: Layer | null) => !!l && isXf(l) && !!(l.quad || l.warp);

