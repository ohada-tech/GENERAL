/**
 * Tool Manager + Transform Engine. כל כלי הוא אובייקט עם down/move/up/overlay/key; העורך מעביר אליו אירועים.
 * כלי חדש נרשם ב-TOOLS ומקבל אוטומטית קיצור, כפתור וסרגל אפשרויות — בלי לגעת בשאר הכלים.
 */
import type { Editor } from './editor';
import type { Pt, RasterLayer, Rect, TextLayer, Xf, XfLayer } from './model';
import { apply, clamp, copyCanvas, ctx2d, hexToRgb, isXf, newCanvas, touch, xfMatrix, cloneLayer, findLayer, xfLeaves } from './model';
import { layerBounds, layerMatrix, localBox, localSize, renderDoc, renderSingle } from './render';
import { combine, polySel, rectSel, wandSel, type SelMode } from './selection';
import { layoutText } from './text';
import { blendLumaIntoSelection } from './select-ops';
import { byMode, MagneticLassoTool, magneticActive, QuickSelectTool, RowColMarqueeTool, SelTransformTool } from './tools-select';
import { BgEraserTool, ColorReplaceTool, HistoryBrushTool, MagicEraserTool } from './tools-paint';
import { BlurTool, BurnTool, DodgeTool, HealTool, PatchTool, RedEyeTool, SharpenTool, SmudgeTool, SpongeTool, SpotHealTool } from './tools-retouch';
import { ColorSamplerTool, RotateViewTool, RulerTool } from './tools-measure';
import { getPattern } from './patterns';
import { ArtboardTool, artboardLabelAt, afterMoveToolDrag } from './tools-artboard';
import { applyArtboardMove, beginArtboardMove, selectedArtboards, type AbMove } from './artboard-ops';
import { unionRect } from './model';

export type ToolId = 'move' | 'marquee' | 'lasso' | 'wand' | 'crop' | 'eyedropper' | 'brush' | 'clone' | 'eraser' | 'gradient' | 'text' | 'shape' | 'hand' | 'zoom' | 'selxf'
  // ציור, רטוש ומדידה (tools-paint / tools-retouch / tools-measure)
  | 'pencil' | 'colorReplace' | 'bgEraser' | 'magicEraser' | 'historyBrush' | 'patternStamp'
  | 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn' | 'sponge'
  | 'spotHeal' | 'heal' | 'patch' | 'redEye'
  | 'colorSampler' | 'ruler' | 'rotateView'
  | 'vtext' | 'htmask' | 'vtmask'
  // משטחי עבודה (tools-artboard)
  | 'artboard';

export interface PtrEvt { doc: Pt; screen: Pt; shift: boolean; alt: boolean; ctrl: boolean; button: number; clicks: number }

