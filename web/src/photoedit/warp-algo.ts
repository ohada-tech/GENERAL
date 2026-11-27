/**
 * מתמטיקה טהורה לטרנספורמים מתקדמים (בלי DOM — נבדק ב-tsx):
 * הומוגרפיה (Distort/Perspective), משטח בזייה 4×4 (Warp) וה-Presets שלו, MLS קשיח (Puppet Warp),
 * מיפוי משולש אפיני (רינדור דרך רשת), ושדה הזזה של Liquify עם כל המברשות שלו.
 */

export interface P2 { x: number; y: number }

/* ======================= הומוגרפיה ======================= */

/** מטריצה 3×3 בשורות: [a b c; d e f; g h i] */
export type H3 = number[];

/** הומוגרפיה מריבוע היחידה (0,0)(1,0)(1,1)(0,1) אל ארבע הפינות q0..q3 (Heckbert) */
export function squareToQuad(q: P2[]): H3 {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(dx3) > 1e-12 || Math.abs(dy3) > 1e-12) {
    if (Math.abs(den) > 1e-14) {
      g = (dx3 * dy2 - dx2 * dy3) / den;
      h = (dx1 * dy3 - dx3 * dy1) / den;
    }
  }
  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h, 1,
  ];
}

export function applyH(m: H3, x: number, y: number): P2 {
  const w = m[6] * x + m[7] * y + m[8];
  const k = Math.abs(w) < 1e-12 ? 1e12 : 1 / w;
  return { x: (m[0] * x + m[1] * y + m[2]) * k, y: (m[3] * x + m[4] * y + m[5]) * k };
}

export function invert3(m: H3): H3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) return null;
  const k = 1 / det;
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ];
}

