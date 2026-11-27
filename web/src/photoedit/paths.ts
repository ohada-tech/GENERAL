/**
 * Paths — מתמטיקה טהורה של נתיבי בזייה (בלי DOM): נקודות עיגון וידיות, פיצול ומחיקה, קרבה לנתיב, תיבה,
 * התאמת עקומות (Schneider) לעט החופשי, מעקב קווי מתאר של בחירה (Make Work Path), Curvature Pen,
 * וטרנספורם אפיני. משמש את העט, פאנל Paths, שכבות צורה וקטוריות ומסכות וקטוריות.
 * כל הנקודות מוחלטות: ix/iy = ידית נכנסת, ox/oy = ידית יוצאת. ידית שווה לנקודה = אין ידית (פינה).
 */

export interface P2 { x: number; y: number }

export interface Anchor {
  x: number; y: number;
  ix: number; iy: number;
  ox: number; oy: number;
  /** ידיות מקושרות (Smooth): גרירת ידית אחת מסובבת את השנייה. false/undefined = פינה */
  smooth?: boolean;
}

export interface SubPath { pts: Anchor[]; closed: boolean }

/** נתיב בפאנל Paths: Work Path (זמני, אחד) או נתיב שמור */
export interface SavedPath { id: string; name: string; subs: SubPath[]; work?: boolean }

/** מטריצה אפינית (תואמת מבנית ל-DOMMatrix) */
export interface Mat { a: number; b: number; c: number; d: number; e: number; f: number }

export const IDENT: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/* ---------- בסיס ---------- */

export const anchor = (x: number, y: number, smooth = false): Anchor => ({ x, y, ix: x, iy: y, ox: x, oy: y, smooth });
export const cloneAnchor = (a: Anchor): Anchor => ({ ...a });
export const cloneSub = (s: SubPath): SubPath => ({ closed: s.closed, pts: s.pts.map(cloneAnchor) });
export const cloneSubs = (subs: SubPath[]): SubPath[] => subs.map(cloneSub);
export const clonePaths = (ps: SavedPath[]): SavedPath[] => ps.map((p) => ({ ...p, subs: cloneSubs(p.subs) }));

export const hasIn = (a: Anchor) => a.ix !== a.x || a.iy !== a.y;
export const hasOut = (a: Anchor) => a.ox !== a.x || a.oy !== a.y;

export const dist = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.y - b.y);
const sub2 = (a: P2, b: P2): P2 => ({ x: a.x - b.x, y: a.y - b.y });
const add2 = (a: P2, b: P2): P2 => ({ x: a.x + b.x, y: a.y + b.y });
const mul2 = (a: P2, k: number): P2 => ({ x: a.x * k, y: a.y * k });
const dot2 = (a: P2, b: P2) => a.x * b.x + a.y * b.y;
const len2 = (a: P2) => Math.hypot(a.x, a.y);
const norm2 = (a: P2): P2 => { const l = len2(a); return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }; };

export const segCount = (s: SubPath) => (s.pts.length < 2 ? 0 : s.closed ? s.pts.length : s.pts.length - 1);

/** קטע i של תת-נתיב: [p0, c1, c2, p3] */
export function segment(s: SubPath, i: number): [P2, P2, P2, P2] {
  const a = s.pts[i], b = s.pts[(i + 1) % s.pts.length];
  return [{ x: a.x, y: a.y }, { x: a.ox, y: a.oy }, { x: b.ix, y: b.iy }, { x: b.x, y: b.y }];
}

export function bez(p0: P2, c1: P2, c2: P2, p3: P2, t: number): P2 {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * c1.x + c * c2.x + d * p3.x, y: a * p0.y + b * c1.y + c * c2.y + d * p3.y };
}