export interface Tool {
  id: ToolId;
  cursor(ed: Editor, e: PtrEvt | null): string;
  down?(ed: Editor, e: PtrEvt): void;
  move?(ed: Editor, e: PtrEvt): void;
  up?(ed: Editor, e: PtrEvt): void;
  hover?(ed: Editor, e: PtrEvt): void;
  overlay?(ed: Editor, x: CanvasRenderingContext2D): void;
  key?(ed: Editor, combo: string, e: KeyboardEvent): boolean;
  activate?(ed: Editor): void;
  deactivate?(ed: Editor): void;
  cancel?(ed: Editor): void;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const deg = (r: number) => (r * 180) / Math.PI;
const modeOf = (e: PtrEvt): SelMode => (e.shift && e.alt ? 'int' : e.shift ? 'add' : e.alt ? 'sub' : 'new');

function pointInQuad(p: Pt, q: Pt[]) {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if (q[i].y > p.y !== q[j].y > p.y && p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
  }
  return inside;
}

function handleDot(x: CanvasRenderingContext2D, p: Pt, s = 7) {
  x.fillStyle = '#fff';
  x.strokeStyle = '#1473e6';
  x.lineWidth = 1;
  x.fillRect(Math.round(p.x - s / 2) + 0.5, Math.round(p.y - s / 2) + 0.5, s, s);
  x.strokeRect(Math.round(p.x - s / 2) + 0.5, Math.round(p.y - s / 2) + 0.5, s, s);
}

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M6 14a7 7 0 0 1 12-6" fill="none" stroke="white" stroke-width="4"/><path d="M6 14a7 7 0 0 1 12-6" fill="none" stroke="black" stroke-width="1.6"/><path d="M19 3v6h-6" fill="none" stroke="white" stroke-width="4"/><path d="M19 3v6h-6" fill="none" stroke="black" stroke-width="1.6"/></svg>')}") 12 12, crosshair`;

/* ======================= Move + Transform ======================= */

const HANDLES: Array<[number, number]> = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];
const RESIZE_CURSORS = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'];

function quadPoint(q: Pt[], hx: number, hy: number): Pt {
  const top = { x: q[0].x + (q[1].x - q[0].x) * hx, y: q[0].y + (q[1].y - q[0].y) * hx };
  const bot = { x: q[3].x + (q[2].x - q[3].x) * hx, y: q[3].y + (q[2].y - q[3].y) * hx };
  return { x: top.x + (bot.x - top.x) * hy, y: top.y + (bot.y - top.y) * hy };
}

interface MoveState {
  mode: 'move' | 'scale' | 'rotate' | 'guide' | 'rubber' | 'float';
  start: Pt;
  items: Array<{ l: XfLayer; t0: Xf }>;
  handle?: number;
  quad0?: Pt[];
  single?: XfLayer | null;
  box0?: Rect;
  targets?: { xs: number[]; ys: number[] };
  guide?: { axis: 'v' | 'h'; index: number };
  floatOrig?: HTMLCanvasElement;
  /** משטחי עבודה נבחרים שזזים יחד עם התוכן (המלבן והמסכות; המיקומים זזים ב-items) */
  abm?: AbMove | null;
  selOrig?: HTMLCanvasElement | null;
  moved?: boolean;
}

let ms: MoveState | null = null;

function showHandles(ed: Editor) { return !!ed.live.freeTransform || ed.opts.move.showTransform; }

function hitHandle(ed: Editor, sp: Pt): { kind: 'scale' | 'rotate'; index: number } | null {
  const q = ed.quadOf();
  if (!q || !showHandles(ed)) return null;
  const qs = q.pts.map((p) => ed.toScreen(p));
  for (let i = 0; i < HANDLES.length; i++) if (dist(quadPoint(qs, ...HANDLES[i]), sp) <= 7) return { kind: 'scale', index: i };
  for (let i = 0; i < 4; i++) if (dist(qs[i], sp) <= 26 && !pointInQuad(sp, qs)) return { kind: 'rotate', index: i };
  return null;
}

function hitGuide(ed: Editor, sp: Pt): MoveState['guide'] | null {
  const d = ed.doc!;
  if (!ed.view.guides || !ed.view.extras) return null;
  const st = ed.st!;
  // במרחב המסמך — עובד גם כשהתצוגה מסובבת (Rotate View)
  const p = ed.toDoc(sp.x, sp.y);
  for (let i = 0; i < d.guides.v.length; i++) if (Math.abs(d.guides.v[i] - p.x) * st.zoom <= 3) return { axis: 'v', index: i };
  for (let i = 0; i < d.guides.h.length; i++) if (Math.abs(d.guides.h[i] - p.y) * st.zoom <= 3) return { axis: 'h', index: i };
  return null;
}

function snapDelta(ed: Editor, box: Rect, dx: number, dy: number, targets: { xs: number[]; ys: number[] }) {
  ed.live.smart = [];
  if (!ed.view.snap) return { dx, dy };
  const d = ed.doc!;
  const thr = 6 / ed.st!.zoom;
  const edgesX = [box.x + dx, box.x + box.w / 2 + dx, box.x + box.w + dx];
  const edgesY = [box.y + dy, box.y + box.h / 2 + dy, box.y + box.h + dy];
  let bx: number | null = null, by: number | null = null, best = thr, bestY = thr;
  for (const t of targets.xs) for (const e of edgesX) if (Math.abs(t - e) < best) { best = Math.abs(t - e); bx = t - e; ed.live.smart![0] = { x1: t, y1: 0, x2: t, y2: d.height }; }
  for (const t of targets.ys) for (const e of edgesY) if (Math.abs(t - e) < bestY) { bestY = Math.abs(t - e); by = t - e; ed.live.smart![1] = { x1: 0, y1: t, x2: d.width, y2: t }; }
  ed.live.smart = ed.live.smart!.filter(Boolean);
  return { dx: dx + (bx ?? 0), dy: dy + (by ?? 0) };
}

/** פתרון מרכז חדש כך שנקודת העוגן (במרחב המקומי) נשארת באותו מקום במסמך */
function solveCenter(l: XfLayer, t: Xf, anchorLocal: Pt, anchorDoc: Pt): Pt {
  const { w, h } = localSize(l);
  const m = new DOMMatrix().rotateSelf(t.rot).scaleSelf(t.sx, t.sy);
  const v = { x: anchorLocal.x - w / 2, y: anchorLocal.y - h / 2 };
  return { x: anchorDoc.x - (m.a * v.x + m.c * v.y), y: anchorDoc.y - (m.b * v.x + m.d * v.y) };
}

const MoveTool: Tool = {
  id: 'move',
  cursor(ed, e) {
    if (!e || !ed.doc) return 'default';
    if (ms?.mode === 'rotate') return ROTATE_CURSOR;
    const h = hitHandle(ed, e.screen);
    if (h?.kind === 'rotate') return ROTATE_CURSOR;
    if (h) return RESIZE_CURSORS[h.index];
    const g = hitGuide(ed, e.screen);
    if (g) return g.axis === 'v' ? 'col-resize' : 'row-resize';
    return 'default';
  },
  down(ed, e) {
    const d = ed.doc!;
    const h = hitHandle(ed, e.screen);
    if (h) {
      const q = ed.quadOf()!;
      const items = ed.transformable().map((l) => ({ l, t0: { ...l.t } }));
      ms = { mode: h.kind, start: e.doc, items, handle: h.index, quad0: q.pts, single: q.single };
      ed.beginInteract();
      return;
    }
    const g = hitGuide(ed, e.screen);
    if (g && !e.alt) { ms = { mode: 'guide', start: e.doc, items: [], guide: g }; return; }

    const a = ed.active;
    // הזזת פיקסלים נבחרים (Move בתוך בחירה על שכבת פיקסלים)
    if (d.selection && a?.type === 'raster' && !a.locked && !ed.live.freeTransform) {
      const sa = ctx2d(d.selection).getImageData(Math.floor(e.doc.x), Math.floor(e.doc.y), 1, 1).data[3];
      if (sa > 127) {
        const floating = ed.selectedPixels(a, d.selection)!;
        const orig = a.canvas;
        ed.clearPixels(a, d.selection);
        ed.live.floating = { layerId: a.id, canvas: floating, dx: 0, dy: 0 };
        ms = { mode: 'float', start: e.doc, items: [], floatOrig: orig, selOrig: d.selection };
        if (e.alt) { a.canvas = orig; touch(a); }
        ed.beginInteract();
        return;
      }
    }

    const q = ed.quadOf();
    const insideBox = q && pointInQuad(e.doc, q.pts);
    const auto = ed.opts.move.autoSelect !== e.ctrl;
    if (auto && !ed.live.freeTransform) {
      const hit = ed.hitTest(e.doc, !ed.opts.move.autoGroup);
      if (hit) {
        if (e.shift) ed.selectLayer(hit.id, 'toggle');
        else if (!ed.st!.selected.includes(hit.id) && !(insideBox && ed.st!.selected.length > 1)) ed.selectLayer(hit.id);
      } else if (!insideBox) {
        if (!e.shift) ed.selectLayer(null);
        ms = { mode: 'rubber', start: e.doc, items: [] };
        return;
      }
    }
    // Alt+גרירה = שכפול והזזה של העותק
    if (e.alt && !ed.live.freeTransform && ed.topSelected().length) {
      const ids: string[] = [];
      for (const l of ed.topSelected()) {
        const f = findLayer(d.layers, l.id)!;
        const c = cloneLayer(l, true);
        c.name = `${l.name} עותק`;
        f.parent.splice(f.index + 1, 0, c);
        ids.push(c.id);
      }
      ed.st!.selected = ids;
      ed.st!.active = ids[ids.length - 1];
    }
    const items = ed.transformable().map((l) => ({ l, t0: { ...l.t } }));
    const abm = ed.live.freeTransform ? null : beginArtboardMove(selectedArtboards(ed), false);
    if (!items.length && !abm) return;
    let box: Rect | null = abm ? { ...abm.box } : null;
    for (const it of items) { const b = layerBounds(it.l)!; box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) } : b; }
    if (abm) box = unionRect(box, abm.box);
    ms = { mode: 'move', start: e.doc, items, box0: box!, abm, targets: ed.snapTargets(new Set([...items.map((i) => i.l.id), ...(abm?.ids ?? [])])) };
    ed.beginInteract();
  },
  move(ed, e) {
    if (!ms) return;
    const d = ed.doc!;
    ms.moved = true;
    if (ms.mode === 'guide') {
      const g = ms.guide!;
      const v = Math.round(g.axis === 'v' ? e.doc.x : e.doc.y);
      d.guides[g.axis][g.index] = v;
      ed.redraw(false);
      return;
    }
    if (ms.mode === 'rubber') {
      ed.live.rubber = { x: Math.min(ms.start.x, e.doc.x), y: Math.min(ms.start.y, e.doc.y), w: Math.abs(e.doc.x - ms.start.x), h: Math.abs(e.doc.y - ms.start.y) };
      ed.redraw(false);
      return;
    }
    if (ms.mode === 'float') {
      const fl = ed.live.floating!;
      let dx = e.doc.x - ms.start.x, dy = e.doc.y - ms.start.y;
      if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      fl.dx = Math.round(dx);
      fl.dy = Math.round(dy);
      const sel = newCanvas(d.width, d.height);
      sel.getContext('2d')!.drawImage(ms.selOrig!, fl.dx, fl.dy);
      d.selection = sel;
      ed.redraw(true);
      return;
    }
    if (ms.mode === 'move') {
      let dx = e.doc.x - ms.start.x, dy = e.doc.y - ms.start.y;
      if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      ({ dx, dy } = snapDelta(ed, ms.box0!, dx, dy, ms.targets!));
      // משטח עבודה זז בפיקסלים שלמים, והתוכן שלו איתו
      if (ms.abm) { dx = Math.round(dx); dy = Math.round(dy); applyArtboardMove(ms.abm, dx, dy); }
      for (const it of ms.items) { it.l.t.x = it.t0.x + dx; it.l.t.y = it.t0.y + dy; touch(it.l); }
      ed.redraw(true);
      ed.status = `ΔX ${Math.round(dx)}  ΔY ${Math.round(dy)}`;
      ed.emit();
      return;
    }
    if (ms.mode === 'rotate') {
      const q = ms.quad0!;
      const c = { x: (q[0].x + q[2].x) / 2, y: (q[0].y + q[2].y) / 2 };
      let da = deg(Math.atan2(e.doc.y - c.y, e.doc.x - c.x) - Math.atan2(ms.start.y - c.y, ms.start.x - c.x));
      if (ms.single) {
        const l = ms.single, t0 = ms.items[0].t0;
        let rot = t0.rot + da;
        if (e.shift) rot = Math.round(rot / 15) * 15;
        const b = localBox(l);
        const centerLocal = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        const t = { ...t0, rot };
        const nc = solveCenter(l, t, centerLocal, c);
        l.t.rot = rot; l.t.x = nc.x; l.t.y = nc.y;
        touch(l);
        ed.status = `${Math.round(((rot % 360) + 540) % 360 - 180)}°`;
      } else {
        if (e.shift) da = Math.round(da / 15) * 15;
        const a = (da * Math.PI) / 180;
        for (const it of ms.items) {
          const dx = it.t0.x - c.x, dy = it.t0.y - c.y;
          it.l.t.x = c.x + dx * Math.cos(a) - dy * Math.sin(a);
          it.l.t.y = c.y + dx * Math.sin(a) + dy * Math.cos(a);
          it.l.t.rot = it.t0.rot + da;
          touch(it.l);
        }
        ed.status = `${Math.round(da)}°`;
      }
      ed.redraw(true);
      ed.emit();
      return;
    }
    if (ms.mode === 'scale') {
      const [hx, hy] = HANDLES[ms.handle!];
      const corner = hx !== 0.5 && hy !== 0.5;
      // כמו בפוטושופ 2019+: פינות פרופורציונליות כברירת מחדל, Shift משחרר
      const prop = corner ? !e.shift : e.shift;
      if (ms.single) {
        const l = ms.single, t0 = ms.items[0].t0;
        const b = localBox(l);
        const { w, h } = localSize(l);
        const m0 = xfMatrix(t0, w, h);
        const H = { x: b.x + hx * b.w, y: b.y + hy * b.h };
        const A = e.alt ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: b.x + (1 - hx) * b.w, y: b.y + (1 - hy) * b.h };
        const Ad = apply(m0, A);
        const q = apply(m0.inverse(), e.doc);
        let fx = hx === 0.5 ? 1 : (q.x - A.x) / (H.x - A.x || 1);
        let fy = hy === 0.5 ? 1 : (q.y - A.y) / (H.y - A.y || 1);
        if (prop) {
          const f = hx === 0.5 ? Math.abs(fy) : hy === 0.5 ? Math.abs(fx) : Math.max(Math.abs(fx), Math.abs(fy));
          fx = (hx === 0.5 ? 1 : Math.sign(fx) || 1) * f;
          fy = (hy === 0.5 ? 1 : Math.sign(fy) || 1) * f;
        }
        if (Math.abs(fx) < 0.001) fx = 0.001 * (Math.sign(fx) || 1);
        if (Math.abs(fy) < 0.001) fy = 0.001 * (Math.sign(fy) || 1);
        const t = { ...t0, sx: t0.sx * fx, sy: t0.sy * fy };
        const nc = solveCenter(l, t, A, Ad);
        Object.assign(l.t, t, nc);
        touch(l);
        ed.status = `W ${Math.round(Math.abs(b.w * t.sx))}  H ${Math.round(Math.abs(b.h * t.sy))}`;
      } else {
        const q = ms.quad0!;
        const box = { x: q[0].x, y: q[0].y, w: q[2].x - q[0].x, h: q[2].y - q[0].y };
        const H = { x: box.x + hx * box.w, y: box.y + hy * box.h };
        const A = e.alt ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : { x: box.x + (1 - hx) * box.w, y: box.y + (1 - hy) * box.h };
        let fx = hx === 0.5 ? 1 : (e.doc.x - A.x) / (H.x - A.x || 1);
        let fy = hy === 0.5 ? 1 : (e.doc.y - A.y) / (H.y - A.y || 1);
        if (prop) {
          const f = hx === 0.5 ? Math.abs(fy) : hy === 0.5 ? Math.abs(fx) : Math.max(Math.abs(fx), Math.abs(fy));
          fx = (hx === 0.5 ? 1 : Math.sign(fx) || 1) * f;
          fy = (hy === 0.5 ? 1 : Math.sign(fy) || 1) * f;
        }
        for (const it of ms.items) {
          const swap = Math.abs(Math.sin((it.t0.rot * Math.PI) / 180)) > 0.7;
          it.l.t.x = A.x + (it.t0.x - A.x) * fx;
          it.l.t.y = A.y + (it.t0.y - A.y) * fy;
          it.l.t.sx = it.t0.sx * (swap ? fy : fx);
          it.l.t.sy = it.t0.sy * (swap ? fx : fy);
          touch(it.l);
        }
        ed.status = `${Math.round(fx * 100)}% × ${Math.round(fy * 100)}%`;
      }
      ed.redraw(true);
      ed.emit();
    }
  },
  up(ed) {
    if (!ms) return;
    const d = ed.doc!;
    const s = ms;
    ms = null;
    ed.live.smart = [];
    ed.status = '';
    if (s.mode === 'guide') {
      const g = s.guide!;
      const v = d.guides[g.axis][g.index];
      if (v < 0 || v > (g.axis === 'v' ? d.width : d.height)) d.guides[g.axis].splice(g.index, 1);
      ed.commit('הזזת קו עזר');
      return;
    }
    if (s.mode === 'rubber') {
      const r = ed.live.rubber;
      ed.live.rubber = null;
      if (r && r.w > 2 && r.h > 2) {
        const ids: string[] = [];
        const rec = (ls: typeof d.layers) => { for (const l of ls) { if (!l.visible || l.locked) continue; const b = layerBounds(l); if (b && b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y) ids.push(l.id); } };
        rec(d.layers);
        ed.st!.selected = [...new Set([...ed.st!.selected, ...ids])];
        ed.st!.active = ed.st!.selected[ed.st!.selected.length - 1] ?? null;
      }
      ed.redraw(false);
      ed.emit();
      return;
    }
    if (s.mode === 'float') {
      const fl = ed.live.floating!;
      const l = ed.layer(fl.layerId) as RasterLayer;
      ed.live.floating = null;
      ed.ensureCoverage(l);
      const c = copyCanvas(l.canvas), x = c.getContext('2d')!;
      x.setTransform(layerMatrix(l).inverse());
      x.drawImage(fl.canvas, fl.dx, fl.dy);
      l.canvas = c;
      touch(l);
      ed.endInteract();
      ed.commit('הזזת פיקסלים');
      return;
    }
    ed.endInteract();
    if (!s.moved) { ed.redraw(true); return; }
    for (const it of s.items) ed.bakeScale(it.l);
    if (ed.live.freeTransform) { ed.redraw(true); ed.emit(); return; }
    if (s.mode === 'move' && !s.abm) afterMoveToolDrag(ed);
    ed.commit(s.mode === 'move' ? (s.abm ? 'הזזת משטח עבודה' : 'הזזה') : s.mode === 'rotate' ? 'סיבוב' : 'שינוי גודל');
  },
  cancel(ed) {
    if (ms?.mode === 'float' && ed.live.floating) {
      const l = ed.layer(ed.live.floating.layerId) as RasterLayer;
      l.canvas = ms.floatOrig!;
      ed.doc!.selection = ms.selOrig ?? null;
      touch(l);
    }
    ms = null;
  },
  key(ed, combo) {
    if (!ed.live.freeTransform) return false;
    if (combo === 'Enter') { ed.commitFreeTransform(); return true; }
    if (combo === 'Escape') { ed.cancelFreeTransform(); return true; }
    return false;
  },
  overlay(ed, x) {
    const r = ed.live.rubber;
    if (r) {
      x.strokeStyle = '#4da3ff';
      x.fillStyle = 'rgba(77,163,255,.12)';
      x.lineWidth = 1;
      rectPath(ed, x, r);
      x.fill();
      x.stroke();
    }
    drawSelectionBoxes(ed, x);
  },
};

/** מסגרות סביב השכבות הנבחרות + ידיות טרנספורם */
function drawSelectionBoxes(ed: Editor, x: CanvasRenderingContext2D) {
  if (!ed.doc || ed.live.textEdit || ed.live.floating) return;
  const q = ed.quadOf();
  if (!q) return;
  const items = ed.transformable();
  x.lineWidth = 1;
  if (items.length > 1) {
    x.strokeStyle = 'rgba(77,163,255,.55)';
    for (const l of items) {
      const p = (localBox(l) && ed.layerMatrix(l)) ? layerQuadScreen(ed, l) : [];
      x.beginPath();
      p.forEach((pt, i) => (i ? x.lineTo(pt.x, pt.y) : x.moveTo(pt.x, pt.y)));
      x.closePath();
      x.stroke();
    }
  }
  const qs = q.pts.map((p) => ed.toScreen(p));
  x.strokeStyle = '#1473e6';
  x.beginPath();
  qs.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
  x.closePath();
  x.stroke();
  if (showHandles(ed)) for (const [hx, hy] of HANDLES) handleDot(x, quadPoint(qs, hx, hy));
  if (ed.live.freeTransform) {
    const c = quadPoint(qs, 0.5, 0.5);
    x.strokeStyle = '#1473e6';
    x.beginPath();
    x.arc(c.x, c.y, 4, 0, Math.PI * 2);
    x.moveTo(c.x - 7, c.y); x.lineTo(c.x + 7, c.y); x.moveTo(c.x, c.y - 7); x.lineTo(c.x, c.y + 7);
    x.stroke();
  }
}

/** מלבן במסמך כמצולע במסך (נכון גם כשהתצוגה מסובבת) */
function rectPath(ed: Editor, x: CanvasRenderingContext2D, r: Rect) {
  const pts = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }].map((p) => ed.toScreen(p));
  x.beginPath();
  pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
  x.closePath();
}

function layerQuadScreen(ed: Editor, l: XfLayer): Pt[] {
  const m = layerMatrix(l), b = localBox(l);
  return [apply(m, { x: b.x, y: b.y }), apply(m, { x: b.x + b.w, y: b.y }), apply(m, { x: b.x + b.w, y: b.y + b.h }), apply(m, { x: b.x, y: b.y + b.h })].map((p) => ed.toScreen(p));
}

/* ======================= בחירות ======================= */

let selDrag: { start: Pt; mode: SelMode; moveSel?: HTMLCanvasElement; pts: Pt[] } | null = null;

function ellipsePts(r: Rect) {
  const out: Pt[] = [];
  for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2; out.push({ x: r.x + r.w / 2 + (Math.cos(a) * r.w) / 2, y: r.y + r.h / 2 + (Math.sin(a) * r.h) / 2 }); }
  return out;
}

const RATIOS: Record<string, number> = { '1:1': 1, '4:5': 4 / 5, '9:16': 9 / 16, '16:9': 16 / 9, '3:2': 3 / 2, '2:3': 2 / 3 };

function dragRect(start: Pt, cur: Pt, square: boolean, center: boolean, ratio: number | null): Rect {
  let w = cur.x - start.x, h = cur.y - start.y;
  if (ratio) { if (Math.abs(w) / ratio > Math.abs(h)) h = (Math.sign(h) || 1) * Math.abs(w) / ratio; else w = (Math.sign(w) || 1) * Math.abs(h) * ratio; }
  else if (square) { const s = Math.max(Math.abs(w), Math.abs(h)); w = (Math.sign(w) || 1) * s; h = (Math.sign(h) || 1) * s; }
  if (center) return { x: start.x - Math.abs(w), y: start.y - Math.abs(h), w: Math.abs(w) * 2, h: Math.abs(h) * 2 };
  return { x: Math.min(start.x, start.x + w), y: Math.min(start.y, start.y + h), w: Math.abs(w), h: Math.abs(h) };
}

function drawMarquee(ed: Editor, x: CanvasRenderingContext2D) {
  const m = ed.live.marquee;
  if (!m || m.pts.length < 2) return;
  const pts = m.pts.map((p) => ed.toScreen(p));
  x.beginPath();
  pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
  if (m.closed) x.closePath();
  x.lineWidth = 1;
  x.strokeStyle = '#fff';
  x.stroke();
  x.strokeStyle = '#000';
  x.setLineDash([4, 4]);
  x.stroke();
  x.setLineDash([]);
}

function selMoveStart(ed: Editor, e: PtrEvt): boolean {
  const d = ed.doc!;
  if (modeOf(e) !== 'new' || !d.selection) return false;
  const a = ctx2d(d.selection).getImageData(Math.floor(e.doc.x), Math.floor(e.doc.y), 1, 1).data[3];
  if (a < 128) return false;
  selDrag = { start: e.doc, mode: 'new', moveSel: d.selection, pts: [] };
  return true;
}

function selMoveUpdate(ed: Editor, e: PtrEvt) {
  const d = ed.doc!;
  const c = newCanvas(d.width, d.height);
  c.getContext('2d')!.drawImage(selDrag!.moveSel!, Math.round(e.doc.x - selDrag!.start.x), Math.round(e.doc.y - selDrag!.start.y));
  d.selection = c;
  ed.redraw(false);
}

const MarqueeTool: Tool = {
  id: 'marquee',
  cursor: () => 'crosshair',
  down(ed, e) {
    if (selMoveStart(ed, e)) return;
    selDrag = { start: e.doc, mode: modeOf(e), pts: [] };
  },
  move(ed, e) {
    if (!selDrag) return;
    if (selDrag.moveSel) return selMoveUpdate(ed, e);
    const o = ed.opts.marquee;
    const fresh = selDrag.mode === 'new';
    const r = dragRect(selDrag.start, e.doc, fresh && e.shift, fresh && e.alt, RATIOS[o.ratio] ?? null);
    ed.live.marquee = { pts: o.shape === 'ellipse' ? ellipsePts(r) : [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }], closed: true };
    (ed.live as any).marqueeRect = r;
    ed.status = `W ${Math.round(r.w)}  H ${Math.round(r.h)}`;
    ed.redraw(false);
    ed.emit();
  },
  up(ed, e) {
    if (!selDrag) return;
    const d = ed.doc!;
    const s = selDrag;
    selDrag = null;
    ed.status = '';
    if (s.moveSel) { if (d.selection !== s.moveSel) ed.commit('הזזת בחירה'); return; }
    const r: Rect | undefined = (ed.live as any).marqueeRect;
    ed.live.marquee = null;
    (ed.live as any).marqueeRect = null;
    if (!r || r.w < 1 || r.h < 1 || dist(s.start, e.doc) * ed.st!.zoom < 3) {
      if (s.mode === 'new' && d.selection) ed.run('select.deselect');
      return;
    }
    const o = ed.opts.marquee;
    ed.setSelection(combine(d, rectSel(d, r, o.shape === 'ellipse', o.feather), s.mode), o.shape === 'ellipse' ? 'בחירה אליפטית' : 'בחירה מלבנית');
  },
  overlay: drawMarquee,
};

let poly: { pts: Pt[]; mode: SelMode; hover: Pt | null } | null = null;

function closePoly(ed: Editor) {
  if (!poly) return;
  const d = ed.doc!;
  const p = poly;
  poly = null;
  ed.live.marquee = null;
  if (p.pts.length >= 3) ed.setSelection(combine(d, polySel(d, p.pts, ed.opts.lasso.feather), p.mode), 'בחירת לאסו');
  else ed.redraw(false);
}

const LassoTool: Tool = {
  id: 'lasso',
  cursor: () => 'crosshair',
  down(ed, e) {
    if (ed.opts.lasso.mode === 'poly') {
      if (!poly) poly = { pts: [e.doc], mode: modeOf(e), hover: e.doc };
      else if (e.clicks >= 2 || (poly.pts.length > 2 && dist(ed.toScreen(poly.pts[0]), e.screen) < 8)) { closePoly(ed); return; }
      else poly.pts.push(e.doc);
      ed.live.marquee = { pts: [...poly.pts, e.doc], closed: false };
      ed.redraw(false);
      return;
    }
    if (selMoveStart(ed, e)) return;
    selDrag = { start: e.doc, mode: modeOf(e), pts: [e.doc] };
  },
  hover(ed, e) {
    if (poly) { ed.live.marquee = { pts: [...poly.pts, e.doc], closed: false }; ed.redraw(false); }
  },
  move(ed, e) {
    if (poly) { LassoTool.hover!(ed, e); return; }
    if (!selDrag) return;
    if (selDrag.moveSel) return selMoveUpdate(ed, e);
    selDrag.pts.push(e.doc);
    ed.live.marquee = { pts: selDrag.pts, closed: false };
    ed.redraw(false);
  },
  up(ed) {
    if (poly || !selDrag) return;
    const d = ed.doc!;
    const s = selDrag;
    selDrag = null;
    ed.live.marquee = null;
    if (s.moveSel) { if (d.selection !== s.moveSel) ed.commit('הזזת בחירה'); return; }
    if (s.pts.length < 3) { if (s.mode === 'new' && d.selection) ed.run('select.deselect'); else ed.redraw(false); return; }
    ed.setSelection(combine(d, polySel(d, s.pts, ed.opts.lasso.feather), s.mode), 'בחירת לאסו');
  },
  key(ed, combo) {
    if (!poly) return false;
    if (combo === 'Enter') { closePoly(ed); return true; }
    if (combo === 'Escape') { poly = null; ed.live.marquee = null; ed.redraw(false); return true; }
    if (combo === 'Backspace' || combo === 'Delete') { poly.pts.pop(); if (!poly.pts.length) { poly = null; ed.live.marquee = null; } ed.redraw(false); return true; }
    return false;
  },
  deactivate(ed) { poly = null; ed.live.marquee = null; },
  overlay: drawMarquee,
};

const WandTool: Tool = {
  id: 'wand',
  cursor: () => 'crosshair',
  down(ed, e) {
    const d = ed.doc!;
    const o = ed.opts.wand;
    const a = ed.active;
    const src = o.allLayers || !a ? renderDoc(d, { scale: 1 }) : renderSingle(a, d);
    ed.setSelection(combine(d, wandSel(d, src, e.doc, o.tolerance, o.contiguous), modeOf(e)), 'מטה קסם');
  },
};

/* ======================= Crop ======================= */

let cropDrag: { mode: 'new' | 'move' | 'handle'; start: Pt; r0: Rect; handle?: number } | null = null;

function cropRatio(ed: Editor): number | null {
  const r = ed.opts.crop.ratio;
  if (r === 'original') return ed.doc!.width / ed.doc!.height;
  return RATIOS[r] ?? null;
}

const CropTool: Tool = {
  id: 'crop',
  cursor(ed, e) {
    const c = ed.live.crop;
    if (!c || !e) return 'crosshair';
    const qs = [{ x: c.x, y: c.y }, { x: c.x + c.w, y: c.y }, { x: c.x + c.w, y: c.y + c.h }, { x: c.x, y: c.y + c.h }].map((p) => ed.toScreen(p));
    for (let i = 0; i < HANDLES.length; i++) if (dist(quadPoint(qs, ...HANDLES[i]), e.screen) <= 9) return RESIZE_CURSORS[i];
    return pointInQuad(e.doc, [{ x: c.x, y: c.y }, { x: c.x + c.w, y: c.y }, { x: c.x + c.w, y: c.y + c.h }, { x: c.x, y: c.y + c.h }]) ? 'move' : 'crosshair';
  },
  activate(ed) { const d = ed.doc; if (d) ed.live.crop = { x: 0, y: 0, w: d.width, h: d.height }; },
  deactivate(ed) { ed.live.crop = null; },
  down(ed, e) {
    const d = ed.doc!;
    if (!ed.live.crop) ed.live.crop = { x: 0, y: 0, w: d.width, h: d.height };
    const c = ed.live.crop;
    if (e.clicks >= 2 && pointInQuad(e.doc, [{ x: c.x, y: c.y }, { x: c.x + c.w, y: c.y }, { x: c.x + c.w, y: c.y + c.h }, { x: c.x, y: c.y + c.h }])) { commitCrop(ed); return; }
    const qs = [{ x: c.x, y: c.y }, { x: c.x + c.w, y: c.y }, { x: c.x + c.w, y: c.y + c.h }, { x: c.x, y: c.y + c.h }].map((p) => ed.toScreen(p));
    for (let i = 0; i < HANDLES.length; i++) if (dist(quadPoint(qs, ...HANDLES[i]), e.screen) <= 9) { cropDrag = { mode: 'handle', start: e.doc, r0: { ...c }, handle: i }; return; }
    const inside = e.doc.x > c.x && e.doc.x < c.x + c.w && e.doc.y > c.y && e.doc.y < c.y + c.h;
    cropDrag = { mode: inside ? 'move' : 'new', start: e.doc, r0: { ...c } };
  },
  move(ed, e) {
    if (!cropDrag) return;
    const r0 = cropDrag.r0, ratio = cropRatio(ed);
    if (cropDrag.mode === 'move') ed.live.crop = { ...r0, x: Math.round(r0.x + e.doc.x - cropDrag.start.x), y: Math.round(r0.y + e.doc.y - cropDrag.start.y) };
    else if (cropDrag.mode === 'new') ed.live.crop = roundRect(dragRect(cropDrag.start, e.doc, e.shift, e.alt, ratio));
    else {
      const [hx, hy] = HANDLES[cropDrag.handle!];
      let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h;
      if (hx === 0) x0 = e.doc.x; if (hx === 1) x1 = e.doc.x;
      if (hy === 0) y0 = e.doc.y; if (hy === 1) y1 = e.doc.y;
      let w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      const want = ratio ?? (e.shift ? r0.w / r0.h : null);
      if (want) { if (hx === 0.5) w = h * want; else h = w / want; }
      const x = hx === 0 ? Math.min(x0, x1) : hx === 1 ? Math.min(r0.x, x1) : r0.x + r0.w / 2 - w / 2;
      const y = hy === 0 ? Math.min(y0, y1) : hy === 1 ? Math.min(r0.y, y1) : r0.y + r0.h / 2 - h / 2;
      ed.live.crop = roundRect({ x: hx === 0 ? r0.x + r0.w - w : x, y: hy === 0 ? r0.y + r0.h - h : y, w, h });
    }
    const c = ed.live.crop!;
    ed.status = `${Math.round(c.w)} × ${Math.round(c.h)} px`;
    ed.redraw(false);
    ed.emit();
  },
  up() { cropDrag = null; },
  key(ed, combo) {
    if (combo === 'Enter') { commitCrop(ed); return true; }
    if (combo === 'Escape') { const d = ed.doc; if (d) ed.live.crop = { x: 0, y: 0, w: d.width, h: d.height }; ed.redraw(false); return true; }
    return false;
  },
  overlay(ed, x) {
    const c = ed.live.crop;
    if (!c) return;
    // ארבע פינות במסך — נכון גם כשהתצוגה מסובבת
    const qs = [{ x: c.x, y: c.y }, { x: c.x + c.w, y: c.y }, { x: c.x + c.w, y: c.y + c.h }, { x: c.x, y: c.y + c.h }].map((p) => ed.toScreen(p));
    const cv = ed.canvas!;
    const poly = () => { qs.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); };
    x.fillStyle = 'rgba(0,0,0,.55)';
    x.beginPath();
    x.rect(0, 0, cv.clientWidth, cv.clientHeight);
    poly();
    x.fill('evenodd');
    x.strokeStyle = 'rgba(255,255,255,.45)';
    x.lineWidth = 1;
    x.beginPath();
    for (const k of [1 / 3, 2 / 3]) {
      const t1 = quadPoint(qs, k, 0), b1 = quadPoint(qs, k, 1), l1 = quadPoint(qs, 0, k), r1 = quadPoint(qs, 1, k);
      x.moveTo(t1.x, t1.y); x.lineTo(b1.x, b1.y);
      x.moveTo(l1.x, l1.y); x.lineTo(r1.x, r1.y);
    }
    x.stroke();
    x.strokeStyle = '#fff';
    x.beginPath();
    poly();
    x.stroke();
    for (const [hx, hy] of HANDLES) handleDot(x, quadPoint(qs, hx, hy), 9);
  },
};

const roundRect = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) });

export function commitCrop(ed: Editor) {
  const c = ed.live.crop, d = ed.doc;
  if (!c || !d) return;
  if (c.x === 0 && c.y === 0 && c.w === d.width && c.h === d.height) return;
  ed.crop(c);
  ed.live.crop = { x: 0, y: 0, w: ed.doc!.width, h: ed.doc!.height };
}

/* ======================= Eyedropper ======================= */

const EyedropperTool: Tool = {
  id: 'eyedropper',
  cursor: () => 'crosshair',
  down(ed, e) { pick(ed, e); },
  move(ed, e) { pick(ed, e); },
};

function pick(ed: Editor, e: PtrEvt) {
  const c = ed.sampleColor(e.doc);
  if (!c) return;
  if (e.alt) ed.bg = c; else ed.fg = c;
  ed.emit();
}

/* ======================= Brush / Eraser / Clone ======================= */

type StrokeTool = 'brush' | 'eraser' | 'clone' | 'pencil' | 'patternStamp';

interface Stroke {
  tool: StrokeTool;
  layerId: string;
  /** qmask = Quick Mask: המשיחה עורכת את הבחירה עצמה */
  target: 'pixels' | 'mask' | 'qmask';
  base: HTMLCanvasElement;
  /** Quick Mask: הבהירות של הצבע = ערך הבחירה (שחור מסיר, לבן מוסיף, אפור חלקי) */
  lum?: number;
  stroke: HTMLCanvasElement;
  inv: DOMMatrix;
  scale: number;
  last: Pt;
  color: string;
  op: 'paint' | 'erase';
  source?: HTMLCanvasElement;
  offset?: Pt;
  /** Pattern Stamp: מקור הדפוס (Aligned = מעוגן למסמך, אחרת לתחילת המשיחה) */
  pattern?: { canvas: HTMLCanvasElement; origin: Pt };
}
let stroke: Stroke | null = null;
let lastStrokeEnd: Pt | null = null;
let cloneOffset: Pt | null = null;

function brushOpts(ed: Editor, tool: StrokeTool): { size: number; hardness: number; opacity: number; flow: number } { return ed.opts[tool]; }

function dab(st: Stroke, ed: Editor, p: Pt) {
  const o = brushOpts(ed, st.tool);
  const x = st.stroke.getContext('2d')!;
  const q = apply(st.inv, p);
  const r = Math.max(0.5, (o.size / 2) * st.scale);
  if (st.tool === 'pencil') {
    // Pencil: עיגול קשיח בלי החלקת קצוות — שורות של פיקסלים שלמים
    x.fillStyle = st.color;
    if (r <= 0.75) { x.fillRect(Math.floor(q.x), Math.floor(q.y), 1, 1); return; }
    for (let yy = Math.floor(q.y - r); yy <= Math.ceil(q.y + r); yy++) {
      const dy = yy + 0.5 - q.y;
      if (Math.abs(dy) > r) continue;
      const half = Math.sqrt(r * r - dy * dy);
      const x0 = Math.round(q.x - half), x1 = Math.round(q.x + half);
      if (x1 > x0) x.fillRect(x0, yy, x1 - x0, 1);
    }
    return;
  }
  if (st.tool === 'patternStamp' && st.pattern) {
    const rd = o.size / 2;
    const size = Math.ceil(rd * 2 + 2);
    const tmp = newCanvas(size, size), tx = tmp.getContext('2d')!;
    const pat = tx.createPattern(st.pattern.canvas, 'repeat')!;
    pat.setTransform(new DOMMatrix().translateSelf(st.pattern.origin.x - (p.x - rd), st.pattern.origin.y - (p.y - rd)));
    tx.fillStyle = pat;
    tx.fillRect(0, 0, size, size);
    tx.globalCompositeOperation = 'destination-in';
    const g = tx.createRadialGradient(rd, rd, rd * o.hardness * 0.999, rd, rd, rd);
    g.addColorStop(0, `rgba(0,0,0,${o.flow})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    tx.fillStyle = g;
    tx.fillRect(0, 0, size, size);
    x.save();
    x.setTransform(st.inv);
    x.drawImage(tmp, p.x - rd, p.y - rd);
    x.restore();
    return;
  }
  if (st.tool === 'clone' && st.source && st.offset) {
    const rd = o.size / 2;
    const size = Math.ceil(rd * 2 + 2);
    const tmp = newCanvas(size, size), tx = tmp.getContext('2d')!;
    tx.drawImage(st.source, -(p.x - st.offset.x - rd), -(p.y - st.offset.y - rd));
    tx.globalCompositeOperation = 'destination-in';
    const g = tx.createRadialGradient(rd, rd, rd * o.hardness * 0.999, rd, rd, rd);
    g.addColorStop(0, `rgba(0,0,0,${o.flow})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    tx.fillStyle = g;
    tx.fillRect(0, 0, size, size);
    x.save();
    x.setTransform(st.inv);
    x.drawImage(tmp, p.x - rd, p.y - rd);
    x.restore();
    return;
  }
  const [cr, cg, cb] = hexToRgb(st.color);
  const g = x.createRadialGradient(q.x, q.y, r * o.hardness * 0.999, q.x, q.y, r);
  g.addColorStop(0, `rgba(${cr},${cg},${cb},${o.flow})`);
  g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  x.fillStyle = g;
  x.beginPath();
  x.arc(q.x, q.y, r, 0, Math.PI * 2);
  x.fill();
}

function strokeTo(st: Stroke, ed: Editor, p: Pt) {
  const o = brushOpts(ed, st.tool);
  const spacing = Math.max(0.5, o.size * 0.1);
  const d = dist(st.last, p);
  const n = Math.floor(d / spacing);
  for (let i = 1; i <= n; i++) dab(st, ed, { x: st.last.x + ((p.x - st.last.x) * i * spacing) / d, y: st.last.y + ((p.y - st.last.y) * i * spacing) / d });
  if (n) st.last = { x: st.last.x + ((p.x - st.last.x) * n * spacing) / d, y: st.last.y + ((p.y - st.last.y) * n * spacing) / d };
}

/** בסיס + משיחה (בתוך הבחירה בלבד), באטימות הכלי */
function composeStroke(st: Stroke, ed: Editor): HTMLCanvasElement {
  const d = ed.doc!;
  const o = brushOpts(ed, st.tool);
  let s = st.stroke;
  if (st.target === 'qmask') {
    // base·(1−a) + lum·a — מוחקים לפי המשיחה ואז מוסיפים אותה בעוצמת הבהירות
    const out = copyCanvas(st.base), x = out.getContext('2d')!;
    x.globalAlpha = o.opacity;
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(s, 0, 0);
    x.globalAlpha = o.opacity * (st.lum ?? 1);
    x.globalCompositeOperation = 'lighter';
    x.drawImage(s, 0, 0);
    return out;
  }
  if (d.selection) {
    s = copyCanvas(st.stroke);
    const sx = s.getContext('2d')!;
    sx.globalCompositeOperation = 'destination-in';
    sx.setTransform(st.inv);
    sx.drawImage(d.selection, 0, 0);
  }
  const out = copyCanvas(st.base), x = out.getContext('2d')!;
  x.globalAlpha = o.opacity;
  x.globalCompositeOperation = st.op === 'erase' ? 'destination-out' : 'source-over';
  x.drawImage(s, 0, 0);
  return out;
}

function startStroke(ed: Editor, e: PtrEvt, tool: StrokeTool): boolean {
  const d = ed.doc!;
  if (ed.st!.qmask && (tool === 'brush' || tool === 'eraser' || tool === 'pencil')) {
    // Quick Mask: מברשת בצבע הקדמי, מחק בצבע הרקע (כמו בפוטושופ) — על הבחירה, לא על שכבה
    const [r, g, b] = hexToRgb(tool === 'eraser' ? ed.bg : ed.fg);
    const base = d.selection ?? newCanvas(d.width, d.height);
    const startPt = e.shift && lastStrokeEnd ? lastStrokeEnd : e.doc;
    stroke = { tool, layerId: '', target: 'qmask', base, stroke: newCanvas(base.width, base.height), inv: new DOMMatrix(), scale: 1, last: startPt, color: '#ffffff', op: 'paint', lum: (0.299 * r + 0.587 * g + 0.114 * b) / 255 };
    dab(stroke, ed, startPt);
    if (e.shift && lastStrokeEnd) strokeTo(stroke, ed, e.doc);
    ed.live.qmask = composeStroke(stroke, ed);
    ed.redraw(false);
    return true;
  }
  let l = ed.active;
  if (!l) { ed.toast('בחר שכבה', 'error'); return false; }
  if (l.locked) { ed.toast('השכבה נעולה', 'error'); return false; }
  const maskEdit = ed.st!.maskEdit && !!l.mask;
  if (!maskEdit && l.type !== 'raster') {
    if (tool === 'eraser') { ed.toast('אי אפשר למחוק בשכבת טקסט/צורה. הוסף מסכה (מחיקה לא הרסנית) או Layer > Rasterize', 'error'); return false; }
    l = ed.newLayer();
    ed.toast('נפתחה שכבה חדשה לציור (השכבה שנבחרה אינה שכבת פיקסלים)');
  }
  if (tool === 'clone' && !ed.live.cloneSrc) { ed.toast('Alt+לחיצה כדי לבחור את נקודת המקור', 'error'); return false; }
  let base: HTMLCanvasElement, inv: DOMMatrix;
  if (maskEdit) { base = l.mask!.canvas; inv = new DOMMatrix(); }
  else {
    const r = l as RasterLayer;
    ed.ensureCoverage(r);
    base = r.canvas;
    inv = layerMatrix(r).inverse();
  }
  let color = ed.fg, op: Stroke['op'] = tool === 'eraser' ? 'erase' : 'paint';
  if (maskEdit) {
    const [r, g, b] = hexToRgb(ed.fg);
    const light = 0.299 * r + 0.587 * g + 0.114 * b > 127;
    color = '#ffffff';
    if (tool === 'eraser' || !light) op = 'erase';
  }
  const scale = Math.sqrt(Math.abs(inv.a * inv.d - inv.b * inv.c));
  const startPt = e.shift && lastStrokeEnd ? lastStrokeEnd : e.doc;
  if (tool === 'pencil' && ed.opts.pencil.autoErase && !maskEdit) {
    // Auto Erase: מתחילים על פיקסל בצבע הקדמי → מציירים בצבע הרקע
    const q = apply(inv, e.doc);
    const px = ctx2d(base).getImageData(Math.floor(q.x), Math.floor(q.y), 1, 1).data;
    const [fr, fg, fb] = hexToRgb(ed.fg);
    if (px[3] > 0 && Math.max(Math.abs(px[0] - fr), Math.abs(px[1] - fg), Math.abs(px[2] - fb)) <= 6) color = ed.bg;
  }
  stroke = { tool, layerId: l.id, target: maskEdit ? 'mask' : 'pixels', base, stroke: newCanvas(base.width, base.height), inv, scale, last: startPt, color, op };
  if (tool === 'clone') {
    stroke.source = renderDoc(d, { scale: 1 });
    if (!ed.opts.clone.aligned || !cloneOffset) cloneOffset = { x: e.doc.x - ed.live.cloneSrc!.x, y: e.doc.y - ed.live.cloneSrc!.y };
    stroke.offset = cloneOffset;
  }
  if (tool === 'patternStamp') {
    const o = ed.opts.patternStamp;
    stroke.pattern = { canvas: getPattern(o.pattern).canvas, origin: o.aligned ? { x: 0, y: 0 } : { x: e.doc.x, y: e.doc.y } };
  }
  dab(stroke, ed, startPt);
  if (e.shift && lastStrokeEnd) strokeTo(stroke, ed, e.doc);
  ed.live.paint = { layerId: l.id, target: maskEdit ? 'mask' : 'pixels', canvas: composeStroke(stroke, ed) };
  ed.beginInteract();
  ed.redraw(true);
  return true;
}

let brushCursor: Pt | null = null;

const STROKE_LABEL: Record<StrokeTool, string> = { brush: 'מברשת', eraser: 'מחק', clone: 'חותמת שכפול', pencil: 'עיפרון', patternStamp: 'חותמת דוגמה' };

function paintTool(id: StrokeTool): Tool {
  return {
    id,
    cursor: () => 'crosshair',
    down(ed, e) {
      if (id === 'clone' && e.alt) { ed.live.cloneSrc = e.doc; cloneOffset = null; ed.toast('נקודת מקור נקבעה'); ed.redraw(false); return; }
      if ((id === 'brush' || id === 'pencil') && e.alt) { pick(ed, { ...e, alt: false }); return; }
      startStroke(ed, e, id);
    },
    move(ed, e) {
      brushCursor = e.screen;
      if (!stroke) { ed.redraw(false); return; }
      strokeTo(stroke, ed, e.doc);
      if (stroke.target === 'qmask') { ed.live.qmask = composeStroke(stroke, ed); ed.redraw(false); return; }
      ed.live.paint = { layerId: stroke.layerId, target: stroke.target === 'mask' ? 'mask' : 'pixels', canvas: composeStroke(stroke, ed) };
      ed.redraw(true);
    },
    hover(ed, e) { brushCursor = e.screen; if (id === 'clone' && ed.live.cloneSrc && cloneOffset) ed.live.cloneCursor = { x: e.doc.x - cloneOffset.x, y: e.doc.y - cloneOffset.y }; ed.redraw(false); },
    up(ed, e) {
      if (!stroke) return;
      const st = stroke;
      stroke = null;
      lastStrokeEnd = e.doc;
      const result = composeStroke(st, ed);
      if (st.target === 'qmask') { ed.live.qmask = null; ed.setSelection(result, `מסכה מהירה · ${STROKE_LABEL[id]}`); return; }
      const l = ed.layer(st.layerId)!;
      if (st.target === 'mask' && l.mask) l.mask = { ...l.mask, canvas: result };
      else (l as RasterLayer).canvas = result;
      touch(l);
      ed.live.paint = null;
      ed.endInteract();
      ed.commit(STROKE_LABEL[id]);
    },
    overlay(ed, x) {
      if (!brushCursor || !ed.st) return;
      const r = (brushOpts(ed, id).size / 2) * ed.st.zoom;
      x.lineWidth = 1;
      x.strokeStyle = 'rgba(0,0,0,.7)';
      x.beginPath(); x.arc(brushCursor.x, brushCursor.y, Math.max(1, r), 0, Math.PI * 2); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,.8)';
      x.beginPath(); x.arc(brushCursor.x, brushCursor.y, Math.max(1, r) + 1, 0, Math.PI * 2); x.stroke();
      if (id === 'clone' && ed.live.cloneSrc) {
        const s = ed.toScreen(stroke && cloneOffset ? { x: stroke.last.x - cloneOffset.x, y: stroke.last.y - cloneOffset.y } : ed.live.cloneCursor ?? ed.live.cloneSrc);
        x.strokeStyle = '#fff';
        x.beginPath(); x.moveTo(s.x - 8, s.y); x.lineTo(s.x + 8, s.y); x.moveTo(s.x, s.y - 8); x.lineTo(s.x, s.y + 8); x.stroke();
      }
    },
    deactivate() { brushCursor = null; },
  };
}

/* ======================= Gradient / Paint Bucket ======================= */

let grad: { a: Pt } | null = null;

function rasterTarget(ed: Editor): RasterLayer | null {
  let l = ed.active;
  if (l?.locked) { ed.toast('השכבה נעולה', 'error'); return null; }
  if (!l || l.type !== 'raster') l = ed.newLayer();
  ed.ensureCoverage(l as RasterLayer);
  return l as RasterLayer;
}

function paintDocCanvas(ed: Editor, l: RasterLayer, docCanvas: HTMLCanvasElement, label: string) {
  const d = ed.doc!;
  if (d.selection) { const x = docCanvas.getContext('2d')!; x.globalCompositeOperation = 'destination-in'; x.drawImage(d.selection, 0, 0); }
  const c = copyCanvas(l.canvas), x = c.getContext('2d')!;
  x.setTransform(layerMatrix(l).inverse());
  x.drawImage(docCanvas, 0, 0);
  l.canvas = c;
  touch(l);
  ed.commit(label);
}

const GradientTool: Tool = {
  id: 'gradient',
  cursor: () => 'crosshair',
  down(ed, e) {
    const o = ed.opts.gradient;
    if (o.mode === 'bucket') {
      if (ed.st!.qmask) { ed.toast('במסכה מהירה עובדים עם מברשת, מחק או מעבר צבע · Q ליציאה', 'error'); return; }
      const d = ed.doc!;
      const l = rasterTarget(ed);
      if (!l) return;
      const src = renderSingle(l, d);
      const region = wandSel(d, src, e.doc, o.tolerance, o.contiguous);
      const fill = newCanvas(d.width, d.height), fx = fill.getContext('2d')!;
      fx.drawImage(region, 0, 0);
      fx.globalCompositeOperation = 'source-in';
      fx.fillStyle = ed.fg;
      fx.globalAlpha = o.opacity;
      fx.fillRect(0, 0, d.width, d.height);
      paintDocCanvas(ed, l, fill, 'דלי צבע');
      return;
    }
    grad = { a: e.doc };
  },
  move(ed, e) {
    if (!grad) return;
    let b = e.doc;
    if (e.shift) {
      const a = Math.atan2(b.y - grad.a.y, b.x - grad.a.x), r = dist(grad.a, b), s = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
      b = { x: grad.a.x + Math.cos(s) * r, y: grad.a.y + Math.sin(s) * r };
    }
    ed.live.gradientLine = { a: grad.a, b };
    ed.redraw(false);
  },
  up(ed) {
    const line = ed.live.gradientLine;
    grad = null;
    ed.live.gradientLine = null;
    if (!line || dist(line.a, line.b) < 2) { ed.redraw(false); return; }
    const d = ed.doc!, o = ed.opts.gradient;
    const l = ed.st!.qmask ? null : rasterTarget(ed);
    if (!l && !ed.st!.qmask) return;
    const c = newCanvas(d.width, d.height), x = c.getContext('2d')!;
    const g = o.type === 'linear' ? x.createLinearGradient(line.a.x, line.a.y, line.b.x, line.b.y) : x.createRadialGradient(line.a.x, line.a.y, 0, line.a.x, line.a.y, dist(line.a, line.b));
    g.addColorStop(0, o.reverse ? ed.bg : ed.fg);
    g.addColorStop(1, o.reverse ? ed.fg : ed.bg);
    x.globalAlpha = o.opacity;
    x.fillStyle = g;
    x.fillRect(0, 0, d.width, d.height);
    if (!l) { ed.setSelection(blendLumaIntoSelection(d.selection, c, d.width, d.height), 'מסכה מהירה · מעבר צבע'); return; }
    paintDocCanvas(ed, l, c, 'מעבר צבע');
  },
  overlay(ed, x) {
    const g = ed.live.gradientLine;
    if (!g) return;
    const a = ed.toScreen(g.a), b = ed.toScreen(g.b);
    x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,.6)';
    x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
    x.lineWidth = 1; x.strokeStyle = '#fff';
    x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
    handleDot(x, a, 6); handleDot(x, b, 6);
  },
};

/* ======================= Text ======================= */

let textDrag: { start: Pt } | null = null;

/**
 * Type Tool בארבעת המצבים של פוטושופ: אופקי, אנכי (vtext), ומסכות טקסט (htmask/vtmask) —
 * במסכה ההקלדה יוצרת בחירה בצורת הטקסט במקום שכבה.
 */
const textTool = (id: ToolId, orient: 'h' | 'v', mask: boolean): Tool => ({
  id,
  cursor: () => (orient === 'v' ? 'vertical-text' : 'text'),
  down(ed, e) {
    if (ed.live.textEdit) { ed.commitTextEdit(); return; }
    const hit = mask ? null : ed.textAt(e.doc);
    if (hit && !hit.locked) { ed.beginTextEdit(hit, false); return; }
    textDrag = { start: e.doc };
  },
  move(ed, e) {
    if (!textDrag) return;
    ed.live.rubber = { x: Math.min(textDrag.start.x, e.doc.x), y: Math.min(textDrag.start.y, e.doc.y), w: Math.abs(e.doc.x - textDrag.start.x), h: Math.abs(e.doc.y - textDrag.start.y) };
    ed.redraw(false);
  },
  up(ed, e) {
    if (!textDrag) return;
    const s = textDrag.start;
    textDrag = null;
    const r = ed.live.rubber;
    ed.live.rubber = null;
    // כמו בפוטושופ: צבע הטקסט החדש = הצבע הקדמי
    const style = { ...ed.opts.text, color: ed.fg };
    ed.fontReady(style);
    const prev = { selected: [...ed.st!.selected], active: ed.st!.active };
    let l: TextLayer;
    if (orient === 'v') {
      // אנכי: הלחיצה היא ראש העמודה הראשונה; עמודות נוספות נבנות שמאלה
      l = ed.addTextLayer('', { x: s.x, y: s.y }, null, style);
      l.orientation = 'v';
      const L = layoutText(l);
      l.t.x = s.x;
      l.t.y = s.y + L.h / 2;
    } else if (r && r.w * ed.st!.zoom > 8) {
      // Paragraph Text: תיבה עם גלישה
      l = ed.addTextLayer('', { x: r.x + r.w / 2, y: 0 }, Math.max(10, r.w), style);
      const L = layoutText(l);
      l.t.y = r.y + L.h / 2;
    } else {
      // Point Text: הלחיצה היא קו הבסיס של השורה, בקצה שממנו מתחילים לכתוב
      l = ed.addTextLayer('', { x: s.x, y: s.y }, null, style);
      const L = layoutText(l);
      const startRight = style.align === 'right' || (style.align === 'justify' && style.dir === 'rtl');
      l.t.x = style.align === 'center' ? s.x : startRight ? s.x - L.w / 2 : s.x + L.w / 2;
      l.t.y = s.y - L.ascent - (L.lineH - (L.ascent + L.descent)) / 2 + L.h / 2;
    }
    void e;
    ed.beginTextEdit(l, true, mask, mask ? prev : undefined);
  },
  overlay(ed, x) {
    const r = ed.live.rubber;
    if (r) {
      x.setLineDash([3, 3]);
      x.strokeStyle = '#fff';
      x.lineWidth = 1;
      rectPath(ed, x, r);
      x.stroke();
      x.setLineDash([]);
    }
    const te = ed.live.textEdit;
    if (te) {
      const l = ed.layer(te.layerId);
      if (l && isXf(l)) {
        const p = layerQuadScreen(ed, l);
        x.strokeStyle = 'rgba(77,163,255,.8)';
        x.setLineDash([2, 3]);
        x.beginPath();
        p.forEach((pt, i) => (i ? x.lineTo(pt.x, pt.y) : x.moveTo(pt.x, pt.y)));
        x.closePath();
        x.stroke();
        x.setLineDash([]);
      }
    } else if (!mask) drawSelectionBoxes(ed, x);
  },
  deactivate(ed) { ed.commitTextEdit(); },
});

/* ======================= Shapes ======================= */

let shapeDrag: { start: Pt; cur: Pt; shift: boolean; alt: boolean } | null = null;

function shapeGeom(ed: Editor, s: NonNullable<typeof shapeDrag>): { r: Rect; rot: number } {
  if (ed.opts.shape.kind === 'line') {
    let b = s.cur;
    if (s.shift) {
      const a = Math.atan2(b.y - s.start.y, b.x - s.start.x), r = dist(s.start, b), q = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
      b = { x: s.start.x + Math.cos(q) * r, y: s.start.y + Math.sin(q) * r };
    }
    const len = dist(s.start, b), th = Math.max(1, ed.opts.shape.strokeWidth);
    const c = { x: (s.start.x + b.x) / 2, y: (s.start.y + b.y) / 2 };
    return { r: { x: c.x - len / 2, y: c.y - th / 2, w: len, h: th }, rot: deg(Math.atan2(b.y - s.start.y, b.x - s.start.x)) };
  }
  return { r: dragRect(s.start, s.cur, s.shift, s.alt, null), rot: 0 };
}

const ShapeTool: Tool = {
  id: 'shape',
  cursor: () => 'crosshair',
  down(_ed, e) { shapeDrag = { start: e.doc, cur: e.doc, shift: e.shift, alt: e.alt }; },
  move(ed, e) {
    if (!shapeDrag) return;
    Object.assign(shapeDrag, { cur: e.doc, shift: e.shift, alt: e.alt });
    const g = shapeGeom(ed, shapeDrag);
    ed.status = `W ${Math.round(g.r.w)}  H ${Math.round(g.r.h)}`;
    ed.redraw(false);
    ed.emit();
  },
  up(ed, e) {
    if (!shapeDrag) return;
    const s = shapeDrag;
    shapeDrag = null;
    ed.status = '';
    let { r, rot } = shapeGeom(ed, s);
    if (dist(s.start, e.doc) * ed.st!.zoom < 4) r = { x: e.doc.x - 100, y: e.doc.y - (ed.opts.shape.kind === 'line' ? ed.opts.shape.strokeWidth / 2 : 100), w: 200, h: ed.opts.shape.kind === 'line' ? ed.opts.shape.strokeWidth : 200 };
    ed.addShapeLayer(ed.opts.shape.kind, r, rot);
    ed.commit('צורה');
  },
  overlay(ed, x) {
    if (!shapeDrag) { drawSelectionBoxes(ed, x); return; }
    const g = shapeGeom(ed, shapeDrag);
    const m = ed.viewMatrix().translateSelf(g.r.x + g.r.w / 2, g.r.y + g.r.h / 2).rotateSelf(g.rot);
    x.save();
    x.setTransform(new DOMMatrix().scaleSelf(Math.min(3, window.devicePixelRatio || 1)).multiplySelf(m));
    x.strokeStyle = '#4da3ff';
    x.lineWidth = 1 / ed.st!.zoom;
    x.strokeRect(-g.r.w / 2, -g.r.h / 2, g.r.w, g.r.h);
    x.restore();
  },
};

/* ======================= Hand / Zoom ======================= */

let handDrag: { last: Pt } | null = null;
const HandTool: Tool = {
  id: 'hand',
  cursor: () => (handDrag ? 'grabbing' : 'grab'),
  down(_ed, e) { handDrag = { last: e.screen }; },
  move(ed, e) { if (!handDrag) return; ed.pan(e.screen.x - handDrag.last.x, e.screen.y - handDrag.last.y); handDrag.last = e.screen; },
  up(ed) { handDrag = null; ed.emit(); },
};

let zoomDrag: { start: Pt; z0: number; moved: boolean } | null = null;
const ZoomTool: Tool = {
  id: 'zoom',
  cursor: (_ed, e) => (e?.alt ? 'zoom-out' : 'zoom-in'),
  down(ed, e) { zoomDrag = { start: e.screen, z0: ed.st!.zoom, moved: false }; },
  move(ed, e) {
    if (!zoomDrag) return;
    const dx = e.screen.x - zoomDrag.start.x;
    if (Math.abs(dx) > 3) zoomDrag.moved = true;
    if (zoomDrag.moved) ed.zoomTo(zoomDrag.z0 * Math.exp(dx * 0.01), zoomDrag.start);
  },
  up(ed, e) {
    if (zoomDrag && !zoomDrag.moved) ed.zoomStep(e.alt ? -1 : 1, e.screen);
    zoomDrag = null;
  },
};

export const TOOLS: Record<ToolId, Tool> = {
  move: MoveTool,
  marquee: byMode(MarqueeTool, RowColMarqueeTool, (ed) => ed.opts.marquee.shape === 'row' || ed.opts.marquee.shape === 'col'),
  lasso: byMode(LassoTool, MagneticLassoTool, (ed) => ed.opts.lasso.mode === 'magnetic'),
  wand: byMode(WandTool, QuickSelectTool, (ed) => ed.opts.wand.mode === 'quick'),
  crop: CropTool,
  eyedropper: EyedropperTool,
  brush: paintTool('brush'),
  clone: paintTool('clone'),
  eraser: paintTool('eraser'),
  gradient: GradientTool,
  text: textTool('text', 'h', false),
  shape: ShapeTool,
  hand: HandTool,
  zoom: ZoomTool,
  selxf: SelTransformTool,
  pencil: paintTool('pencil'),
  colorReplace: ColorReplaceTool,
  bgEraser: BgEraserTool,
  magicEraser: MagicEraserTool,
  historyBrush: HistoryBrushTool,
  patternStamp: paintTool('patternStamp'),
  blur: BlurTool,
  sharpen: SharpenTool,
  smudge: SmudgeTool,
  dodge: DodgeTool,
  burn: BurnTool,
  sponge: SpongeTool,
  spotHeal: SpotHealTool,
  heal: HealTool,
  patch: PatchTool,
  redEye: RedEyeTool,
  colorSampler: ColorSamplerTool,
  ruler: RulerTool,
  rotateView: RotateViewTool,
  vtext: textTool('vtext', 'v', false),
  htmask: textTool('htmask', 'h', true),
  vtmask: textTool('vtmask', 'v', true),
  artboard: ArtboardTool,
};

/* ======================= ניתוב אירועי עכבר ======================= */

let dragTool: Tool | null = null;

export function pointerDown(ed: Editor, e: PtrEvt) {
  if (!ed.doc) return;
  // דיאלוג שדוגם מהקנבס (Color Range) תופס את הלחיצה
  if (ed.live.pick) { ed.live.pick(e); return; }
  let t = ed.activeTool();
  // Ctrl מחזיק זמנית את כלי ההזזה (כמו בפוטושופ); Alt במברשת/דלי/מעבר = דוגם צבע
  if (e.ctrl && !['move', 'hand', 'zoom', 'crop', 'text', 'vtext', 'htmask', 'vtmask', 'marquee', 'lasso', 'wand', 'selxf', 'rotateView'].includes(t.id) && !e.alt) t = TOOLS.move;
  if (e.ctrl && ['marquee', 'lasso'].includes(t.id) && !poly && !magneticActive()) t = TOOLS.move;
  if (e.alt && t.id === 'gradient') t = TOOLS.eyedropper;
  if (e.button === 1) t = TOOLS.hand;
  // גרירת תווית של משטח עבודה בכלי Move = הזזת המשטח (כמו בפוטושופ)
  if (t === TOOLS.move && !ed.live.freeTransform && artboardLabelAt(ed, e.screen)) t = TOOLS.artboard;
  const spring = t !== ed.activeTool();
  dragTool = t;
  t.down?.(ed, spring && t === TOOLS.move ? { ...e, ctrl: false } : e);
}

export function pointerMove(ed: Editor, e: PtrEvt, pressed: boolean) {
  if (!ed.doc) return;
  ed.cursorDoc = e.doc;
  if (pressed && dragTool) dragTool.move?.(ed, e);
  else ed.activeTool().hover?.(ed, e);
}

export function pointerUp(ed: Editor, e: PtrEvt) {
  const t = dragTool;
  dragTool = null;
  t?.up?.(ed, e);
}

export function anyPaintActive() { return !!stroke; }
export { xfLeaves };