export const UNIT_QUAD: P2[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

export const isIdentityQuad = (q: P2[] | null | undefined) => !q || q.every((p, i) => Math.abs(p.x - UNIT_QUAD[i].x) < 1e-6 && Math.abs(p.y - UNIT_QUAD[i].y) < 1e-6);

/** האם הארבעון קמור ולא מנוון (פוטושופ מסרב לפינה שחוצה את הצלע הנגדית) */
export function quadOk(q: P2[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < 1e-9) return false;
    const s = Math.sign(cr);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/* ======================= משולש אפיני ======================= */

/** מטריצה אפינית [a b c d e f] (כמו setTransform) שממפה את משולש המקור למשולש היעד */
export function triAffine(s0: P2, s1: P2, s2: P2, d0: P2, d1: P2, d2: P2): [number, number, number, number, number, number] | null {
  const ux = s1.x - s0.x, uy = s1.y - s0.y, vx = s2.x - s0.x, vy = s2.y - s0.y;
  const det = ux * vy - vx * uy;
  if (Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  const px = d1.x - d0.x, py = d1.y - d0.y, qx = d2.x - d0.x, qy = d2.y - d0.y;
  // M * u = p, M * v = q  →  M = [p q] [u v]^-1
  const a = (px * vy - qx * uy) * k, c = (qx * ux - px * vx) * k;
  const b = (py * vy - qy * uy) * k, d = (qy * ux - py * vx) * k;
  return [a, b, c, d, d0.x - a * s0.x - c * s0.y, d0.y - b * s0.x - d * s0.y];
}

/** מנפח משולש סביב מרכז הכובד ב-px יחידות — מעלים את התפרים בין משולשים סמוכים */
export function inflateTri(p: P2[], px: number): P2[] {
  const cx = (p[0].x + p[1].x + p[2].x) / 3, cy = (p[0].y + p[1].y + p[2].y) / 3;
  return p.map((q) => {
    const dx = q.x - cx, dy = q.y - cy, L = Math.hypot(dx, dy) || 1;
    return { x: q.x + (dx / L) * px, y: q.y + (dy / L) * px };
  });
}

/* ======================= Warp: משטח בזייה 4×4 ======================= */

export const bern = (t: number): [number, number, number, number] => {
  const s = 1 - t;
  return [s * s * s, 3 * t * s * s, 3 * t * t * s, t * t * t];
};

/** נקודה על המשטח. pts: 16 נקודות בשורות (j = שורה לפי v, i = עמודה לפי u) */
export function bezierPatch(pts: P2[], u: number, v: number): P2 {
  const bu = bern(u), bv = bern(v);
  let x = 0, y = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const w = bu[i] * bv[j], p = pts[j * 4 + i];
    x += w * p.x; y += w * p.y;
  }
  return { x, y };
}

export const identityWarp = (): P2[] => {
  const out: P2[] = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) out.push({ x: i / 3, y: j / 3 });
  return out;
};

export const isIdentityWarp = (pts: P2[] | null | undefined) => !pts || identityWarp().every((p, k) => Math.abs(p.x - pts[k].x) < 1e-6 && Math.abs(p.y - pts[k].y) < 1e-6);

function inv4(m: number[][]): number[][] {
  const n = 4, a = m.map((r, i) => [...r, ...[0, 1, 2, 3].map((k) => (k === i ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let k = 0; k < 2 * n; k++) a[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = a[r][c]; for (let k = 0; k < 2 * n; k++) a[r][k] -= f * a[c][k]; }
  }
  return a.map((r) => r.slice(n));
}
const MINV = inv4([0, 1, 2, 3].map((k) => bern(k / 3)));

/** נקודות בקרה שהמשטח עובר בדיוק דרך f בנקודות (k/3, l/3) — כך ה-Preset נראה בדיוק כמו הנוסחה שלו */
export function fitPatch(f: (u: number, v: number) => P2): P2[] {
  const F = [0, 1, 2, 3].map((l) => [0, 1, 2, 3].map((k) => f(k / 3, l / 3)));
  const out: P2[] = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    let x = 0, y = 0;
    for (let l = 0; l < 4; l++) for (let k = 0; k < 4; k++) { const w = MINV[j][l] * MINV[i][k]; x += w * F[l][k].x; y += w * F[l][k].y; }
    out.push({ x, y });
  }
  return out;
}

export type WarpPreset = 'none' | 'custom' | 'arc' | 'arch' | 'bulge' | 'flag' | 'wave' | 'fish' | 'rise' | 'fisheye' | 'inflate' | 'squeeze' | 'twist';

export const WARP_PRESETS: Array<[WarpPreset, string, string]> = [
  ['none', 'None', 'ללא'], ['custom', 'Custom', 'מותאם'],
  ['arc', 'Arc', 'קשת'], ['arch', 'Arch', 'קמרון'], ['bulge', 'Bulge', 'בליטה'], ['flag', 'Flag', 'דגל'], ['wave', 'Wave', 'גל'],
  ['fish', 'Fish', 'דג'], ['rise', 'Rise', 'עלייה'], ['fisheye', 'Fisheye', 'עין דג'], ['inflate', 'Inflate', 'ניפוח'],
  ['squeeze', 'Squeeze', 'כיווץ'], ['twist', 'Twist', 'סיבוב'],
];

export interface WarpParams { preset: WarpPreset; bend: number; h: number; v: number; vertical: boolean }

/** פונקציית ה-Preset במרחב המנורמל (0..1). bend/h/v באחוזים -100..100 */
export function presetFn(p: WarpParams): (u: number, v: number) => P2 {
  const b = p.bend / 100, hd = p.h / 100, vd = p.v / 100;
  const shape = (u: number, v: number): P2 => {
    const s = 2 * u - 1, t = 2 * v - 1, r2 = s * s + t * t;
    let x = u, y = v;
    switch (p.preset) {
      case 'arc': {
        // מגזר טבעת: השורה האמצעית נשארת ברוחב המקורי, העליונה ארוכה יותר והתחתונה קצרה (b<0 = הפוך)
        const ab = Math.abs(b);
        if (ab < 1e-3) break;
        const th = ab * (Math.PI / 3), R = 0.5 / Math.sin(th), vv = b > 0 ? v : 1 - v;
        const ang = th * s, rad = R + (0.5 - vv);
        const yy = 0.5 + R - Math.cos(ang) * rad;
        x = 0.5 + Math.sin(ang) * rad;
        y = b > 0 ? yy : 1 - yy;
        break;
      }
      case 'arch': y = v - b * 0.32 * (1 - s * s); break;
      case 'bulge': y = v + b * 0.22 * (1 - s * s) * t; break;
      case 'flag': y = v - b * 0.13 * Math.sin(Math.PI * 2 * u); break;
      case 'wave': y = v - b * 0.13 * Math.sin(Math.PI * 2 * u + v * Math.PI * 0.6); break;
      case 'fish': y = v + b * 0.22 * t * Math.sin(Math.PI * Math.min(1, u * 1.15)) - b * 0.1 * t * u * u; break;
      case 'rise': y = v - b * 0.2 * Math.sin(Math.PI * (u - 0.5)); break;
      case 'fisheye': {
        if (r2 < 1) { const k = 1 + b * 0.45 * (1 - r2); x = 0.5 + (s * k) / 2; y = 0.5 + (t * k) / 2; }
        break;
      }
      case 'inflate': { const k = 1 + b * 0.32 * (1 - r2 / 2); x = 0.5 + (s * k) / 2; y = 0.5 + (t * k) / 2; break; }
      case 'squeeze': x = u - b * 0.22 * s * (1 - t * t); y = v + b * 0.1 * t * (1 - s * s); break;
      case 'twist': {
        const a = b * (Math.PI / 2) * Math.max(0, 1 - Math.sqrt(r2) / Math.SQRT2);
        const c = Math.cos(a), sn = Math.sin(a);
        x = 0.5 + (s * c - t * sn) / 2; y = 0.5 + (s * sn + t * c) / 2;
        break;
      }
      default: break;
    }
    // Horizontal / Vertical Distortion: הטיית פרספקטיבה מעל הצורה
    if (hd) y = 0.5 + (y - 0.5) * (1 + hd * (x - 0.5) * 1.2);
    if (vd) x = 0.5 + (x - 0.5) * (1 + vd * (y - 0.5) * 1.2);
    return { x, y };
  };
  if (!p.vertical) return shape;
  // כיוון אנכי: מחליפים תפקידים בין הצירים
  return (u, v) => { const q = shape(v, u); return { x: q.y, y: q.x }; };
}

export function presetPoints(p: WarpParams): P2[] {
  if (p.preset === 'none' || p.preset === 'custom') return identityWarp();
  return fitPatch(presetFn(p));
}

/** גרירת נקודה בתוך המשטח (u0,v0) ב-delta: פתרון מינימום-נורמה על משקלי ברנשטיין, כמו גרירת רשת בפוטושופ */
export function dragPatch(pts0: P2[], u0: number, v0: number, dx: number, dy: number): P2[] {
  const bu = bern(u0), bv = bern(v0);
  let s2 = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) s2 += (bu[i] * bv[j]) ** 2;
  return pts0.map((p, k) => {
    const w = (bu[k % 4] * bv[Math.floor(k / 4)]) / (s2 || 1);
    return { x: p.x + w * dx, y: p.y + w * dy };
  });
}

/* ======================= Puppet Warp: MLS קשיח ======================= */

/** Moving Least Squares, דפורמציה קשיחה (Schaefer 2006). p = נעצים מקוריים, q = מיקומים חדשים */
export function mlsRigid(v: P2, p: P2[], q: P2[]): P2 {
  const n = p.length;
  if (!n) return v;
  if (n === 1) return { x: v.x + q[0].x - p[0].x, y: v.y + q[0].y - p[0].y };
  let sw = 0, psx = 0, psy = 0, qsx = 0, qsy = 0;
  const w = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const d2 = (p[i].x - v.x) ** 2 + (p[i].y - v.y) ** 2;
    if (d2 < 1e-8) return { x: q[i].x, y: q[i].y };
    w[i] = 1 / d2;
    sw += w[i]; psx += w[i] * p[i].x; psy += w[i] * p[i].y; qsx += w[i] * q[i].x; qsy += w[i] * q[i].y;
  }
  psx /= sw; psy /= sw; qsx /= sw; qsy /= sw;
  const dx = v.x - psx, dy = v.y - psy;
  let fx = 0, fy = 0;
  for (let i = 0; i < n; i++) {
    const px = p[i].x - psx, py = p[i].y - psy, qx = q[i].x - qsx, qy = q[i].y - qsy;
    const s = qx * px + qy * py, t = qx * py - qy * px;
    fx += w[i] * (s * dx + t * dy);
    fy += w[i] * (s * dy - t * dx);
  }
  const L = Math.hypot(fx, fy), D = Math.hypot(dx, dy);
  if (L < 1e-12) return { x: dx + qsx, y: dy + qsy };
  return { x: (D * fx) / L + qsx, y: (D * fy) / L + qsy };
}