function bezD(p0: P2, c1: P2, c2: P2, p3: P2, t: number): P2 {
  const u = 1 - t;
  return {
    x: 3 * u * u * (c1.x - p0.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (p3.x - c2.x),
    y: 3 * u * u * (c1.y - p0.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (p3.y - c2.y),
  };
}

/** de Casteljau: מחזיר את שני החצאים */
export function splitBez(p0: P2, c1: P2, c2: P2, p3: P2, t: number): [[P2, P2, P2, P2], [P2, P2, P2, P2]] {
  const l = (a: P2, b: P2) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const a = l(p0, c1), b = l(c1, c2), c = l(c2, p3), d = l(a, b), e = l(b, c), m = l(d, e);
  return [[p0, a, d, m], [m, e, c, p3]];
}

/* ---------- מטריצות ---------- */

export const applyMat = (m: Mat, p: P2): P2 => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
export function mulMat(m: Mat, n: Mat): Mat {
  return { a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b, c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d, e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f };
}
export function invMat(m: Mat): Mat {
  const det = m.a * m.d - m.b * m.c || 1e-12;
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det };
}
export const isIdent = (m: Mat) => m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;

export function mapAnchor(a: Anchor, m: Mat): Anchor {
  const p = applyMat(m, a), i = applyMat(m, { x: a.ix, y: a.iy }), o = applyMat(m, { x: a.ox, y: a.oy });
  return { x: p.x, y: p.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y, smooth: a.smooth };
}
export const mapSubs = (subs: SubPath[], m: Mat): SubPath[] => (isIdent(m) ? cloneSubs(subs) : subs.map((s) => ({ closed: s.closed, pts: s.pts.map((a) => mapAnchor(a, m)) })));

/** הזזת עוגן יחד עם הידיות שלו */
export function moveAnchor(a: Anchor, dx: number, dy: number): Anchor {
  return { ...a, x: a.x + dx, y: a.y + dy, ix: a.ix + dx, iy: a.iy + dy, ox: a.ox + dx, oy: a.oy + dy };
}

/* ---------- תיבה ---------- */

/** תיבה מדויקת של קטע בזייה (שורשי הנגזרת) */
function bezBounds(p0: P2, c1: P2, c2: P2, p3: P2, acc: { x0: number; y0: number; x1: number; y1: number }) {
  const take = (p: P2) => { if (p.x < acc.x0) acc.x0 = p.x; if (p.y < acc.y0) acc.y0 = p.y; if (p.x > acc.x1) acc.x1 = p.x; if (p.y > acc.y1) acc.y1 = p.y; };
  take(p0); take(p3);
  for (const k of ['x', 'y'] as const) {
    const a = -p0[k] + 3 * c1[k] - 3 * c2[k] + p3[k], b = 2 * (p0[k] - 2 * c1[k] + c2[k]), c = c1[k] - p0[k];
    const ts: number[] = [];
    if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) ts.push(-c / b); }
    else {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) { const s = Math.sqrt(disc); ts.push((-b + s) / (2 * a), (-b - s) / (2 * a)); }
    }
    for (const t of ts) if (t > 0 && t < 1) take(bez(p0, c1, c2, p3, t));
  }
}

export function boundsOf(subs: SubPath[]): { x: number; y: number; w: number; h: number } | null {
  const acc = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const s of subs) {
    if (s.pts.length === 1) bezBounds(s.pts[0], s.pts[0], s.pts[0], s.pts[0], acc);
    for (let i = 0; i < segCount(s); i++) { const [a, b, c, d] = segment(s, i); bezBounds(a, b, c, d, acc); }
  }
  if (!Number.isFinite(acc.x0)) return null;
  return { x: acc.x0, y: acc.y0, w: acc.x1 - acc.x0, h: acc.y1 - acc.y0 };
}

/* ---------- ציור / SVG ---------- */

/** מצייר על כל אובייקט עם moveTo/lineTo/bezierCurveTo/closePath (CanvasRenderingContext2D, Path2D) */
export function traceSubs(ctx: { moveTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void; lineTo(x: number, y: number): void; closePath(): void }, subs: SubPath[], m?: Mat) {
  for (const s0 of subs) {
    if (!s0.pts.length) continue;
    const s = m && !isIdent(m) ? { closed: s0.closed, pts: s0.pts.map((a) => mapAnchor(a, m)) } : s0;
    ctx.moveTo(s.pts[0].x, s.pts[0].y);
    for (let i = 0; i < segCount(s); i++) {
      const a = s.pts[i], b = s.pts[(i + 1) % s.pts.length];
      if (!hasOut(a) && !hasIn(b)) ctx.lineTo(b.x, b.y);
      else ctx.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y);
    }
    if (s.closed) ctx.closePath();
  }
}

