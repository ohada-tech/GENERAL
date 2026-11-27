/**
 * Paths במסמך: Work Path ונתיבים שמורים (doc.paths), הנתיב הפעיל (פאנל Paths), "יעדים" שאפשר לערוך בעט
 * ובבחירה הישירה (נתיב, צורה וקטורית, Vector Mask), והפקודות: Load as Selection, Make Work Path, Fill/Stroke Path,
 * Vector Mask, Convert to Shape. כל פעולה נכנסת להיסטוריה עם תווית בעברית.
 */
import type { Editor } from './editor';
import type { Doc, Layer, RasterLayer, ShapeLayer } from './model';
import { copyCanvas, ctx2d, findLayer, makeRaster, makeShape, newCanvas, touch, uid, walk } from './model';
import { layerMatrix, pathViewMat } from './render';
import type { Mat, SavedPath, SubPath } from './paths';
import { boundsOf, cloneSubs, flattenSub, invMat, isIdent, mapSubs, mulMat, pathFromMask, traceSubs, anchor, dist } from './paths';
import { combine, type SelMode } from './selection';
import { ellipseSub } from './custom-shapes';

/* ---------- נתיבי המסמך ---------- */

export const pathsOf = (doc: Doc): SavedPath[] => doc.paths ?? [];
export const workPathOf = (doc: Doc) => pathsOf(doc).find((p) => p.work) ?? null;

/** הנתיב הפעיל בפאנל Paths (מצב תצוגה, לא היסטוריה): מזהה נתיב, shape:<id> או vmask:<id> */
const activeKeys = new WeakMap<Doc, { key: string | null; layer: string | null }>();
function setKey(ed: Editor, key: string | null) {
  if (ed.doc) activeKeys.set(ed.doc, { key, layer: ed.st?.active ?? null });
}
/** מפתח שהמשתמש ביטל במפורש (לחיצה על אזור ריק בפאנל) — לא נבחר אוטומטית שוב עד שמשהו משתנה */
const hiddenKeys = new WeakMap<Doc, string | null>();

export function setActivePath(ed: Editor, key: string | null) {
  const d = ed.doc;
  if (!d) return;
  const implicit = implicitKey(ed);
  setKey(ed, key);
  hiddenKeys.set(d, key === null ? implicit : null);
  ed.redraw(false);
  ed.emit();
}

export type TargetKind = 'path' | 'shape' | 'vmask';
export interface Target {
  key: string;
  kind: TargetKind;
  name: string;
  path?: SavedPath;
  layer?: Layer;
  /** ממרחב הנתיב למרחב המסמך */
  m: Mat;
}

const isPathShape = (l: Layer | null | undefined): l is ShapeLayer => !!l && l.type === 'shape' && l.shape === 'path';

function implicitKey(ed: Editor): string | null {
  const a = ed.active;
  // כמו בפוטושופ: נתיב של שכבת צורה נבחר אוטומטית; Vector Mask רק בלחיצה על התמונה הממוזערת שלה / בפאנל
  if (isPathShape(a)) return `shape:${a.id}`;
  return null;
}

export function shapeMat(l: ShapeLayer): Mat {
  return mulMat(layerMatrix(l), pathViewMat(l));
}

export function resolveTarget(ed: Editor, key: string | null): Target | null {
  const d = ed.doc;
  if (!d || !key) return null;
  if (key.startsWith('shape:') || key.startsWith('vmask:')) {
    const l = findLayer(d.layers, key.slice(6))?.layer;
    if (!l) return null;
    if (key.startsWith('shape:')) return isPathShape(l) ? { key, kind: 'shape', name: `${l.name} · Shape Path`, layer: l, m: shapeMat(l) } : null;
    return l.vmask ? { key, kind: 'vmask', name: `${l.name} · Vector Mask`, layer: l, m: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } } : null;
  }
  const p = pathsOf(d).find((x) => x.id === key);
  return p ? { key, kind: 'path', name: p.name, path: p, m: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } } : null;
}

