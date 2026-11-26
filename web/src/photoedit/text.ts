/**
 * Text Engine — פריסה ורינדור של שכבות טקסט. עברית ואנגלית: הקנבס מקבל direction=rtl/ltr ומטפל ב-bidi בעצמו,
 * כך שאותיות לא מתהפכות וסימני פיסוק נשארים במקום. גלישה לפי מילים בתיבת פסקה.
 */
import type { TextLayer, TextStyle } from './model';

export interface TextLayout {
  lines: string[];
  w: number;
  h: number;
  lineH: number;
  ascent: number;
  descent: number;
  font: string;
  spacing: number;
}

const FALLBACK = '"Assistant", "Heebo", "Arial Hebrew", Arial, sans-serif';
export const fontString = (s: TextStyle, size = s.size) => `${s.italic ? 'italic ' : ''}${s.weight} ${size}px "${s.family}", ${FALLBACK}`;

let mctx: CanvasRenderingContext2D | null = null;
const measureCtx = () => (mctx ??= document.createElement('canvas').getContext('2d')!);

const cache = new Map<string, TextLayout>();
export const clearTextCache = () => cache.clear();

const pending = new Set<string>();
/** מבקש טעינת פונט; מחזיר true אם הוא כבר זמין. כשייטען — onLoad יקרא כדי לרנדר מחדש */
export function ensureFont(s: TextStyle, onLoad: () => void): boolean {
  const f = `${s.italic ? 'italic ' : ''}${s.weight} 40px "${s.family}"`;
  try {
    if (document.fonts.check(f)) return true;
  } catch {
    return true;
  }
  if (!pending.has(f)) {
    pending.add(f);
    document.fonts.load(f).then(() => { pending.delete(f); cache.clear(); onLoad(); }, () => pending.delete(f));
  }
  return false;
}

function prep(ctx: CanvasRenderingContext2D, s: TextStyle) {
  ctx.font = fontString(s);
  ctx.direction = s.dir;
  ctx.fontKerning = s.kerning ? 'normal' : 'none';
  const spacing = (s.tracking / 1000) * s.size;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${spacing}px`;
  return spacing;
}

const shown = (l: { text: string; style: TextStyle }) => (l.style.caps ? l.text.toUpperCase() : l.text);

export function layoutText(l: Pick<TextLayer, 'text' | 'style' | 'boxW'>): TextLayout {
  const key = JSON.stringify([l.text, l.style, l.boxW]);
  const hit = cache.get(key);
  if (hit) return hit;
  const ctx = measureCtx();
  const spacing = prep(ctx, l.style);
  const width = (t: string) => ctx.measureText(t).width;
  const lines: string[] = [];
  for (const para of shown(l).split('\n')) {
    if (l.boxW == null || !para) { lines.push(para); continue; }
    const words = para.split(/(\s+)/);
    let cur = '';
    for (const w of words) {
      const next = cur + w;
      if (cur && width(next.trimEnd()) > l.boxW) {
        lines.push(cur.trimEnd());
        cur = w.trimStart();
      } else cur = next;
    }
    lines.push(cur.trimEnd());
  }
  const m = ctx.measureText('אAgy');
  const ascent = m.fontBoundingBoxAscent ?? l.style.size * 0.9;
  const descent = m.fontBoundingBoxDescent ?? l.style.size * 0.25;
  const lineH = l.style.leading > 0 ? l.style.leading : l.style.size * 1.2;
  const w = l.boxW ?? Math.max(1, ...lines.map(width));
  const out: TextLayout = { lines, w: Math.max(1, Math.ceil(w)), h: Math.max(1, Math.ceil(lines.length * lineH)), lineH, ascent, descent, font: ctx.font, spacing };
  if (cache.size > 400) cache.clear();
  cache.set(key, out);
  return out;
}

/** מצייר את הטקסט במרחב המקומי של השכבה (0,0 = פינה שמאלית עליונה של התיבה) */
export function drawText(ctx: CanvasRenderingContext2D, l: TextLayer, color = l.style.color, strokeOnly?: { width: number; color: string }) {
  const L = layoutText(l);
  const s = l.style;
  ctx.save();
  prep(ctx, s);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  if (strokeOnly) {
    ctx.strokeStyle = strokeOnly.color;
    ctx.lineWidth = strokeOnly.width * 2;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
  }
  L.lines.forEach((line, i) => {
    const top = i * L.lineH;
    const baseline = top + (L.lineH - (L.ascent + L.descent)) / 2 + L.ascent;
    const last = i === L.lines.length - 1;
    if (s.align === 'justify' && l.boxW != null && !last && /\s/.test(line.trim())) {
      // יישור לשני הצדדים: פיזור הרווחים, מימין לשמאל בעברית
      const words = line.trim().split(/\s+/);
      const ww = words.map((w) => ctx.measureText(w).width);
      const gap = (L.w - ww.reduce((a, b) => a + b, 0)) / (words.length - 1);
      ctx.textAlign = 'left';
      let x = s.dir === 'rtl' ? L.w : 0;
      words.forEach((w, k) => {
        const px = s.dir === 'rtl' ? x - ww[k] : x;
        if (strokeOnly) ctx.strokeText(w, px, baseline);
        else ctx.fillText(w, px, baseline);
        x = s.dir === 'rtl' ? px - gap : px + ww[k] + gap;
      });
    } else {
      const align = s.align === 'justify' ? (s.dir === 'rtl' ? 'right' : 'left') : s.align;
      ctx.textAlign = align;
      const x = align === 'right' ? L.w : align === 'center' ? L.w / 2 : 0;
      if (strokeOnly) ctx.strokeText(line, x, baseline);
      else ctx.fillText(line, x, baseline);
      if (s.underline && !strokeOnly) {
        const lw = ctx.measureText(line).width;
        const x0 = align === 'right' ? x - lw : align === 'center' ? x - lw / 2 : x;
        ctx.fillRect(x0, baseline + s.size * 0.08, lw, Math.max(1, s.size * 0.05));
      }
    }
  });
  ctx.restore();
}