/**
 * רשת משולשים לבובה: נקודות בריווח step על פני האזור, ומשולשים רק איפה שיש תוכן (אחרי Expansion).
 * covered(x, y) = האם יש תוכן בתא. מחזיר נקודות (בפיקסלים של השכבה) ואינדקסים של משולשים.
 */
export function puppetMesh(w: number, h: number, step: number, covered: (x0: number, y0: number, x1: number, y1: number) => boolean): { pts: P2[]; tris: number[] } {
  const nx = Math.max(1, Math.ceil(w / step)), ny = Math.max(1, Math.ceil(h / step));
  const idx = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
  const pts: P2[] = [];
  const tris: number[] = [];
  const vid = (i: number, j: number) => {
    const k = j * (nx + 1) + i;
    if (idx[k] < 0) { idx[k] = pts.length; pts.push({ x: Math.min(w, i * step), y: Math.min(h, j * step) }); }
    return idx[k];
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!covered(i * step, j * step, Math.min(w, (i + 1) * step), Math.min(h, (j + 1) * step))) continue;
    const a = vid(i, j), b = vid(i + 1, j), c = vid(i + 1, j + 1), d = vid(i, j + 1);
    // אלכסון לסירוגין — רשת סימטרית יותר
    if ((i + j) % 2) tris.push(a, b, c, a, c, d); else tris.push(a, b, d, b, c, d);
  }
  return { pts, tris };
}

