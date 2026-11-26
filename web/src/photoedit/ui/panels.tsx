/** UI Panels: Layers, Properties, Adjustments, History, Color, Swatches, Character, Paragraph, Align, Transform. */
import { useEffect, useRef, useState } from 'react';
import { ADJUSTMENTS, adjustDef, curveLut } from '../adjust';
import type { Editor } from '../editor';
import { customFonts } from '../editor';
import { FONTS, WEIGHT_NAMES, weightsOf } from '../fonts';
import type { AdjustLayer, BlendMode, Effects, Layer, ShapeLayer, TextLayer, TextStyle, XfLayer } from '../model';
import { BLEND_MODES, findLayer, flatForPanel, isXf, makeGroup, touch } from '../model';
import { drawThumb, layerBounds, localBox } from '../render';
import { layoutText } from '../text';
import { Check, ColorField, ColorPicker, Ico, Num, Seg, Slider, useEditor } from './widgets';

/* ======================= Layers ======================= */

function Thumb({ ed, layer }: { ed: Editor; layer: Layer }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, d = ed.doc;
    if (!c || !d) return;
    if (layer.type === 'adjust') return;
    const t = window.setTimeout(() => drawThumb(layer, d, c), 30);
    return () => window.clearTimeout(t);
  }, [ed, layer, layer.rev, ed.doc?.width, ed.doc?.height]);
  if (layer.type === 'adjust') return <div className="pe-thumb pe-thumb-adj"><Ico n="adjust" size={16} /></div>;
  if (layer.type === 'text') return <div className="pe-thumb pe-thumb-text">T</div>;
  return <canvas ref={ref} className="pe-thumb" width={40} height={40} />;
}

function MaskThumb({ ed, layer }: { ed: Editor; layer: Layer }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, d = ed.doc;
    if (!c || !d || !layer.mask) return;
    const x = c.getContext('2d')!;
    x.fillStyle = '#000';
    x.fillRect(0, 0, c.width, c.height);
    const k = Math.min(c.width / d.width, c.height / d.height);
    const tmp = document.createElement('canvas');
    tmp.width = c.width; tmp.height = c.height;
    const tx = tmp.getContext('2d')!;
    tx.drawImage(layer.mask.canvas, (c.width - d.width * k) / 2, (c.height - d.height * k) / 2, d.width * k, d.height * k);
    tx.globalCompositeOperation = 'source-in';
    tx.fillStyle = '#fff';
    tx.fillRect(0, 0, c.width, c.height);
    x.drawImage(tmp, 0, 0);
  }, [ed, layer, layer.rev, layer.mask]);
  return <canvas ref={ref} className="pe-thumb pe-mask-thumb" width={40} height={40} />;
}