/** המפתח שנבחר במפורש בפאנל (אם עדיין קיים) */
export function explicitTarget(ed: Editor): Target | null {
  const d = ed.doc;
  if (!d) return null;
  const rec = activeKeys.get(d);
  const t = resolveTarget(ed, rec?.key ?? null);
  if (!t) return null;
  // נתיב של שכבה נשאר פעיל רק כשהשכבה עצמה פעילה (כמו בפוטושופ)
  if (t.layer && t.layer.id !== ed.st!.active) return null;
  // בחירת שכבה אחרת שיש לה נתיב (צורה / Vector Mask) מעבירה אליה את היעד
  if (!t.layer && rec!.layer !== ed.st!.active && implicitKey(ed)) return null;
  return t;
}

/** היעד של כלי העט והבחירה: נבחר בפאנל, או הנתיב של שכבת הצורה הפעילה */
export function currentTarget(ed: Editor): Target | null {
  const d = ed.doc;
  if (!d) return null;
  const ex = explicitTarget(ed);
  if (ex) return ex;
  const ik = implicitKey(ed);
  if (!ik || hiddenKeys.get(d) === ik) return null;
  return resolveTarget(ed, ik);
}

export const rawSubs = (t: Target): SubPath[] => (t.kind === 'path' ? t.path!.subs : t.kind === 'shape' ? (t.layer as ShapeLayer).subs ?? [] : t.layer!.vmask!.subs);

/** תתי-הנתיבים של היעד במרחב המסמך (עותק) */
export const docSubs = (t: Target): SubPath[] => mapSubs(rawSubs(t), t.m);

export const targetLocked = (t: Target | null) => !!t?.layer?.locked;

/** כתיבה חזרה מהמסמך ליעד (בלי commit). צורה: התיבה, המרכז והגודל מתעדכנים כך ששום דבר לא זז */
export function writeDocSubs(ed: Editor, t: Target, subs: SubPath[]) {
  if (t.kind === 'path') { t.path!.subs = cloneSubs(subs); }
  else if (t.kind === 'vmask') { const l = t.layer!; l.vmask = { ...l.vmask!, subs: cloneSubs(subs) }; touch(l); }
  else {
    const l = t.layer as ShapeLayer;
    setShapeFromDoc(l, subs);
    t.m = shapeMat(l);
  }
  ed.redraw(true);
}

/** צורה וקטורית: נתיב במרחב המסמך → subs מקומיים מנורמלים לתיבה (0,0)-(w,h) */
export function setShapeFromDoc(l: ShapeLayer, subs: SubPath[]) {
  const xm = layerMatrix(l);
  const local = mapSubs(subs, invMat(xm));
  const b = boundsOf(local) ?? { x: 0, y: 0, w: 1, h: 1 };
  const bw = Math.max(1, b.w), bh = Math.max(1, b.h);
  const bx = b.x - (bw - b.w) / 2, by = b.y - (bh - b.h) / 2;
  const lin = new DOMMatrix().rotateSelf(l.t.rot).scaleSelf(l.t.sx, l.t.sy);
  const v = { x: bx + bw / 2 - l.w / 2, y: by + bh / 2 - l.h / 2 };
  l.t = { ...l.t, x: l.t.x + lin.a * v.x + lin.c * v.y, y: l.t.y + lin.b * v.x + lin.d * v.y };
  l.subs = mapSubs(local, { a: 1, b: 0, c: 0, d: 1, e: -bx, f: -by });
  l.w = bw; l.h = bh; l.vw = bw; l.vh = bh;
  touch(l);
}

/** שכבת צורה וקטורית חדשה מנתיב במרחב המסמך, עם מילוי וקו מתאר מאפשרויות הצורה */
export function createPathShape(ed: Editor, subs: SubPath[], name?: string): ShapeLayer {
  const o = ed.opts.shape;
  const b = boundsOf(subs) ?? { x: 0, y: 0, w: 1, h: 1 };
  const bw = Math.max(1, b.w), bh = Math.max(1, b.h);
  const l = makeShape('path', b.x + b.w / 2, b.y + b.h / 2, bw, bh, { ...o.fill }, { on: o.strokeOn, color: o.strokeColor, width: o.strokeWidth }, 0, 5);
  const bx = b.x - (bw - b.w) / 2, by = b.y - (bh - b.h) / 2;
  l.subs = mapSubs(subs, { a: 1, b: 0, c: 0, d: 1, e: -bx, f: -by });
  l.vw = bw; l.vh = bh;
  if (name) l.name = name;
  else {
    let n = 1;
    walk(ed.doc!.layers, (x) => { const m = /^צורה (\d+)$/.exec(x.name); if (m) n = Math.max(n, Number(m[1]) + 1); });
    l.name = `צורה ${n}`;
  }
  ed.insert(l);
  return l;
}

