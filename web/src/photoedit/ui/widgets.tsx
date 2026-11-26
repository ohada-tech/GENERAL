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

/* ---------- אייקונים (קווי, 20×20) ---------- */

const P: Record<string, ReactNode> = {
  move: <><path d="M10 2v16M2 10h16" /><path d="M10 2l-2.5 2.5M10 2l2.5 2.5M10 18l-2.5-2.5M10 18l2.5-2.5M2 10l2.5-2.5M2 10l2.5 2.5M18 10l-2.5-2.5M18 10l-2.5 2.5" /></>,
  marquee: <rect x="3" y="4" width="14" height="12" strokeDasharray="2.2 1.8" />,
  ellipse: <ellipse cx="10" cy="10" rx="7.5" ry="6" strokeDasharray="2.2 1.8" />,
  lasso: <><path d="M6 15c-3-1.5-3.5-5 0-8 3.5-2.5 10-2 10.5 2s-5 5.5-9 4.5" /><path d="M7 13.5c-1 2 0 3.5 1.5 4" /></>,
  poly: <path d="M3 15L6 4l11 3-4 9z" strokeDasharray="2.2 1.8" />,
  wand: <><path d="M3 17L12 8" /><path d="M13 2v3M13 10v3M9.5 5.5l-2-2M16.5 5.5l2-2M18 7.5h-3" /></>,
  crop: <><path d="M5 1v14h14" /><path d="M1 5h14v14" /></>,
  eyedropper: <><path d="M13.5 3.5a2 2 0 0 1 3 3L9 14l-4 1 1-4z" /><path d="M11.5 5.5l3 3" /></>,
  brush: <><path d="M17 3c-3 2-6 5.5-8 8.5l1.5 1.5C13.5 11 17 8 17 3z" /><path d="M8 12c-2 0-3 1.5-3 3s-1 2-2 2c2 1 6 .5 6.5-3z" /></>,
  clone: <><rect x="5" y="12" width="10" height="3" rx="1" /><path d="M6 15v2h8v-2M8 12V9h4v3M10 9V6" /><circle cx="10" cy="4.5" r="2" /></>,
  eraser: <><path d="M3 13l8-8 6 6-6 6H7z" /><path d="M7 9l6 6M7 17h10" /></>,
  gradient: <><rect x="3" y="4" width="14" height="12" /><path d="M3 4l14 12" opacity=".5" /></>,
  bucket: <><path d="M4 9l6-6 6 6-6 6z" /><path d="M16 11c1 1.6 1.5 2.6 1.5 3.2a1.5 1.5 0 0 1-3 0c0-.6.5-1.6 1.5-3.2z" /></>,
  text: <><path d="M4 4h12M10 4v13M7.5 17h5" /></>,
  shape: <rect x="3" y="3" width="14" height="14" rx="1" />,
  hand: <path d="M7 10V4.5a1.2 1.2 0 0 1 2.4 0V9V3.5a1.2 1.2 0 0 1 2.4 0V9V4.5a1.2 1.2 0 0 1 2.4 0V10V7a1.2 1.2 0 0 1 2.4 0v5c0 3-2 5.5-5.5 5.5-2.5 0-3.5-1-5-3L4.5 12a1.2 1.2 0 0 1 2-1.4z" />,
  zoom: <><circle cx="8.5" cy="8.5" r="5.5" /><path d="M12.5 12.5L17.5 17.5M6 8.5h5M8.5 6v5" /></>,
  eye: <><path d="M1.5 10S5 4 10 4s8.5 6 8.5 6-3.5 6-8.5 6-8.5-6-8.5-6z" /><circle cx="10" cy="10" r="2.6" /></>,
  lock: <><rect x="4.5" y="9" width="11" height="8" rx="1" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></>,
  trash: <><path d="M4 6h12M8 6V4h4v2M5.5 6l1 11h7l1-11" /></>,
  plus: <><rect x="3.5" y="3.5" width="13" height="13" rx="1" /><path d="M10 7v6M7 10h6" /></>,
  folder: <path d="M2.5 5.5h5l1.5 2h8.5v8.5h-15z" />,
  mask: <><rect x="3" y="4" width="14" height="12" rx="1" /><circle cx="10" cy="10" r="3.5" /></>,
  adjust: <><circle cx="10" cy="10" r="7" /><path d="M10 3a7 7 0 0 0 0 14z" fill="currentColor" /></>,
  fx: <text x="3" y="15" fontSize="12" fontStyle="italic" fontWeight="700" stroke="none" fill="currentColor">fx</text>,
  link: <><path d="M8 12l4-4" /><path d="M9 6l1.5-1.5a3 3 0 0 1 4.2 4.2L13 10.5M11 14l-1.5 1.5a3 3 0 0 1-4.2-4.2L7 9.5" /></>,
  chevron: <path d="M7 5l5 5-5 5" />,
  swap: <><path d="M5 8h10l-3-3M15 12H5l3 3" /></>,
  clip: <path d="M6 4v9h9M12 10l3 3-3 3" />,
  alignL: <><path d="M3 2v16" /><rect x="5" y="5" width="10" height="3" /><rect x="5" y="12" width="6" height="3" /></>,
  alignHC: <><path d="M10 2v16" /><rect x="4" y="5" width="12" height="3" /><rect x="6.5" y="12" width="7" height="3" /></>,
  alignR: <><path d="M17 2v16" /><rect x="5" y="5" width="10" height="3" /><rect x="9" y="12" width="6" height="3" /></>,
  alignT: <><path d="M2 3h16" /><rect x="5" y="5" width="3" height="10" /><rect x="12" y="5" width="3" height="6" /></>,
  alignVC: <><path d="M2 10h16" /><rect x="5" y="4" width="3" height="12" /><rect x="12" y="6.5" width="3" height="7" /></>,
  alignB: <><path d="M2 17h16" /><rect x="5" y="5" width="3" height="10" /><rect x="12" y="9" width="3" height="6" /></>,
  distH: <><path d="M3 3v14M17 3v14" /><rect x="8" y="6" width="4" height="8" /></>,
  distV: <><path d="M3 3h14M3 17h14" /><rect x="6" y="8" width="8" height="4" /></>,
  flipH: <><path d="M10 2v16" strokeDasharray="2 2" /><path d="M8 5L3 15h5zM12 5l5 10h-5z" /></>,
  flipV: <><path d="M2 10h16" strokeDasharray="2 2" /><path d="M5 8L15 3v5zM5 12l10 5v-5z" /></>,
  rotCW: <><path d="M15 9a5.5 5.5 0 1 1-2-4.3" /><path d="M14 2v4h-4" /></>,
  rotCCW: <><path d="M5 9a5.5 5.5 0 1 0 2-4.3" /><path d="M6 2v4h4" /></>,
  textR: <path d="M4 5h13M8 9h9M4 13h13M10 17h7" />,
  textC: <path d="M3 5h14M6 9h8M3 13h14M7 17h6" />,
  textLft: <path d="M3 5h13M3 9h9M3 13h13M3 17h7" />,
  textJ: <path d="M3 5h14M3 9h14M3 13h14M3 17h9" />,
  group: <path d="M2.5 5.5h5l1.5 2h8.5v8.5h-15z" />,
  check: <path d="M4 10l4 4 8-8" />,
  close: <path d="M5 5l10 10M15 5L5 15" />,
};

export function Ico({ n, size = 18 }: { n: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[n] ?? null}
    </svg>
  );
}