const fmt = (v: number) => String(+v.toFixed(3));

export function toSvgD(subs: SubPath[], m?: Mat): string {
  const out: string[] = [];
  const rec = {
    moveTo: (x: number, y: number) => out.push(`M${fmt(x)} ${fmt(y)}`),
    lineTo: (x: number, y: number) => out.push(`L${fmt(x)} ${fmt(y)}`),
    bezierCurveTo: (a: number, b: number, c: number, d: number, e: number, f: number) => out.push(`C${fmt(a)} ${fmt(b)} ${fmt(c)} ${fmt(d)} ${fmt(e)} ${fmt(f)}`),
    closePath: () => out.push('Z'),
  };
  traceSubs(rec, subs, m);
  return out.join('');
}

/* ---------- דגימה וקרבה ---------- */

/** תת-נתיב כקו שבור (לבחירה, לקו מתאר במברשת ולבדיקת פגיעה) */
export function flattenSub(s: SubPath, tol = 0.5): P2[] {
  const out: P2[] = [];
  if (!s.pts.length) return out;
  out.push({ x: s.pts[0].x, y: s.pts[0].y });
  for (let i = 0; i < segCount(s); i++) {
    const [a, b, c, d] = segment(s, i);
    const poly = dist(a, b) + dist(b, c) + dist(c, d);
    const n = Math.min(400, Math.max(1, Math.ceil(Math.sqrt(poly / Math.max(0.05, tol)) * 1.5)));
    const straight = dist(a, b) < 1e-9 && dist(c, d) < 1e-9;
    if (straight) { out.push(d); continue; }
    for (let k = 1; k <= n; k++) out.push(bez(a, b, c, d, k / n));
  }
  return out;
}

export interface NearHit { si: number; seg: number; t: number; d: number; pt: P2 }

/** הנקודה הקרובה ביותר על הנתיב (דגימה ואז עידון בחיפוש בינארי) */
export function nearestOnSubs(subs: SubPath[], p: P2): NearHit | null {
  let best: NearHit | null = null;
  subs.forEach((s, si) => {
    for (let i = 0; i < segCount(s); i++) {
      const [a, b, c, d] = segment(s, i);
      const N = 48;
      let bt = 0, bd = Infinity;
      for (let k = 0; k <= N; k++) { const t = k / N, q = bez(a, b, c, d, t), dd = dist(q, p); if (dd < bd) { bd = dd; bt = t; } }
      let step = 1 / N;
      for (let it = 0; it < 18; it++) {
        step /= 2;
        for (const t of [bt - step, bt + step]) {
          if (t < 0 || t > 1) continue;
          const dd = dist(bez(a, b, c, d, t), p);
          if (dd < bd) { bd = dd; bt = t; }
        }
      }
      if (!best || bd < best.d) best = { si, seg: i, t: bt, d: bd, pt: bez(a, b, c, d, bt) };
    }
  });
  return best;
}

/* ---------- עריכה ---------- */

/** Add Anchor Point: פיצול הקטע ב-t, הנקודה החדשה חלקה (או פינה כשהקטע ישר) */
export function insertAnchor(s: SubPath, seg: number, t: number): SubPath {
  const n = s.pts.length, j = (seg + 1) % n;
  const out = cloneSub(s);
  const a = out.pts[seg], b = out.pts[j];
  const straight = !hasOut(a) && !hasIn(b);
  const [L, R] = splitBez(...segment(s, seg), t);
  const m: Anchor = straight
    ? anchor(L[3].x, L[3].y)
    : { x: L[3].x, y: L[3].y, ix: L[2].x, iy: L[2].y, ox: R[1].x, oy: R[1].y, smooth: true };
  if (!straight) { a.ox = L[1].x; a.oy = L[1].y; b.ix = R[2].x; b.iy = R[2].y; }
  out.pts.splice(seg + 1, 0, m);
  return out;
}

/** Delete Anchor Point: הנתיב נשאר מחובר; null = לא נשארו מספיק נקודות */
export function removeAnchor(s: SubPath, i: number): SubPath | null {
  const out = cloneSub(s);
  out.pts.splice(i, 1);
  if (out.pts.length < 2) return null;
  if (out.pts.length === 2 && out.closed) out.closed = false;
  return out;
}

