/** רכיבי ממשק קטנים: שדה מספר עם גרירה על התווית (כמו בפוטושופ), סליידר, בוחר צבע HSB, אייקונים. */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Editor } from '../editor';
import { clamp, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from '../model';

export function useEditor(ed: Editor) {
  useSyncExternalStore(ed.subscribe, ed.getVersion);
  return ed;
}

/** מספר עם Scrubby: גרירה אופקית על התווית משנה את הערך; Shift = צעד ×10 */
export function Num({ label, value, onChange, min = -Infinity, max = Infinity, step = 1, unit, width = 52, title, digits = 0 }: {
  label?: ReactNode; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; width?: number; title?: string; digits?: number;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (Number.isFinite(value) ? (+value.toFixed(digits)).toString() : '');
  const drag = useRef<{ x: number; v: number } | null>(null);
  const commit = (s: string) => {
    setText(null);
    const v = Number(s.replace(',', '.'));
    if (Number.isFinite(v)) onChange(clamp(v, min, max));
  };
  return (
    <label className="pe-num" title={title}>
      {label != null && (
        <span
          className="pe-num-label"
          onPointerDown={(e) => { drag.current = { x: e.clientX, v: value }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (!drag.current) return; const dx = e.clientX - drag.current.x; onChange(clamp(+(drag.current.v + Math.round(dx / 2) * step * (e.shiftKey ? 10 : 1)).toFixed(4), min, max)); }}
          onPointerUp={() => { drag.current = null; }}
        >
          {label}
        </span>
      )}
      <input
        dir="ltr"
        style={{ width }}
        value={shown}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); onChange(clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), min, max)); }
          e.stopPropagation();
        }}
      />
      {unit && <span className="pe-num-unit">{unit}</span>}
    </label>
  );
}

export function Slider({ label, value, min, max, step = 1, onChange, unit = '', digits = 0 }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string; digits?: number }) {
  return (
    <div className="pe-slider">
      <div className="pe-slider-head">
        <span>{label}</span>
        <Num value={value} onChange={onChange} min={min} max={max} step={step} unit={unit} width={46} digits={digits} />
      </div>
      <input type="range" dir="ltr" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function Check({ label, checked, onChange, title }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="pe-check" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** בוחר צבע: ריבוע רוויה/בהירות + פס גוון + HEX/RGB/HSB */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [r, g, b] = hexToRgb(value);
  const [hsv, setHsv] = useState(() => rgbToHsv(r, g, b));
  const last = useRef(value);
  useEffect(() => {
    if (value.toLowerCase() !== last.current.toLowerCase()) { setHsv(rgbToHsv(...hexToRgb(value))); last.current = value; }
  }, [value]);
  const set = (h: number, s: number, v: number) => {
    setHsv([h, s, v]);
    const hex = rgbToHex(...hsvToRgb(h, s, v));
    last.current = hex;
    onChange(hex);
  };
  const sq = useRef<HTMLDivElement>(null);
  const hue = useRef<HTMLDivElement>(null);
  const onSq = (e: React.PointerEvent) => {
    const rc = sq.current!.getBoundingClientRect();
    set(hsv[0], clamp((e.clientX - rc.left) / rc.width, 0, 1), clamp(1 - (e.clientY - rc.top) / rc.height, 0, 1));
  };
  const onHue = (e: React.PointerEvent) => {
    const rc = hue.current!.getBoundingClientRect();
    set(clamp((1 - (e.clientY - rc.top) / rc.height) * 360, 0, 359.9), hsv[1], hsv[2]);
  };
  const drag = (fn: (e: React.PointerEvent) => void) => ({
    onPointerDown: (e: React.PointerEvent) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); fn(e); },
    onPointerMove: (e: React.PointerEvent) => { if (e.buttons) fn(e); },
  });
  const [H, S, V] = hsv;
  return (
    <div className="pe-picker" dir="ltr">
      <div className="pe-picker-main">
        <div ref={sq} className="pe-picker-sq" style={{ background: `hsl(${H},100%,50%)` }} {...drag(onSq)}>
          <div className="pe-picker-white" />
          <div className="pe-picker-black" />
          <div className="pe-picker-dot" style={{ left: `${S * 100}%`, top: `${(1 - V) * 100}%` }} />
        </div>
        <div ref={hue} className="pe-picker-hue" {...drag(onHue)}>
          <div className="pe-picker-hue-mark" style={{ top: `${(1 - H / 360) * 100}%` }} />
        </div>
      </div>
      <div className="pe-picker-fields">
        <label className="pe-hex">#<input value={value.replace('#', '')} onChange={(e) => { const v = e.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6); if (v.length === 6) onChange(`#${v}`); }} onKeyDown={(e) => e.stopPropagation()} /></label>
        <div className="pe-picker-row">
          <Num label="R" value={r} min={0} max={255} width={36} onChange={(v) => onChange(rgbToHex(v, g, b))} />
          <Num label="G" value={g} min={0} max={255} width={36} onChange={(v) => onChange(rgbToHex(r, v, b))} />
          <Num label="B" value={b} min={0} max={255} width={36} onChange={(v) => onChange(rgbToHex(r, g, v))} />
        </div>
        <div className="pe-picker-row">
          <Num label="H" value={Math.round(H)} min={0} max={359} width={36} onChange={(v) => set(v, S, V)} />
          <Num label="S" value={Math.round(S * 100)} min={0} max={100} width={36} onChange={(v) => set(H, v / 100, V)} />
          <Num label="B" value={Math.round(V * 100)} min={0} max={100} width={36} onChange={(v) => set(H, S, v / 100)} />
        </div>
      </div>
    </div>
  );
}