/* ======================= Liquify: שדה הזזה ======================= */

/**
 * שדה הזזה אחורי: הפיקסל ב-x מקבל את צבע המקור ב-x + d(x). השדה ברזולוציה מוקטנת (step) ומוגדל
 * באינטרפולציה ביליניארית. כל מברשת = advection חצי-לגרנז'י: d'(x) = (y - x) + d(y) כש-y = מיפוי אחורי.
 */
export class LiqField {
  readonly fw: number; readonly fh: number;
  dx: Float32Array; dy: Float32Array; freeze: Float32Array;
  private tx: Float32Array; private ty: Float32Array;
  constructor(readonly w: number, readonly h: number, readonly step: number) {
    this.fw = Math.ceil(w / step) + 1;
    this.fh = Math.ceil(h / step) + 1;
    const n = this.fw * this.fh;
    this.dx = new Float32Array(n); this.dy = new Float32Array(n); this.freeze = new Float32Array(n);
    this.tx = new Float32Array(n); this.ty = new Float32Array(n);
  }

  /** הזזה בנקודה (בפיקסלים של התמונה) */
  sample(x: number, y: number, out: P2) {
    const s = this.step, fx = Math.max(0, Math.min(this.fw - 1.001, x / s)), fy = Math.max(0, Math.min(this.fh - 1.001, y / s));
    const i = fx | 0, j = fy | 0, ax = fx - i, ay = fy - j, k = j * this.fw + i, W = this.fw;
    const D = this.dx, E = this.dy;
    out.x = (D[k] * (1 - ax) + D[k + 1] * ax) * (1 - ay) + (D[k + W] * (1 - ax) + D[k + W + 1] * ax) * ay;
    out.y = (E[k] * (1 - ax) + E[k + 1] * ax) * (1 - ay) + (E[k + W] * (1 - ax) + E[k + W + 1] * ax) * ay;
    return out;
  }