/** Delete במקש (Direct Selection): מוחק את העוגנים ואת הקטעים שלהם — הנתיב נשבר לחלקים פתוחים */
export function deleteAnchorsBreaking(s: SubPath, del: Set<number>): SubPath[] {
  const n = s.pts.length;
  if (!del.size) return [cloneSub(s)];
  const runs: Anchor[][] = [];
  let cur: Anchor[] = [];
  for (let i = 0; i < n; i++) {
    if (del.has(i)) { if (cur.length) runs.push(cur); cur = []; }
    else cur.push(cloneAnchor(s.pts[i]));
  }
  if (cur.length) runs.push(cur);
  // בנתיב סגור הריצה האחרונה ממשיכה לראשונה
  if (s.closed && runs.length > 1 && !del.has(0) && !del.has(n - 1)) {
    const last = runs.pop()!;
    runs[0] = [...last, ...runs[0]];
  }
  return runs.filter((r) => r.length >= 2).map((pts) => {
    // הקצוות החדשים מאבדים את הידית לכיוון שנמחק
    const a = pts[0], b = pts[pts.length - 1];
    a.ix = a.x; a.iy = a.y; b.ox = b.x; b.oy = b.y;
    return { closed: false, pts };
  });
}

export function reverseSub(s: SubPath): SubPath {
  return { closed: s.closed, pts: [...s.pts].reverse().map((a) => ({ ...a, ix: a.ox, iy: a.oy, ox: a.ix, oy: a.iy })) };
}

/** הידית הנגדית מסתובבת כך שתישאר על אותו קו (שומרת את האורך שלה) */
export function alignOpposite(a: Anchor, moved: 'in' | 'out'): Anchor {
  const r = { ...a };
  const hx = moved === 'out' ? a.ox - a.x : a.ix - a.x, hy = moved === 'out' ? a.oy - a.y : a.iy - a.y;
  const hl = Math.hypot(hx, hy);
  if (hl < 1e-9) return r;
  const ol = moved === 'out' ? Math.hypot(a.ix - a.x, a.iy - a.y) : Math.hypot(a.ox - a.x, a.oy - a.y);
  if (ol < 1e-9) return r;
  const k = -ol / hl;
  if (moved === 'out') { r.ix = a.x + hx * k; r.iy = a.y + hy * k; }
  else { r.ox = a.x + hx * k; r.oy = a.y + hy * k; }
  return r;
}

/** גרירת קטע ב-Direct Selection: נקודת העקומה ב-t זזה בדיוק ב-delta (פתרון בנורמה מינימלית על שתי הידיות) */
export function reshapeSegment(s: SubPath, seg: number, t: number, dx: number, dy: number): SubPath {
  const out = cloneSub(s);
  const n = out.pts.length, a = out.pts[seg], b = out.pts[(seg + 1) % n];
  const tt = Math.min(0.95, Math.max(0.05, t));
  const w1 = 3 * tt * (1 - tt) * (1 - tt), w2 = 3 * tt * tt * (1 - tt), den = w1 * w1 + w2 * w2;
  a.ox += (dx * w1) / den; a.oy += (dy * w1) / den;
  b.ix += (dx * w2) / den; b.iy += (dy * w2) / den;
  if (a.smooth) out.pts[seg] = alignOpposite(a, 'out');
  if (b.smooth) out.pts[(seg + 1) % n] = alignOpposite(b, 'in');
  return out;
}

/** Shift: הצמדה לזוויות של 45° ביחס לנקודה הקודמת */
export function snap45(from: P2, p: P2): P2 {
  const a = Math.atan2(p.y - from.y, p.x - from.x), r = dist(from, p), q = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
  return { x: from.x + Math.cos(q) * r, y: from.y + Math.sin(q) * r };
}

/* ---------- Curvature Pen ---------- */

export interface CurvPt { x: number; y: number; corner: boolean }

