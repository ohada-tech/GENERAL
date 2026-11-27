/**
 * Custom Shape — ספריית צורות וקטוריות מובנות (כמו Custom Shape Picker בפוטושופ). כל צורה מוגדרת בתיבה משלה
 * (SVG d מוחלט: M L C Z, או מחוללת) ונמתחת למלבן שנגרר. חורים נכתבים בכיוון הפוך — כלל nonzero.
 */
import type { Anchor, SubPath } from './paths';
import { anchor, mapSubs, reverseSub } from './paths';

export interface CustomShapeDef { id: string; name: string; en: string; w: number; h: number; subs: () => SubPath[] }

/** מנתח SVG d מינימלי (פקודות מוחלטות M/L/C/Z) לתתי-נתיבים */
export function parseD(d: string): SubPath[] {
  const tok = d.match(/[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const out: SubPath[] = [];
  let cur: SubPath | null = null;
  let i = 0, cmd = '';
  const num = () => Number(tok[i++]);
  while (i < tok.length) {
    if (/^[MLCZ]$/i.test(tok[i])) cmd = tok[i++].toUpperCase();
    if (cmd === 'M') { cur = { closed: false, pts: [anchor(num(), num())] }; out.push(cur); cmd = 'L'; }
    else if (cmd === 'L' && cur) cur.pts.push(anchor(num(), num()));
    else if (cmd === 'C' && cur) {
      const c1x = num(), c1y = num(), c2x = num(), c2y = num(), x = num(), y = num();
      const prev = cur.pts[cur.pts.length - 1];
      prev.ox = c1x; prev.oy = c1y;
      const a = anchor(x, y);
      a.ix = c2x; a.iy = c2y;
      cur.pts.push(a);
    } else if (cmd === 'Z' && cur) {
      // נקודה אחרונה שחוזרת לראשונה מתאחדת איתה
      const f = cur.pts[0], l = cur.pts[cur.pts.length - 1];
      if (cur.pts.length > 1 && Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) { f.ix = l.ix; f.iy = l.iy; cur.pts.pop(); }
      cur.closed = true;
      cmd = '';
    } else i++;
  }
  for (const s of out) for (const a of s.pts) {
    const hi = a.ix !== a.x || a.iy !== a.y, ho = a.ox !== a.x || a.oy !== a.y;
    if (hi && ho) {
      const v1 = Math.atan2(a.y - a.iy, a.x - a.ix), v2 = Math.atan2(a.oy - a.y, a.ox - a.x);
      a.smooth = Math.abs(Math.atan2(Math.sin(v1 - v2), Math.cos(v1 - v2))) < 0.02;
    }
  }
  return out;
}

const K = 0.5522847498;

/** עיגול/אליפסה בארבעה עוגנים, עם כיוון השעון */
export function ellipseSub(cx: number, cy: number, rx: number, ry: number): SubPath {
  const p = (x: number, y: number, ix: number, iy: number, ox: number, oy: number): Anchor => ({ x, y, ix, iy, ox, oy, smooth: true });
  return {
    closed: true,
    pts: [
      p(cx, cy - ry, cx - rx * K, cy - ry, cx + rx * K, cy - ry),
      p(cx + rx, cy, cx + rx, cy - ry * K, cx + rx, cy + ry * K),
      p(cx, cy + ry, cx + rx * K, cy + ry, cx - rx * K, cy + ry),
      p(cx - rx, cy, cx - rx, cy + ry * K, cx - rx, cy - ry * K),
    ],
  };
}

function starSub(cx: number, cy: number, n: number, ro: number, ri: number, rot = -Math.PI / 2): SubPath {
  const pts: Anchor[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n, r = i % 2 ? ri : ro;
    pts.push(anchor(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return { closed: true, pts };
}

export const CUSTOM_SHAPES: CustomShapeDef[] = [
  { id: 'heart', name: 'לב', en: 'Heart', w: 100, h: 90, subs: () => parseD('M50 90 C20 70 0 50 0 28 C0 11 13 0 28 0 C39 0 46 6 50 14 C54 6 61 0 72 0 C87 0 100 11 100 28 C100 50 80 70 50 90 Z') },
  { id: 'arrow', name: 'חץ', en: 'Arrow', w: 100, h: 80, subs: () => parseD('M0 25 L58 25 L58 0 L100 40 L58 80 L58 55 L0 55 Z') },
  { id: 'arrow2', name: 'חץ דו-כיווני', en: 'Double Arrow', w: 100, h: 60, subs: () => parseD('M0 30 L25 0 L25 18 L75 18 L75 0 L100 30 L75 60 L75 42 L25 42 L25 60 Z') },
  { id: 'chevron', name: 'שברון', en: 'Chevron', w: 70, h: 100, subs: () => parseD('M0 0 L30 0 L70 50 L30 100 L0 100 L40 50 Z') },
  { id: 'bubble', name: 'בועת דיבור', en: 'Speech Bubble', w: 100, h: 100, subs: () => parseD('M15 0 L85 0 C93 0 100 7 100 15 L100 60 C100 68 93 75 85 75 L45 75 L22 100 L26 75 L15 75 C7 75 0 68 0 60 L0 15 C0 7 7 0 15 0 Z') },
  { id: 'check', name: 'וי', en: 'Checkmark', w: 100, h: 78, subs: () => parseD('M0 42 L14 28 L36 50 L86 0 L100 14 L36 78 Z') },
  { id: 'cross', name: 'פלוס', en: 'Cross', w: 100, h: 100, subs: () => parseD('M35 0 L65 0 L65 35 L100 35 L100 65 L65 65 L65 100 L35 100 L35 65 L0 65 L0 35 L35 35 Z') },
  { id: 'burst', name: 'מדבקת מבצע', en: 'Starburst Badge', w: 100, h: 100, subs: () => [starSub(50, 50, 16, 50, 41)] },
  { id: 'ring', name: 'טבעת', en: 'Ring Badge', w: 100, h: 100, subs: () => [ellipseSub(50, 50, 50, 50), reverseSub(ellipseSub(50, 50, 34, 34))] },
  { id: 'bolt', name: 'ברק', en: 'Lightning', w: 80, h: 100, subs: () => parseD('M50 0 L0 58 L35 58 L25 100 L80 38 L45 38 L60 0 Z') },
  { id: 'drop', name: 'טיפה', en: 'Drop', w: 80, h: 100, subs: () => parseD('M40 0 C40 0 80 45 80 65 C80 87 62 100 40 100 C18 100 0 87 0 65 C0 45 40 0 40 0 Z') },
  { id: 'ribbon', name: 'סרט', en: 'Ribbon Banner', w: 100, h: 60, subs: () => parseD('M0 0 L100 0 L85 30 L100 60 L0 60 L15 30 Z') },
  { id: 'house', name: 'בית', en: 'Home', w: 100, h: 90, subs: () => parseD('M50 0 L100 45 L85 45 L85 90 L15 90 L15 45 L0 45 Z') },
  { id: 'star5', name: 'כוכב', en: 'Star', w: 95.106, h: 90.451, subs: () => [starSub(47.553, 50, 5, 50, 20)] },
];

export const customShape = (id: string) => CUSTOM_SHAPES.find((s) => s.id === id) ?? CUSTOM_SHAPES[0];

/** הצורה מתוחה לתיבה w×h (מרחב מקומי 0..w × 0..h) */
export function customShapeSubs(id: string, w: number, h: number): SubPath[] {
  const def = customShape(id);
  return mapSubs(def.subs(), { a: w / def.w, b: 0, c: 0, d: h / def.h, e: 0, f: 0 });
}