export function LayersPanel({ ed }: { ed: Editor }) {
  useEditor(ed);
  const st = ed.st;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; where: 'above' | 'below' | 'into' } | null>(null);
  const [menu, setMenu] = useState<'adjust' | 'fx' | null>(null);
  if (!st) return <div className="pe-empty-panel">אין מסמך פתוח</div>;
  const rows = flatForPanel(st.doc.layers);
  const a = ed.active;
  const sel = new Set(st.selected);

  const onRowClick = (e: React.MouseEvent, l: Layer) => {
    const mod = e.ctrlKey || e.metaKey;
    ed.selectLayer(l.id, e.shiftKey ? 'range' : mod ? 'toggle' : 'set');
  };

  return (
    <div className="pe-layers">
      <div className="pe-layers-top">
        <select
          value={a?.blend ?? 'normal'}
          disabled={!a || a.type === 'adjust'}
          onChange={(e) => { for (const l of ed.topSelected()) { l.blend = e.target.value as BlendMode; touch(l); } ed.commit('מצב מיזוג'); }}
          title="Blend Mode"
        >
          {BLEND_MODES.map((b, i) => (b ? <option key={b[0]} value={b[0]}>{b[1]}</option> : <option key={`s${i}`} disabled>──────</option>))}
        </select>
        <Num label="Opacity" value={Math.round((a?.opacity ?? 1) * 100)} min={0} max={100} unit="%" width={36}
          onChange={(v) => { for (const l of ed.topSelected()) { l.opacity = v / 100; touch(l); } ed.softCommit('אטימות'); }} />
      </div>
      <div className="pe-layers-locks">
        <span>Lock:</span>
        <button type="button" className={a?.locked ? 'on' : ''} title="נעילת שכבה (Ctrl+/)" onClick={() => ed.run('layer.lock')}><Ico n="lock" size={14} /></button>
        {a?.mask && <span className="pe-maskmode">{st.maskEdit ? 'עריכת מסכה' : ''}</span>}
      </div>
      <div className="pe-layer-list" onDragLeave={() => setDrop(null)}>
        {rows.map(({ layer: l, depth }) => (
          <div
            key={l.id}
            className={`pe-layer-row ${sel.has(l.id) ? 'sel' : ''} ${st.active === l.id ? 'active' : ''} ${drop?.id === l.id ? `drop-${drop.where}` : ''} ${l.clip ? 'clipped' : ''}`}
            style={{ paddingInlineStart: 6 + depth * 16 }}
            draggable={renaming !== l.id}
            onDragStart={(e) => { e.dataTransfer.setData('text/x-pe-layer', l.id); if (!sel.has(l.id)) ed.selectLayer(l.id); }}
            onDragOver={(e) => {
              e.preventDefault();
              const rc = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const y = (e.clientY - rc.top) / rc.height;
              setDrop({ id: l.id, where: l.type === 'group' && y > 0.3 && y < 0.7 ? 'into' : y < 0.5 ? 'above' : 'below' });
            }}
            onDrop={(e) => { e.preventDefault(); if (drop) ed.moveLayers(ed.topSelected().map((x) => x.id), drop.id, drop.where); setDrop(null); }}
            onClick={(e) => onRowClick(e, l)}
            onDoubleClick={() => setRenaming(l.id)}
          >
            <button type="button" className={`pe-eye ${l.visible ? '' : 'off'}`} title="הצג/הסתר (Alt+לחיצה = רק השכבה הזו)"
              onClick={(e) => {
                e.stopPropagation();
                if (e.altKey) { const siblings = findLayer(st.doc.layers, l.id)!.parent; const solo = siblings.every((s) => s === l || !s.visible); siblings.forEach((s) => { s.visible = solo ? true : s === l; touch(s); }); }
                else { l.visible = !l.visible; touch(l); }
                ed.commit(l.visible ? 'הצגת שכבה' : 'הסתרת שכבה');
              }}>
              <Ico n="eye" size={15} />
            </button>
            {l.clip && <span className="pe-clip-arrow" title="Clipping Mask"><Ico n="clip" size={13} /></span>}
            {l.type === 'group' && (
              <button type="button" className={`pe-twisty ${l.open ? 'open' : ''}`} onClick={(e) => { e.stopPropagation(); l.open = !l.open; ed.emit(); }}><Ico n="chevron" size={12} /></button>
            )}
            {l.type === 'group' ? <span className="pe-thumb pe-thumb-group"><Ico n="group" size={16} /></span> : (
              <span title="Ctrl+לחיצה = בחירה מהשכבה" onClick={(e) => { if (e.ctrlKey || e.metaKey) { e.stopPropagation(); ed.selectionFromLayer(l, e.shiftKey ? 'add' : e.altKey ? 'sub' : 'new'); } else if (st.maskEdit && st.active === l.id) { st.maskEdit = false; ed.emit(); } }}>
                <Thumb ed={ed} layer={l} />
              </span>
            )}
            {l.mask && (
              <span
                className={`pe-mask-wrap ${st.maskEdit && st.active === l.id ? 'editing' : ''} ${l.mask.enabled ? '' : 'disabled'}`}
                title="לחיצה = עריכת המסכה · Shift+לחיצה = כיבוי/הפעלה"
                onClick={(e) => { e.stopPropagation(); if (e.shiftKey) { ed.toggleMaskEnabled(l); return; } ed.selectLayer(l.id); st.maskEdit = true; ed.emit(); }}
              >
                <MaskThumb ed={ed} layer={l} />
              </span>
            )}
            {renaming === l.id ? (
              <input className="pe-rename" autoFocus defaultValue={l.name}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }}
                onBlur={(e) => { const v = e.target.value.trim(); setRenaming(null); if (v && v !== l.name) { l.name = v; ed.commit('שינוי שם'); } }} />
            ) : (
              <span className="pe-layer-name" dir="auto">{l.name}</span>
            )}
            {l.type !== 'adjust' && (l.fx.shadow.on || l.fx.stroke.on || l.fx.glow.on || l.fx.overlay.on) && <span className="pe-fx-badge">fx</span>}
            {l.locked && <span className="pe-lock-badge"><Ico n="lock" size={12} /></span>}
          </div>
        ))}
        {!rows.length && <div className="pe-empty-panel">אין שכבות</div>}
      </div>
      <div className="pe-layers-bottom">
        <div className="pe-menu-anchor">
          <button type="button" title="Layer Style" onClick={() => setMenu(menu === 'fx' ? null : 'fx')} disabled={!a || a.type === 'adjust'}><Ico n="fx" /></button>
          {menu === 'fx' && a && (
            <div className="pe-dropmenu up" onMouseLeave={() => setMenu(null)}>
              {(['shadow', 'stroke', 'glow', 'overlay'] as const).map((k) => (
                <button key={k} type="button" onClick={() => { a.fx[k].on = true; touch(a); ed.commit('Layer Style'); setMenu(null); ed.openPanel('Properties'); }}>
                  {{ shadow: 'Drop Shadow · צל', stroke: 'Stroke · קו מתאר', glow: 'Outer Glow · זוהר', overlay: 'Color Overlay · שכבת צבע' }[k]}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" title="הוספת מסכה (Alt = מסכה שמסתירה הכול)" onClick={(e) => ed.addMask(e.altKey)} disabled={!a}><Ico n="mask" /></button>
        <div className="pe-menu-anchor">
          <button type="button" title="שכבת התאמה חדשה" onClick={() => setMenu(menu === 'adjust' ? null : 'adjust')}><Ico n="adjust" /></button>
          {menu === 'adjust' && (
            <div className="pe-dropmenu up" onMouseLeave={() => setMenu(null)}>
              {ADJUSTMENTS.map((d) => (
                <button key={d.kind} type="button" onClick={() => { ed.addAdjustLayer(d.kind); setMenu(null); ed.openPanel('Properties'); }}>{d.en} · {d.name}</button>
              ))}
            </div>
          )}
        </div>
        <button type="button" title="קבוצה חדשה (Ctrl+G)" onClick={() => { if (ed.topSelected().length) ed.run('layer.group'); else { ed.insert(makeGroup([], 'קבוצה')); ed.commit('קבוצה חדשה'); } }}><Ico n="folder" /></button>
        <button type="button" title="שכבה חדשה (Ctrl+Shift+N)" onClick={() => ed.run('layer.new')}><Ico n="plus" /></button>
        <button type="button" title="מחיקת שכבה (Delete)" onClick={() => ed.deleteSelected()} disabled={!ed.topSelected().length}><Ico n="trash" /></button>
      </div>
    </div>
  );
}


/* ======================= History ======================= */

export function HistoryPanel({ ed }: { ed: Editor }) {
  useEditor(ed);
  const st = ed.st;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector('.cur')?.scrollIntoView({ block: 'nearest' }); });
  if (!st) return <div className="pe-empty-panel">אין מסמך פתוח</div>;
  return (
    <div className="pe-history" ref={list}>
      {st.history.states.map((s, i) => (
        <button key={`${s.time}-${i}`} type="button" className={`pe-hist-row ${i === st.history.index ? 'cur' : ''} ${i > st.history.index ? 'future' : ''}`} onClick={() => ed.jump(i)}>
          {i === 0 ? <span className="pe-hist-snap" /> : null}
          <span>{s.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ======================= Color / Swatches ======================= */

export function ColorPanel({ ed }: { ed: Editor }) {
  useEditor(ed);
  const [which, setWhich] = useState<'fg' | 'bg'>('fg');
  return (
    <div className="pe-color-panel">
      <div className="pe-fgbg-mini">
        <button type="button" className={`fg ${which === 'fg' ? 'on' : ''}`} style={{ background: ed.fg }} onClick={() => setWhich('fg')} title="צבע קדמי" />
        <button type="button" className={`bg ${which === 'bg' ? 'on' : ''}`} style={{ background: ed.bg }} onClick={() => setWhich('bg')} title="צבע רקע" />
      </div>
      <ColorPicker value={which === 'fg' ? ed.fg : ed.bg} onChange={(c) => { if (which === 'fg') ed.fg = c; else ed.bg = c; ed.emit(); }} />
    </div>
  );
}

export function SwatchesPanel({ ed }: { ed: Editor }) {
  useEditor(ed);
  return (
    <div className="pe-swatches">
      {ed.swatches.map((c, i) => (
        <button key={`${c}-${i}`} type="button" style={{ background: c }} title={`${c} · לחיצה = קדמי, Alt = רקע, קליק ימני = מחיקה`}
          onClick={(e) => { if (e.altKey) ed.bg = c; else ed.fg = c; ed.emit(); }}
          onContextMenu={(e) => { e.preventDefault(); ed.swatches.splice(i, 1); ed.emit(); }} />
      ))}
      <button type="button" className="pe-swatch-add" title="הוספת הצבע הקדמי" onClick={() => { ed.swatches.push(ed.fg); ed.emit(); }}>+</button>
    </div>
  );
}

/* ======================= Transform ======================= */

export function TransformPanel({ ed }: { ed: Editor }) {
  useEditor(ed);
  const items = ed.transformable();
  if (!items.length) return <div className="pe-empty-panel">בחר שכבה</div>;
  const single = items.length === 1 ? items[0] : null;
  const b = single ? localBox(single) : null;
  const bounds = ed.topSelected().map(layerBounds).filter(Boolean).reduce<{ x: number; y: number; w: number; h: number } | null>((a, r) => (a ? { x: Math.min(a.x, r!.x), y: Math.min(a.y, r!.y), w: Math.max(a.x + a.w, r!.x + r!.w) - Math.min(a.x, r!.x), h: Math.max(a.y + a.h, r!.y + r!.h) - Math.min(a.y, r!.y) } : r!), null);
  if (!bounds) return null;
  const moveBy = (dx: number, dy: number) => { for (const l of items) { l.t.x += dx; l.t.y += dy; touch(l); } ed.softCommit('הזזה'); };
  const W = single ? Math.abs(b!.w * single.t.sx) : bounds.w, H = single ? Math.abs(b!.h * single.t.sy) : bounds.h;
  const setSize = (w: number | null, h: number | null, link: boolean) => {
    if (single) {
      const kx = w != null ? w / W : link && h != null ? h / H : 1;
      const ky = h != null ? h / H : link && w != null ? w / W : 1;
      single.t.sx *= kx; single.t.sy *= ky;
      ed.bakeScale(single);
      touch(single);
    } else {
      const kx = w != null ? w / bounds.w : link && h != null ? h / bounds.h : 1, ky = h != null ? h / bounds.h : link && w != null ? w / bounds.w : 1;
      for (const l of items) { l.t.x = bounds.x + (l.t.x - bounds.x) * kx; l.t.y = bounds.y + (l.t.y - bounds.y) * ky; l.t.sx *= kx; l.t.sy *= ky; ed.bakeScale(l); touch(l); }
    }
    ed.softCommit('שינוי גודל');
  };
  return <TransformFields ed={ed} x={bounds.x} y={bounds.y} w={W} h={H} rot={single?.t.rot ?? 0} onMove={moveBy} onSize={setSize}
    onRot={single ? (r) => { single.t.rot = r; touch(single); ed.softCommit('סיבוב'); } : null} />;
}

function TransformFields({ ed, x, y, w, h, rot, onMove, onSize, onRot }: { ed: Editor; x: number; y: number; w: number; h: number; rot: number; onMove: (dx: number, dy: number) => void; onSize: (w: number | null, h: number | null, link: boolean) => void; onRot: ((r: number) => void) | null }) {
  const [link, setLink] = useState(true);
  return (
    <div className="pe-xf">
      <div className="pe-row">
        <Num label="X" value={x} onChange={(v) => onMove(v - x, 0)} unit="px" />
        <Num label="Y" value={y} onChange={(v) => onMove(0, v - y)} unit="px" />
      </div>
      <div className="pe-row">
        <Num label="W" value={w} min={1} onChange={(v) => onSize(v, null, link)} unit="px" />
        <button type="button" className={`pe-link ${link ? 'on' : ''}`} title="שמירה על יחס" onClick={() => setLink(!link)}><Ico n="link" size={14} /></button>
        <Num label="H" value={h} min={1} onChange={(v) => onSize(null, v, link)} unit="px" />
      </div>
      <div className="pe-row">
        {onRot && <Num label="∠" value={+rot.toFixed(1)} digits={1} onChange={onRot} unit="°" title="סיבוב" />}
        <button type="button" title="היפוך אופקי" onClick={() => ed.flip(true)}><Ico n="flipH" /></button>
        <button type="button" title="היפוך אנכי" onClick={() => ed.flip(false)}><Ico n="flipV" /></button>
        <button type="button" title="סיבוב 90° נגד השעון" onClick={() => ed.rotateLayers(-90)}><Ico n="rotCCW" /></button>
        <button type="button" title="סיבוב 90° עם השעון" onClick={() => ed.rotateLayers(90)}><Ico n="rotCW" /></button>
      </div>
    </div>
  );
}

/* ======================= Align ======================= */

export function AlignPanel({ ed }: { ed: Editor }) {
  useEditor(ed);
  const [toCanvas, setToCanvas] = useState(false);
  const n = ed.topSelected().length;
  return (
    <div className="pe-align">
      <div className="pe-row">
        {(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map((k) => (
          <button key={k} type="button" disabled={!n} title={{ left: 'יישור לשמאל', hcenter: 'מרכוז אופקי', right: 'יישור לימין', top: 'יישור למעלה', vcenter: 'מרכוז אנכי', bottom: 'יישור למטה' }[k]}
            onClick={() => ed.align(k, toCanvas)}>
            <Ico n={{ left: 'alignL', hcenter: 'alignHC', right: 'alignR', top: 'alignT', vcenter: 'alignVC', bottom: 'alignB' }[k]} />
          </button>
        ))}
      </div>
      <div className="pe-row">
        <button type="button" disabled={n < 3} title="פיזור אופקי" onClick={() => ed.distribute('h')}><Ico n="distH" /></button>
        <button type="button" disabled={n < 3} title="פיזור אנכי" onClick={() => ed.distribute('v')}><Ico n="distV" /></button>
        <Check label="ליישר לקנבס" checked={toCanvas} onChange={setToCanvas} />
      </div>
      <p className="pe-hint">שכבה אחת מתיישרת לקנבס; כמה שכבות — זו לזו. בחירה פעילה = יישור לבחירה.</p>
    </div>
  );
}

/* ======================= Character / Paragraph ======================= */

function textTargets(ed: Editor): TextLayer[] {
  const te = ed.live.textEdit;
  if (te) { const l = ed.layer(te.layerId); return l && l.type === 'text' ? [l] : []; }
  return ed.topSelected().filter((l): l is TextLayer => l.type === 'text');
}

export function applyTextStyle(ed: Editor, patch: Partial<TextStyle>, extra?: (l: TextLayer) => void) {
  Object.assign(ed.opts.text, patch);
  if (patch.color) ed.fg = patch.color;
  const ts = textTargets(ed);
  for (const l of ts) {
    const before = layoutText(l);
    l.style = { ...l.style, ...patch };
    extra?.(l);
    ed.reanchorText(l, before.w, before.h);
    touch(l);
    ed.fontReady(l.style);
  }
  ed.fontReady(ed.opts.text);
  if (ts.length && !ed.live.textEdit) ed.softCommit('Character');
  else { ed.redraw(true); ed.emit(); }
}

export function FontSelect({ ed, value, onChange }: { ed: Editor; value: string; onChange: (f: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const custom = [...customFonts];
  return (
    <div className="pe-font-select">
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: `"${value}"` }} title="Font Family">
        {custom.length > 0 && <optgroup label="שהועלו">{custom.map((f) => <option key={f} value={f}>{f}</option>)}</optgroup>}
        <optgroup label="עברית">{FONTS.filter((f) => f.hebrew).map((f) => <option key={f.family} value={f.family} style={{ fontFamily: `"${f.family}"` }}>{f.family}</option>)}</optgroup>
        <optgroup label="Latin">{FONTS.filter((f) => !f.hebrew).map((f) => <option key={f.family} value={f.family} style={{ fontFamily: `"${f.family}"` }}>{f.family}</option>)}</optgroup>
        {!FONTS.some((f) => f.family === value) && !custom.includes(value) && <option value={value}>{value}</option>}
      </select>
      <button type="button" className="pe-small-btn" title="העלאת פונט (TTF/OTF/WOFF) — נשמר בתוך המסמך" onClick={() => fileRef.current?.click()}>+</button>
      <input ref={fileRef} type="file" hidden accept=".ttf,.otf,.woff,.woff2" onChange={async (e) => { const f = e.target.files?.[0]; if (f) onChange(await ed.uploadFont(f)); e.target.value = ''; }} />
    </div>
  );
}

export function CharacterPanel({ ed }: { ed: Editor }) {
  useEditor(ed);
  const t = textTargets(ed)[0];
  const s = t?.style ?? ed.opts.text;
  const set = (p: Partial<TextStyle>) => applyTextStyle(ed, p);
  const weights = weightsOf(s.family);
  return (
    <div className="pe-char">
      {!t && <p className="pe-hint">הגדרות לטקסט הבא שתיצור (T). בחר שכבת טקסט כדי לשנות אותה.</p>}
      <FontSelect ed={ed} value={s.family} onChange={(family) => set({ family, weight: weightsOf(family).includes(s.weight) ? s.weight : weightsOf(family).reduce((a, b) => (Math.abs(b - s.weight) < Math.abs(a - s.weight) ? b : a)) })} />
      <div className="pe-row">
        <select value={s.weight} onChange={(e) => set({ weight: Number(e.target.value) })} title="Font Weight">
          {weights.map((w) => <option key={w} value={w}>{w} {WEIGHT_NAMES[w]}</option>)}
        </select>
        <button type="button" className={s.italic ? 'on' : ''} onClick={() => set({ italic: !s.italic })} title="Italic"><i>I</i></button>
      </div>
      <div className="pe-row">
        <Num label="Size" value={s.size} min={1} max={2000} step={1} digits={1} unit="px" onChange={(v) => set({ size: v })} title="גודל פונט" />
        <Num label="Leading" value={s.leading || Math.round(s.size * 1.2)} min={1} max={4000} digits={1} unit="px" onChange={(v) => set({ leading: v })} title="ריווח שורות (0 = אוטומטי)" />
      </div>
      <div className="pe-row">
        <Num label="Tracking" value={s.tracking} min={-500} max={2000} step={5} onChange={(v) => set({ tracking: v })} title="ריווח אותיות באלפיות em" />
        <Check label="Kerning" checked={s.kerning} onChange={(v) => set({ kerning: v })} title="קרנינג אוטומטי של הפונט" />
      </div>
      <div className="pe-row">
        <span className="pe-lbl">Color</span>
        <ColorField value={s.color} onChange={(c) => set({ color: c })} title="צבע טקסט" />
        <button type="button" className={s.underline ? 'on' : ''} onClick={() => set({ underline: !s.underline })} title="קו תחתון"><u>U</u></button>
        <button type="button" className={s.caps ? 'on' : ''} onClick={() => set({ caps: !s.caps })} title="All Caps">TT</button>
        <button type="button" onClick={() => set({ leading: 0 })} title="Leading אוטומטי">Auto</button>
      </div>
      {t && <TextFx ed={ed} l={t} />}
    </div>
  );
}

/** קו מתאר וצל לטקסט — מקוצר מתוך Layer Style */
function TextFx({ ed, l }: { ed: Editor; l: TextLayer }) {
  const fx = l.fx;
  const upd = (fn: () => void) => { fn(); touch(l); ed.softCommit('Layer Style'); };
  return (
    <div className="pe-textfx">
      <div className="pe-row">
        <Check label="Stroke" checked={fx.stroke.on} onChange={(v) => upd(() => { fx.stroke.on = v; })} />
        <ColorField value={fx.stroke.color} onChange={(c) => upd(() => { fx.stroke.color = c; })} />
        <Num value={fx.stroke.width} min={0} max={200} digits={1} unit="px" width={36} onChange={(v) => upd(() => { fx.stroke.width = v; })} />
      </div>
      <div className="pe-row">
        <Check label="Shadow" checked={fx.shadow.on} onChange={(v) => upd(() => { fx.shadow.on = v; })} />
        <ColorField value={fx.shadow.color} onChange={(c) => upd(() => { fx.shadow.color = c; })} />
        <Num value={fx.shadow.distance} min={0} max={500} unit="px" width={34} title="מרחק" onChange={(v) => upd(() => { fx.shadow.distance = v; })} />
        <Num value={fx.shadow.blur} min={0} max={250} unit="px" width={34} title="טשטוש" onChange={(v) => upd(() => { fx.shadow.blur = v; })} />
      </div>
    </div>
  );
}

export function ParagraphPanel({ ed }: { ed: Editor }) {
  useEditor(ed);
  const t = textTargets(ed)[0];
  const s = t?.style ?? ed.opts.text;
  return (
    <div className="pe-para">
      <div className="pe-row">
        <Seg value={s.align} onChange={(align) => applyTextStyle(ed, { align })} options={[['right', <Ico key="r" n="textR" />, 'יישור לימין'], ['center', <Ico key="c" n="textC" />, 'מרכוז'], ['left', <Ico key="l" n="textLft" />, 'יישור לשמאל'], ['justify', <Ico key="j" n="textJ" />, 'יישור לשני הצדדים']]} />
      </div>
      <div className="pe-row">
        <Seg value={s.dir} onChange={(dir) => applyTextStyle(ed, { dir, align: s.align === 'justify' ? 'justify' : dir === 'rtl' ? 'right' : 'left' })} options={[['rtl', 'RTL · עברית'], ['ltr', 'LTR · English']]} />
      </div>
      {t && (
        <div className="pe-row">
          <Seg value={t.boxW == null ? 'point' : 'box'} onChange={(v) => applyTextStyle(ed, {}, (l) => { l.boxW = v === 'point' ? null : Math.max(layoutText(l).w + 2, 50); })} options={[['point', 'Point Text'], ['box', 'Paragraph']]} />
          {t.boxW != null && <Num label="Box W" value={t.boxW} min={10} unit="px" onChange={(v) => applyTextStyle(ed, {}, (l) => { l.boxW = v; })} />}
        </div>
      )}
      <p className="pe-hint">כיוון RTL מציג עברית נכון, כולל פיסוק ומספרים בתוך המשפט.</p>
    </div>
  );
}

/* ======================= Adjustments ======================= */

export function AdjustmentsPanel({ ed }: { ed: Editor }) {
  useEditor(ed);
  return (
    <div className="pe-adj-grid">
      {ADJUSTMENTS.map((d) => (
        <button key={d.kind} type="button" disabled={!ed.doc} onClick={() => { ed.addAdjustLayer(d.kind); ed.openPanel('Properties'); }} title={`${d.en} — שכבת התאמה (לא הרסני)`}>
          <span>{d.name}</span>
          <small dir="ltr">{d.en}</small>
        </button>
      ))}
    </div>
  );
}

/** עורך עקומות: לחיצה מוסיפה נקודה, גרירה מזיזה, גרירה החוצה מוחקת */
export function CurvesEditor({ points, onChange }: { points: number[][]; onChange: (p: number[][]) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<number | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const x = c.getContext('2d')!, S = c.width;
    x.fillStyle = '#1b1b1b';
    x.fillRect(0, 0, S, S);
    x.strokeStyle = '#3a3a3a';
    x.beginPath();
    for (let i = 1; i < 4; i++) { x.moveTo((S * i) / 4, 0); x.lineTo((S * i) / 4, S); x.moveTo(0, (S * i) / 4); x.lineTo(S, (S * i) / 4); }
    x.moveTo(0, S); x.lineTo(S, 0);
    x.stroke();
    const lut = curveLut(points);
    x.strokeStyle = '#e8e8e8';
    x.lineWidth = 1.5;
    x.beginPath();
    for (let i = 0; i < 256; i++) { const px = (i / 255) * S, py = S - (lut[i] / 255) * S; if (i) x.lineTo(px, py); else x.moveTo(px, py); }
    x.stroke();
    x.fillStyle = '#fff';
    for (const [px, py] of points) x.fillRect((px / 255) * S - 3, S - (py / 255) * S - 3, 6, 6);
  }, [points]);
  const toVal = (e: React.PointerEvent) => {
    const rc = ref.current!.getBoundingClientRect();
    return [Math.round(Math.min(255, Math.max(0, ((e.clientX - rc.left) / rc.width) * 255))), Math.round(Math.min(255, Math.max(0, (1 - (e.clientY - rc.top) / rc.height) * 255)))];
  };
  return (
    <canvas ref={ref} width={200} height={200} className="pe-curves"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const [vx, vy] = toVal(e);
        let i = points.findIndex(([px, py]) => Math.abs(px - vx) < 10 && Math.abs(py - vy) < 14);
        const next = points.map((p) => [...p]);
        if (i < 0) { next.push([vx, vy]); next.sort((a, b) => a[0] - b[0]); i = next.findIndex((p) => p[0] === vx && p[1] === vy); onChange(next); }
        drag.current = i;
      }}
      onPointerMove={(e) => {
        if (drag.current == null || !e.buttons) return;
        const [vx, vy] = toVal(e);
        const rc = ref.current!.getBoundingClientRect();
        const out = e.clientY > rc.bottom + 20 || e.clientY < rc.top - 20;
        const next = points.map((p) => [...p]);
        const i = drag.current;
        if (out && i > 0 && i < next.length - 1) { next.splice(i, 1); drag.current = null; onChange(next); return; }
        const lo = i > 0 ? next[i - 1][0] + 1 : 0, hi = i < next.length - 1 ? next[i + 1][0] - 1 : 255;
        next[i] = [i === 0 ? Math.min(vx, hi) : i === next.length - 1 ? Math.max(vx, lo) : Math.min(hi, Math.max(lo, vx)), vy];
        onChange(next);
      }}
      onPointerUp={() => { drag.current = null; }}
    />
  );
}

/** עורך פרמטרים להתאמה — משותף לשכבת התאמה ול-Image > Adjustments */
export function AdjustParams({ kind, p, onChange }: { kind: AdjustLayer['kind']; p: Record<string, any>; onChange: (p: Record<string, any>) => void }) {
  const set = (k: string, v: unknown) => onChange({ ...p, [k]: v });
  const S = (k: string, label: string, min: number, max: number, step = 1, unit = '') => <Slider key={k} label={label} value={p[k]} min={min} max={max} step={step} unit={unit} digits={step < 1 ? 2 : 0} onChange={(v) => set(k, v)} />;
  switch (kind) {
    case 'brightness': return <>{S('brightness', 'Brightness · בהירות', -150, 150)}{S('contrast', 'Contrast · ניגודיות', -50, 100)}</>;
    case 'levels': return <>{S('inBlack', 'Input Black', 0, 253)}{S('gamma', 'Midtones (Gamma)', 0.1, 9.99, 0.01)}{S('inWhite', 'Input White', 2, 255)}{S('outBlack', 'Output Black', 0, 255)}{S('outWhite', 'Output White', 0, 255)}</>;
    case 'curves': {
      const ch = p.channel as 'rgb' | 'r' | 'g' | 'b';
      return (
        <>
          <Seg value={ch} onChange={(v) => set('channel', v)} options={[['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']]} />
          <CurvesEditor points={p[ch]} onChange={(pts) => set(ch, pts)} />
          <p className="pe-hint">לחיצה מוסיפה נקודה · גרירה מחוץ לגרף מוחקת</p>
        </>
      );
    }
    case 'exposure': return <>{S('exposure', 'Exposure', -5, 5, 0.01)}{S('offset', 'Offset', -0.5, 0.5, 0.001)}{S('gamma', 'Gamma', 0.1, 3, 0.01)}</>;
    case 'vibrance': return <>{S('vibrance', 'Vibrance · חיוניות', -100, 100)}{S('saturation', 'Saturation · רוויה', -100, 100)}</>;
    case 'hueSat': return <>{S('hue', 'Hue · גוון', -180, 180)}{S('saturation', 'Saturation · רוויה', -100, 100)}{S('lightness', 'Lightness · בהירות', -100, 100)}<Check label="Colorize" checked={!!p.colorize} onChange={(v) => set('colorize', v)} /></>;
    case 'colorBalance': {
      const tone = p.tone as 'shadows' | 'midtones' | 'highlights';
      const arr = p[tone] as number[];
      const setI = (i: number, v: number) => { const n = [...arr]; n[i] = v; set(tone, n); };
      return (
        <>
          <Seg value={tone} onChange={(v) => set('tone', v)} options={[['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']]} />
          <Slider label="Cyan ⟷ Red" value={arr[0]} min={-100} max={100} onChange={(v) => setI(0, v)} />
          <Slider label="Magenta ⟷ Green" value={arr[1]} min={-100} max={100} onChange={(v) => setI(1, v)} />
          <Slider label="Yellow ⟷ Blue" value={arr[2]} min={-100} max={100} onChange={(v) => setI(2, v)} />
          <Check label="Preserve Luminosity" checked={!!p.preserve} onChange={(v) => set('preserve', v)} />
        </>
      );
    }
    case 'bw': return <>{S('reds', 'Reds', -200, 300)}{S('yellows', 'Yellows', -200, 300)}{S('greens', 'Greens', -200, 300)}{S('cyans', 'Cyans', -200, 300)}{S('blues', 'Blues', -200, 300)}{S('magentas', 'Magentas', -200, 300)}<div className="pe-row"><Check label="Tint" checked={!!p.tint} onChange={(v) => set('tint', v)} /><ColorField value={p.tintColor} onChange={(c) => set('tintColor', c)} /></div></>;
    case 'shadowsHighlights': return <>{S('shadows', 'Shadows · הבהרת צללים', 0, 100)}{S('highlights', 'Highlights · הנמכת הארות', 0, 100)}</>;
    case 'temperature': return <>{S('temperature', 'Temperature · חום', -100, 100)}{S('tint', 'Tint · ירוק/מג׳נטה', -100, 100)}</>;
    case 'invert': return <p className="pe-hint">היפוך כל הצבעים מתחת לשכבה.</p>;
    case 'posterize': return S('levels', 'Levels', 2, 32);
    case 'threshold': return S('level', 'Threshold Level', 1, 255);
    case 'gradientMap': return <div className="pe-row"><ColorField value={p.c1} onChange={(c) => set('c1', c)} title="צללים" /><span className="pe-gradbar" style={{ background: `linear-gradient(90deg, ${p.c1}, ${p.c2})` }} /><ColorField value={p.c2} onChange={(c) => set('c2', c)} title="הארות" /></div>;
  }
}

/* ======================= Properties ======================= */

function ShapeProps({ ed, l }: { ed: Editor; l: ShapeLayer }) {
  const upd = (fn: () => void) => { fn(); touch(l); ed.softCommit('מאפייני צורה'); };
  return (
    <div className="pe-props-sec">
      <h4>Appearance · צורה</h4>
      <div className="pe-row">
        <span className="pe-lbl">Fill</span>
        <select value={l.fill.type} onChange={(e) => upd(() => { l.fill = { ...l.fill, type: e.target.value as ShapeLayer['fill']['type'] }; })}>
          <option value="solid">Solid</option><option value="linear">Linear Gradient</option><option value="radial">Radial Gradient</option><option value="none">None</option>
        </select>
        {l.fill.type !== 'none' && <ColorField value={l.fill.color} onChange={(c) => upd(() => { l.fill = { ...l.fill, color: c }; })} />}
        {(l.fill.type === 'linear' || l.fill.type === 'radial') && <ColorField value={l.fill.color2} onChange={(c) => upd(() => { l.fill = { ...l.fill, color2: c }; })} />}
      </div>
      {l.fill.type === 'linear' && <Num label="Angle" value={l.fill.angle} min={-180} max={180} unit="°" onChange={(v) => upd(() => { l.fill = { ...l.fill, angle: v }; })} />}
      <div className="pe-row">
        <Check label="Stroke" checked={l.stroke.on} onChange={(v) => upd(() => { l.stroke = { ...l.stroke, on: v }; })} />
        <ColorField value={l.stroke.color} onChange={(c) => upd(() => { l.stroke = { ...l.stroke, color: c }; })} />
        <Num value={l.stroke.width} min={0} max={500} digits={1} unit="px" width={38} onChange={(v) => upd(() => { l.stroke = { ...l.stroke, width: v }; })} />
      </div>
      {l.shape === 'rect' && <Num label="Radius" value={l.radius} min={0} max={5000} unit="px" onChange={(v) => upd(() => { l.radius = v; })} />}
      {(l.shape === 'polygon' || l.shape === 'star') && <Num label="Sides" value={l.sides} min={3} max={64} onChange={(v) => upd(() => { l.sides = Math.round(v); })} />}
      {l.shape === 'line' && <Num label="Weight" value={l.h} min={1} max={500} unit="px" onChange={(v) => upd(() => { l.h = v; })} />}
    </div>
  );
}

function FxEditor({ ed, l }: { ed: Editor; l: Layer }) {
  const fx = l.fx;
  const upd = (fn: (f: Effects) => void) => { fn(fx); touch(l); ed.softCommit('Layer Style'); };
  return (
    <div className="pe-props-sec">
      <h4>Layer Style · אפקטים</h4>
      <div className="pe-fx-block">
        <div className="pe-row"><Check label="Drop Shadow" checked={fx.shadow.on} onChange={(v) => upd((f) => { f.shadow.on = v; })} /><ColorField value={fx.shadow.color} onChange={(c) => upd((f) => { f.shadow.color = c; })} /></div>
        {fx.shadow.on && (
          <div className="pe-grid2">
            <Num label="Opacity" value={Math.round(fx.shadow.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => upd((f) => { f.shadow.opacity = v / 100; })} />
            <Num label="Angle" value={fx.shadow.angle} min={-180} max={180} unit="°" onChange={(v) => upd((f) => { f.shadow.angle = v; })} />
            <Num label="Distance" value={fx.shadow.distance} min={0} max={1000} unit="px" onChange={(v) => upd((f) => { f.shadow.distance = v; })} />
            <Num label="Size" value={fx.shadow.blur} min={0} max={250} unit="px" onChange={(v) => upd((f) => { f.shadow.blur = v; })} />
          </div>
        )}
      </div>
      <div className="pe-fx-block">
        <div className="pe-row"><Check label="Stroke" checked={fx.stroke.on} onChange={(v) => upd((f) => { f.stroke.on = v; })} /><ColorField value={fx.stroke.color} onChange={(c) => upd((f) => { f.stroke.color = c; })} /></div>
        {fx.stroke.on && <div className="pe-grid2"><Num label="Size" value={fx.stroke.width} min={0} max={250} digits={1} unit="px" onChange={(v) => upd((f) => { f.stroke.width = v; })} /><Num label="Opacity" value={Math.round(fx.stroke.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => upd((f) => { f.stroke.opacity = v / 100; })} /></div>}
      </div>
      <div className="pe-fx-block">
        <div className="pe-row"><Check label="Outer Glow" checked={fx.glow.on} onChange={(v) => upd((f) => { f.glow.on = v; })} /><ColorField value={fx.glow.color} onChange={(c) => upd((f) => { f.glow.color = c; })} /></div>
        {fx.glow.on && <div className="pe-grid2"><Num label="Size" value={fx.glow.size} min={0} max={250} unit="px" onChange={(v) => upd((f) => { f.glow.size = v; })} /><Num label="Opacity" value={Math.round(fx.glow.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => upd((f) => { f.glow.opacity = v / 100; })} /></div>}
      </div>
      <div className="pe-fx-block">
        <div className="pe-row"><Check label="Color Overlay" checked={fx.overlay.on} onChange={(v) => upd((f) => { f.overlay.on = v; })} /><ColorField value={fx.overlay.color} onChange={(c) => upd((f) => { f.overlay.color = c; })} /></div>
        {fx.overlay.on && <Num label="Opacity" value={Math.round(fx.overlay.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => upd((f) => { f.overlay.opacity = v / 100; })} />}
      </div>
    </div>
  );
}

export function PropertiesPanel({ ed }: { ed: Editor }) {
  useEditor(ed);
  const st = ed.st;
  const l = ed.active;
  if (!st || !l) return <div className="pe-empty-panel">{st ? `מסמך ${st.doc.width}×${st.doc.height} px` : 'אין מסמך פתוח'}</div>;
  if (st.maskEdit && l.mask) {
    return (
      <div className="pe-props">
        <h4>Layer Mask · מסכה</h4>
        <p className="pe-hint">מברשת שחורה מסתירה, לבנה מחזירה. X מחליף צבעים.</p>
        <div className="pe-row wrap">
          <button type="button" className="pe-btn" onClick={() => ed.invertMask()}>Invert</button>
          <button type="button" className="pe-btn" onClick={() => ed.toggleMaskEnabled(l)}>{l.mask.enabled ? 'Disable' : 'Enable'}</button>
          {l.type === 'raster' && <button type="button" className="pe-btn" onClick={() => ed.deleteMask(true)}>Apply</button>}
          <button type="button" className="pe-btn danger" onClick={() => ed.deleteMask(false)}>Delete</button>
        </div>
      </div>
    );
  }
  if (l.type === 'adjust') {
    const def = adjustDef(l.kind);
    return (
      <div className="pe-props">
        <h4>{def.en} · {def.name}</h4>
        <AdjustParams kind={l.kind} p={l.p} onChange={(p) => { l.p = p; touch(l); ed.softCommit(def.en); }} />
        <div className="pe-row wrap">
          <button type="button" className="pe-btn" onClick={() => { l.p = def.defaults(); touch(l); ed.commit(`${def.en} — איפוס`); }}>Reset</button>
          <button type="button" className={`pe-btn ${l.clip ? 'on' : ''}`} onClick={() => ed.toggleClip()} title="להחיל רק על השכבה שמתחת (Ctrl+Alt+G)">Clip to layer</button>
        </div>
      </div>
    );
  }
  return (
    <div className="pe-props">
      {isXf(l) && <><h4>Transform</h4><TransformPanel ed={ed} /></>}
      {l.type === 'shape' && <ShapeProps ed={ed} l={l} />}
      {l.type === 'text' && (
        <div className="pe-props-sec">
          <h4>Type · טקסט</h4>
          <div className="pe-row wrap">
            <button type="button" className="pe-btn" onClick={() => ed.beginTextEdit(l, false)}>עריכת טקסט</button>
            <button type="button" className="pe-btn" onClick={() => ed.rasterize()}>Rasterize</button>
          </div>
          <p className="pe-hint">{l.style.family} · {l.style.weight} · {+l.style.size.toFixed(1)}px</p>
        </div>
      )}
      {l.type === 'raster' && <p className="pe-hint">Pixel Layer · {l.canvas.width}×{l.canvas.height}px{Math.abs(l.t.sx) !== 1 ? ` · מוצג ב-${Math.round(Math.abs(l.t.sx) * 100)}%` : ''}</p>}
      {l.type === 'group' && <p className="pe-hint">קבוצה · {l.children.length} שכבות</p>}
      <FxEditor ed={ed} l={l} />
    </div>
  );
}

export type { XfLayer };