/** העקומה עוברת בכל הנקודות; ידיות לאורך המשיק (שכנה-לשכנה), באורך שליש מהמרחק לשכן. פינה/קצה = בלי ידיות */
export function curvatureAnchors(pts: CurvPt[], closed: boolean): Anchor[] {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = anchor(p.x, p.y);
    const hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
    if (p.corner || !hasPrev || !hasNext || n < 3) return a;
    const pr = pts[(i - 1 + n) % n], nx = pts[(i + 1) % n];
    const T = norm2(sub2(nx, pr));
    const dp = dist(p, pr), dn = dist(p, nx);
    a.ix = p.x - T.x * dp / 3; a.iy = p.y - T.y * dp / 3;
    a.ox = p.x + T.x * dn / 3; a.oy = p.y + T.y * dn / 3;
    a.smooth = true;
    return a;
  });
}

/* ---------- התאמת עקומות (Philip J. Schneider, Graphics Gems 1990) ---------- */

type Bz = [P2, P2, P2, P2];

function chordParams(pts: P2[], first: number, last: number): number[] {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + dist(pts[i], pts[i - 1]));
  const L = u[u.length - 1] || 1;
  return u.map((v) => v / L);
}

function generateBezier(pts: P2[], first: number, last: number, u: number[], t1: P2, t2: P2): Bz {
  const p0 = pts[first], p3 = pts[last];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < u.length; i++) {
    const t = u[i], mt = 1 - t;
    const b0 = mt * mt * mt, b1 = 3 * t * mt * mt, b2 = 3 * t * t * mt, b3 = t * t * t;
    const A1 = mul2(t1, b1), A2 = mul2(t2, b2);
    c00 += dot2(A1, A1); c01 += dot2(A1, A2); c11 += dot2(A2, A2);
    const tmp = sub2(pts[first + i], add2(mul2(p0, b0 + b1), mul2(p3, b2 + b3)));
    x0 += dot2(A1, tmp); x1 += dot2(A2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let aL = 0, aR = 0;
  if (Math.abs(det) > 1e-12) { aL = (x0 * c11 - c01 * x1) / det; aR = (c00 * x1 - x0 * c01) / det; }
  const segLen = dist(p0, p3), eps = 1e-6 * segLen;
  if (aL < eps || aR < eps) { aL = aR = segLen / 3; }
  return [p0, add2(p0, mul2(t1, aL)), add2(p3, mul2(t2, aR)), p3];
}

function maxError(pts: P2[], first: number, last: number, b: Bz, u: number[]): { err: number; split: number } {
  let err = 0, split = Math.floor((last - first + 1) / 2) + first;
  for (let i = first + 1; i < last; i++) {
    const p = bez(b[0], b[1], b[2], b[3], u[i - first]);
    const d = (p.x - pts[i].x) ** 2 + (p.y - pts[i].y) ** 2;
    if (d >= err) { err = d; split = i; }
  }
  return { err, split };
}

function newtonRoot(b: Bz, p: P2, u: number): number {
  const q = bez(b[0], b[1], b[2], b[3], u);
  const d1 = bezD(b[0], b[1], b[2], b[3], u);
  // נגזרת שנייה
  const mt = 1 - u;
  const d2 = {
    x: 6 * mt * (b[2].x - 2 * b[1].x + b[0].x) + 6 * u * (b[3].x - 2 * b[2].x + b[1].x),
    y: 6 * mt * (b[2].y - 2 * b[1].y + b[0].y) + 6 * u * (b[3].y - 2 * b[2].y + b[1].y),
  };
  const num = (q.x - p.x) * d1.x + (q.y - p.y) * d1.y;
  const den = d1.x * d1.x + d1.y * d1.y + (q.x - p.x) * d2.x + (q.y - p.y) * d2.y;
  if (Math.abs(den) < 1e-12) return u;
  return Math.min(1, Math.max(0, u - num / den));
}

function fitCubic(pts: P2[], first: number, last: number, t1: P2, t2: P2, err2: number, out: Bz[], depth = 0) {
  const p0 = pts[first], p3 = pts[last];
  if (last - first === 1 || depth > 40) {
    const d = dist(p0, p3) / 3;
    out.push([p0, add2(p0, mul2(t1, d)), add2(p3, mul2(t2, d)), p3]);
    return;
  }
  let u = chordParams(pts, first, last);
  let b = generateBezier(pts, first, last, u, t1, t2);
  let { err, split } = maxError(pts, first, last, b, u);
  if (err < err2) { out.push(b); return; }
  if (err < err2 * 4) {
    for (let it = 0; it < 20; it++) {
      const up = u.map((v, i) => newtonRoot(b, pts[first + i], v));
      b = generateBezier(pts, first, last, up, t1, t2);
      ({ err, split } = maxError(pts, first, last, b, up));
      if (err < err2) { out.push(b); return; }
      u = up;
    }
  }
  split = Math.min(last - 1, Math.max(first + 1, split));
  let tc = norm2(sub2(pts[split - 1], pts[split + 1]));
  if (!tc.x && !tc.y) tc = norm2(sub2(pts[split - 1], pts[split]));
  fitCubic(pts, first, split, t1, tc, err2, out, depth + 1);
  fitCubic(pts, split, last, mul2(tc, -1), t2, err2, out, depth + 1);
}

/** מסיר נקודות כפולות/צפופות מדי */
export function dedupe(pts: P2[], minD = 0.01): P2[] {
  const out: P2[] = [];
  for (const p of pts) if (!out.length || dist(out[out.length - 1], p) > minD) out.push({ x: p.x, y: p.y });
  return out;
}

/** ידיות שכמעט על המיתר הופכות לקטע ישר אמיתי (פינות), כמו בפוטושופ */
function collapseStraight(b: Bz): Bz {
  const [p0, c1, c2, p3] = b;
  const L = dist(p0, p3);
  if (L < 1e-9) return b;
  const dir = mul2(sub2(p3, p0), 1 / L);
  const off = (c: P2) => Math.abs((c.x - p0.x) * dir.y - (c.y - p0.y) * dir.x);
  const along = (c: P2) => dot2(sub2(c, p0), dir);
  if (off(c1) < 0.02 && off(c2) < 0.02 && along(c1) >= -0.01 && along(c2) <= L + 0.01) return [p0, p0, p3, p3];
  return b;
}

/** קו שבור → רצף בזייה. err = מרחק מרבי בפיקסלים. t1/t2 = משיקים בקצוות (אופציונלי) */
export function fitBeziers(pts0: P2[], err: number, t1?: P2, t2?: P2): Bz[] {
  const pts = dedupe(pts0);
  if (pts.length < 2) return [];
  const n = pts.length;
  const a = t1 ?? norm2(sub2(pts[Math.min(1, n - 1)], pts[0]));
  const b = t2 ?? norm2(sub2(pts[Math.max(0, n - 2)], pts[n - 1]));
  const out: Bz[] = [];
  fitCubic(pts, 0, n - 1, a, b, Math.max(1e-6, err * err), out);
  return out.map(collapseStraight);
}

/** רצף בזייה → עוגנים של תת-נתיב פתוח */
export function beziersToAnchors(bz: Bz[], smoothJoins = true): Anchor[] {
  if (!bz.length) return [];
  const out: Anchor[] = [anchor(bz[0][0].x, bz[0][0].y)];
  for (const b of bz) {
    const prev = out[out.length - 1];
    prev.ox = b[1].x; prev.oy = b[1].y;
    const a = anchor(b[3].x, b[3].y);
    a.ix = b[2].x; a.iy = b[2].y;
    out.push(a);
  }
  if (smoothJoins) {
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i];
      if (!hasIn(a) || !hasOut(a)) continue;
      const v1 = norm2({ x: a.x - a.ix, y: a.y - a.iy }), v2 = norm2({ x: a.ox - a.x, y: a.oy - a.y });
      a.smooth = dot2(v1, v2) > 0.995;
    }
  }
  return out;
}

