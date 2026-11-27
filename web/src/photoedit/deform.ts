/**
 * רינדור שכבות לא-אפיניות: Distort/Perspective (quad → הומוגרפיה), Warp (משטח בזייה) ו-Puppet (רשת משולשים).
 * השכבה נשארת כמו שהיא (טקסט/צורה עדיין ניתנים לעריכה); כאן היא מצוירת דרך רשת של ~16×16 תאים,
 * כל משולש דרך קליפ ומיפוי אפיני משלו, עם ניפוח קטן של הקליפ כדי שלא ייראו תפרים.
 * המודול לא מייבא מ-render.ts (אין תלות מעגלית) — render.ts מעביר את המטריצה, התיבה ופונקציית ציור התוכן.
 */
import type { Layer, Pt, Rect, XfLayer } from './model';
import { apply, newCanvas } from './model';
import { applyH, bezierPatch, inflateTri, squareToQuad, triAffine } from './warp-algo';

export const isDeformed = (l: Layer) => !!(l.quad || l.warp || l.mesh);

/** מיפוי (u,v) מנורמל של תיבת השכבה → נקודה במסמך: Warp, אחריו Quad, אחריו הטרנספורם האפיני */
export function deformMap(l: Pick<Layer, 'quad' | 'warp'>, m: DOMMatrix, box: Rect): (u: number, v: number) => Pt {
  const H = l.quad ? squareToQuad(l.quad) : null;
  const W = l.warp?.pts ?? null;
  return (u, v) => {
    let p: Pt = W ? bezierPatch(W, u, v) : { x: u, y: v };
    if (H) p = applyH(H, p.x, p.y);
    return apply(m, { x: box.x + p.x * box.w, y: box.y + p.y * box.h });
  };
}

/** ארבע פינות תיבת הטרנספורם במסמך (ה-Quad; בלי Warp — כמו ב-Smart Object) */
export function deformCorners(l: Pick<Layer, 'quad'>, m: DOMMatrix, box: Rect): Pt[] {
  const q = l.quad ?? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  return q.map((p) => apply(m, { x: box.x + p.x * box.w, y: box.y + p.y * box.h }));
}

/** קו המתאר של השכבה המעוותת (לפגיעת עכבר ולגבולות) */
export function deformOutline(l: Pick<Layer, 'quad' | 'warp' | 'mesh'>, m: DOMMatrix, box: Rect, n = 12): Pt[] {
  if (l.mesh) return meshHull(l.mesh.dst).map((p) => apply(m, p));
  const f = deformMap(l, m, box), out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(f(i / n, 0));
  for (let i = 0; i < n; i++) out.push(f(1, i / n));
  for (let i = n; i > 0; i--) out.push(f(i / n, 1));
  for (let i = n; i > 0; i--) out.push(f(0, i / n));
  return out;
}

/** כל הנקודות שהשכבה יכולה להגיע אליהן (לחישוב גבולות) */
export function deformSamples(l: Pick<Layer, 'quad' | 'warp' | 'mesh'>, m: DOMMatrix, box: Rect): Pt[] {
  if (l.mesh) return l.mesh.dst.map((p) => apply(m, p));
  const f = deformMap(l, m, box), out: Pt[] = [];
  for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) out.push(f(i / 8, j / 8));
  return out;
}