  private sampleT(x: number, y: number, out: P2) {
    const s = this.step, fx = Math.max(0, Math.min(this.fw - 1.001, x / s)), fy = Math.max(0, Math.min(this.fh - 1.001, y / s));
    const i = fx | 0, j = fy | 0, ax = fx - i, ay = fy - j, k = j * this.fw + i, W = this.fw;
    const D = this.tx, E = this.ty;
    out.x = (D[k] * (1 - ax) + D[k + 1] * ax) * (1 - ay) + (D[k + W] * (1 - ax) + D[k + W + 1] * ax) * ay;
    out.y = (E[k] * (1 - ax) + E[k + 1] * ax) * (1 - ay) + (E[k + W] * (1 - ax) + E[k + W + 1] * ax) * ay;
  }

  /** תחום התאים שבתוך העיגול, והעתקה של השדה הישן (עם שוליים) לפני advection */
  private region(cx: number, cy: number, R: number, margin: number) {
    const s = this.step;
    const i0 = Math.max(0, Math.floor((cx - R - margin) / s)), i1 = Math.min(this.fw - 1, Math.ceil((cx + R + margin) / s));
    const j0 = Math.max(0, Math.floor((cy - R - margin) / s)), j1 = Math.min(this.fh - 1, Math.ceil((cy + R + margin) / s));
    for (let j = j0; j <= j1; j++) {
      const a = j * this.fw + i0, b = j * this.fw + i1 + 1;
      this.tx.set(this.dx.subarray(a, b), a);
      this.ty.set(this.dy.subarray(a, b), a);
    }
    return { i0, i1, j0, j1 };
  }