/** Freeform Pen: נקודות הגרירה → תת-נתיב פתוח (Curve Fit בפיקסלים) */
export function freeformSub(pts: P2[], curveFit: number): SubPath | null {
  const an = beziersToAnchors(fitBeziers(pts, Math.max(0.1, curveFit)));
  return an.length >= 2 ? { closed: false, pts: an } : null;
}

/* ---------- Make Work Path from Selection: מעקב קווי מתאר של מסכה ---------- */

/**
 * קווי המתאר של אזור (alpha >= threshold) לאורך גבולות הפיקסלים. החוץ עם כיוון השעון (במסך), חורים נגדו —
 * כך שכלל nonzero ממלא נכון. מחזיר רק את פינות המדרגות (נקודות שבהן הכיוון משתנה).
 */
export function traceMask(alpha: ArrayLike<number>, w: number, h: number, threshold = 128): P2[][] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && alpha[y * w + x] >= threshold;
  const W1 = w + 1;
  // לכל קודקוד: עד 4 קשתות יוצאות (0=מזרח 1=דרום 2=מערב 3=צפון)
  const out = new Uint8Array(W1 * (h + 1));
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) { out[y * W1 + x] |= 1; count++; }            // עליון: (x,y)→(x+1,y)
      if (!inside(x + 1, y)) { out[y * W1 + x + 1] |= 2; count++; }        // ימני: (x+1,y)→(x+1,y+1)
      if (!inside(x, y + 1)) { out[(y + 1) * W1 + x + 1] |= 4; count++; }  // תחתון: (x+1,y+1)→(x,y+1)
      if (!inside(x - 1, y)) { out[(y + 1) * W1 + x] |= 8; count++; }      // שמאלי: (x,y+1)→(x,y)
    }
  }
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const loops: P2[][] = [];
  if (!count) return loops;
  for (let v0 = 0; v0 < out.length; v0++) {
    while (out[v0]) {
      let d = out[v0] & 1 ? 0 : out[v0] & 2 ? 1 : out[v0] & 4 ? 2 : 3;
      let v = v0;
      const pts: P2[] = [];
      let guard = count + 4;
      let prevD = -1;
      for (;;) {
        out[v] &= ~(1 << d);
        const vx = v % W1, vy = (v - vx) / W1;
        if (d !== prevD) pts.push({ x: vx, y: vy });
        prevD = d;
        v = (vy + DY[d]) * W1 + vx + DX[d];
        if (v === v0 || --guard <= 0) break;
        // בקודקוד עם שתי יציאות (אוכף) פונים ימינה — פיקסלים שנוגעים באלכסון נשארים נפרדים
        const right = (d + 1) % 4, straight = d, left = (d + 3) % 4;
        if (out[v] & (1 << right)) d = right;
        else if (out[v] & (1 << straight)) d = straight;
        else if (out[v] & (1 << left)) d = left;
        else break;
      }
      // אם הלולאה נסגרה בלי פנייה בנקודת ההתחלה, הנקודה הראשונה איננה פינה (מסונן למטה)
      if (pts.length >= 3) {
        // הנקודה הראשונה עלולה להיות באמצע קו ישר — מסירים נקודות שאינן פינה
        const clean = pts.filter((p, i) => {
          const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
          return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) !== 0;
        });
        if (clean.length >= 3) loops.push(clean);
      }
    }
  }
  return loops;
}