/** Work Path חדש (מחליף את הקודם שלא נשמר — כמו בפוטושופ) */
export function setWorkPath(ed: Editor, subs: SubPath[]): SavedPath {
  const d = ed.doc!;
  const old = workPathOf(d);
  const p: SavedPath = { id: old?.id ?? uid(), name: 'Work Path', subs: cloneSubs(subs), work: true };
  d.paths = old ? pathsOf(d).map((x) => (x === old ? p : x)) : [...pathsOf(d), p];
  setKey(ed, p.id);
  hiddenKeys.set(d, null);
  return p;
}

export function nextPathName(doc: Doc) {
  let n = 1;
  for (const p of pathsOf(doc)) { const m = /^נתיב (\d+)$/.exec(p.name); if (m) n = Math.max(n, Number(m[1]) + 1); }
  return `נתיב ${n}`;
}

/* ---------- טרנספורם של כל הנתונים הווקטוריים במרחב המסמך (Canvas Size, Image Size, Rotate, Flip, Artboards) ---------- */

/** נתיבי המסמך ומסכות וקטוריות של השכבות זזים עם המסמך */
export function mapDocVectors(doc: Doc | null, m: Mat, layers: Layer[] = doc?.layers ?? [], withPaths = true) {
  if (isIdent(m)) return;
  if (withPaths && doc?.paths) doc.paths = doc.paths.map((p) => ({ ...p, subs: mapSubs(p.subs, m) }));
  walk(layers, (l) => { if (l.vmask) { l.vmask = { ...l.vmask, subs: mapSubs(l.vmask.subs, m) }; touch(l); } });
}

/* ---------- פקודות ---------- */

function needTarget(ed: Editor): Target | null {
  const t = currentTarget(ed);
  if (!t) ed.toast('אין נתיב פעיל — בחרו נתיב בפאנל Paths או ציירו בעט (P)', 'error');
  return t;
}

/** נתיב → קנבס אלפא בגודל המסמך */
export function pathAlpha(doc: Doc, subs: SubPath[]): HTMLCanvasElement {
  const c = newCanvas(doc.width, doc.height), x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  x.beginPath();
  traceSubs(x, subs);
  x.fill('nonzero');
  return c;
}

export function loadPathAsSelection(ed: Editor, mode: SelMode = 'new', t: Target | null = needTarget(ed)) {
  if (!t) return;
  const d = ed.doc!;
  const subs = docSubs(t);
  if (!subs.some((s) => s.pts.length > 1)) { ed.toast('הנתיב ריק', 'error'); return; }
  ed.setSelection(combine(d, pathAlpha(d, subs), mode), 'טעינת נתיב כבחירה');
}

export function makeWorkPathFromSelection(ed: Editor, tol = ed.opts.pen.tolerance) {
  const d = ed.doc!;
  if (!d.selection) { ed.toast('אין בחירה — Make Work Path צריך בחירה פעילה', 'error'); return; }
  const img = ctx2d(d.selection, true).getImageData(0, 0, d.width, d.height).data;
  const a = new Uint8Array(d.width * d.height);
  for (let i = 0; i < a.length; i++) a[i] = img[i * 4 + 3];
  const subs = pathFromMask(a, d.width, d.height, Math.max(0.5, tol));
  if (!subs.length) { ed.toast('לא נמצא קו מתאר בבחירה', 'error'); return; }
  setWorkPath(ed, subs);
  // כמו בפוטושופ: הבחירה הופכת לנתיב (והבחירה מתבטלת)
  if (d.selection) ed.st!.lastSelection = d.selection;
  d.selection = null;
  ed.commit('נתיב עבודה מהבחירה');
  ed.openPanel('Paths');
}

