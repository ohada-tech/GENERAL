/**
 * פאנל Info — כמו בפוטושופ: צבע (RGB/HEX) מתחת לסמן ובכל נקודת Color Sampler, מידות המסמך והבחירה,
 * מדידת הסרגל, ושינויים בזמן טרנספורם. הסמן מתעדכן בדגימה קלה (בלי רינדור מחדש של המסמך).
 */
import { useEffect, useReducer } from 'react';
import type { Editor } from '../editor';
import { findLayer, isXf, rgbToHex, type Pt } from '../model';
import { localBox } from '../render';
import { selBounds } from '../selection';
import { compPixel } from '../paint-engine';
import { rulerMeasure, samplersOf, samplerValues } from '../tools-measure';
import { useEditor } from './widgets';

type Px = [number, number, number, number] | null;

function ColorRow({ title, p, px, onRemove }: { title: string; p: Pt | null; px: Px; onRemove?: () => void }) {
  const hex = px ? rgbToHex(px[0], px[1], px[2]) : null;
  return (
    <div className="pe-info-row">
      <span className="pe-info-sw" style={{ background: hex && px![3] > 0 ? hex : 'transparent' }} />
      <b>{title}</b>
      <span dir="ltr" className="pe-info-val">
        {px ? <>R {px[0]} · G {px[1]} · B {px[2]}{px[3] < 255 ? ` · A ${Math.round((px[3] / 255) * 100)}%` : ''}</> : '—'}
      </span>
      <span dir="ltr" className="pe-info-hex">{hex && px![3] > 0 ? hex.toUpperCase() : ''}</span>
      {p && <span dir="ltr" className="pe-info-xy">{Math.floor(p.x)}, {Math.floor(p.y)}</span>}
      {onRemove && <button type="button" className="pe-info-x" title="מחיקת הנקודה" aria-label="מחיקת הנקודה" onClick={onRemove}>×</button>}
    </div>
  );
}

/** שינויים בטרנספורם: השכבה הפעילה מול מצבה בתחילת Free Transform */
function transformDelta(ed: Editor): string | null {
  const ft = ed.live.freeTransform, a = ed.active;
  if (!ft || !a || !isXf(a)) return null;
  const f = findLayer(ft.snapshot, a.id);
  if (!f || !isXf(f.layer)) return null;
  const t0 = f.layer.t, t = a.t;
  const b0 = localBox(f.layer), b = localBox(a);
  const w = (Math.abs(t.sx) * b.w) / Math.max(1e-6, Math.abs(t0.sx) * b0.w), h = (Math.abs(t.sy) * b.h) / Math.max(1e-6, Math.abs(t0.sy) * b0.h);
  return `ΔX ${(t.x - t0.x).toFixed(1)} · ΔY ${(t.y - t0.y).toFixed(1)} · W ${(w * 100).toFixed(1)}% · H ${(h * 100).toFixed(1)}% · ∠ ${(t.rot - t0.rot).toFixed(1)}°`;
}

export function InfoPanel({ ed }: { ed: Editor }) {
  useEditor(ed);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  // הסמן זז בלי emit — דגימה קלה כדי שהפאנל יתעדכן
  useEffect(() => {
    let last = '';
    const id = window.setInterval(() => {
      const c = ed.cursorDoc;
      const k = c ? `${Math.floor(c.x)},${Math.floor(c.y)}` : '';
      if (k !== last) { last = k; tick(); }
    }, 90);
    return () => window.clearInterval(id);
  }, [ed]);
  const st = ed.st, d = ed.doc;
  if (!st || !d) return <div className="pe-empty-panel">אין מסמך פתוח</div>;
  const c = ed.cursorDoc;
  const sel = d.selection ? selBounds(d.selection) : null;
  const rm = rulerMeasure(st);
  const xf = transformDelta(ed);
  const samples = samplerValues(ed);
  return (
    <div className="pe-info" dir="rtl">
      <ColorRow title="סמן" p={c} px={c ? compPixel(ed, c) : null} />
      {samples.map((s, i) => (
        <ColorRow key={i} title={`#${i + 1}`} p={s.p} px={s.rgb} onRemove={() => { samplersOf(st).splice(i, 1); ed.redraw(false); ed.emit(); }} />
      ))}
      <div className="pe-info-grid">
        <span>מסמך</span><span dir="ltr">{d.width} × {d.height} px · {d.dpi} ppi</span>
        <span>בחירה</span><span dir="ltr">{sel ? `${sel.w} × ${sel.h} px @ ${sel.x}, ${sel.y}` : '—'}</span>
        {rm && <><span>סרגל</span><span dir="ltr">A {rm.angle.toFixed(1)}° · L {rm.dist.toFixed(1)} px · W {rm.w.toFixed(1)} · H {(-rm.h).toFixed(1)}</span></>}
        {xf && <><span>טרנספורם</span><span dir="ltr">{xf}</span></>}
        {!xf && ed.status && <><span>פעולה</span><span dir="ltr">{ed.status}</span></>}
        {st.rot ? <><span>סיבוב תצוגה</span><span dir="ltr">{st.rot.toFixed(1)}°</span></> : null}
      </div>
      {!samples.length && <p className="pe-hint">Color Sampler (Shift+I) מוסיף עד 10 נקודות דגימה קבועות.</p>}
    </div>
  );
}