  /** advection כללי: back(x, y, w) מחזיר את נקודת המקור y למשקל w (0..1) */
  advect(cx: number, cy: number, R: number, margin: number, weight: (r: number) => number, back: (x: number, y: number, w: number, o: P2) => void) {
    const { i0, i1, j0, j1 } = this.region(cx, cy, R, margin);
    const s = this.step, o: P2 = { x: 0, y: 0 }, t: P2 = { x: 0, y: 0 };
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i * s, y = j * s, r = Math.hypot(x - cx, y - cy) / R;
      if (r >= 1) continue;
      const k = j * this.fw + i;
      const w = weight(r) * (1 - this.freeze[k]);
      if (w <= 1e-4) continue;
      back(x, y, w, o);
      this.sampleT(o.x, o.y, t);
      this.dx[k] = o.x - x + t.x;
      this.dy[k] = o.y - y + t.y;
    }
  }

  /** Forward Warp / Push Left: התוכן נגרר ב-(mx,my) */
  push(cx: number, cy: number, R: number, mx: number, my: number, weight: (r: number) => number) {
    this.advect(cx, cy, R, Math.hypot(mx, my) + 2 * this.step, weight, (x, y, w, o) => { o.x = x - w * mx; o.y = y - w * my; });
  }

  /** Twirl: סיבוב בזווית a (רדיאנים, חיובי = עם השעון במסך) */
  twirl(cx: number, cy: number, R: number, a: number, weight: (r: number) => number) {
    this.advect(cx, cy, R, 2 * this.step, weight, (x, y, w, o) => {
      const c = Math.cos(-a * w), sn = Math.sin(-a * w), vx = x - cx, vy = y - cy;
      o.x = cx + vx * c - vy * sn; o.y = cy + vx * sn + vy * c;
    });
  }

  /** Pucker (k>0, התוכן מתכווץ למרכז) / Bloat (k<0, מתנפח) */
  scale(cx: number, cy: number, R: number, k: number, weight: (r: number) => number) {
    this.advect(cx, cy, R, R * Math.abs(k) + 2 * this.step, weight, (x, y, w, o) => {
      const f = 1 + k * w;
      o.x = cx + (x - cx) * f; o.y = cy + (y - cy) * f;
    });
  }

  /** Reconstruct: מחזיר בהדרגה למקור */
  reconstruct(cx: number, cy: number, R: number, rate: number, weight: (r: number) => number) {
    this.each(cx, cy, R, (k, r) => { const f = 1 - Math.min(1, rate * weight(r) * (1 - this.freeze[k])); this.dx[k] *= f; this.dy[k] *= f; });
  }

  /** Smooth: ממצע את ההזזה עם השכנים */
  smooth(cx: number, cy: number, R: number, rate: number, weight: (r: number) => number) {
    const { i0, i1, j0, j1 } = this.region(cx, cy, R, this.step);
    const W = this.fw;
    this.each(cx, cy, R, (k, r) => {
      const i = k % W, j = (k / W) | 0;
      if (i <= i0 || i >= i1 || j <= j0 || j >= j1) return;
      const ax = (this.tx[k - 1] + this.tx[k + 1] + this.tx[k - W] + this.tx[k + W]) / 4;
      const ay = (this.ty[k - 1] + this.ty[k + 1] + this.ty[k - W] + this.ty[k + W]) / 4;
      const f = Math.min(1, rate * weight(r) * (1 - this.freeze[k]));
      this.dx[k] += (ax - this.dx[k]) * f;
      this.dy[k] += (ay - this.dy[k]) * f;
    });
  }

  /** Freeze (v=1) / Thaw (v=0) */
  paintFreeze(cx: number, cy: number, R: number, v: number, strength: number, weight: (r: number) => number) {
    this.each(cx, cy, R, (k, r) => { const w = Math.min(1, weight(r) * strength); this.freeze[k] += (v - this.freeze[k]) * w; });
  }

  private each(cx: number, cy: number, R: number, fn: (k: number, r: number) => void) {
    const s = this.step;
    const i0 = Math.max(0, Math.floor((cx - R) / s)), i1 = Math.min(this.fw - 1, Math.ceil((cx + R) / s));
    const j0 = Math.max(0, Math.floor((cy - R) / s)), j1 = Math.min(this.fh - 1, Math.ceil((cy + R) / s));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const r = Math.hypot(i * s - cx, j * s - cy) / R;
      if (r < 1) fn(j * this.fw + i, r);
    }
  }

  /** Reconstruct All (amount 0..1, מכבד הקפאה) */
  reconstructAll(amount: number) {
    for (let k = 0; k < this.dx.length; k++) { const f = 1 - amount * (1 - this.freeze[k]); this.dx[k] *= f; this.dy[k] *= f; }
  }
  /** Restore All: מאפס הכול, גם אזורים קפואים */
  restoreAll() { this.dx.fill(0); this.dy.fill(0); }
  clearFreeze() { this.freeze.fill(0); }
  isZero() { for (let k = 0; k < this.dx.length; k++) if (Math.abs(this.dx[k]) > 0.01 || Math.abs(this.dy[k]) > 0.01) return false; return true; }
  snapshot() { return { dx: this.dx.slice(), dy: this.dy.slice(), freeze: this.freeze.slice() }; }
  restore(s: { dx: Float32Array; dy: Float32Array; freeze: Float32Array }) { this.dx.set(s.dx); this.dy.set(s.dy); this.freeze.set(s.freeze); }
}

/** עוצמת המברשת לפי מרחק יחסי r (0..1). density 0..100 = כמה הקצה קשה */
export function liqFalloff(density: number): (r: number) => number {
  const core = Math.max(0, Math.min(0.9, (density / 100) * 0.8));
  return (r) => (r <= core ? 1 : 0.5 * (1 + Math.cos((Math.PI * (r - core)) / (1 - core))));
}