/** מצייר על שכבת הפיקסלים הפעילה (או על שכבה חדשה) דרך קנבס בגודל המסמך */
function paintOnPixels(ed: Editor, label: string, draw: (x: CanvasRenderingContext2D) => void) {
  const d = ed.doc!;
  let l = ed.active;
  if (l?.locked) { ed.toast('השכבה נעולה', 'error'); return; }
  if (!l || l.type !== 'raster') {
    let n = 1;
    walk(d.layers, (x) => { const m = /^שכבה (\d+)$/.exec(x.name); if (m) n = Math.max(n, Number(m[1]) + 1); });
    const nl = makeRaster(`שכבה ${n}`, newCanvas(d.width, d.height), d.width / 2, d.height / 2);
    ed.insert(nl);
    l = nl;
  }
  const r = l as RasterLayer;
  ed.ensureCoverage(r);
  const tmp = newCanvas(d.width, d.height), tx = tmp.getContext('2d')!;
  draw(tx);
  const c = copyCanvas(r.canvas), x = c.getContext('2d')!;
  x.setTransform(layerMatrix(r).inverse());
  x.drawImage(tmp, 0, 0);
  r.canvas = c;
  touch(r);
  ed.commit(label);
}

export function fillPath(ed: Editor, color = ed.fg) {
  const t = needTarget(ed);
  if (!t) return;
  const subs = docSubs(t);
  paintOnPixels(ed, 'מילוי נתיב', (x) => { x.fillStyle = color; x.beginPath(); traceSubs(x, subs); x.fill('nonzero'); });
}

export function strokePath(ed: Editor, tool: 'brush' | 'solid' = ed.opts.pen.strokeTool) {
  const t = needTarget(ed);
  if (!t) return;
  const subs = docSubs(t);
  const color = ed.fg;
  if (tool === 'solid') {
    const w = Math.max(0.5, ed.opts.pen.strokeWidth);
    paintOnPixels(ed, 'קו מתאר לנתיב', (x) => { x.strokeStyle = color; x.lineWidth = w; x.lineJoin = 'round'; x.lineCap = 'round'; x.beginPath(); traceSubs(x, subs); x.stroke(); });
    return;
  }
  // מברשת: חותמות לאורך הנתיב לפי Size / Hardness / Opacity / Flow של המברשת הנוכחית
  const b = ed.opts.brush;
  const size = Math.max(1, b.size), r = size / 2, spacing = Math.max(0.5, size * 0.12);
  paintOnPixels(ed, 'קו מתאר לנתיב (מברשת)', (x) => {
    const d = ed.doc!;
    const st = newCanvas(d.width, d.height), sx = st.getContext('2d')!;
    const dab = newCanvas(Math.ceil(size) + 2, Math.ceil(size) + 2), dx = dab.getContext('2d')!;
    const c = dab.width / 2;
    const g = dx.createRadialGradient(c, c, 0, c, c, r);
    const [R, G, B] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    g.addColorStop(0, `rgba(${R},${G},${B},1)`);
    g.addColorStop(Math.min(0.999, Math.max(0, b.hardness)), `rgba(${R},${G},${B},1)`);
    g.addColorStop(1, `rgba(${R},${G},${B},0)`);
    dx.fillStyle = g;
    dx.fillRect(0, 0, dab.width, dab.height);
    sx.globalAlpha = Math.max(0.01, b.flow);
    for (const s of subs) {
      const poly = flattenSub(s.closed ? { ...s, pts: s.pts } : s, 0.25);
      if (s.closed && poly.length) poly.push(poly[0]);
      let carry = 0;
      for (let i = 1; i < poly.length; i++) {
        const a = poly[i - 1], q = poly[i], L = dist(a, q);
        let pos = carry;
        while (pos <= L) {
          const k = L ? pos / L : 0;
          sx.drawImage(dab, a.x + (q.x - a.x) * k - c, a.y + (q.y - a.y) * k - c);
          pos += spacing;
        }
        carry = pos - L;
      }
      if (poly.length === 1) sx.drawImage(dab, poly[0].x - c, poly[0].y - c);
    }
    x.globalAlpha = Math.max(0.01, b.opacity);
    x.drawImage(st, 0, 0);
    x.globalAlpha = 1;
  });
}