/** ריבוע צבע שנפתח לבוחר צבע קטן */
export function ColorField({ value, onChange, title }: { value: string; onChange: (hex: string) => void; title?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', off);
    return () => window.removeEventListener('pointerdown', off);
  }, [open]);
  return (
    <div className="pe-colorfield" ref={ref} title={title}>
      <button type="button" className="pe-swatch-btn" style={{ background: value }} onClick={() => setOpen((o) => !o)} aria-label={title ?? 'צבע'} />
      {open && (
        <div className="pe-pop">
          <ColorPicker value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, ReactNode, string?]>; onChange: (v: T) => void }) {
  return (
    <div className="pe-seg">
      {options.map(([v, label, title]) => (
        <button key={v} type="button" className={v === value ? 'on' : ''} title={title} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

/* ---------- אייקונים (ברוח SF Symbols: רשת 20×20, קו 1.6, קצוות ומפרקים מעוגלים) ---------- */

const P: Record<string, ReactNode> = {
  move: <><path d="M10 2.5v15M2.5 10h15" /><path d="M7.8 4.7L10 2.5l2.2 2.2M7.8 15.3l2.2 2.2 2.2-2.2M4.7 7.8L2.5 10l2.2 2.2M15.3 7.8l2.2 2.2-2.2 2.2" /></>,
  marquee: <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" strokeDasharray="2.4 2.2" />,
  ellipse: <ellipse cx="10" cy="10" rx="7" ry="5.8" strokeDasharray="2.4 2.2" />,
  lasso: <><path d="M7.2 14.6C4.3 13.9 2.8 12 2.8 9.8c0-3.4 3.3-6 7.2-6s7.2 2.6 7.2 5.9c0 3.2-3 5.6-6.8 5.6" /><circle cx="8.6" cy="14.6" r="1.4" /><path d="M8 16c-.6 1-1.5 1.6-2.6 1.7" /></>,
  poly: <path d="M4 15.5L5.5 4.5l10.5 3-3.5 8z" strokeDasharray="2.4 2.2" />,
  wand: <><path d="M3 17l8.6-8.6" /><path d="M14.6 2.4v2.4M14.6 8.4v2.4M10.8 6.6h2.4M16 6.6h2.4" /><path d="M12.4 4.4l.8.8M16.8 8.8l-.8-.8M16.8 4.4l-.8.8" /></>,
  crop: <><path d="M5.5 2.5v10.5a1.5 1.5 0 0 0 1.5 1.5h10.5" /><path d="M2.5 5.5H13a1.5 1.5 0 0 1 1.5 1.5v10.5" /></>,
  eyedropper: <><path d="M12.3 4.2l1.3-1.3a2.1 2.1 0 0 1 3 3l-1.3 1.3" /><path d="M10.9 5.6l3.5 3.5" /><path d="M12.6 7.3L5.8 14.1a2 2 0 0 1-.9.5l-2 .6.6-2a2 2 0 0 1 .5-.9L10.8 5.5" /></>,
  brush: <><path d="M16.9 3.1c.7.7-1.3 4-4.6 7.3l-1.6 1.4-2.5-2.5 1.4-1.6c3.3-3.3 6.6-5.3 7.3-4.6z" /><path d="M8.2 9.3c-1.8-.3-3.4.8-3.6 2.6-.2 1.6-.6 2.9-2.1 3.9 2.8 1.1 6.4.8 7.6-1.9.4-.9.2-1.9-.4-2.6" /></>,
  clone: <><circle cx="10" cy="4.6" r="2.1" /><path d="M8.4 6.4l-.5 3.4h4.2l-.5-3.4" /><rect x="3.5" y="9.8" width="13" height="4" rx="1.4" /><path d="M5.5 17.2h9" /></>,
  eraser: <><path d="M8 16.5L3.4 11.9a1.6 1.6 0 0 1 0-2.3l6.2-6.2a1.6 1.6 0 0 1 2.3 0l4.7 4.7a1.6 1.6 0 0 1 0 2.3l-5.8 5.8" /><path d="M6.2 6.8l7 7" /><path d="M8 16.5h8.5" /></>,
  gradient: <><rect x="3" y="3" width="14" height="14" rx="3" /><path d="M3.6 13.4l9.8-9.8M6.6 16.4l9.8-9.8" opacity=".55" /><path d="M10.6 16.6l6-6" opacity=".25" /></>,
  bucket: <><path d="M3.8 9.4l5.6-5.6 6 6-5 5a1.6 1.6 0 0 1-2.3 0L3.8 11.7a1.6 1.6 0 0 1 0-2.3z" /><path d="M3.6 10.2h11.6" /><path d="M7.2 2.6l2.2 1.2" /><path d="M16.6 12.2c.9 1.4 1.4 2.4 1.4 3a1.4 1.4 0 0 1-2.8 0c0-.6.5-1.6 1.4-3z" /></>,
  text: <><path d="M4.5 5.5V4h11v1.5M10 4v12.5M7.8 16.5h4.4" /></>,
  shape: <><rect x="2.8" y="6.5" width="9" height="9" rx="2" /><circle cx="12.8" cy="7.3" r="4.6" /></>,
  hand: <path d="M7.4 10.3V4.6a1.25 1.25 0 0 1 2.5 0v4.6-5.9a1.25 1.25 0 0 1 2.5 0v5.9-4.4a1.25 1.25 0 0 1 2.5 0v6.1-2.7a1.25 1.25 0 0 1 2.5 0v3.4c0 3.6-2.6 6.4-6.1 6.4-2.3 0-3.7-.8-5-2.7L4 11.9a1.3 1.3 0 0 1 2.1-1.5z" />,
  zoom: <><circle cx="8.7" cy="8.7" r="5.7" /><path d="M13 13l4.3 4.3" /><path d="M6.3 8.7h4.8M8.7 6.3v4.8" /></>,
  eye: <><path d="M1.8 10c1.7-3.5 4.6-5.5 8.2-5.5s6.5 2 8.2 5.5c-1.7 3.5-4.6 5.5-8.2 5.5S3.5 13.5 1.8 10z" /><circle cx="10" cy="10" r="2.6" /></>,
  lock: <><rect x="4.5" y="8.8" width="11" height="8.2" rx="2" /><path d="M6.9 8.8V6.4a3.1 3.1 0 0 1 6.2 0v2.4" /></>,
  trash: <><path d="M3.5 5.5h13" /><path d="M7.8 5.5V4a1 1 0 0 1 1-1h2.4a1 1 0 0 1 1 1v1.5" /><path d="M5 5.5l.8 10.4a1.6 1.6 0 0 0 1.6 1.5h5.2a1.6 1.6 0 0 0 1.6-1.5L15 5.5" /><path d="M8.5 8.5v5.5M11.5 8.5v5.5" /></>,
  plus: <><rect x="3" y="3" width="14" height="14" rx="3.5" /><path d="M10 6.8v6.4M6.8 10h6.4" /></>,
  folder: <path d="M2.8 6.2V5a1.5 1.5 0 0 1 1.5-1.5h3.4l1.9 2h6.1a1.5 1.5 0 0 1 1.5 1.5v7.8a1.5 1.5 0 0 1-1.5 1.5H4.3a1.5 1.5 0 0 1-1.5-1.5z" />,
  mask: <><rect x="2.8" y="3.8" width="14.4" height="12.4" rx="3" /><circle cx="10" cy="10" r="3.4" fill="currentColor" fillOpacity=".25" /></>,
  adjust: <><circle cx="10" cy="10" r="7" /><path d="M10 3a7 7 0 0 0 0 14z" fill="currentColor" stroke="none" /></>,
  fx: <text x="10" y="14.2" textAnchor="middle" fontSize="11.5" fontStyle="italic" fontWeight="600" fontFamily="-apple-system, 'SF Pro Text', Inter, sans-serif" stroke="none" fill="currentColor">fx</text>,
  link: <><path d="M8.6 11.4l2.8-2.8" /><path d="M9.2 5.9l1.2-1.2a3.2 3.2 0 0 1 4.6 4.6l-1.2 1.2M10.8 14.1l-1.2 1.2A3.2 3.2 0 0 1 5 10.7l1.2-1.2" /></>,
  chevron: <path d="M7.8 5l5 5-5 5" />,
  swap: <><path d="M4 7.5h11.5M12.5 4.5l3 3-3 3" /><path d="M16 12.5H4.5M7.5 9.5l-3 3 3 3" /></>,
  clip: <path d="M5.5 3.5v7a2.5 2.5 0 0 0 2.5 2.5h8.5M13.5 10l3 3-3 3" />,
  alignL: <><path d="M3.2 2.5v15" /><rect x="6" y="4.8" width="10.5" height="3.6" rx="1.2" /><rect x="6" y="11.6" width="6.5" height="3.6" rx="1.2" /></>,
  alignHC: <><path d="M10 2.5v15" /><rect x="3.8" y="4.8" width="12.4" height="3.6" rx="1.2" /><rect x="6.4" y="11.6" width="7.2" height="3.6" rx="1.2" /></>,
  alignR: <><path d="M16.8 2.5v15" /><rect x="3.5" y="4.8" width="10.5" height="3.6" rx="1.2" /><rect x="7.5" y="11.6" width="6.5" height="3.6" rx="1.2" /></>,
  alignT: <><path d="M2.5 3.2h15" /><rect x="4.8" y="6" width="3.6" height="10.5" rx="1.2" /><rect x="11.6" y="6" width="3.6" height="6.5" rx="1.2" /></>,
  alignVC: <><path d="M2.5 10h15" /><rect x="4.8" y="3.8" width="3.6" height="12.4" rx="1.2" /><rect x="11.6" y="6.4" width="3.6" height="7.2" rx="1.2" /></>,
  alignB: <><path d="M2.5 16.8h15" /><rect x="4.8" y="3.5" width="3.6" height="10.5" rx="1.2" /><rect x="11.6" y="7.5" width="3.6" height="6.5" rx="1.2" /></>,
  distH: <><path d="M3.2 3v14M16.8 3v14" /><rect x="7.8" y="5.5" width="4.4" height="9" rx="1.3" /></>,
  distV: <><path d="M3 3.2h14M3 16.8h14" /><rect x="5.5" y="7.8" width="9" height="4.4" rx="1.3" /></>,
  flipH: <><path d="M10 2.5v15" strokeDasharray="1.6 2.2" /><path d="M7.5 5.5L3 14.5h4.5z" /><path d="M12.5 5.5l4.5 9h-4.5z" fill="currentColor" fillOpacity=".3" /></>,
  flipV: <><path d="M2.5 10h15" strokeDasharray="1.6 2.2" /><path d="M5.5 7.5L14.5 3v4.5z" /><path d="M5.5 12.5l9 4.5v-4.5z" fill="currentColor" fillOpacity=".3" /></>,
  rotCW: <><path d="M15.6 10.6A5.7 5.7 0 1 1 13.3 5" /><path d="M13.6 2.2l.2 3.4-3.4.4" /></>,
  rotCCW: <><path d="M4.4 10.6A5.7 5.7 0 1 0 6.7 5" /><path d="M6.4 2.2l-.2 3.4 3.4.4" /></>,
  textR: <path d="M3.5 5h13M7.5 8.7h9M3.5 12.4h13M9.5 16.1h7" />,
  textC: <path d="M3.5 5h13M6 8.7h8M3.5 12.4h13M7 16.1h6" />,
  textLft: <path d="M3.5 5h13M3.5 8.7h9M3.5 12.4h13M3.5 16.1h7" />,
  textJ: <path d="M3.5 5h13M3.5 8.7h13M3.5 12.4h13M3.5 16.1h8" />,
  group: <><path d="M2.8 6.2V5a1.5 1.5 0 0 1 1.5-1.5h3.4l1.9 2h6.1a1.5 1.5 0 0 1 1.5 1.5v7.8a1.5 1.5 0 0 1-1.5 1.5H4.3a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M2.8 8h14.4" /></>,
  check: <path d="M4.5 10.4l3.6 3.6 7.4-8" />,
  /* כלי בחירה ומסכות (Quick Selection, Magnetic Lasso, Single Row/Column, Quick Mask) */
  quicksel: <><path d="M11.5 2.5c2.6 0 4.8 1.9 4.8 4.4 0 2.2-1.8 3.9-4 4.3" strokeDasharray="2 1.8" /><path d="M4 17.5l5.6-5.6" /><path d="M9.6 11.9a2.2 2.2 0 1 0 3.1-3.1 2.2 2.2 0 0 0-3.1 3.1z" /></>,
  magnetic: <><path d="M7.2 14.6C4.3 13.9 2.8 12 2.8 9.8c0-3.4 3.3-6 7.2-6s7.2 2.6 7.2 5.9c0 3.2-3 5.6-6.8 5.6" strokeDasharray="2 1.6" /><path d="M5 15.5v2.5h2.5v-2.5M10.5 15.5v2.5H13v-2.5" /></>,
  rowsel: <><path d="M2 10h16" strokeDasharray="2 1.6" /><path d="M2 8v4M18 8v4" /></>,
  colsel: <><path d="M10 2v16" strokeDasharray="2 1.6" /><path d="M8 2h4M8 18h4" /></>,
  qmask: <><rect x="3" y="4" width="14" height="12" rx="1.5" /><circle cx="10" cy="10" r="3.6" strokeDasharray="1.8 1.6" /></>,
  close: <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />,
  /* ציור, רטוש ומדידה */
  pencil: <><path d="M13.6 3.4l3 3-9.4 9.4-3.9.9.9-3.9z" /><path d="M11.8 5.2l3 3" /></>,
  colorReplace: <><path d="M16.9 3.1c.7.7-1.3 4-4.6 7.3l-1.6 1.4-2.5-2.5 1.4-1.6c3.3-3.3 6.6-5.3 7.3-4.6z" /><path d="M2.8 12.6a3.6 3.6 0 0 1 5.9-1.9" /><path d="M8.8 16.4a3.6 3.6 0 0 1-5.6-1.3" /><path d="M9.2 9.2l-.4 1.8-1.8-.4" /></>,
  bgEraser: <><path d="M8 13.5L3.4 8.9a1.6 1.6 0 0 1 0-2.3l3.2-3.2a1.6 1.6 0 0 1 2.3 0l4.7 4.7a1.6 1.6 0 0 1 0 2.3l-2.8 2.8" /><path d="M5.2 5l5.5 5.5" /><path d="M2.8 17h14.4" strokeDasharray="1.6 2" /></>,
  magicEraser: <><path d="M7 16.5L2.9 12.4a1.5 1.5 0 0 1 0-2.1l5-5a1.5 1.5 0 0 1 2.1 0l4.1 4.1a1.5 1.5 0 0 1 0 2.1l-4.9 4.9" /><path d="M5.4 7.8l6.8 6.8" /><path d="M15.6 2.4v3.2M14 4h3.2" /></>,
  historyBrush: <><path d="M16.9 3.1c.7.7-1.3 4-4.6 7.3l-1.6 1.4-2.5-2.5 1.4-1.6c3.3-3.3 6.6-5.3 7.3-4.6z" /><path d="M8.4 12.2a4.2 4.2 0 1 1-5-4.6" /><path d="M2.4 5.6l1 2 2-.8" /></>,
  patternStamp: <><circle cx="10" cy="4.6" r="2.1" /><path d="M8.4 6.4l-.5 3.4h4.2l-.5-3.4" /><rect x="3.5" y="9.8" width="13" height="4" rx="1.4" /><path d="M4.8 17.2h1.8M9.1 17.2h1.8M13.4 17.2h1.8" /></>,
  blur: <path d="M10 2.8c2.9 3.6 4.8 6.4 4.8 8.9a4.8 4.8 0 0 1-9.6 0c0-2.5 1.9-5.3 4.8-8.9z" />,
  sharpen: <><path d="M10 2.6l4.6 13.4H5.4z" /><path d="M7.6 9.8h4.8" opacity=".5" /></>,
  smudge: <path d="M8.5 11.5V4.2a1.4 1.4 0 0 1 2.8 0v5.6l3 .9a2 2 0 0 1 1.4 2.3l-.6 3.4a2 2 0 0 1-2 1.6H9.4a2 2 0 0 1-1.6-.8l-3.1-4a1.3 1.3 0 0 1 2-1.7z" />,
  dodge: <><circle cx="11.6" cy="7" r="4.4" /><path d="M8.5 10.2l-5 6.3" /></>,
  burn: <><path d="M5.8 17.2v-5a4.2 4.2 0 0 1 8.4 0v5" /><path d="M8 7.3a2.2 2.2 0 1 1 4 0" /><path d="M10 12.2v.1" /></>,
  sponge: <><rect x="3.2" y="5" width="13.6" height="10" rx="3" /><path d="M7.4 8.6v.1M12.4 8.2v.1M9.8 11.8v.1M13.6 12v.1" /></>,
  spotHeal: <><rect x="2.6" y="7.3" width="14.8" height="5.4" rx="2.7" transform="rotate(-45 10 10)" /><path d="M9.2 9.2v.1M10.8 10.8v.1M9.2 10.8v.1M10.8 9.2v.1" /><path d="M14.8 1.9a3.2 3.2 0 0 1 3.3 3.3" strokeDasharray="1.4 1.4" /></>,
  heal: <><rect x="2.6" y="7.3" width="14.8" height="5.4" rx="2.7" transform="rotate(-45 10 10)" /><path d="M9.2 9.2v.1M10.8 10.8v.1M9.2 10.8v.1M10.8 9.2v.1" /></>,
  patch: <><rect x="3.5" y="5" width="13" height="10" rx="2.2" /><path d="M6.4 8.4h7.2M6.4 11.6h7.2" strokeDasharray="1.6 1.6" /></>,
  redEye: <><path d="M1.8 10c1.7-3.5 4.6-5.5 8.2-5.5s6.5 2 8.2 5.5c-1.7 3.5-4.6 5.5-8.2 5.5S3.5 13.5 1.8 10z" /><circle cx="10" cy="10" r="2.6" fill="currentColor" fillOpacity=".35" /><path d="M10 1.2v1.6M10 17.2v1.6" /></>,
  colorSampler: <><path d="M12.3 4.2l1.3-1.3a2.1 2.1 0 0 1 3 3l-1.3 1.3" /><path d="M10.9 5.6l3.5 3.5" /><path d="M12.6 7.3L5.8 14.1a2 2 0 0 1-.9.5l-2 .6.6-2a2 2 0 0 1 .5-.9L10.8 5.5" /><path d="M15.4 13.6v4.4M13.2 15.8h4.4" /></>,
  ruler: <g transform="rotate(-30 10 10)"><rect x="2" y="7.2" width="16" height="5.6" rx="1.2" /><path d="M5 7.2v2.2M8 7.2v1.4M11 7.2v2.2M14 7.2v1.4" /></g>,
  rotateView: <><path d="M15.6 10.6A5.7 5.7 0 1 1 13.3 5" /><path d="M13.6 2.2l.2 3.4-3.4.4" /><path d="M10 8v4.6M7.7 10.3h4.6" /></>,
  vtext: <path d="M5.5 4.5H4v11h1.5M4 10h12.5M16.5 7.8v4.4" />,
  htmask: <path d="M4.5 5.5V4h11v1.5M10 4v12.5M7.8 16.5h4.4" strokeDasharray="2 1.6" />,
  vtmask: <path d="M5.5 4.5H4v11h1.5M4 10h12.5M16.5 7.8v4.4" strokeDasharray="2 1.6" />,
  artboard: <><rect x="5.5" y="5.5" width="9" height="9" rx="1.2" /><path d="M5.5 2.5v1.6M14.5 2.5v1.6M5.5 15.9v1.6M14.5 15.9v1.6M2.5 5.5h1.6M2.5 14.5h1.6M15.9 5.5h1.6M15.9 14.5h1.6" /></>,
};

export function Ico({ n, size = 18 }: { n: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      {P[n] ?? null}
    </svg>
  );
}