/** דגימה ביליניארית של RGBA (מוכפל אלפא כדי שלא יהיו שוליים כהים) לתוך out[o..o+3] */
function sampleRGBA(src: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: Uint8ClampedArray, o: number) {
  x -= 0.5; y -= 0.5;
  const i = Math.floor(x), j = Math.floor(y), ax = x - i, ay = y - j;
  let r = 0, g = 0, b = 0, a = 0;
  for (let q = 0; q < 4; q++) {
    const xi = i + (q & 1), yj = j + (q >> 1);
    if (xi < 0 || yj < 0 || xi >= w || yj >= h) continue;
    const wt = ((q & 1) ? ax : 1 - ax) * ((q >> 1) ? ay : 1 - ay);
    const k = (yj * w + xi) * 4, al = src[k + 3] * wt;
    r += src[k] * al; g += src[k + 1] * al; b += src[k + 2] * al; a += al;
  }
  if (a <= 0.001) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; return; }
  out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = a;
}

/** החלה מלאה ברזולוציה של המקור */
export function applyField(src: Uint8ClampedArray, w: number, h: number, f: LiqField, out: Uint8ClampedArray) {
  const d: P2 = { x: 0, y: 0 };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    f.sample(x + 0.5, y + 0.5, d);
    const o = (y * w + x) * 4;
    if (d.x === 0 && d.y === 0) { out[o] = src[o]; out[o + 1] = src[o + 1]; out[o + 2] = src[o + 2]; out[o + 3] = src[o + 3]; continue; }
    sampleRGBA(src, w, h, x + 0.5 + d.x, y + 0.5 + d.y, out, o);
  }
}

/**
 * תצוגה מקדימה בגודל החלון: פיקסל מסך (px,py) → תמונה (ox + px*k, oy + py*k). מצייר רקע שחמט, המקור המעוות
 * (דגימת שכן קרוב — מהיר), גוון אדום לאזור קפוא ורשת אופציונלית. מעדכן רק את המלבן [x0,x1)×[y0,y1) במסך.
 */
export function renderLiqView(src: Uint8ClampedArray, w: number, h: number, f: LiqField, out: Uint8ClampedArray, ow: number, oh: number, ox: number, oy: number, k: number, showMask: boolean, mesh: number, x0 = 0, y0 = 0, x1 = ow, y1 = oh) {
  const s = f.step, fw = f.fw, fh = f.fh, D = f.dx, E = f.dy, Z = f.freeze;
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(ow, Math.ceil(x1)); y1 = Math.min(oh, Math.ceil(y1));
  const lim = k * 0.9;
  for (let py = y0; py < y1; py++) {
    const iy = oy + (py + 0.5) * k;
    const fy = Math.max(0, Math.min(fh - 1.001, iy / s)), j = fy | 0, ay = fy - j;
    for (let qx = x0; qx < x1; qx++) {
      const ix = ox + (qx + 0.5) * k, o = (py * ow + qx) * 4;
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) { out[o] = out[o + 1] = out[o + 2] = 28; out[o + 3] = 255; continue; }
      const fx = Math.max(0, Math.min(fw - 1.001, ix / s)), i = fx | 0, ax = fx - i, c = j * fw + i;
      const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
      const dx = D[c] * w00 + D[c + 1] * w10 + D[c + fw] * w01 + D[c + fw + 1] * w11;
      const dy = E[c] * w00 + E[c + 1] * w10 + E[c + fw] * w01 + E[c + fw + 1] * w11;
      const sx = ix + dx, sy = iy + dy, chk = (((qx >> 3) + (py >> 3)) & 1) ? 204 : 255;
      let r = chk, g = chk, b = chk;
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) {
        const q = ((sy | 0) * w + (sx | 0)) * 4, a = src[q + 3] / 255;
        r = src[q] * a + chk * (1 - a); g = src[q + 1] * a + chk * (1 - a); b = src[q + 2] * a + chk * (1 - a);
      }
      if (showMask) {
        const fz = Z[c];
        if (fz > 0.01) { const m = fz * 0.5; r = r * (1 - m) + 255 * m; g *= 1 - m; b *= 1 - m; }
      }
      if (mesh > 0) {
        const ex = ((sx % mesh) + mesh) % mesh, ey = ((sy % mesh) + mesh) % mesh;
        if (ex < lim || ey < lim) { r = r * 0.5 + 40; g = g * 0.5 + 90; b = b * 0.5 + 127; }
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
}