/** לולאה סגורה → תת-נתיב בזייה: פינות חדות נשמרות, השאר מותאם בסבולת tol */
export function fitClosedLoop(loop: P2[], tol: number): SubPath | null {
  const n = loop.length;
  if (n < 3) return null;
  // אורך קשת מצטבר — לזיהוי פינות בחלון של כמה פיקסלים
  const cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + dist(loop[i % n], loop[i - 1]));
  const total = cum[n];
  const r = Math.max(2, tol * 1.6);
  const at = (i: number) => loop[((i % n) + n) % n];
  const arc = (i: number, j: number) => { // אורך מ-i קדימה עד j
    const a = cum[((i % n) + n) % n], b = cum[((j % n) + n) % n];
    return b >= a ? b - a : total - a + b;
  };
  const angle = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let j = i - 1, k = i + 1, g = 0;
    while (arc(j, i) < r && g++ < n) j--;
    g = 0;
    while (arc(i, k) < r && g++ < n) k++;
    const v1 = norm2(sub2(loop[i], at(j))), v2 = norm2(sub2(at(k), loop[i]));
    angle[i] = Math.acos(Math.max(-1, Math.min(1, dot2(v1, v2))));
  }
  const TH = (55 * Math.PI) / 180;
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    if (angle[i] < TH) continue;
    // שיא מקומי בחלון של אורך קשת r (שוויון: הראשון מנצח)
    let isMax = true;
    for (let k = 1; k < n && isMax; k++) {
      const f = (i + k) % n, b = (i - k + n) % n;
      const nearF = arc(i, f) < r, nearB = arc(b, i) < r;
      if (!nearF && !nearB) break;
      if (nearF && angle[f] > angle[i]) isMax = false;
      if (nearB && (angle[b] > angle[i] || (angle[b] === angle[i] && corners.includes(b)))) isMax = false;
    }
    if (isMax) corners.push(i);
  }
  const smoothJoin = corners.length === 0;
  if (smoothJoin) corners.push(0, Math.floor(n / 2));
  const anchors: Anchor[] = [];
  for (let c = 0; c < corners.length; c++) {
    const s = corners[c], e = corners[(c + 1) % corners.length];
    const span: P2[] = [];
    for (let i = s; ; i = (i + 1) % n) { span.push(loop[i]); if (i === e && span.length > 1) break; if (span.length > n + 1) break; }
    let t1: P2 | undefined, t2: P2 | undefined;
    if (smoothJoin) {
      t1 = norm2(sub2(at(s + 1), at(s - 1)));
      t2 = norm2(sub2(at(e - 1), at(e + 1)));
    }
    const an = beziersToAnchors(fitBeziers(span, tol, t1, t2));
    if (an.length < 2) continue;
    if (anchors.length) {
      const last = anchors[anchors.length - 1];
      last.ox = an[0].ox; last.oy = an[0].oy;
      anchors.push(...an.slice(1));
    } else anchors.push(...an);
  }
  if (anchors.length < 3) return null;
  // האחרון = הראשון: מאחדים
  const first = anchors[0], last = anchors.pop()!;
  first.ix = last.ix; first.iy = last.iy;
  for (const a of [first, ...anchors.slice(1)]) {
    if (hasIn(a) && hasOut(a)) {
      const v1 = norm2({ x: a.x - a.ix, y: a.y - a.iy }), v2 = norm2({ x: a.ox - a.x, y: a.oy - a.y });
      a.smooth = dot2(v1, v2) > 0.995;
    }
  }
  return { closed: true, pts: anchors };
}

