/**
 * PHOTOEDIT — ליבת העורך. מחזיק את המסמכים הפתוחים (טאבים), התצוגה, הכלים, הפקודות, ההיסטוריה והשמירה.
 * הממשק (React) רק קורא מצב ומפעיל פקודות; כל הציור על הקנבס נעשה כאן, מחוץ ל-React, כדי שיהיה מהיר.
 */
import { applyAdjust, applyFilter, adjustDef, type FilterDef, FILTERS } from './adjust';
import { History } from './history';
import { cloud, encodeCanvas, fileToCanvas, recovery, registerFont, deserialize, serialize, exportBlob, downloadBlob, safeName, type ExportOpts, urlToCanvas } from './io';
import type { AdjustKind, Doc, Fill, GroupLayer, Layer, Pt, RasterLayer, Rect, ShapeKind, TextLayer, TextStyle, XfLayer } from './model';
import {
  aabb, apply, clamp, cloneLayer, copyCanvas, ctx2d, defaultTextStyle, findLayer, flatForPanel, isXf, makeAdjust, makeGroup,
  makeRaster, makeShape, makeText, newCanvas, touch, uid, walk, xfLeaves, xfMatrix,
} from './model';
import { contentBounds, drawLayerContent, layerBounds, layerMatrix, layerQuad, localBox, localSize, renderDoc, renderSingle } from './render';
import { allSel, combine, featherSel, growSel, invertSel, isEmpty, selBounds, selEdges, type SelMode } from './selection';
import { Shortcuts, comboOf } from './shortcuts';
import { clearTextCache, ensureFont, fontString, layoutText } from './text';
import { TOOLS, type Tool, type ToolId } from './tools';

export interface DocState {
  doc: Doc;
  history: History;
  zoom: number;
  panX: number;
  panY: number;
  selected: string[];
  active: string | null;
  maskEdit: boolean;
  lastSelection: HTMLCanvasElement | null;
  /** מספר הפעולה האחרונה שנשמרה בענן (להשוואה מול ההיסטוריה) */
  savedMark: number;
  opMark: number;
  saving: boolean;
  saveError: string | null;
  fitted: boolean;
}

export interface Dialog { type: string; data?: any }

export interface ToolOpts {
  brush: { size: number; hardness: number; opacity: number; flow: number };
  eraser: { size: number; hardness: number; opacity: number; flow: number };
  clone: { size: number; hardness: number; opacity: number; flow: number; aligned: boolean };
  marquee: { shape: 'rect' | 'ellipse'; feather: number; ratio: string };
  lasso: { mode: 'free' | 'poly'; feather: number };
  wand: { tolerance: number; contiguous: boolean; allLayers: boolean };
  gradient: { mode: 'gradient' | 'bucket'; type: 'linear' | 'radial'; reverse: boolean; opacity: number; tolerance: number; contiguous: boolean };
  shape: { kind: ShapeKind; fill: Fill; strokeOn: boolean; strokeColor: string; strokeWidth: number; radius: number; sides: number };
  text: TextStyle;
  move: { autoSelect: boolean; showTransform: boolean; autoGroup: boolean };
  crop: { ratio: string };
  eyedropper: { sample: number };
}

const DPR = () => Math.min(3, window.devicePixelRatio || 1);
let untitled = 0;