function meshHull(pts: Pt[]): Pt[] {
  // Andrew monotone chain
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cr = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export function pointInPoly(p: Pt, q: Pt[]) {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if (q[i].y > p.y !== q[j].y > p.y && p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
  }
  return inside;
}

/* ---------- ציור משולש דרך קליפ ---------- */

function drawTri(ctx: CanvasRenderingContext2D, base: DOMMatrix, src: CanvasImageSource, sw: number, sh: number, s: Pt[], d: Pt[], inflate: number) {
  const A = triAffine(s[0], s[1], s[2], d[0], d[1], d[2]);
  if (!A) return;
  const c = inflateTri(d, inflate);
  ctx.save();
  ctx.setTransform(base);
  ctx.beginPath();
  ctx.moveTo(c[0].x, c[0].y); ctx.lineTo(c[1].x, c[1].y); ctx.lineTo(c[2].x, c[2].y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(A[0], A[1], A[2], A[3], A[4], A[5]);
  // רק תת-המלבן של המשולש במקור (עם שוליים) — חוסך עבודת פיקסלים בתמונות גדולות
  const x0 = Math.max(0, Math.floor(Math.min(s[0].x, s[1].x, s[2].x) - 2)), y0 = Math.max(0, Math.floor(Math.min(s[0].y, s[1].y, s[2].y) - 2));
  const x1 = Math.min(sw, Math.ceil(Math.max(s[0].x, s[1].x, s[2].x) + 2)), y1 = Math.min(sh, Math.ceil(Math.max(s[0].y, s[1].y, s[2].y) + 2));
  if (x1 > x0 && y1 > y0) ctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

/* ---------- מקור לציור: פיקסלים כמו שהם, או טקסט/צורה מרונדרים במטמון ---------- */

const vecCache = new Map<string, { key: string; k: number; c: HTMLCanvasElement }>();

function contentKey(l: XfLayer): string {
  // כל המאפיינים שמשפיעים על התוכן עצמו (לא על המיקום) — כך גרירה בטרנספורם לא מרנדרת מחדש
  const { t: _t, quad: _q, warp: _w, mesh: _m, rev: _r, mask: _k, fx: _f, name: _n, opacity: _o, blend: _b, visible: _v, locked: _l, clip: _c, id: _i, ...rest } = l as XfLayer & Record<string, unknown>;
  return JSON.stringify(rest, (key, val) => (val instanceof HTMLCanvasElement ? undefined : val));
}

/** כמה פיקסלי מסמך לכל פיקסל מקומי (ההגדלה המקסימלית של המיפוי) */
function stretch(f: (u: number, v: number) => Pt, box: Rect) {
  let s = 0;
  for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) {
    const u = i / 4, v = j / 4, p = f(u, v), px = f(u + 0.02, v), py = f(u, v + 0.02);
    s = Math.max(s, Math.hypot(px.x - p.x, px.y - p.y) / (0.02 * box.w || 1), Math.hypot(py.x - p.x, py.y - p.y) / (0.02 * box.h || 1));
  }
  return s || 1;
}

/**
 * מצייר שכבה מעוותת. ctx כבר במרחב המסמך (setTransform של scale/תרגום כלשהו); devScale = פיקסלי מכשיר לכל
 * יחידת מסמך (לניפוח התפרים ולרזולוציית הרינדור של טקסט/צורה). drawContent מצייר את התוכן במרחב המקומי.
 */
export function drawDeformed(ctx: CanvasRenderingContext2D, l: XfLayer, m: DOMMatrix, box: Rect, devScale: number, raster: HTMLCanvasElement | null, drawContent: (x: CanvasRenderingContext2D) => void, pad = 0) {
  const base = ctx.getTransform();
  const inflate = 0.65 / Math.max(1e-6, devScale);
  if (l.mesh) {
    // Puppet: משולשים מפורשים, מקור ויעד בפיקסלים של השכבה
    const src = raster;
    if (!src) return;
    const { src: S, dst: D, tris } = l.mesh;
    const Dd = D.map((p) => apply(m, p));
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      drawTri(ctx, base, src, src.width, src.height, [S[a], S[b], S[c]], [Dd[a], Dd[b], Dd[c]], inflate);
    }
    ctx.setTransform(base);
    return;
  }
  const f = deformMap(l, m, box);
  let src: HTMLCanvasElement, sx0: number, sy0: number, k: number;
  if (raster) { src = raster; k = 1; sx0 = 0; sy0 = 0; pad = 0; }
  else {
    // טקסט/צורה: מרנדרים את התוכן לקנבס ברזולוציה שמתאימה להגדלה, ושומרים במטמון לפי התוכן בלבד
    const want = Math.min(6, Math.max(0.25, stretch(f, box) * devScale));
    const W = (box.w + 2 * pad), H = (box.h + 2 * pad);
    k = Math.min(want, 4096 / Math.max(1, W), 4096 / Math.max(1, H));
    k = Math.pow(2, Math.round(Math.log2(k) * 4) / 4); // מדרגות — לא לרנדר מחדש על כל שינוי זום קטן
    const key = contentKey(l), hit = vecCache.get(l.id);
    if (hit && hit.key === key && hit.k === k) src = hit.c;
    else {
      src = newCanvas(W * k, H * k);
      const x = src.getContext('2d')!;
      x.setTransform(k, 0, 0, k, (pad - box.x) * k, (pad - box.y) * k);
      x.imageSmoothingQuality = 'high';
      drawContent(x);
      vecCache.set(l.id, { key, k, c: src });
      if (vecCache.size > 48) vecCache.delete(vecCache.keys().next().value as string);
    }
    sx0 = box.x - pad; sy0 = box.y - pad;
  }
  const pu = pad / (box.w || 1), pv = pad / (box.h || 1);
  const N = l.warp ? 20 : 16;
  const us: number[] = [], vs: number[] = [];
  for (let i = 0; i <= N; i++) { us.push(-pu + (i / N) * (1 + 2 * pu)); vs.push(-pv + (i / N) * (1 + 2 * pv)); }
  const D: Pt[] = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) D.push(f(us[i], vs[j]));
  const S = (i: number, j: number): Pt => ({ x: (box.x + us[i] * box.w - sx0) * k, y: (box.y + vs[j] * box.h - sy0) * k });
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 2, d = a + N + 1;
    const sa = S(i, j), sb = S(i + 1, j), sc = S(i + 1, j + 1), sd = S(i, j + 1);
    drawTri(ctx, base, src, src.width, src.height, [sa, sb, sc], [D[a], D[b], D[c]], inflate);
    drawTri(ctx, base, src, src.width, src.height, [sa, sc, sd], [D[a], D[c], D[d]], inflate);
  }
  ctx.setTransform(base);
}