export function deletePath(ed: Editor) {
  const t = currentTarget(ed);
  const d = ed.doc!;
  if (!t) return;
  if (t.kind === 'path') { d.paths = pathsOf(d).filter((p) => p !== t.path); setKey(ed, null); ed.commit('מחיקת נתיב'); }
  else if (t.kind === 'vmask') { const l = t.layer!; l.vmask = null; touch(l); ed.commit('מחיקת מסכה וקטורית'); }
  else ed.toast('נתיב של שכבת צורה נמחק יחד עם השכבה (Layers)', 'info');
}

export function savePath(ed: Editor, t: Target | null = currentTarget(ed), name?: string) {
  const d = ed.doc!;
  if (!t) return null;
  if (t.kind === 'path' && t.path!.work) {
    const p = { ...t.path!, subs: cloneSubs(t.path!.subs), work: undefined, name: name ?? nextPathName(d) };
    delete (p as { work?: boolean }).work;
    d.paths = pathsOf(d).map((x) => (x === t.path ? p : x));
    setKey(ed, p.id);
    ed.commit('שמירת נתיב');
    return p;
  }
  // נתיב של שכבה / נתיב שמור → עותק שמור חדש
  const p: SavedPath = { id: uid(), name: name ?? nextPathName(d), subs: docSubs(t) };
  d.paths = [...pathsOf(d), p];
  setKey(ed, p.id);
  ed.commit(t.kind === 'path' ? 'שכפול נתיב' : 'שמירת נתיב');
  return p;
}

export function newPath(ed: Editor) {
  const d = ed.doc!;
  const p: SavedPath = { id: uid(), name: nextPathName(d), subs: [] };
  d.paths = [...pathsOf(d), p];
  setKey(ed, p.id);
  hiddenKeys.set(d, null);
  ed.commit('נתיב חדש');
  return p;
}

export function renamePath(ed: Editor, id: string, name: string) {
  const d = ed.doc!;
  const p = pathsOf(d).find((x) => x.id === id);
  if (!p || !name.trim() || name === p.name) return;
  const np = { ...p, name: name.trim() };
  delete (np as { work?: boolean }).work;
  d.paths = pathsOf(d).map((x) => (x === p ? np : x));
  ed.commit('שינוי שם נתיב');
}

/* ---------- Vector Mask ---------- */

export function vectorMaskFromPath(ed: Editor) {
  const a = ed.active;
  if (!a) { ed.toast('בחרו שכבה', 'error'); return; }
  if (a.locked) { ed.toast('השכבה נעולה', 'error'); return; }
  const t = currentTarget(ed);
  if (!t || (t.kind === 'vmask' && t.layer === a)) { ed.toast('אין נתיב פעיל — בחרו נתיב בפאנל Paths', 'error'); return; }
  a.vmask = { enabled: true, subs: docSubs(t) };
  touch(a);
  ed.commit('מסכה וקטורית מהנתיב');
  setActivePath(ed, `vmask:${a.id}`);
}

export function vectorMaskHideAll(ed: Editor) {
  const a = ed.active;
  if (!a || a.locked) return;
  a.vmask = { enabled: true, subs: [] };
  touch(a);
  ed.commit('מסכה וקטורית: הסתר הכול');
  setActivePath(ed, `vmask:${a.id}`);
}

export function vectorMaskToggle(ed: Editor) {
  const a = ed.active;
  if (!a?.vmask) return;
  a.vmask = { ...a.vmask, enabled: !a.vmask.enabled };
  touch(a);
  ed.commit(a.vmask.enabled ? 'הפעלת מסכה וקטורית' : 'כיבוי מסכה וקטורית');
}

export function vectorMaskDelete(ed: Editor) {
  const a = ed.active;
  if (!a?.vmask) return;
  a.vmask = null;
  touch(a);
  ed.commit('מחיקת מסכה וקטורית');
}

/* ---------- Convert to Shape ---------- */

