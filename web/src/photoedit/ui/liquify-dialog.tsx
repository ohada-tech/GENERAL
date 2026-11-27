/**
 * Filter > Liquify (Ctrl+Shift+X) — חלון מלא עם תצוגה משלו. העיוות נשמר כשדה הזזה ברזולוציה מוקטנת
 * (warp-algo: LiqField) ומוחל על השכבה רק ב-OK, ברזולוציה מלאה. Cancel לא נוגע בשכבה.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '../editor';
import { findLayer, isXf, newCanvas, touch, type RasterLayer } from '../model';
import { isDeformed } from '../deform';
import { applyField, LiqField, liqFalloff, renderLiqView } from '../warp-algo';
import { Check, Ico, Num, useEditor } from './widgets';

type LiqTool = 'warp' | 'reconstruct' | 'smooth' | 'twirl' | 'pucker' | 'bloat' | 'push' | 'freeze' | 'thaw' | 'hand' | 'zoom';

const TOOLS: Array<{ id: LiqTool; key: string; en: string; he: string; icon: string }> = [
  { id: 'warp', key: 'W', en: 'Forward Warp Tool', he: 'דחיפה קדימה', icon: 'liqWarp' },
  { id: 'reconstruct', key: 'R', en: 'Reconstruct Tool', he: 'שחזור', icon: 'liqReconstruct' },
  { id: 'smooth', key: 'E', en: 'Smooth Tool', he: 'החלקה', icon: 'liqSmooth' },
  { id: 'twirl', key: 'C', en: 'Twirl Clockwise Tool', he: 'סחרור (Alt = נגד השעון)', icon: 'liqTwirl' },
  { id: 'pucker', key: 'S', en: 'Pucker Tool', he: 'כיווץ', icon: 'liqPucker' },
  { id: 'bloat', key: 'B', en: 'Bloat Tool', he: 'ניפוח', icon: 'liqBloat' },
  { id: 'push', key: 'O', en: 'Push Left Tool', he: 'דחיפה הצידה (Alt = ימינה)', icon: 'liqPush' },
  { id: 'freeze', key: 'F', en: 'Freeze Mask Tool', he: 'מסכת הקפאה', icon: 'liqFreeze' },
  { id: 'thaw', key: 'D', en: 'Thaw Mask Tool', he: 'הפשרה', icon: 'liqThaw' },
  { id: 'hand', key: 'H', en: 'Hand Tool', he: 'יד', icon: 'hand' },
  { id: 'zoom', key: 'Z', en: 'Zoom Tool', he: 'זכוכית מגדלת (Alt = הקטנה)', icon: 'zoom' },
];

export function LiquifyDialog({ ed }: { ed: Editor }) {
  useEditor(ed);
  const dlg = ed.dialog;
  if (dlg?.type !== 'liquify' || !ed.doc) return null;
  return <Liquify key={dlg.data?.layerId} ed={ed} layerId={dlg.data?.layerId} />;
}

function Liquify({ ed, layerId }: { ed: Editor; layerId: string }) {
  const layer = ed.layer(layerId);
  const needsRaster = !!layer && isXf(layer) && (layer.type !== 'raster' || isDeformed(layer));
  const [confirmed, setConfirmed] = useState(!needsRaster);
  if (!layer || !isXf(layer)) return null;
  if (!confirmed) {
    const what = layer.type === 'text' ? 'שכבת טקסט' : layer.type === 'shape' ? 'שכבת צורה' : 'שכבה עם Distort/Warp';
    return (
      <div className="pe-modal-back">
        <div className="pe-modal" role="dialog" aria-label="Liquify">
          <div className="pe-modal-head"><h3>Liquify · נזילות</h3><button type="button" className="pe-x" onClick={() => ed.closeDialog()} aria-label="סגירה">×</button></div>
          <div className="pe-modal-body"><p>זו {what}. כדי להפעיל Liquify צריך להמיר אותה לפיקסלים, והיא לא תהיה ניתנת לעריכה אחר כך. ההמרה קורית רק אם תאשרו ב-OK.</p></div>
          <div className="pe-modal-foot">
            <button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button>
            <button type="button" className="pe-btn primary" autoFocus onClick={() => setConfirmed(true)}>המרה לפיקסלים · Rasterize</button>
          </div>
        </div>
      </div>
    );
  }
  return <LiquifyWork ed={ed} layerId={layerId} />;
}

function LiquifyWork({ ed, layerId }: { ed: Editor; layerId: string }) {
  // מקור: הפיקסלים של השכבה; טקסט/צורה/שכבה מעוותת — עותק מרונדר (השכבה עצמה מוחלפת רק ב-OK)
  const base = useMemo(() => {
    const l = ed.layer(layerId)!;
    const r: RasterLayer = l.type === 'raster' && !isDeformed(l) ? l : ed.rasterOf(l);
    const c = r.canvas, w = c.width, h = c.height;
    const data = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
    const step = Math.max(1, Math.ceil(Math.max(w, h) / 720));
    return { r, w, h, data, field: new LiqField(w, h, step) };
  }, [ed, layerId]);
  const { w, h, data, field } = base;

  const [tool, setTool] = useState<LiqTool>('warp');
  const [size, setSize] = useState(() => Math.max(10, Math.round(Math.min(w, h) / 10)));
  const [density, setDensity] = useState(50);
  const [pressure, setPressure] = useState(100);
  const [rate, setRate] = useState(80);
  const [stylus, setStylus] = useState(false);
  const [showMask, setShowMask] = useState(true);
  const [showMesh, setShowMesh] = useState(false);
  const [recAmount, setRecAmount] = useState(100);
  const [, force] = useState(0);
  const undo = useRef<Array<ReturnType<LiqField['snapshot']>>>([]);

  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const view = useRef({ k: 1, ox: 0, oy: 0, cw: 0, ch: 0, dpr: 1 });
  const img = useRef<ImageData | null>(null);
  const opts = useRef({ tool, size, density, pressure, rate, stylus, showMask, showMesh });
  opts.current = { tool, size, density, pressure, rate, stylus, showMask, showMesh };
  const spring = useRef<LiqTool | null>(null);
  const drag = useRef<{ last: { x: number; y: number }; screen: { x: number; y: number }; alt: boolean; pr: number; raf: number; moved: boolean } | null>(null);

  /* ---------- תצוגה ---------- */

  const paint = (rect?: { x0: number; y0: number; x1: number; y1: number }) => {
    const c = cv.current, im = img.current, v = view.current;
    if (!c || !im) return;
    const o = opts.current;
    const mesh = o.showMesh ? Math.max(8, Math.round(Math.max(w, h) / 40)) : 0;
    const r = rect ?? { x0: 0, y0: 0, x1: im.width, y1: im.height };
    renderLiqView(data, w, h, field, im.data, im.width, im.height, v.ox, v.oy, v.k / v.dpr, o.showMask, mesh, r.x0, r.y0, r.x1, r.y1);
    const x0 = Math.max(0, Math.floor(r.x0)), y0 = Math.max(0, Math.floor(r.y0));
    c.getContext('2d')!.putImageData(im, 0, 0, x0, y0, Math.min(im.width, Math.ceil(r.x1)) - x0, Math.min(im.height, Math.ceil(r.y1)) - y0);
  };

  /** k = פיקסלי תמונה לכל פיקסל CSS */
  const fit = () => {
    const v = view.current;
    v.k = Math.max(w / Math.max(1, v.cw - 40), h / Math.max(1, v.ch - 40), 1 / 8);
    v.ox = w / 2 - (v.cw / 2) * v.k;
    v.oy = h / 2 - (v.ch / 2) * v.k;
  };

  useEffect(() => {
    const el = wrap.current, c = cv.current;
    if (!el || !c) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      const v = view.current, dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = el.clientWidth, ch = el.clientHeight;
      if (!cw || !ch) return;
      // שומרים על מרכז התצוגה כשהחלון משנה גודל
      const cx = v.ox + (v.cw / 2) * v.k, cy = v.oy + (v.ch / 2) * v.k;
      v.cw = cw; v.ch = ch; v.dpr = dpr;
      c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
      c.style.width = `${cw}px`; c.style.height = `${ch}px`;
      img.current = new ImageData(c.width, c.height);
      if (first) { fit(); first = false; } else { v.ox = cx - (cw / 2) * v.k; v.oy = cy - (ch / 2) * v.k; }
      paint();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { paint(); }, [showMask, showMesh]); // eslint-disable-line react-hooks/exhaustive-deps

  const toImg = (sx: number, sy: number) => { const v = view.current; return { x: v.ox + sx * v.k, y: v.oy + sy * v.k }; };
  const local = (e: { clientX: number; clientY: number }) => { const rc = cv.current!.getBoundingClientRect(); return { x: e.clientX - rc.left, y: e.clientY - rc.top }; };

  const placeCursor = (sp: { x: number; y: number } | null) => {
    const el = cursor.current;
    if (!el) return;
    const t = spring.current ?? opts.current.tool;
    if (!sp || t === 'hand' || t === 'zoom') { el.style.display = 'none'; return; }
    const d = (opts.current.size / view.current.k);
    el.style.display = 'block';
    el.style.width = el.style.height = `${d}px`;
    el.style.transform = `translate(${sp.x - d / 2}px, ${sp.y - d / 2}px)`;
  };

  const zoomAt = (sp: { x: number; y: number }, f: number) => {
    const v = view.current, p = toImg(sp.x, sp.y);
    v.k = Math.min(8, Math.max(1 / 16, v.k / f));
    v.ox = p.x - sp.x * v.k; v.oy = p.y - sp.y * v.k;
    paint();
    placeCursor(sp);
  };

  /* ---------- מברשות ---------- */

  const strength = (pr: number) => (opts.current.pressure / 100) * (opts.current.stylus ? pr : 1);

  /** הפעלה אחת של הכלי במיקום p (תמונה); mv = תנועה מאז האירוע הקודם */
  const applyAt = (p: { x: number; y: number }, mv: { x: number; y: number } | null, alt: boolean, pr: number) => {
    const o = opts.current, R = o.size / 2, fo = liqFalloff(o.density), s = strength(pr), rt = o.rate / 100;
    switch (spring.current ?? o.tool) {
      case 'warp': if (mv) field.push(p.x, p.y, R, mv.x * s, mv.y * s, fo); break;
      case 'push': if (mv) { const k = (alt ? -1 : 1) * s * 0.5; field.push(p.x, p.y, R, mv.y * k, -mv.x * k, fo); } break;
      case 'twirl': field.twirl(p.x, p.y, R, (alt ? -1 : 1) * 0.07 * rt * s, fo); break;
      case 'pucker': field.scale(p.x, p.y, R, 0.035 * rt * s, fo); break;
      case 'bloat': field.scale(p.x, p.y, R, -0.035 * rt * s, fo); break;
      case 'reconstruct': field.reconstruct(p.x, p.y, R, 0.12 * rt * s, fo); break;
      case 'smooth': field.smooth(p.x, p.y, R, 0.5 * rt * s, fo); break;
      case 'freeze': field.paintFreeze(p.x, p.y, R, 1, 0.35 * s, fo); break;
      case 'thaw': field.paintFreeze(p.x, p.y, R, 0, 0.35 * s, fo); break;
      default: return;
    }
    // מעדכנים רק את אזור המברשת במסך (עם שוליים לתוכן שנגרר מבחוץ)
    const v = view.current, m = R * 1.6 + (mv ? Math.hypot(mv.x, mv.y) : 0) + field.step * 2;
    const k = v.k / v.dpr;
    paint({ x0: (p.x - m - v.ox) / k, y0: (p.y - m - v.oy) / k, x1: (p.x + m - v.ox) / k, y1: (p.y + m - v.oy) / k });
  };

  const timeTool = (t: LiqTool) => t !== 'warp' && t !== 'push' && t !== 'hand' && t !== 'zoom';

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const sp = local(e), t = spring.current ?? tool;
    if (t === 'zoom') { zoomAt(sp, e.altKey ? 1 / 1.6 : 1.6); return; }
    const pr = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1;
    if (t !== 'hand') { undo.current.push(field.snapshot()); if (undo.current.length > 30) undo.current.shift(); }
    const d = { last: toImg(sp.x, sp.y), screen: sp, alt: e.altKey, pr, raf: 0, moved: false };
    drag.current = d;
    if (t !== 'hand' && timeTool(t)) {
      // כלים שפועלים כל עוד מחזיקים (Twirl, Pucker, Bloat, Reconstruct…): פעימה בכל פריים
      const tick = () => { const g = drag.current; if (!g) return; applyAt(g.last, null, g.alt, g.pr); g.raf = requestAnimationFrame(tick); };
      tick();
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const sp = local(e);
    placeCursor(sp);
    const d = drag.current;
    if (!d) return;
    const t = spring.current ?? tool;
    if (t === 'hand') {
      const v = view.current;
      v.ox -= (sp.x - d.screen.x) * v.k; v.oy -= (sp.y - d.screen.y) * v.k;
      d.screen = sp;
      paint();
      return;
    }
    const p = toImg(sp.x, sp.y);
    d.alt = e.altKey;
    d.pr = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1;
    d.screen = sp;
    if (!timeTool(t)) {
      // תנועה ארוכה מחולקת לצעדים קטנים — אחרת דחיפה מהירה "קופצת"
      const mv = { x: p.x - d.last.x, y: p.y - d.last.y }, L = Math.hypot(mv.x, mv.y), R = size / 2;
      const n = Math.max(1, Math.ceil(L / Math.max(1, R / 4)));
      for (let i = 1; i <= n; i++) applyAt({ x: d.last.x + (mv.x * i) / n, y: d.last.y + (mv.y * i) / n }, { x: mv.x / n, y: mv.y / n }, d.alt, d.pr);
    }
    d.last = p;
    d.moved = true;
  };

  const onUp = () => {
    const d = drag.current;
    if (d) cancelAnimationFrame(d.raf);
    drag.current = null;
    force((n) => n + 1);
  };

  /* ---------- מקלדת ---------- */

  const ok = () => {
    const l = ed.layer(layerId), d = ed.doc;
    if (!l || !d || !isXf(l)) { ed.closeDialog(); return; }
    if (field.isZero() && l.type === 'raster' && !isDeformed(l)) { ed.closeDialog(); return; }
    const out = newCanvas(w, h), x = out.getContext('2d')!;
    const im = x.createImageData(w, h);
    applyField(data, w, h, field, im.data);
    x.putImageData(im, 0, 0);
    if (l.type === 'raster' && !isDeformed(l)) {
      l.canvas = out;
      touch(l);
    } else {
      // טקסט/צורה/מעוות: השכבה מוחלפת בשכבת פיקסלים (אותו מזהה, שם, מסכה ואפקטים)
      const nl = base.r;
      nl.canvas = out;
      touch(nl);
      const f = findLayer(d.layers, l.id);
      if (f) f.parent.splice(f.index, 1, nl);
    }
    ed.closeDialog();
    ed.commit('Liquify · נזילות');
  };

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ed.closeDialog(); }
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    let handled = true;
    if (e.key === 'Escape') ed.closeDialog();
    else if (e.key === 'Enter') ok();
    else if (ctrl && e.code === 'KeyZ') { const s = undo.current.pop(); if (s) { field.restore(s); paint(); } }
    else if (ctrl && (e.code === 'Equal' || e.code === 'NumpadAdd')) zoomAt({ x: view.current.cw / 2, y: view.current.ch / 2 }, 1.6);
    else if (ctrl && (e.code === 'Minus' || e.code === 'NumpadSubtract')) zoomAt({ x: view.current.cw / 2, y: view.current.ch / 2 }, 1 / 1.6);
    else if (ctrl && e.code === 'Digit0') { fit(); paint(); }
    else if (ctrl) handled = false;
    else if (e.code === 'BracketLeft') setSize((s) => Math.max(1, Math.round(s - (s > 100 ? 25 : s > 10 ? 5 : 1))));
    else if (e.code === 'BracketRight') setSize((s) => Math.min(15000, Math.round(s + (s >= 100 ? 25 : s >= 10 ? 5 : 1))));
    else if (e.code === 'Space') { if (!e.repeat) spring.current = 'hand'; }
    else {
      const k = e.code.startsWith('Key') ? e.code.slice(3) : '';
      const hit = TOOLS.find((x) => x.key === k);
      if (hit) setTool(hit.id); else handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => keyRef.current(e);
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') { spring.current = null; e.stopPropagation(); } };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); };
  }, []);

  const cur = TOOLS.find((x) => x.id === tool)!;
  const zoomPct = Math.round((1 / view.current.k) * 100);
  return (
    <div className="pe-modal-back pe-liq-back">
      <div className="pe-liq" role="dialog" aria-label="Liquify">
        <div className="pe-modal-head"><h3>Liquify · נזילות</h3><button type="button" className="pe-x" onClick={() => ed.closeDialog()} aria-label="סגירה">×</button></div>
        <div className="pe-liq-main">
          <div className="pe-liq-tools">
            {TOOLS.map((x) => (
              <button key={x.id} type="button" className={`pe-liq-tool ${tool === x.id ? 'on' : ''}`} title={`${x.en} (${x.key}) · ${x.he}`} onClick={() => setTool(x.id)}>
                <Ico n={x.icon} size={18} />
              </button>
            ))}
          </div>
          <div ref={wrap} className="pe-liq-stage" style={{ cursor: tool === 'hand' ? 'grab' : tool === 'zoom' ? 'zoom-in' : 'none' }}
            onWheel={(e) => { const sp = local(e); zoomAt(sp, e.deltaY < 0 ? 1.15 : 1 / 1.15); }}>
            <canvas ref={cv} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
              onPointerLeave={() => placeCursor(null)} onContextMenu={(e) => e.preventDefault()} />
            <div ref={cursor} className="pe-liq-cursor" />
            <span className="pe-liq-zoom">{zoomPct}%</span>
          </div>
          <div className="pe-liq-props" dir="rtl">
            <h4>{cur.en} · {cur.he}</h4>
            <h5>Brush Tool Options · מברשת</h5>
            <Num label="Size" value={size} min={1} max={15000} unit="px" width={56} title="[ ] משנים גודל" onChange={setSize} />
            <Num label="Density" value={density} min={0} max={100} width={56} title="כמה הקצה של המברשת קשה" onChange={setDensity} />
            <Num label="Pressure" value={pressure} min={1} max={100} width={56} title="עוצמת העיוות בכל תנועה" onChange={setPressure} />
            <Num label="Rate" value={rate} min={0} max={100} width={56} title="מהירות הכלים שפועלים כשמחזיקים במקום (Twirl, Pucker, Bloat, Reconstruct)" onChange={setRate} />
            <Check label="Stylus Pressure" checked={stylus} onChange={setStylus} title="לחץ העט משפיע על העוצמה" />
            <h5>Mask Options · הקפאה</h5>
            <Check label="Show Mask" checked={showMask} onChange={setShowMask} />
            <button type="button" className="pe-btn" onClick={() => { undo.current.push(field.snapshot()); field.clearFreeze(); paint(); }}>None · ביטול ההקפאה</button>
            <h5>Brush Reconstruct Options · שחזור</h5>
            <div className="pe-row">
              <button type="button" className="pe-btn" title="מחזיר את כל האזורים שלא הוקפאו לפי הכמות" onClick={() => { undo.current.push(field.snapshot()); field.reconstructAll(recAmount / 100); paint(); }}>Reconstruct All · שחזור הכול</button>
              <Num label="Amount" value={recAmount} min={1} max={100} unit="%" width={40} onChange={setRecAmount} />
            </div>
            <button type="button" className="pe-btn" title="מבטל את כל העיוותים, גם באזורים קפואים" onClick={() => { undo.current.push(field.snapshot()); field.restoreAll(); paint(); }}>Restore All · שחזור מלא</button>
            <h5>View Options · תצוגה</h5>
            <Check label="Show Mesh" checked={showMesh} onChange={setShowMesh} />
            <p className="pe-hint">W R E C S B O F D H Z = כלים · [ ] = גודל · Alt = כיוון הפוך · רווח = יד · Ctrl+Z = צעד אחורה · Enter = OK</p>
          </div>
        </div>
        <div className="pe-modal-foot">
          <button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>Cancel · ביטול</button>
          <button type="button" className="pe-btn primary" onClick={ok}>OK</button>
        </div>
      </div>
    </div>
  );
}