/** מסכת אלפא → נתיב (Tolerance בפיקסלים, ברירת המחדל של פוטושופ 2.0) */
export function pathFromMask(alpha: ArrayLike<number>, w: number, h: number, tol = 2): SubPath[] {
  return traceMask(alpha, w, h).map((l) => fitClosedLoop(l, tol)).filter((s): s is SubPath => !!s);
}

/* ---------- פגיעה (קו שבור) ---------- */

/** האם נקודה בתוך הנתיב (nonzero), על בסיס קו שבור */
export function pointInSubs(subs: SubPath[], p: P2): boolean {
  let wn = 0;
  for (const s of subs) {
    const poly = flattenSub(s, 0.5);
    if (poly.length < 3) continue;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (a.y <= p.y) { if (b.y > p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0) wn++; }
      else if (b.y <= p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0) wn--;
    }
  }
  return wn !== 0;
}

/** שטח מסומן (חיובי = עם כיוון השעון במסך y-למטה) */
export function signedArea(poly: P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}

/** ולידציה לקבצים שנטענים: מחזיר תת-נתיבים תקינים בלבד */
export function sanitizeSubs(v: unknown): SubPath[] {
  if (!Array.isArray(v)) return [];
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  const out: SubPath[] = [];
  for (const s of v) {
    if (!s || !Array.isArray((s as SubPath).pts)) continue;
    const pts: Anchor[] = [];
    for (const a of (s as SubPath).pts) {
      if (!a || !num(a.x) || !num(a.y)) continue;
      pts.push({ x: a.x, y: a.y, ix: num(a.ix) ? a.ix : a.x, iy: num(a.iy) ? a.iy : a.y, ox: num(a.ox) ? a.ox : a.x, oy: num(a.oy) ? a.oy : a.y, smooth: !!a.smooth });
    }
    if (pts.length) out.push({ closed: !!(s as SubPath).closed && pts.length > 2, pts });
  }
  return out;
}