/** צורה חיה (מלבן, אליפסה, משולש, מצולע, כוכב) → נתיב בזייה עריך, במרחב המקומי 0..w × 0..h */
export function liveShapeSubs(l: ShapeLayer): SubPath[] | null {
  const { w, h } = l;
  switch (l.shape) {
    case 'rect': {
      const r = Math.min(l.radius, w / 2, h / 2);
      if (r <= 0) return [{ closed: true, pts: [anchor(0, 0), anchor(w, 0), anchor(w, h), anchor(0, h)] }];
      const k = r * 0.5522847498;
      const A = (x: number, y: number, ix: number, iy: number, ox: number, oy: number) => ({ x, y, ix, iy, ox, oy });
      return [{ closed: true, pts: [
        A(r, 0, r - k, 0, r, 0), A(w - r, 0, w - r, 0, w - r + k, 0),
        A(w, r, w, r - k, w, r), A(w, h - r, w, h - r, w, h - r + k),
        A(w - r, h, w - r + k, h, w - r, h), A(r, h, r, h, r - k, h),
        A(0, h - r, 0, h - r + k, 0, h - r), A(0, r, 0, r, 0, r - k),
      ] }];
    }
    case 'ellipse': return [ellipseSub(w / 2, h / 2, w / 2, h / 2)];
    case 'triangle': return [{ closed: true, pts: [anchor(w / 2, 0), anchor(w, h), anchor(0, h)] }];
    case 'polygon':
    case 'star': {
      const n = Math.max(3, Math.round(l.sides));
      const cnt = l.shape === 'star' ? n * 2 : n;
      const pts = [];
      for (let i = 0; i < cnt; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / cnt;
        const k = l.shape === 'star' && i % 2 ? 0.45 : 1;
        pts.push(anchor(w / 2 + Math.cos(a) * (w / 2) * k, h / 2 + Math.sin(a) * (h / 2) * k));
      }
      return [{ closed: true, pts }];
    }
    default: return null;
  }
}

/** Layer > Convert to Shape: הצורה החיה הופכת לנתיב שאפשר לערוך בבחירה הישירה. מחזיר האם הומר */
export function convertToShape(ed: Editor, l: Layer | null = ed.active, commit = true): boolean {
  if (!l || l.type !== 'shape') { if (commit) ed.toast('Convert to Shape עובד על שכבת צורה (מלבן, אליפסה, מצולע, כוכב)', 'error'); return false; }
  if (l.shape === 'path') return false;
  if (l.locked) { ed.toast('השכבה נעולה', 'error'); return false; }
  const subs = liveShapeSubs(l);
  if (!subs) { ed.toast('קו לא הופך לצורה — השתמשו במלבן', 'error'); return false; }
  l.shape = 'path';
  l.subs = subs;
  l.vw = l.w;
  l.vh = l.h;
  touch(l);
  if (commit) ed.commit('המרה לצורה');
  return true;
}

/* ---------- ניתוב פקודות (Editor.run → tool-cmds) ---------- */

export function runPathCmd(ed: Editor, id: string): boolean {
  switch (id) {
    case 'path.toSelection': loadPathAsSelection(ed, 'new'); return true;
    case 'path.toSelectionAdd': loadPathAsSelection(ed, 'add'); return true;
    case 'path.toSelectionSub': loadPathAsSelection(ed, 'sub'); return true;
    case 'path.toSelectionInt': loadPathAsSelection(ed, 'int'); return true;
    case 'path.fromSelection': makeWorkPathFromSelection(ed); return true;
    case 'path.fill': fillPath(ed); return true;
    case 'path.stroke': strokePath(ed); return true;
    case 'path.strokeBrush': strokePath(ed, 'brush'); return true;
    case 'path.strokeSolid': strokePath(ed, 'solid'); return true;
    case 'path.new': newPath(ed); return true;
    case 'path.save': savePath(ed); return true;
    case 'path.delete': deletePath(ed); return true;
    case 'path.deselect': setActivePath(ed, null); return true;
    case 'layer.vmaskCurrent': vectorMaskFromPath(ed); return true;
    case 'layer.vmaskHideAll': vectorMaskHideAll(ed); return true;
    case 'layer.vmaskToggle': vectorMaskToggle(ed); return true;
    case 'layer.vmaskDelete': vectorMaskDelete(ed); return true;
    case 'layer.vmaskEdit': {
      const a = ed.active;
      if (!a?.vmask) return true;
      setActivePath(ed, `vmask:${a.id}`);
      ed.setTool('directSel');
      ed.openPanel('Paths');
      return true;
    }
    case 'layer.convertToShape': convertToShape(ed); return true;
  }
  return false;
}