export class Editor {
  docs: DocState[] = [];
  cur = -1;
  tool: ToolId = 'move';
  springTool: ToolId | null = null;
  fg = '#000000';
  bg = '#ffffff';
  swatches = ['#000000', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#a2845e', '#1c1c1e', '#8e8e93', '#f2f2f7', '#0a2540'];
  opts: ToolOpts = {
    brush: { size: 40, hardness: 0.8, opacity: 1, flow: 1 },
    eraser: { size: 60, hardness: 0.8, opacity: 1, flow: 1 },
    clone: { size: 60, hardness: 0.6, opacity: 1, flow: 1, aligned: true },
    marquee: { shape: 'rect', feather: 0, ratio: 'free' },
    lasso: { mode: 'free', feather: 0 },
    wand: { tolerance: 32, contiguous: true, allLayers: true },
    gradient: { mode: 'gradient', type: 'linear', reverse: false, opacity: 1, tolerance: 32, contiguous: true },
    shape: { kind: 'rect', fill: { type: 'solid', color: '#ff3b30', color2: '#ffcc00', angle: 90 }, strokeOn: false, strokeColor: '#000000', strokeWidth: 4, radius: 0, sides: 5 },
    text: defaultTextStyle(),
    move: { autoSelect: true, showTransform: true, autoGroup: false },
    crop: { ratio: 'free' },
    eyedropper: { sample: 1 },
  };
  view = { rulers: true, guides: true, grid: false, snap: true, smartGuides: true, extras: true, panels: true, gridSize: 54 };
  shortcuts = new Shortcuts();
  dialog: Dialog | null = null;
  toastMsg: { text: string; tone: 'info' | 'error' | 'ok'; id: number } | null = null;
  status = '';
  cursorDoc: Pt | null = null;
  cloudOk: boolean | null = null;
  lastFilter: { id: string; p: Record<string, number> } | null = null;
  clipboard: { kind: 'pixels'; canvas: HTMLCanvasElement } | { kind: 'layers'; layers: Layer[] } | null = null;
  clipboardFresh = false;
  /** מצב חי של כלים (טרנספורם, חיתוך, ציור) — מנוהל ע"י הכלים */
  live: {
    paint?: { layerId: string; target: 'pixels' | 'mask'; canvas: HTMLCanvasElement } | null;
    floating?: { layerId: string; canvas: HTMLCanvasElement; dx: number; dy: number } | null;
    freeTransform?: { snapshot: Layer[] } | null;
    crop?: Rect | null;
    smart?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
    marquee?: { pts: Pt[]; closed: boolean } | null;
    rubber?: Rect | null;
    gradientLine?: { a: Pt; b: Pt } | null;
    textEdit?: { layerId: string; isNew: boolean; before: string } | null;
    cloneSrc?: Pt | null;
    cloneCursor?: Pt | null;
  } = {};

  /* ---------- מצב והאזנה לממשק ---------- */
  version = 0;
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private emitQueued = false;
  emit() {
    if (this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => { this.emitQueued = false; this.version++; this.listeners.forEach((f) => f()); });
  }

  get st(): DocState | null { return this.docs[this.cur] ?? null; }
  get doc(): Doc | null { return this.st?.doc ?? null; }

  /* ---------- תצוגה ---------- */
  canvas: HTMLCanvasElement | null = null;
  rulerX: HTMLCanvasElement | null = null;
  rulerY: HTMLCanvasElement | null = null;
  overlayHost: HTMLDivElement | null = null;
  textArea: HTMLTextAreaElement | null = null;
  comp = newCanvas(1, 1);
  compScale = 1;
  compDirty = true;
  interacting = false;
  private raf = 0;
  private antsPhase = 0;
  private antsTimer = 0;
  private hiResTimer = 0;

  attach(canvas: HTMLCanvasElement, rulerX: HTMLCanvasElement, rulerY: HTMLCanvasElement, host: HTMLDivElement) {
    this.canvas = canvas; this.rulerX = rulerX; this.rulerY = rulerY; this.overlayHost = host;
    this.antsTimer = window.setInterval(() => { this.antsPhase = (this.antsPhase + 1) % 8; if (this.doc?.selection || this.live.marquee) this.redraw(false); }, 140);
    this.redraw();
  }
  detach() {
    window.clearInterval(this.antsTimer);
    cancelAnimationFrame(this.raf);
    this.canvas = null;
  }

  /** redraw(true) מרכיב מחדש את המסמך; redraw(false) רק את התצוגה (זום, הזזה, שכבות-על) */
  redraw(composite = true) {
    if (composite) this.compDirty = true;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }

  beginInteract() { this.interacting = true; window.clearTimeout(this.hiResTimer); }
  endInteract() {
    this.interacting = false;
    window.clearTimeout(this.hiResTimer);
    this.hiResTimer = window.setTimeout(() => this.redraw(true), 30);
  }

  hideIds(): Set<string> | undefined {
    const te = this.live.textEdit;
    return te ? new Set([te.layerId]) : undefined;
  }

  private paint() {
    const c = this.canvas, st = this.st;
    if (!c) return;
    const dpr = DPR();
    const cw = c.clientWidth, ch = c.clientHeight;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
    const x = c.getContext('2d')!;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = '#1f1f1f';
    x.fillRect(0, 0, cw, ch);
    if (!st) { this.paintRulers(); return; }
    if (!st.fitted && cw > 50) { this.fit(); st.fitted = true; }
    const doc = st.doc;
    // מרכיב מחדש: בזמן גרירה בסקאלה של המסך (מהיר), אחר כך ברזולוציה מלאה
    if (this.compDirty) {
      const full = Math.min(1, Math.max(0.05, 8000 / Math.max(doc.width, doc.height)));
      const want = this.interacting ? Math.min(full, Math.max(0.05, st.zoom * dpr)) : full;
      this.compScale = want;
      renderDoc(doc, { scale: want, hide: this.hideIds(), live: this.live.paint, floating: this.live.floating }, this.comp);
      this.compDirty = false;
    }
    const z = st.zoom;
    const dx = st.panX, dy = st.panY, W = doc.width * z, H = doc.height * z;
    // צל המסמך ולוח שחמט לשקיפות
    x.fillStyle = 'rgba(0,0,0,.45)';
    x.fillRect(dx + 3, dy + 3, W, H);
    x.save();
    x.beginPath();
    x.rect(dx, dy, W, H);
    x.clip();
    const s = 8;
    x.fillStyle = '#ffffff';
    x.fillRect(dx, dy, W, H);
    x.fillStyle = '#cccccc';
    const x0 = Math.max(0, Math.floor(-dx / s)), y0 = Math.max(0, Math.floor(-dy / s));
    const x1 = Math.min(Math.ceil(W / s), Math.ceil((cw - dx) / s)), y1 = Math.min(Math.ceil(H / s), Math.ceil((ch - dy) / s));
    for (let j = y0; j < y1; j++) for (let i = x0 + ((x0 + j) % 2); i < x1; i += 2) x.fillRect(dx + i * s, dy + j * s, s, s);
    x.imageSmoothingEnabled = z * dpr < 2;
    x.imageSmoothingQuality = 'high';
    x.drawImage(this.comp, dx, dy, W, H);
    x.restore();
    x.strokeStyle = 'rgba(0,0,0,.6)';
    x.lineWidth = 1;
    x.strokeRect(Math.round(dx) - 0.5, Math.round(dy) - 0.5, Math.round(W) + 1, Math.round(H) + 1);

    if (this.view.extras) {
      if (this.view.grid) this.paintGrid(x, doc, z, dx, dy);
      if (doc.selection) this.paintAnts(x, doc.selection, z, dx, dy);
      if (this.view.guides) {
        x.strokeStyle = 'rgba(0,255,255,.9)';
        x.lineWidth = 1;
        x.beginPath();
        for (const gx of doc.guides.v) { const sx = Math.round(dx + gx * z) + 0.5; x.moveTo(sx, 0); x.lineTo(sx, ch); }
        for (const gy of doc.guides.h) { const sy = Math.round(dy + gy * z) + 0.5; x.moveTo(0, sy); x.lineTo(cw, sy); }
        x.stroke();
      }
      if (this.live.smart?.length) {
        x.strokeStyle = '#ff2fd0';
        x.lineWidth = 1;
        x.beginPath();
        for (const l of this.live.smart) { x.moveTo(dx + l.x1 * z + 0.5, dy + l.y1 * z + 0.5); x.lineTo(dx + l.x2 * z + 0.5, dy + l.y2 * z + 0.5); }
        x.stroke();
      }
    }
    this.activeTool().overlay?.(this, x);
    this.paintRulers();
    this.positionTextArea();
  }

  private paintGrid(x: CanvasRenderingContext2D, doc: Doc, z: number, dx: number, dy: number) {
    const g = this.view.gridSize;
    if (g * z < 4) return;
    x.strokeStyle = 'rgba(120,160,255,.28)';
    x.lineWidth = 1;
    x.beginPath();
    for (let gx = g; gx < doc.width; gx += g) { const sx = Math.round(dx + gx * z) + 0.5; x.moveTo(sx, dy); x.lineTo(sx, dy + doc.height * z); }
    for (let gy = g; gy < doc.height; gy += g) { const sy = Math.round(dy + gy * z) + 0.5; x.moveTo(dx, sy); x.lineTo(dx + doc.width * z, sy); }
    x.stroke();
  }

  private paintAnts(x: CanvasRenderingContext2D, sel: HTMLCanvasElement, z: number, dx: number, dy: number) {
    const e = selEdges(sel);
    x.lineWidth = 1;
    x.strokeStyle = '#fff';
    x.beginPath();
    for (let i = 0; i < e.length; i += 4) { x.moveTo(Math.round(dx + e[i] * z) + 0.5, Math.round(dy + e[i + 1] * z) + 0.5); x.lineTo(Math.round(dx + e[i + 2] * z) + 0.5, Math.round(dy + e[i + 3] * z) + 0.5); }
    x.stroke();
    x.strokeStyle = '#000';
    x.setLineDash([4, 4]);
    x.lineDashOffset = -this.antsPhase;
    x.stroke();
    x.setLineDash([]);
  }

  private paintRulers() {
    const st = this.st;
    for (const [rc, horiz] of [[this.rulerX, true], [this.rulerY, false]] as const) {
      if (!rc) continue;
      const dpr = DPR(), cw = rc.clientWidth, ch = rc.clientHeight;
      if (!cw || !ch) continue;
      if (rc.width !== Math.round(cw * dpr) || rc.height !== Math.round(ch * dpr)) { rc.width = Math.round(cw * dpr); rc.height = Math.round(ch * dpr); }
      const x = rc.getContext('2d')!;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.fillStyle = '#2b2b2b';
      x.fillRect(0, 0, cw, ch);
      if (!st) continue;
      const z = st.zoom, off = horiz ? st.panX - 18 : st.panY;
      const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
      const step = steps.find((s) => s * z >= 60) ?? 5000;
      x.strokeStyle = '#777';
      x.fillStyle = '#aaa';
      x.font = '9px Assistant, sans-serif';
      x.beginPath();
      const len = horiz ? cw : ch;
      const startDoc = Math.floor(-off / z / step) * step;
      for (let v = startDoc; v * z + off < len; v += step / 10) {
        const p = Math.round(v * z + off) + 0.5;
        const major = Math.abs(v % step) < 1e-6;
        const tick = major ? 18 : Math.abs(v % (step / 2)) < 1e-6 ? 8 : 4;
        if (horiz) { x.moveTo(p, 18); x.lineTo(p, 18 - tick); } else { x.moveTo(18, p); x.lineTo(18 - tick, p); }
        if (major) {
          if (horiz) x.fillText(String(Math.round(v)), p + 2, 9);
          else { x.save(); x.translate(9, p + 2); x.rotate(-Math.PI / 2); x.textAlign = 'right'; x.fillText(String(Math.round(v)), 0, 0); x.restore(); }
        }
      }
      x.stroke();
      if (this.cursorDoc) {
        const p = (horiz ? this.cursorDoc.x : this.cursorDoc.y) * z + off;
        x.strokeStyle = '#4da3ff';
        x.beginPath();
        if (horiz) { x.moveTo(p, 0); x.lineTo(p, 18); } else { x.moveTo(0, p); x.lineTo(18, p); }
        x.stroke();
      }
    }
  }

  toDoc(sx: number, sy: number): Pt {
    const st = this.st!;
    return { x: (sx - st.panX) / st.zoom, y: (sy - st.panY) / st.zoom };
  }
  toScreen(p: Pt): Pt {
    const st = this.st!;
    return { x: p.x * st.zoom + st.panX, y: p.y * st.zoom + st.panY };
  }

  fit() {
    const st = this.st, c = this.canvas;
    if (!st || !c) return;
    const cw = c.clientWidth, ch = c.clientHeight;
    st.zoom = Math.min((cw - 60) / st.doc.width, (ch - 60) / st.doc.height, 8);
    st.panX = (cw - st.doc.width * st.zoom) / 2;
    st.panY = (ch - st.doc.height * st.zoom) / 2;
    this.redraw(true);
    this.emit();
  }

  zoomTo(z: number, at?: Pt) {
    const st = this.st, c = this.canvas;
    if (!st || !c) return;
    const nz = clamp(z, 0.02, 64);
    const p = at ?? { x: c.clientWidth / 2, y: c.clientHeight / 2 };
    const d = this.toDoc(p.x, p.y);
    st.zoom = nz;
    st.panX = p.x - d.x * nz;
    st.panY = p.y - d.y * nz;
    this.redraw(this.compScale < Math.min(1, nz * DPR()));
    this.emit();
  }

  zoomStep(dir: 1 | -1, at?: Pt) {
    const st = this.st;
    if (!st) return;
    const levels = [0.02, 0.03, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 32, 64];
    const z = st.zoom;
    const nz = dir > 0 ? levels.find((l) => l > z * 1.01) ?? 64 : [...levels].reverse().find((l) => l < z * 0.99) ?? 0.02;
    this.zoomTo(nz, at);
  }

  pan(dx: number, dy: number) {
    const st = this.st;
    if (!st) return;
    st.panX += dx;
    st.panY += dy;
    this.redraw(false);
  }

  /* ---------- טקסט על הקנבס ---------- */

  private positionTextArea() {
    const ta = this.textArea, te = this.live.textEdit, st = this.st;
    if (!ta || !te || !st) return;
    const f = findLayer(st.doc.layers, te.layerId);
    if (!f || f.layer.type !== 'text') return;
    const l = f.layer;
    const L = layoutText(l);
    const view = new DOMMatrix().translateSelf(st.panX, st.panY).scaleSelf(st.zoom, st.zoom).multiplySelf(layerMatrix(l));
    const s = l.style;
    ta.style.transform = `matrix(${view.a},${view.b},${view.c},${view.d},${view.e},${view.f})`;
    ta.style.font = fontString(s);
    ta.style.letterSpacing = `${L.spacing}px`;
    ta.style.lineHeight = `${L.lineH}px`;
    ta.style.direction = s.dir;
    ta.style.textAlign = s.align === 'justify' ? (s.dir === 'rtl' ? 'right' : 'left') : s.align;
    ta.style.textTransform = s.caps ? 'uppercase' : 'none';
    ta.style.color = s.color;
    ta.style.caretColor = s.color;
    ta.style.width = `${(l.boxW ?? L.w) + s.size * 0.6}px`;
    ta.style.marginLeft = l.boxW == null && ta.style.textAlign !== 'left' ? `${-(s.size * (ta.style.textAlign === 'center' ? 0.3 : 0.6))}px` : '0';
    ta.style.height = `${L.h + L.lineH}px`;
    ta.style.whiteSpace = l.boxW == null ? 'pre' : 'pre-wrap';
  }

  beginTextEdit(l: TextLayer, isNew: boolean) {
    this.commitTextEdit();
    const host = this.overlayHost;
    if (!host) return;
    this.live.textEdit = { layerId: l.id, isNew, before: l.text };
    this.selectLayer(l.id);
    const ta = document.createElement('textarea');
    ta.className = 'pe-textedit';
    ta.spellcheck = false;
    ta.value = l.text;
    ta.setAttribute('dir', l.style.dir);
    host.appendChild(ta);
    this.textArea = ta;
    ta.addEventListener('input', () => this.onTextInput(ta.value));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); e.stopPropagation(); this.commitTextEdit(); }
      else if (e.key === 'Enter' && e.code === 'NumpadEnter') { e.preventDefault(); this.commitTextEdit(); }
      e.stopPropagation();
    });
    this.positionTextArea();
    requestAnimationFrame(() => { ta.focus(); if (!isNew) ta.select(); });
    this.redraw(true);
    this.emit();
  }

  /** שינוי טקסט שומר את נקודת העיגון (צד ימין ב-RTL, שמאל ב-LTR, מרכז ביישור מרכזי) */
  private onTextInput(v: string) {
    const te = this.live.textEdit, d = this.doc;
    if (!te || !d) return;
    const f = findLayer(d.layers, te.layerId);
    if (!f || f.layer.type !== 'text') return;
    const l = f.layer;
    const before = layoutText(l);
    l.text = v;
    if (!l.name || l.name === 'טקסט' || l.name === before.lines[0]?.slice(0, 40) || te.isNew) l.name = v.split('\n')[0].slice(0, 40) || 'טקסט';
    this.reanchorText(l, before.w, before.h);
    touch(l);
    this.redraw(true);
    this.positionTextArea();
  }

  reanchorText(l: TextLayer, oldW: number, oldH: number) {
    const now = layoutText(l);
    const align = l.style.align === 'justify' ? (l.style.dir === 'rtl' ? 'right' : 'left') : l.style.align;
    const ax = l.boxW != null ? 0 : align === 'right' ? -(now.w - oldW) / 2 : align === 'left' ? (now.w - oldW) / 2 : 0;
    const ay = (now.h - oldH) / 2;
    const m = new DOMMatrix().rotateSelf(l.t.rot).scaleSelf(l.t.sx, l.t.sy);
    l.t.x += m.a * ax + m.c * ay;
    l.t.y += m.b * ax + m.d * ay;
  }

  commitTextEdit() {
    const te = this.live.textEdit, d = this.doc;
    if (!te) return;
    this.live.textEdit = null;
    this.textArea?.remove();
    this.textArea = null;
    if (d) {
      const f = findLayer(d.layers, te.layerId);
      if (f && f.layer.type === 'text') {
        if (!f.layer.text.trim()) {
          f.parent.splice(f.index, 1);
          if (!te.isNew) this.commit('מחיקת טקסט');
          else this.st!.selected = this.st!.selected.filter((x) => x !== te.layerId);
        } else if (te.isNew || f.layer.text !== te.before) this.commit(te.isNew ? 'שכבת טקסט' : 'עריכת טקסט');
      }
    }
    this.redraw(true);
    this.emit();
  }

  /* ---------- מסמכים וטאבים ---------- */

  addDoc(doc: Doc, label = 'פתיחה'): DocState {
    this.commitTextEdit();
    const st: DocState = {
      doc, history: new History(), zoom: 1, panX: 0, panY: 0, selected: [], active: null, maskEdit: false,
      lastSelection: null, savedMark: doc.serverId ? 0 : -1, opMark: 0, saving: false, saveError: null, fitted: false,
    };
    const top = doc.layers[doc.layers.length - 1];
    if (top) { st.selected = [top.id]; st.active = top.id; }
    st.history.push(History.take(doc, label, st.selected));
    this.docs.push(st);
    this.cur = this.docs.length - 1;
    this.redraw(true);
    this.emit();
    return st;
  }

  newDoc(o: { name?: string; width: number; height: number; dpi?: number; background: 'white' | 'black' | 'transparent' | string; projectId?: string | null }) {
    const doc: Doc = {
      id: uid(), name: o.name?.trim() || `ללא שם-${++untitled}`, width: Math.round(o.width), height: Math.round(o.height), dpi: o.dpi ?? 72,
      layers: [], guides: { v: [], h: [] }, selection: null, fonts: [], projectId: o.projectId ?? null, serverId: null,
    };
    if (o.background !== 'transparent') {
      const c = newCanvas(doc.width, doc.height), x = c.getContext('2d')!;
      x.fillStyle = o.background === 'white' ? '#ffffff' : o.background === 'black' ? '#000000' : o.background;
      x.fillRect(0, 0, c.width, c.height);
      doc.layers.push(makeRaster('רקע', c, doc.width / 2, doc.height / 2));
    } else {
      doc.layers.push(makeRaster('שכבה 1', newCanvas(doc.width, doc.height), doc.width / 2, doc.height / 2));
    }
    return this.addDoc(doc, 'מסמך חדש');
  }

  async openImageAsDoc(canvas: HTMLCanvasElement, name: string, projectId: string | null = null) {
    const doc: Doc = {
      id: uid(), name: name.replace(/\.[a-z0-9]+$/i, ''), width: canvas.width, height: canvas.height, dpi: 72,
      layers: [makeRaster('רקע', canvas, canvas.width / 2, canvas.height / 2)], guides: { v: [], h: [] }, selection: null, fonts: [], projectId, serverId: null,
    };
    return this.addDoc(doc);
  }

  switchTo(i: number) {
    if (i === this.cur || !this.docs[i]) return;
    this.commitTextEdit();
    this.cancelTransient();
    this.cur = i;
    this.redraw(true);
    this.emit();
  }

  close(i = this.cur, force = false) {
    const st = this.docs[i];
    if (!st) return;
    if (!force && this.isDirty(st)) { this.dialog = { type: 'confirmClose', data: { index: i } }; this.emit(); return; }
    this.commitTextEdit();
    this.cancelTransient();
    void recovery.remove(st.doc.id);
    this.docs.splice(i, 1);
    this.cur = Math.min(this.cur, this.docs.length - 1);
    if (i < this.cur) this.cur--;
    this.redraw(true);
    this.emit();
  }

  isDirty(st: DocState) { return st.opMark !== st.savedMark; }

  /* ---------- היסטוריה ---------- */

  commit(label: string) {
    const st = this.st;
    if (!st) return;
    st.history.push(History.take(st.doc, label, st.selected));
    st.opMark++;
    this.redraw(true);
    this.emit();
    this.scheduleSave();
  }

  /** שינויים רצופים מפאנל (גרירת סליידר, הקלדה) נאספים לפעולה אחת בהיסטוריה */
  private softTimer = 0;
  private softLabel = '';
  softCommit(label: string) {
    this.redraw(true);
    this.emit();
    if (this.softLabel && this.softLabel !== label) this.flushSoft();
    this.softLabel = label;
    window.clearTimeout(this.softTimer);
    this.softTimer = window.setTimeout(() => this.flushSoft(), 500);
  }
  flushSoft() {
    window.clearTimeout(this.softTimer);
    if (!this.softLabel) return;
    const l = this.softLabel;
    this.softLabel = '';
    this.commit(l);
  }

  undo() { this.flushSoft(); const st = this.st; if (st?.history.canUndo) this.jump(st.history.index - 1); }
  redo() { const st = this.st; if (st?.history.canRedo) this.jump(st.history.index + 1); }
  jump(i: number) {
    const st = this.st;
    if (!st) return;
    this.commitTextEdit();
    this.cancelTransient();
    st.selected = st.history.restore(st.doc, i).filter((id) => findLayer(st.doc.layers, id));
    st.active = st.selected[st.selected.length - 1] ?? null;
    st.opMark++;
    clearTextCache();
    this.redraw(true);
    this.emit();
    this.scheduleSave();
  }

  cancelTransient() {
    const ft = this.live.freeTransform;
    if (ft && this.doc) { this.doc.layers = ft.snapshot; }
    this.live.freeTransform = null;
    this.live.crop = null;
    this.live.marquee = null;
    this.live.smart = [];
    this.live.gradientLine = null;
    this.live.paint = null;
    if (this.live.floating) this.activeTool().cancel?.(this);
    this.live.floating = null;
  }

  /* ---------- שכבות: בחירה וגישה ---------- */

  layer(id: string | null): Layer | null { return id && this.doc ? findLayer(this.doc.layers, id)?.layer ?? null : null; }
  get active(): Layer | null { return this.layer(this.st?.active ?? null); }
  selectedLayers(): Layer[] { const d = this.doc; return d ? (this.st!.selected.map((id) => findLayer(d.layers, id)?.layer).filter(Boolean) as Layer[]) : []; }

  /** השכבות הנבחרות בלי צאצאים של קבוצה נבחרת */
  topSelected(): Layer[] {
    const sel = new Set(this.st?.selected ?? []);
    const out: Layer[] = [];
    const rec = (ls: Layer[]) => { for (const l of ls) { if (sel.has(l.id)) out.push(l); else if (l.type === 'group') rec(l.children); } };
    if (this.doc) rec(this.doc.layers);
    return out;
  }

  selectLayer(id: string | null, mode: 'set' | 'toggle' | 'range' = 'set') {
    const st = this.st;
    if (!st) return;
    st.maskEdit = false;
    if (!id) { st.selected = []; st.active = null; }
    else if (mode === 'toggle') {
      st.selected = st.selected.includes(id) ? st.selected.filter((x) => x !== id) : [...st.selected, id];
      st.active = st.selected.includes(id) ? id : st.selected[st.selected.length - 1] ?? null;
    } else if (mode === 'range' && st.active) {
      const flat = flatForPanel(st.doc.layers).map((r) => r.layer.id);
      const a = flat.indexOf(st.active), b = flat.indexOf(id);
      if (a >= 0 && b >= 0) st.selected = flat.slice(Math.min(a, b), Math.max(a, b) + 1);
      st.active = id;
    } else { st.selected = [id]; st.active = id; }
    this.redraw(false);
    this.emit();
  }

  /** מוסיף שכבה מעל השכבה הפעילה (באותה קבוצה) */
  insert(l: Layer, ref: string | null = this.st?.active ?? null) {
    const d = this.doc!;
    const f = ref ? findLayer(d.layers, ref) : null;
    if (f) f.parent.splice(f.index + 1, 0, l);
    else d.layers.push(l);
    this.st!.selected = [l.id];
    this.st!.active = l.id;
  }

  /* ---------- כלים ---------- */

  activeTool(): Tool { return TOOLS[this.springTool ?? this.tool]; }

  setTool(id: ToolId) {
    if (this.tool === id && !this.springTool) return;
    if (this.live.textEdit && id !== 'text') this.commitTextEdit();
    this.activeTool().deactivate?.(this);
    this.tool = id;
    this.springTool = null;
    this.activeTool().activate?.(this);
    this.redraw(false);
    this.emit();
  }

  /** לחיצה חוזרת על קיצור (Shift+M וכו') מחליפה בין כלים באותה קבוצה */
  cycleTool(id: ToolId) {
    if (id === 'marquee') this.opts.marquee.shape = this.opts.marquee.shape === 'rect' ? 'ellipse' : 'rect';
    if (id === 'lasso') this.opts.lasso.mode = this.opts.lasso.mode === 'free' ? 'poly' : 'free';
    if (id === 'gradient') this.opts.gradient.mode = this.opts.gradient.mode === 'gradient' ? 'bucket' : 'gradient';
    if (id === 'shape') { const k: ShapeKind[] = ['rect', 'ellipse', 'triangle', 'polygon', 'star', 'line']; this.opts.shape.kind = k[(k.indexOf(this.opts.shape.kind) + 1) % k.length]; }
    this.setTool(id);
    this.emit();
  }

  /* ---------- הודעות ---------- */

  toast(text: string, tone: 'info' | 'error' | 'ok' = 'info') {
    this.toastMsg = { text, tone, id: Date.now() };
    this.emit();
    const id = this.toastMsg.id;
    window.setTimeout(() => { if (this.toastMsg?.id === id) { this.toastMsg = null; this.emit(); } }, tone === 'error' ? 6000 : 3200);
  }

  /** הפאנל הפתוח בכל קבוצת פאנלים (Window) */
  panelTabs: Record<string, string> = { top: 'Color', mid: 'Properties', bottom: 'Layers' };
  openPanel(name: string) {
    const groups: Record<string, string[]> = { top: ['Color', 'Swatches'], mid: ['Properties', 'Adjustments', 'Character', 'Paragraph', 'Align', 'Transform'], bottom: ['Layers', 'History'] };
    for (const [g, names] of Object.entries(groups)) if (names.includes(name)) this.panelTabs[g] = name;
    this.view.panels = true;
    this.emit();
  }

  openDialog(type: string, data?: any) { this.commitTextEdit(); this.dialog = { type, data }; this.emit(); }
  closeDialog() { this.dialog = null; this.live.paint = null; this.redraw(true); this.emit(); }

  /* ---------- מקלדת ---------- */

  private spaceDown = false;
  onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (typing) {
      if (t!.tagName === 'INPUT' && e.key === 'Enter') (t as HTMLInputElement).blur();
      return;
    }
    if (this.dialog) {
      if (e.key === 'Escape') { e.preventDefault(); this.closeDialog(); }
      return;
    }
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      if (!this.spaceDown) { this.spaceDown = true; if (this.tool !== 'hand') { this.springTool = 'hand'; this.emit(); this.redraw(false); } }
      return;
    }
    if (e.code === 'Space') { e.preventDefault(); return; }
    const combo = comboOf(e);
    if (!combo) return;
    // מקשי חיצים, Enter ו-Escape מגיעים לכלי הפעיל לפני הקיצורים הכלליים
    if (this.activeTool().key?.(this, combo, e)) { e.preventDefault(); return; }
    const id = this.shortcuts.lookup(combo);
    if (id) {
      e.preventDefault();
      e.stopPropagation();
      this.run(id);
      return;
    }
    const nudge: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const k = combo.replace('Shift+', '');
    if (nudge[k] && this.st) {
      e.preventDefault();
      const m = e.shiftKey ? 10 : 1;
      this.nudge(nudge[k][0] * m, nudge[k][1] * m);
      return;
    }
    // Shift + מקש כלי = מעבר בין כלים באותה קבוצה
    if (combo.startsWith('Shift+')) {
      const tid = this.shortcuts.lookup(combo.slice(6));
      if (tid?.startsWith('tool.')) { e.preventDefault(); this.cycleTool(tid.slice(5) as ToolId); return; }
    }
    // Opacity בספרות, כמו בפוטושופ: 1=10% ... 0=100%
    if (/^\d$/.test(combo) && this.st) {
      const v = combo === '0' ? 1 : Number(combo) / 10;
      if (['brush', 'eraser', 'clone'].includes(this.tool)) { (this.opts[this.tool as 'brush'] as { opacity: number }).opacity = v; this.emit(); }
      else if (this.topSelected().length) { for (const l of this.topSelected()) { l.opacity = v; touch(l); } this.commit(`אטימות ${Math.round(v * 100)}%`); }
    }
  };

  onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') {
      this.spaceDown = false;
      if (this.springTool === 'hand') { this.springTool = null; this.emit(); this.redraw(false); }
    }
  };

  /** פקודות — כל תפריט, כפתור וקיצור עובר דרך כאן */
  run(id: string) {
    const d = this.doc;
    if (id.startsWith('tool.')) {
      const tid = id.slice(5) as ToolId;
      if (this.tool === tid && ['marquee', 'lasso', 'gradient', 'shape'].includes(tid)) return;
      this.setTool(tid);
      return;
    }
    switch (id) {
      case 'colors.default': this.fg = '#000000'; this.bg = '#ffffff'; this.emit(); return;
      case 'colors.swap': [this.fg, this.bg] = [this.bg, this.fg]; this.emit(); return;
      case 'brush.smaller': case 'brush.bigger': case 'brush.softer': case 'brush.harder': {
        const key = (['brush', 'eraser', 'clone'].includes(this.tool) ? this.tool : 'brush') as 'brush';
        const o = this.opts[key];
        if (id === 'brush.smaller') o.size = Math.max(1, Math.round(o.size - (o.size > 100 ? 25 : o.size > 10 ? 5 : 1)));
        if (id === 'brush.bigger') o.size = Math.min(2500, Math.round(o.size + (o.size >= 100 ? 25 : o.size >= 10 ? 5 : 1)));
        if (id === 'brush.softer') o.hardness = Math.max(0, +(o.hardness - 0.25).toFixed(2));
        if (id === 'brush.harder') o.hardness = Math.min(1, +(o.hardness + 0.25).toFixed(2));
        this.redraw(false);
        this.emit();
        return;
      }
      case 'view.screenMode': this.toggleFullscreen(); return;
      case 'view.togglePanels': this.view.panels = !this.view.panels; this.emit(); setTimeout(() => this.redraw(false)); return;
      case 'file.new': this.openDialog('new'); return;
      case 'file.open': this.openDialog('open'); return;
      case 'file.place': this.pickFiles(false); return;
      case 'edit.shortcuts': this.openDialog('shortcuts'); return;
    }
    if (!d) {
      if (id === 'view.rulers') { this.view.rulers = !this.view.rulers; this.emit(); }
      return;
    }
    switch (id) {
      case 'file.save': void this.save(); return;
      case 'file.saveAs': this.openDialog('saveAs'); return;
      case 'file.export': this.openDialog('export'); return;
      case 'file.quickPng': void this.quickExport(); return;
      case 'file.close': this.close(); return;
      case 'edit.undo': this.undo(); return;
      case 'edit.redo': this.redo(); return;
      case 'edit.stepBack': this.undo(); return;
      case 'edit.copy': this.copy(false); return;
      case 'edit.copyMerged': this.copy(true); return;
      case 'edit.cut': this.cut(); return;
      case 'edit.fill': this.openDialog('fill'); return;
      case 'edit.fillFg': this.fill(this.fg); return;
      case 'edit.fillBg': this.fill(this.bg); return;
      case 'edit.clear': this.clear(); return;
      case 'edit.freeTransform': this.startFreeTransform(); return;
      case 'edit.flipH': this.flip(true); return;
      case 'edit.flipV': this.flip(false); return;
      case 'image.levels': this.openDialog('adjust', { kind: 'levels' }); return;
      case 'image.curves': this.openDialog('adjust', { kind: 'curves' }); return;
      case 'image.hueSat': this.openDialog('adjust', { kind: 'hueSat' }); return;
      case 'image.colorBalance': this.openDialog('adjust', { kind: 'colorBalance' }); return;
      case 'image.bw': this.openDialog('adjust', { kind: 'bw' }); return;
      case 'image.invert': this.applyAdjustDestructive('invert', {}); return;
      case 'image.desaturate': this.applyAdjustDestructive('hueSat', { hue: 0, saturation: -100, lightness: 0, colorize: false }); return;
      case 'image.size': this.openDialog('imageSize'); return;
      case 'image.canvasSize': this.openDialog('canvasSize'); return;
      case 'layer.new': this.newLayer(); return;
      case 'layer.duplicate': this.duplicate(false); return;
      case 'layer.viaCut': this.duplicate(true); return;
      case 'layer.group': this.group(); return;
      case 'layer.ungroup': this.ungroup(); return;
      case 'layer.clip': this.toggleClip(); return;
      case 'layer.mergeDown': this.mergeDown(); return;
      case 'layer.mergeVisible': this.mergeVisible(); return;
      case 'layer.stamp': this.stampVisible(); return;
      case 'layer.forward': this.arrange(1); return;
      case 'layer.backward': this.arrange(-1); return;
      case 'layer.front': this.arrange(99); return;
      case 'layer.back': this.arrange(-99); return;
      case 'layer.selectUp': this.selectNeighbor(1); return;
      case 'layer.selectDown': this.selectNeighbor(-1); return;
      case 'layer.rasterize': this.rasterize(); return;
      case 'layer.addMask': this.addMask(); return;
      case 'layer.lock': for (const l of this.topSelected()) l.locked = !l.locked; this.commit('נעילה'); return;
      case 'layer.hideOthers': for (const l of this.topSelected()) l.visible = !l.visible; this.commit('הסתרה/הצגה'); return;
      case 'select.all': this.setSelection(allSel(d), 'בחירת הכול'); return;
      case 'select.deselect': if (d.selection) { this.st!.lastSelection = d.selection; this.setSelection(null, 'ביטול בחירה'); } return;
      case 'select.reselect': if (this.st!.lastSelection) this.setSelection(this.st!.lastSelection, 'בחירה חוזרת'); return;
      case 'select.inverse': if (d.selection) this.setSelection(invertSel(d), 'היפוך בחירה'); return;
      case 'select.feather': if (d.selection) this.openDialog('selModify', { op: 'feather' }); return;
      case 'select.allLayers': this.st!.selected = flatForPanel(d.layers).map((r) => r.layer.id); this.emit(); this.redraw(false); return;
      case 'filter.last': if (this.lastFilter) this.applyFilterDestructive(this.lastFilter.id, this.lastFilter.p); return;
      case 'view.zoomIn': this.zoomStep(1); return;
      case 'view.zoomOut': this.zoomStep(-1); return;
      case 'view.fit': this.fit(); return;
      case 'view.actual': this.zoomTo(1); return;
      case 'view.rulers': this.view.rulers = !this.view.rulers; this.emit(); setTimeout(() => this.redraw(false)); return;
      case 'view.guides': this.view.guides = !this.view.guides; this.emit(); this.redraw(false); return;
      case 'view.grid': this.view.grid = !this.view.grid; this.emit(); this.redraw(false); return;
      case 'view.snap': this.view.snap = !this.view.snap; this.emit(); return;
      case 'view.extras': this.view.extras = !this.view.extras; this.emit(); this.redraw(false); return;
    }
  }

  toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => {
        // במסך מלא הדפדפן מאפשר לתפוס גם Ctrl+N / Ctrl+T / Ctrl+W
        (navigator as Navigator & { keyboard?: { lock?: (k?: string[]) => Promise<void> } }).keyboard?.lock?.().catch(() => undefined);
      }, () => this.toast('הדפדפן לא אישר מסך מלא', 'error'));
    } else void document.exitFullscreen?.();
  }

  /* ---------- פעולות שכבה ---------- */

  newLayer(name?: string) {
    const d = this.doc!;
    let n = 1;
    walk(d.layers, (l) => { const m = /^שכבה (\d+)$/.exec(l.name); if (m) n = Math.max(n, Number(m[1]) + 1); });
    const l = makeRaster(name ?? `שכבה ${n}`, newCanvas(d.width, d.height), d.width / 2, d.height / 2);
    this.insert(l);
    this.commit('שכבה חדשה');
    return l;
  }

  addImageLayer(c: HTMLCanvasElement, name: string, at?: Pt) {
    const d = this.doc!;
    const l = makeRaster(name.replace(/\.[a-z0-9]+$/i, ''), c, at?.x ?? d.width / 2, at?.y ?? d.height / 2);
    // תמונה גדולה מהמסמך מוקטנת להתאמה (לא הרסני — הפיקסלים המקוריים נשמרים)
    const k = Math.min(1, d.width / c.width, d.height / c.height);
    l.t.sx = l.t.sy = k;
    this.insert(l);
    this.commit('הוספת תמונה');
    return l;
  }

  addTextLayer(text: string, at: Pt, boxW: number | null, style = this.opts.text) {
    const l = makeText(text, { ...style }, at.x, at.y, boxW);
    this.insert(l);
    return l;
  }

  addShapeLayer(kind: ShapeKind, r: Rect, rot = 0) {
    const o = this.opts.shape;
    const l = makeShape(kind, r.x + r.w / 2, r.y + r.h / 2, Math.max(1, r.w), Math.max(1, r.h), { ...o.fill }, { on: o.strokeOn, color: o.strokeColor, width: o.strokeWidth }, o.radius, o.sides);
    l.t.rot = rot;
    this.insert(l);
    return l;
  }

  addAdjustLayer(kind: AdjustKind) {
    const d = this.doc!;
    const def = adjustDef(kind);
    const l = makeAdjust(kind, def.defaults(), def.name);
    if (d.selection) l.mask = { canvas: copyCanvas(d.selection), enabled: true };
    this.insert(l);
    this.commit(`שכבת התאמה: ${def.name}`);
  }

  removeLayers(ids: string[]) {
    const d = this.doc!;
    for (const id of ids) { const f = findLayer(d.layers, id); if (f) f.parent.splice(f.index, 1); }
    const flat = flatForPanel(d.layers);
    const next = flat[0]?.layer.id ?? null;
    this.st!.selected = next ? [next] : [];
    this.st!.active = next;
  }

  deleteSelected() {
    const ids = this.topSelected().map((l) => l.id);
    if (!ids.length) return;
    this.removeLayers(ids);
    this.commit(ids.length > 1 ? 'מחיקת שכבות' : 'מחיקת שכבה');
  }

  duplicate(cut: boolean) {
    const d = this.doc!, a = this.active;
    if (d.selection && a && a.type === 'raster') {
      const px = this.selectedPixels(a, d.selection);
      if (!px) return;
      if (cut) this.clearPixels(a, d.selection);
      const nl = makeRaster(cut ? 'שכבה בגזירה' : 'שכבה בהעתקה', px, d.width / 2, d.height / 2);
      this.insert(nl, a.id);
      this.commit(cut ? 'Layer via Cut' : 'Layer via Copy');
      return;
    }
    const sel = this.topSelected();
    if (!sel.length) return;
    const ids: string[] = [];
    for (const l of sel) {
      const f = findLayer(d.layers, l.id)!;
      const c = cloneLayer(l, true);
      c.name = `${l.name} עותק`;
      f.parent.splice(f.index + 1, 0, c);
      ids.push(c.id);
    }
    this.st!.selected = ids;
    this.st!.active = ids[ids.length - 1];
    this.commit('שכפול שכבה');
  }

  group() {
    const d = this.doc!;
    const sel = this.topSelected();
    if (!sel.length) return;
    const flat = flatForPanel(d.layers).map((r) => r.layer.id);
    const topMost = sel.reduce((a, b) => (flat.indexOf(a.id) < flat.indexOf(b.id) ? a : b));
    const f = findLayer(d.layers, topMost.id)!;
    const anchorParent = f.parent;
    // סדר מלמטה למעלה כמו בעץ
    const ordered = [...sel].sort((a, b) => flat.indexOf(b.id) - flat.indexOf(a.id));
    const g = makeGroup([]);
    let n = 1;
    walk(d.layers, (l) => { const m = /^קבוצה (\d+)$/.exec(l.name); if (m) n = Math.max(n, Number(m[1]) + 1); });
    g.name = `קבוצה ${n}`;
    const idx = f.index;
    anchorParent.splice(idx + 1, 0, g);
    for (const l of ordered) {
      const ff = findLayer(d.layers, l.id)!;
      ff.parent.splice(ff.index, 1);
      g.children.push(l);
    }
    this.st!.selected = [g.id];
    this.st!.active = g.id;
    this.commit('קיבוץ שכבות');
  }

  ungroup() {
    const d = this.doc!;
    const groups = this.topSelected().filter((l): l is GroupLayer => l.type === 'group');
    if (!groups.length) return;
    const ids: string[] = [];
    for (const g of groups) {
      const f = findLayer(d.layers, g.id)!;
      f.parent.splice(f.index, 1, ...g.children);
      ids.push(...g.children.map((c) => c.id));
    }
    this.st!.selected = ids;
    this.st!.active = ids[ids.length - 1] ?? null;
    this.commit('פירוק קבוצה');
  }

  toggleClip() {
    const sel = this.topSelected();
    if (!sel.length) return;
    const on = !sel.every((l) => l.clip);
    for (const l of sel) { l.clip = on; touch(l); }
    this.commit(on ? 'Clipping Mask' : 'שחרור Clipping Mask');
  }

  arrange(dir: number) {
    const d = this.doc!;
    const sel = this.topSelected();
    if (!sel.length) return;
    const order = dir > 0 ? [...sel].reverse() : sel;
    for (const l of order) {
      const f = findLayer(d.layers, l.id)!;
      const arr = f.parent;
      const to = clamp(Math.abs(dir) > 1 ? (dir > 0 ? arr.length - 1 : 0) : f.index + dir, 0, arr.length - 1);
      arr.splice(f.index, 1);
      arr.splice(to, 0, l);
    }
    this.commit('סידור שכבות');
  }

  /** גרירה בפאנל השכבות: מעל/מתחת/לתוך קבוצה */
  moveLayers(ids: string[], targetId: string, where: 'above' | 'below' | 'into') {
    const d = this.doc!;
    if (ids.includes(targetId)) return;
    const moving = ids.map((id) => findLayer(d.layers, id)?.layer).filter(Boolean) as Layer[];
    // לא מכניסים קבוצה לתוך עצמה
    for (const m of moving) if (m.type === 'group' && findLayer(m.children, targetId)) return;
    for (const m of moving) { const f = findLayer(d.layers, m.id)!; f.parent.splice(f.index, 1); }
    const t = findLayer(d.layers, targetId);
    if (!t) { d.layers.push(...moving); }
    else if (where === 'into' && t.layer.type === 'group') { t.layer.children.push(...moving); t.layer.open = true; }
    else t.parent.splice(where === 'above' ? t.index + 1 : t.index, 0, ...moving);
    this.commit('הזזת שכבה');
  }

  selectNeighbor(dir: 1 | -1) {
    const d = this.doc!;
    const flat = flatForPanel(d.layers).map((r) => r.layer.id);
    const i = flat.indexOf(this.st!.active ?? '');
    const j = clamp(i - dir, 0, flat.length - 1);
    if (flat[j]) this.selectLayer(flat[j]);
  }

  setProp<K extends keyof Layer>(l: Layer, key: K, value: Layer[K], label?: string) {
    (l as any)[key] = value;
    touch(l);
    if (label) this.commit(label); else this.redraw(true);
  }

  /** קנבס פיקסלים במרחב המסמך מתוך שכבה (לפי בחירה) */
  selectedPixels(l: XfLayer, sel: HTMLCanvasElement | null): HTMLCanvasElement | null {
    const d = this.doc!;
    const c = newCanvas(d.width, d.height), x = c.getContext('2d')!;
    x.setTransform(layerMatrix(l));
    if (l.type === 'raster') x.drawImage(l.canvas, 0, 0);
    else { const r = renderSingle({ ...l, fx: { ...l.fx, shadow: { ...l.fx.shadow, on: false } } } as Layer, d); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(r, 0, 0); }
    x.setTransform(1, 0, 0, 1, 0, 0);
    if (l.mask?.enabled) { x.globalCompositeOperation = 'destination-in'; x.drawImage(l.mask.canvas, 0, 0); }
    if (sel) { x.globalCompositeOperation = 'destination-in'; x.drawImage(sel, 0, 0); }
    return c;
  }

  /** מחיקת פיקסלים לפי בחירה (copy-on-write) */
  clearPixels(l: RasterLayer, sel: HTMLCanvasElement) {
    const c = copyCanvas(l.canvas), x = c.getContext('2d')!;
    x.setTransform(layerMatrix(l).inverse());
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(sel, 0, 0);
    l.canvas = c;
    touch(l);
  }

  /** מבטיח שבשכבת פיקסלים בלי טרנספורם יש כיסוי לכל המסמך (כדי שאפשר לצייר בכל מקום) */
  ensureCoverage(l: RasterLayer) {
    const d = this.doc!;
    const t = l.t;
    if (Math.abs(t.sx) !== 1 || Math.abs(t.sy) !== 1 || t.rot % 360 !== 0 || t.sx < 0 || t.sy < 0) return;
    const left = t.x - l.canvas.width / 2, top = t.y - l.canvas.height / 2;
    const x0 = Math.min(0, Math.floor(left)), y0 = Math.min(0, Math.floor(top));
    const x1 = Math.max(d.width, Math.ceil(left + l.canvas.width)), y1 = Math.max(d.height, Math.ceil(top + l.canvas.height));
    if (x0 === Math.floor(left) && y0 === Math.floor(top) && x1 - x0 === l.canvas.width && y1 - y0 === l.canvas.height) return;
    if ((x1 - x0) * (y1 - y0) > 64e6) return;
    const c = newCanvas(x1 - x0, y1 - y0);
    c.getContext('2d')!.drawImage(l.canvas, left - x0, top - y0);
    l.canvas = c;
    l.t.x = x0 + c.width / 2;
    l.t.y = y0 + c.height / 2;
    touch(l);
  }

  rasterize(target?: Layer) {
    const d = this.doc!;
    const list = target ? [target] : this.topSelected();
    let did = false;
    for (const l of list) {
      if (l.type !== 'text' && l.type !== 'shape' && l.type !== 'group') continue;
      const nl = this.rasterOf(l);
      const f = findLayer(d.layers, l.id)!;
      f.parent.splice(f.index, 1, nl);
      if (this.st!.active === l.id) this.st!.active = nl.id;
      this.st!.selected = this.st!.selected.map((x) => (x === l.id ? nl.id : x));
      did = true;
    }
    if (did && !target) this.commit('המרה לפיקסלים');
    return did;
  }

  /** שכבה → שכבת פיקסלים בגבולות התוכן (גם מחוץ למסמך), שומרת שם, אטימות, מיזוג, מסכה ואפקטים */
  rasterOf(l: Layer): RasterLayer {
    const d = this.doc!;
    const b = layerBounds(l) ?? { x: 0, y: 0, w: d.width, h: d.height };
    const pad = 2;
    const r = { x: Math.floor(b.x) - pad, y: Math.floor(b.y) - pad, w: Math.ceil(b.w) + pad * 2, h: Math.ceil(b.h) + pad * 2 };
    const k = Math.min(1, Math.sqrt(64e6 / Math.max(1, r.w * r.h)));
    const c = newCanvas(r.w * k, r.h * k), x = c.getContext('2d')!;
    x.scale(k, k);
    x.translate(-r.x, -r.y);
    const tmp: Layer = { ...cloneLayer(l), mask: null, fx: { ...l.fx, shadow: { ...l.fx.shadow, on: false }, glow: { ...l.fx.glow, on: false }, stroke: { ...l.fx.stroke, on: false }, overlay: { ...l.fx.overlay, on: false } }, opacity: 1, blend: 'normal' } as Layer;
    if (isXf(tmp)) {
      const m = layerMatrix(tmp);
      x.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      drawLayerContent(x, tmp, { scale: 1 });
    } else {
      // קבוצה: מרנדרים במרחב המסמך ומעתיקים
      x.drawImage(renderDoc({ ...d, layers: [tmp] }, { scale: 1 }), 0, 0);
    }
    const nl = makeRaster(l.name, c, r.x + r.w / 2, r.y + r.h / 2);
    nl.t.sx = nl.t.sy = 1 / k;
    Object.assign(nl, { id: l.id, opacity: l.opacity, blend: l.blend, mask: l.mask, fx: l.fx, clip: l.clip, visible: l.visible });
    return nl;
  }

  mergeDown() {
    const d = this.doc!;
    let list = this.topSelected();
    if (list.length === 1) {
      const f = findLayer(d.layers, list[0].id)!;
      if (f.index === 0) return this.toast('אין שכבה מתחת למיזוג', 'error');
      list = [f.parent[f.index - 1], list[0]];
    }
    this.mergeInto(list, list.length === 2 ? 'מיזוג למטה' : 'מיזוג שכבות');
  }

  private mergeInto(list: Layer[], label: string) {
    const d = this.doc!;
    if (list.length < 2) return;
    const flat = flatForPanel(d.layers).map((r) => r.layer.id);
    const ordered = [...list].sort((a, b) => flat.indexOf(b.id) - flat.indexOf(a.id));
    const c = renderDoc({ ...d, layers: ordered.map((l) => ({ ...cloneLayer(l), clip: false })) as Layer[] }, { scale: 1 });
    const bottom = ordered[0];
    const nl = makeRaster(bottom.name, c, d.width / 2, d.height / 2);
    const f = findLayer(d.layers, bottom.id)!;
    f.parent.splice(f.index, 1, nl);
    for (const l of ordered.slice(1)) { const ff = findLayer(d.layers, l.id); if (ff) ff.parent.splice(ff.index, 1); }
    this.st!.selected = [nl.id];
    this.st!.active = nl.id;
    this.commit(label);
  }

  mergeVisible() {
    const d = this.doc!;
    const c = renderDoc(d, { scale: 1 });
    const hidden = d.layers.filter((l) => !l.visible);
    const nl = makeRaster('ממוזג', c, d.width / 2, d.height / 2);
    d.layers = [...hidden, nl];
    this.st!.selected = [nl.id];
    this.st!.active = nl.id;
    this.commit('מיזוג הגלויות');
  }

  stampVisible() {
    const d = this.doc!;
    const nl = makeRaster('חותמת ממוזגת', renderDoc(d, { scale: 1 }), d.width / 2, d.height / 2);
    d.layers.push(nl);
    this.st!.selected = [nl.id];
    this.st!.active = nl.id;
    this.commit('Stamp Visible');
  }

  flatten() {
    const d = this.doc!;
    const c = renderDoc(d, { scale: 1 });
    const out = newCanvas(d.width, d.height), x = out.getContext('2d')!;
    x.fillStyle = '#fff';
    x.fillRect(0, 0, d.width, d.height);
    x.drawImage(c, 0, 0);
    const nl = makeRaster('רקע', out, d.width / 2, d.height / 2);
    d.layers = [nl];
    this.st!.selected = [nl.id];
    this.st!.active = nl.id;
    this.commit('שיטוח תמונה');
  }

  /* ---------- מסכות ---------- */

  addMask(hideAll = false) {
    const d = this.doc!;
    const l = this.active;
    if (!l) return;
    if (l.mask) return this.toast('לשכבה כבר יש מסכה');
    const c = newCanvas(d.width, d.height), x = c.getContext('2d')!;
    if (d.selection && !hideAll) x.drawImage(d.selection, 0, 0);
    else if (!hideAll) { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
    l.mask = { canvas: c, enabled: true };
    touch(l);
    this.st!.maskEdit = true;
    this.commit('הוספת מסכה');
  }

  deleteMask(applyIt = false) {
    const l = this.active;
    if (!l?.mask) return;
    if (applyIt && l.type === 'raster') {
      const c = copyCanvas(l.canvas), x = c.getContext('2d')!;
      x.setTransform(layerMatrix(l).inverse());
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(l.mask.canvas, 0, 0);
      l.canvas = c;
    }
    l.mask = null;
    this.st!.maskEdit = false;
    touch(l);
    this.commit(applyIt ? 'החלת מסכה' : 'מחיקת מסכה');
  }

  invertMask() {
    const d = this.doc!, l = this.active;
    if (!l?.mask) return;
    const c = newCanvas(d.width, d.height), x = c.getContext('2d')!;
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(l.mask.canvas, 0, 0);
    l.mask = { ...l.mask, canvas: c };
    touch(l);
    this.commit('היפוך מסכה');
  }

  toggleMaskEnabled(l: Layer) {
    if (!l.mask) return;
    l.mask = { ...l.mask, enabled: !l.mask.enabled };
    touch(l);
    this.commit(l.mask.enabled ? 'הפעלת מסכה' : 'כיבוי מסכה');
  }

  /** Ctrl+לחיצה על תמונה ממוזערת: בחירה מתוך האלפא של השכבה */
  selectionFromLayer(l: Layer, mode: SelMode = 'new') {
    const d = this.doc!;
    const c = renderSingle({ ...cloneLayer(l), fx: { ...l.fx, shadow: { ...l.fx.shadow, on: false }, glow: { ...l.fx.glow, on: false } } } as Layer, d);
    this.setSelection(combine(d, c, mode), 'טעינת בחירה');
  }

  /* ---------- בחירות ---------- */

  setSelection(c: HTMLCanvasElement | null, label: string) {
    const d = this.doc!;
    if (d.selection && !c) this.st!.lastSelection = d.selection;
    d.selection = c && !isEmpty(c) ? c : null;
    this.commit(label);
  }

  modifySelection(op: 'feather' | 'expand' | 'contract', v: number) {
    const d = this.doc!;
    if (!d.selection) return;
    const next = op === 'feather' ? featherSel(d.selection, v) : growSel(d, d.selection, op === 'expand' ? v : -v);
    this.setSelection(next, op === 'feather' ? 'ריכוך בחירה' : op === 'expand' ? 'הרחבת בחירה' : 'כיווץ בחירה');
  }

  /* ---------- מילוי ומחיקה ---------- */

  fill(color: string, opacity = 1) {
    const d = this.doc!;
    let l = this.active;
    if (!l || l.type !== 'raster') {
      if (l && isXf(l) && !d.selection) {
        if (l.type === 'shape') { l.fill = { ...l.fill, type: 'solid', color }; touch(l); this.commit('מילוי צורה'); return; }
        if (l.type === 'text') { l.style = { ...l.style, color }; touch(l); this.commit('צבע טקסט'); return; }
      }
      l = this.newLayer();
    }
    const r = l as RasterLayer;
    this.ensureCoverage(r);
    const c = copyCanvas(r.canvas), x = c.getContext('2d')!;
    const tmp = newCanvas(d.width, d.height), tx = tmp.getContext('2d')!;
    tx.fillStyle = color;
    tx.globalAlpha = opacity;
    tx.fillRect(0, 0, d.width, d.height);
    if (d.selection) { tx.globalAlpha = 1; tx.globalCompositeOperation = 'destination-in'; tx.drawImage(d.selection, 0, 0); }
    x.setTransform(layerMatrix(r).inverse());
    x.drawImage(tmp, 0, 0);
    r.canvas = c;
    touch(r);
    this.commit('מילוי');
  }

  clear() {
    const d = this.doc!, a = this.active;
    if (this.live.freeTransform) return;
    if (d.selection && a && a.type === 'raster') { this.clearPixels(a, d.selection); this.commit('מחיקת פיקסלים'); return; }
    if (d.selection && a && this.st!.maskEdit && a.mask) {
      const c = copyCanvas(a.mask.canvas), x = c.getContext('2d')!;
      x.globalCompositeOperation = 'destination-out';
      x.drawImage(d.selection, 0, 0);
      a.mask = { ...a.mask, canvas: c };
      touch(a);
      this.commit('מחיקה במסכה');
      return;
    }
    this.deleteSelected();
  }

  /* ---------- לוח העתקה ---------- */

  copy(merged: boolean) {
    const d = this.doc!, a = this.active;
    if (merged || d.selection) {
      let c: HTMLCanvasElement | null;
      if (merged || !a || !isXf(a)) {
        c = renderDoc(d, { scale: 1 });
        if (d.selection) { const x = c.getContext('2d')!; x.globalCompositeOperation = 'destination-in'; x.drawImage(d.selection, 0, 0); }
      } else c = this.selectedPixels(a, d.selection);
      if (!c) return;
      this.clipboard = { kind: 'pixels', canvas: c };
      this.clipboardFresh = true;
      void this.writeSystemClipboard(c, d.selection ? selBounds(d.selection) : null);
      this.toast('הועתק');
      return;
    }
    const sel = this.topSelected();
    if (!sel.length) return;
    this.clipboard = { kind: 'layers', layers: sel.map((l) => cloneLayer(l, true)) };
    this.clipboardFresh = true;
    this.toast(sel.length > 1 ? `הועתקו ${sel.length} שכבות` : 'השכבה הועתקה');
  }

  cut() {
    this.copy(false);
    const d = this.doc!, a = this.active;
    if (d.selection && a?.type === 'raster') { this.clearPixels(a, d.selection); this.commit('גזירה'); }
    else this.deleteSelected();
  }

  private async writeSystemClipboard(c: HTMLCanvasElement, r: Rect | null) {
    try {
      let src = c;
      if (r) { src = newCanvas(r.w, r.h); src.getContext('2d')!.drawImage(c, -r.x, -r.y); }
      const blob = await new Promise<Blob | null>((res) => src.toBlob(res, 'image/png'));
      if (blob && 'ClipboardItem' in window) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch { /* לוח המערכת לא זמין — הלוח הפנימי עדיין עובד */ }
  }

  async paste(e: ClipboardEvent) {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (this.clipboardFresh && this.clipboard && this.doc) { this.pasteInternal(); return; }
    if (files.length) {
      for (const f of files) {
        const c = await fileToCanvas(f, 1200);
        if (!this.doc) await this.openImageAsDoc(c, 'הדבקה');
        else this.addImageLayer(c, 'הדבקה');
      }
      return;
    }
    if (this.clipboard && this.doc) this.pasteInternal();
  }

  private pasteInternal() {
    const d = this.doc!, cb = this.clipboard!;
    if (cb.kind === 'pixels') {
      const nl = makeRaster('הדבקה', copyCanvas(cb.canvas), d.width / 2, d.height / 2);
      this.insert(nl);
      this.commit('הדבקה');
    } else {
      const ids: string[] = [];
      for (const l of cb.layers) { const c = cloneLayer(l, true); this.insert(c); ids.push(c.id); }
      this.st!.selected = ids;
      this.st!.active = ids[ids.length - 1];
      this.commit('הדבקת שכבות');
    }
  }

  /* ---------- טרנספורם ---------- */

  startFreeTransform() {
    const d = this.doc!;
    if (!this.topSelected().some((l) => xfLeaves(l).length)) return this.toast('בחר שכבה לטרנספורם', 'error');
    if (d.selection && this.active?.type === 'raster') {
      // כמו בפוטושופ: עם בחירה פעילה, Ctrl+T מעביר את הפיקסלים הנבחרים לשכבה משלהם
      this.duplicate(true);
      d.selection = null;
    }
    this.live.freeTransform = { snapshot: d.layers.map((l) => cloneLayer(l)) };
    this.setTool('move');
    this.emit();
    this.redraw(false);
  }

  commitFreeTransform() {
    if (!this.live.freeTransform) return;
    this.live.freeTransform = null;
    this.commit('Free Transform');
  }

  cancelFreeTransform() {
    const ft = this.live.freeTransform, d = this.doc;
    if (!ft || !d) return;
    d.layers = ft.snapshot;
    this.live.freeTransform = null;
    this.redraw(true);
    this.emit();
  }

  nudge(dx: number, dy: number) {
    const d = this.doc!;
    if (this.tool === 'move' || this.springTool === 'move' || this.live.freeTransform) {
      const leaves = this.topSelected().filter((l) => !l.locked).flatMap(xfLeaves);
      if (!leaves.length) return;
      for (const l of leaves) { l.t.x += dx; l.t.y += dy; touch(l); }
      if (this.live.freeTransform) { this.redraw(true); return; }
      this.commit('הזזה');
    } else if (d.selection && ['marquee', 'lasso', 'wand'].includes(this.tool)) {
      const c = newCanvas(d.width, d.height);
      c.getContext('2d')!.drawImage(d.selection, dx, dy);
      this.setSelection(c, 'הזזת בחירה');
    }
  }

  /** אופק אחרי טרנספורם: טקסט וצורות מקבלים את הסקאלה לתוך הגודל (כמו בפוטושופ), כך שגודל הפונט נשאר אמיתי */
  bakeScale(l: XfLayer) {
    const ax = Math.abs(l.t.sx), ay = Math.abs(l.t.sy);
    if (l.type === 'text' && Math.abs(ax - ay) < 0.002 && Math.abs(ax - 1) > 0.0005) {
      l.style = { ...l.style, size: +(l.style.size * ax).toFixed(2), leading: l.style.leading ? +(l.style.leading * ax).toFixed(2) : 0 };
      if (l.boxW != null) l.boxW = l.boxW * ax;
      l.t.sx = Math.sign(l.t.sx);
      l.t.sy = Math.sign(l.t.sy);
      touch(l);
    } else if (l.type === 'shape' && (Math.abs(ax - 1) > 0.0005 || Math.abs(ay - 1) > 0.0005)) {
      l.w *= ax;
      if (l.shape !== 'line') l.h *= ay;
      l.t.sx = Math.sign(l.t.sx);
      if (l.shape !== 'line') l.t.sy = Math.sign(l.t.sy);
      touch(l);
    }
  }

  flip(horizontal: boolean) {
    const sel = this.topSelected().filter((l) => !l.locked);
    const leaves = sel.flatMap(xfLeaves);
    if (!leaves.length) return;
    let box: Rect | null = null;
    for (const l of sel) { const b = layerBounds(l); if (b) box = box ? aabbUnion(box, b) : b; }
    const cx = box!.x + box!.w / 2, cy = box!.y + box!.h / 2;
    for (const l of leaves) {
      if (horizontal) { l.t.sx *= -1; l.t.x = 2 * cx - l.t.x; l.t.rot = -l.t.rot; }
      else { l.t.sy *= -1; l.t.y = 2 * cy - l.t.y; l.t.rot = -l.t.rot; }
      touch(l);
    }
    if (this.live.freeTransform) { this.redraw(true); return; }
    this.commit(horizontal ? 'היפוך אופקי' : 'היפוך אנכי');
  }

  rotateLayers(deg: number) {
    const sel = this.topSelected().filter((l) => !l.locked);
    const leaves = sel.flatMap(xfLeaves);
    if (!leaves.length) return;
    let box: Rect | null = null;
    for (const l of sel) { const b = layerBounds(l); if (b) box = box ? aabbUnion(box, b) : b; }
    const c = { x: box!.x + box!.w / 2, y: box!.y + box!.h / 2 };
    const a = (deg * Math.PI) / 180;
    for (const l of leaves) {
      const dx = l.t.x - c.x, dy = l.t.y - c.y;
      l.t.x = c.x + dx * Math.cos(a) - dy * Math.sin(a);
      l.t.y = c.y + dx * Math.sin(a) + dy * Math.cos(a);
      l.t.rot = (l.t.rot + deg) % 360;
      touch(l);
    }
    if (this.live.freeTransform) { this.redraw(true); return; }
    this.commit(`סיבוב ${deg}°`);
  }

  /** Align / Distribute — לפי גבולות הבחירה, או לקנבס כששכבה אחת (או כשביקשו) */
  align(how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom', toCanvas = false) {
    const d = this.doc!;
    const sel = this.topSelected().filter((l) => !l.locked && layerBounds(l));
    if (!sel.length) return;
    const boxes = sel.map((l) => layerBounds(l)!);
    let ref: Rect;
    if (d.selection && selBounds(d.selection)) ref = selBounds(d.selection)!;
    else if (toCanvas || sel.length === 1) ref = { x: 0, y: 0, w: d.width, h: d.height };
    else ref = boxes.reduce((a, b) => aabbUnion(a, b));
    sel.forEach((l, i) => {
      const b = boxes[i];
      let dx = 0, dy = 0;
      if (how === 'left') dx = ref.x - b.x;
      if (how === 'hcenter') dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
      if (how === 'right') dx = ref.x + ref.w - (b.x + b.w);
      if (how === 'top') dy = ref.y - b.y;
      if (how === 'vcenter') dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
      if (how === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
      for (const x of xfLeaves(l)) { x.t.x += dx; x.t.y += dy; touch(x); }
    });
    this.commit('יישור');
  }

  distribute(axis: 'h' | 'v') {
    const sel = this.topSelected().filter((l) => !l.locked && layerBounds(l));
    if (sel.length < 3) return this.toast('לפיזור צריך לפחות 3 שכבות', 'error');
    const items = sel.map((l) => ({ l, b: layerBounds(l)! })).sort((a, b) => (axis === 'h' ? a.b.x + a.b.w / 2 - (b.b.x + b.b.w / 2) : a.b.y + a.b.h / 2 - (b.b.y + b.b.h / 2)));
    const c = (b: Rect) => (axis === 'h' ? b.x + b.w / 2 : b.y + b.h / 2);
    const first = c(items[0].b), last = c(items[items.length - 1].b);
    items.forEach((it, i) => {
      const want = first + ((last - first) * i) / (items.length - 1);
      const delta = want - c(it.b);
      for (const x of xfLeaves(it.l)) { if (axis === 'h') x.t.x += delta; else x.t.y += delta; touch(x); }
    });
    this.commit('פיזור');
  }

  /* ---------- Image: גודל, קנבס, חיתוך, סיבוב ---------- */

  resizeImage(w: number, h: number) {
    const d = this.doc!;
    const kx = w / d.width, ky = h / d.height;
    const scaleMask = (c: HTMLCanvasElement) => { const n = newCanvas(w, h), x = n.getContext('2d')!; x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, w, h); return n; };
    walk(d.layers, (l) => {
      if (isXf(l)) { l.t.x *= kx; l.t.y *= ky; l.t.sx *= kx; l.t.sy *= ky; this.bakeScale(l); }
      if (l.mask) l.mask = { ...l.mask, canvas: scaleMask(l.mask.canvas) };
      touch(l);
    });
    d.selection = d.selection ? scaleMask(d.selection) : null;
    d.guides = { v: d.guides.v.map((g) => g * kx), h: d.guides.h.map((g) => g * ky) };
    d.width = Math.round(w);
    d.height = Math.round(h);
    clearTextCache();
    this.commit('גודל תמונה');
    this.fit();
  }

  /** שינוי גודל הקנבס עם היסט (גם לחיתוך). השכבות לא נחתכות — הפיקסלים מחוץ למסמך נשמרים */
  resizeCanvas(w: number, h: number, ox: number, oy: number, label = 'גודל קנבס', fill?: string) {
    const d = this.doc!;
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const shiftMask = (c: HTMLCanvasElement, white: boolean) => {
      const n = newCanvas(w, h), x = n.getContext('2d')!;
      if (white) { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.clearRect(ox, oy, c.width, c.height); }
      x.drawImage(c, ox, oy);
      return n;
    };
    walk(d.layers, (l) => {
      if (isXf(l)) { l.t.x += ox; l.t.y += oy; }
      if (l.mask) l.mask = { ...l.mask, canvas: shiftMask(l.mask.canvas, true) };
      touch(l);
    });
    d.selection = d.selection ? shiftMask(d.selection, false) : null;
    d.guides = { v: d.guides.v.map((g) => g + ox).filter((g) => g >= 0 && g <= w), h: d.guides.h.map((g) => g + oy).filter((g) => g >= 0 && g <= h) };
    d.width = w;
    d.height = h;
    if (fill) {
      const bg = newCanvas(w, h), x = bg.getContext('2d')!;
      x.fillStyle = fill;
      x.fillRect(0, 0, w, h);
      d.layers.unshift(makeRaster('רקע הרחבה', bg, w / 2, h / 2));
    }
    this.commit(label);
    this.fit();
  }

  crop(r: Rect) {
    if (r.w < 1 || r.h < 1) return;
    this.doc!.selection = null;
    this.resizeCanvas(r.w, r.h, -r.x, -r.y, 'חיתוך');
  }

  cropToSelection() {
    const d = this.doc!;
    const b = d.selection && selBounds(d.selection);
    if (b) this.crop(b);
  }

  trim() {
    const d = this.doc!;
    const b = contentBounds(renderDoc(d, { scale: 1 }));
    if (b) this.crop(b);
  }

  rotateCanvas(deg: 90 | -90 | 180) {
    const d = this.doc!;
    const W = d.width, H = d.height;
    const nw = deg === 180 ? W : H, nh = deg === 180 ? H : W;
    const map = (p: Pt): Pt => (deg === 90 ? { x: H - p.y, y: p.x } : deg === -90 ? { x: p.y, y: W - p.x } : { x: W - p.x, y: H - p.y });
    const rotC = (c: HTMLCanvasElement) => {
      const n = newCanvas(nw, nh), x = n.getContext('2d')!;
      x.translate(nw / 2, nh / 2);
      x.rotate((deg * Math.PI) / 180);
      x.drawImage(c, -W / 2, -H / 2);
      return n;
    };
    walk(d.layers, (l) => {
      if (isXf(l)) { const p = map({ x: l.t.x, y: l.t.y }); l.t.x = p.x; l.t.y = p.y; l.t.rot = (l.t.rot + deg) % 360; }
      if (l.mask) l.mask = { ...l.mask, canvas: rotC(l.mask.canvas) };
      touch(l);
    });
    d.selection = d.selection ? rotC(d.selection) : null;
    d.guides = { v: [], h: [] };
    d.width = nw;
    d.height = nh;
    this.commit(`סיבוב קנבס ${deg}°`);
    this.fit();
  }

  flipCanvas(horizontal: boolean) {
    const d = this.doc!;
    const fl = (c: HTMLCanvasElement) => { const n = newCanvas(c.width, c.height), x = n.getContext('2d')!; if (horizontal) { x.translate(c.width, 0); x.scale(-1, 1); } else { x.translate(0, c.height); x.scale(1, -1); } x.drawImage(c, 0, 0); return n; };
    walk(d.layers, (l) => {
      if (isXf(l)) {
        if (horizontal) { l.t.x = d.width - l.t.x; l.t.sx *= -1; } else { l.t.y = d.height - l.t.y; l.t.sy *= -1; }
        l.t.rot = -l.t.rot;
      }
      if (l.mask) l.mask = { ...l.mask, canvas: fl(l.mask.canvas) };
      touch(l);
    });
    d.selection = d.selection ? fl(d.selection) : null;
    this.commit(horizontal ? 'היפוך קנבס אופקי' : 'היפוך קנבס אנכי');
  }

  /* ---------- התאמות ופילטרים הרסניים (עם תצוגה מקדימה חיה) ---------- */

  /** מחזיר את שכבת הפיקסלים שעליה אפשר להפעיל פילטר, או מסביר למה לא */
  pixelTarget(): RasterLayer | null {
    const a = this.active;
    if (!a) { this.toast('בחר שכבה', 'error'); return null; }
    if (a.type !== 'raster') { this.toast('פילטר עובד על שכבת פיקסלים — Layer > Rasterize, או השתמש בשכבת התאמה', 'error'); return null; }
    return a;
  }

  private processed(l: RasterLayer, fn: (c: HTMLCanvasElement) => HTMLCanvasElement): HTMLCanvasElement {
    const d = this.doc!;
    const out = fn(l.canvas);
    if (!d.selection) return out;
    // רק בתוך הבחירה: מערבבים לפי מסכת הבחירה במרחב השכבה
    const m = newCanvas(l.canvas.width, l.canvas.height), mx = m.getContext('2d')!;
    mx.setTransform(layerMatrix(l).inverse());
    mx.drawImage(d.selection, 0, 0);
    mx.setTransform(1, 0, 0, 1, 0, 0);
    mx.globalCompositeOperation = 'source-in';
    mx.drawImage(out, 0, 0);
    const res = copyCanvas(l.canvas), rx = res.getContext('2d')!;
    rx.setTransform(layerMatrix(l).inverse());
    rx.globalCompositeOperation = 'destination-out';
    rx.drawImage(d.selection, 0, 0);
    rx.setTransform(1, 0, 0, 1, 0, 0);
    rx.globalCompositeOperation = 'source-over';
    rx.drawImage(m, 0, 0);
    return res;
  }

  adjustedCanvas(l: RasterLayer, kind: AdjustKind, p: Record<string, any>) {
    return this.processed(l, (src) => {
      const c = copyCanvas(src), x = ctx2d(c, true);
      const img = x.getImageData(0, 0, c.width, c.height);
      applyAdjust(img, kind, p);
      x.putImageData(img, 0, 0);
      return c;
    });
  }

  previewAdjust(kind: AdjustKind, p: Record<string, any>) {
    const l = this.active;
    if (!l || l.type !== 'raster') return;
    this.live.paint = { layerId: l.id, target: 'pixels', canvas: this.adjustedCanvas(l, kind, p) };
    this.redraw(true);
  }

  applyAdjustDestructive(kind: AdjustKind, p: Record<string, any>) {
    const l = this.pixelTarget();
    if (!l) return;
    l.canvas = this.adjustedCanvas(l, kind, p);
    this.live.paint = null;
    touch(l);
    this.commit(adjustDef(kind).en);
  }

  previewFilter(id: string, p: Record<string, number>) {
    const l = this.active;
    if (!l || l.type !== 'raster') return;
    this.live.paint = { layerId: l.id, target: 'pixels', canvas: this.processed(l, (c) => applyFilter(c, id, p)) };
    this.redraw(true);
  }

  applyFilterDestructive(id: string, p: Record<string, number>) {
    const l = this.pixelTarget();
    if (!l) return;
    l.canvas = this.processed(l, (c) => applyFilter(c, id, p));
    this.live.paint = null;
    this.lastFilter = { id, p };
    touch(l);
    this.commit((FILTERS.find((f) => f.id === id) as FilterDef).en);
  }

  /* ---------- פתיחה, ייבוא, שמירה, ייצוא ---------- */

  pickFiles(asDoc: boolean) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = asDoc ? 'image/png,image/jpeg,image/webp,image/svg+xml,.photoedit,.json' : 'image/png,image/jpeg,image/webp,image/svg+xml';
    input.onchange = () => { void this.importFiles([...(input.files ?? [])], asDoc); };
    input.click();
  }

  async importFiles(files: File[], asDoc: boolean, at?: Pt) {
    for (const f of files) {
      try {
        if (/\.(photoedit|json)$/i.test(f.name)) {
          const doc = await deserialize(JSON.parse(await f.text()));
          doc.id = uid();
          doc.serverId = null;
          this.addDoc(doc);
          continue;
        }
        if (/\.(ttf|otf|woff2?)$/i.test(f.name)) { await this.uploadFont(f); continue; }
        if (!f.type.startsWith('image/')) { this.toast(`הקובץ ${f.name} לא נתמך`, 'error'); continue; }
        const c = await fileToCanvas(f, 1200);
        if (asDoc || !this.doc) await this.openImageAsDoc(c, f.name, null);
        else this.addImageLayer(c, f.name, at);
      } catch (e) {
        this.toast(e instanceof Error ? e.message : String(e), 'error');
      }
    }
  }

  async uploadFont(f: File) {
    const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
    const family = f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
    await registerFont(family, data);
    customFonts.add(family);
    if (this.doc && !this.doc.fonts.some((x) => x.family === family)) this.doc.fonts.push({ family, data });
    clearTextCache();
    this.redraw(true);
    this.toast(`הפונט ${family} נוסף`, 'ok');
    this.emit();
    return family;
  }

  async openCloud(id: string) {
    const existing = this.docs.findIndex((s) => s.doc.serverId === id);
    if (existing >= 0) { this.switchTo(existing); return; }
    try {
      const doc = await cloud.load(id);
      for (const f of doc.fonts) customFonts.add(f.family);
      const st = this.addDoc(doc);
      st.savedMark = st.opMark;
      this.emit();
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  async openUrl(url: string, name: string, projectId: string | null, asLayer = false) {
    try {
      const c = await urlToCanvas(url);
      if (asLayer && this.doc) this.addImageLayer(c, name);
      else await this.openImageAsDoc(c, name, projectId);
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  private saveTimer = 0;
  private recTimer = 0;
  scheduleSave() {
    window.clearTimeout(this.recTimer);
    this.recTimer = window.setTimeout(() => { const st = this.st; if (st) void recovery.put(st.doc); }, 1500);
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      // שמירה אוטומטית בענן לכל מסמך שכבר נשמר פעם אחת
      for (const st of this.docs) if (st.doc.serverId && this.isDirty(st) && !st.saving && this.cloudOk !== false) void this.saveState(st, true);
    }, 6000);
  }

  async save(asNew = false, name?: string, projectId?: string | null) {
    const st = this.st;
    if (!st) return;
    this.commitTextEdit();
    if (name) st.doc.name = name;
    if (projectId !== undefined) st.doc.projectId = projectId;
    if (asNew) st.doc.serverId = null;
    if (!st.doc.serverId && !name) { this.openDialog('saveAs'); return; }
    await this.saveState(st, false);
  }

  async saveState(st: DocState, auto: boolean) {
    if (this.cloudOk === false) {
      await recovery.put(st.doc);
      st.savedMark = st.opMark;
      if (!auto) this.toast('נשמר בדפדפן (אין חיבור לשרת המערכת)', 'info');
      this.emit();
      return;
    }
    const mark = st.opMark;
    st.saving = true;
    st.saveError = null;
    this.emit();
    try {
      const r = await cloud.save(st.doc);
      st.doc.serverId = r.id;
      st.savedMark = mark;
      this.cloudOk = true;
      void recovery.remove(st.doc.id);
      if (!auto) this.toast('נשמר בענן ✓', 'ok');
    } catch (e) {
      st.saveError = e instanceof Error ? e.message : String(e);
      if (!auto) this.toast(`השמירה נכשלה: ${st.saveError}`, 'error');
      void recovery.put(st.doc);
    } finally {
      st.saving = false;
      this.emit();
    }
  }

  async exportAs(o: ExportOpts, filename: string, toProject: string | null) {
    const d = this.doc!;
    this.commitTextEdit();
    const blob = await exportBlob(d, o);
    const ext = o.format === 'jpg' ? 'jpg' : o.format;
    const file = `${safeName(filename)}.${ext}`;
    if (toProject) {
      await cloud.sendToProject(toProject, blob, file);
      this.toast('נשלח לפרויקט ✓ (בקבצים של הפרויקט)', 'ok');
    } else downloadBlob(blob, file);
  }

  async quickExport() {
    const d = this.doc!;
    await this.exportAs({ format: 'png', quality: 1, scale: 1, transparent: true, bg: '#ffffff' }, d.name, null);
  }

  async downloadProject() {
    const d = this.doc!;
    const body = JSON.stringify(await serialize(d));
    downloadBlob(new Blob([body], { type: 'application/json' }), `${safeName(d.name)}.photoedit`);
  }

  /** חיבור ראשוני: בודק אם יש שרת (בגרסת claude.ai אין) */
  async probeCloud() {
    try { await cloud.list(null); this.cloudOk = true; } catch { this.cloudOk = false; }
    this.emit();
  }

  /* ---------- עזרי כלים ---------- */

  /** השכבה העליונה מתחת לנקודה (רק גלויות ולא נעולות; טקסט/צורה לפי התיבה, פיקסלים לפי אלפא) */
  hitTest(p: Pt, deep = true): Layer | null {
    const d = this.doc!;
    const rec = (ls: Layer[]): Layer | null => {
      for (let i = ls.length - 1; i >= 0; i--) {
        const l = ls[i];
        if (!l.visible) continue;
        if (l.type === 'group') {
          const r = rec(l.children);
          if (r) return deep ? r : l;
          continue;
        }
        if (!isXf(l) || l.locked) continue;
        const m = layerMatrix(l).inverse();
        const q = apply(m, p);
        const b = localBox(l);
        if (q.x < b.x || q.y < b.y || q.x > b.x + b.w || q.y > b.y + b.h) continue;
        if (l.mask?.enabled) {
          const a = ctx2d(l.mask.canvas).getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data[3];
          if (a < 20) continue;
        }
        if (l.type === 'raster') {
          const a = ctx2d(l.canvas).getImageData(Math.floor(q.x), Math.floor(q.y), 1, 1).data[3];
          if (a < 20) continue;
        }
        return l;
      }
      return null;
    };
    return rec(d.layers);
  }

  /** נקודות הצמדה: קצוות ומרכז המסמך, קווי עזר, קצוות ומרכזי שכבות אחרות */
  snapTargets(exclude: Set<string>): { xs: number[]; ys: number[] } {
    const d = this.doc!;
    const xs = [0, d.width / 2, d.width, ...(this.view.guides ? d.guides.v : [])];
    const ys = [0, d.height / 2, d.height, ...(this.view.guides ? d.guides.h : [])];
    if (this.view.smartGuides) {
      walk(d.layers, (l) => {
        if (!isXf(l) || !l.visible || exclude.has(l.id)) return;
        const b = layerBounds(l);
        if (!b) return;
        xs.push(b.x, b.x + b.w / 2, b.x + b.w);
        ys.push(b.y, b.y + b.h / 2, b.y + b.h);
      });
    }
    return { xs, ys };
  }

  /** צבע מהקומפוזיציה בנקודה (ממוצע לפי גודל הדגימה) */
  sampleColor(p: Pt): string | null {
    const d = this.doc!;
    const comp = renderDoc(d, { scale: 1 });
    const s = this.opts.eyedropper.sample, h = Math.floor(s / 2);
    const x0 = Math.floor(p.x) - h, y0 = Math.floor(p.y) - h;
    if (p.x < 0 || p.y < 0 || p.x >= d.width || p.y >= d.height) return null;
    const px = ctx2d(comp).getImageData(Math.max(0, x0), Math.max(0, y0), s, s).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
    if (!n) return null;
    return '#' + [r / n, g / n, b / n].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  }

  textAt(p: Pt): TextLayer | null {
    const h = this.hitTest(p);
    return h && h.type === 'text' ? h : null;
  }

  /** קורא לפני ג'נרציה/עריכה: מוודא שפונט נטען */
  fontReady(s: TextStyle) { return ensureFont(s, () => { clearTextCache(); this.redraw(true); }); }

  /* ---------- מידע לממשק ---------- */

  transformable(): XfLayer[] { return this.topSelected().filter((l) => !l.locked).flatMap(xfLeaves).filter((l) => !l.locked); }

  quadOf(): { pts: Pt[]; single: XfLayer | null } | null {
    const items = this.transformable();
    if (!items.length) return null;
    if (items.length === 1 && this.topSelected().length === 1 && isXf(this.topSelected()[0])) return { pts: layerQuad(items[0]), single: items[0] };
    const pts = items.flatMap((l) => layerQuad(l));
    const b = aabb(pts);
    return { pts: [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }], single: null };
  }

  layerMatrix = layerMatrix;
  localBox = localBox;
  localSize = localSize;
  xfMatrix = xfMatrix;
}

export const customFonts = new Set<string>();

function aabbUnion(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export { encodeCanvas };
