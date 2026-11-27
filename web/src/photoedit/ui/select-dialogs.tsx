/**
 * דיאלוגים של Select: Select and Mask, Color Range, Border/Smooth, Save/Load Selection.
 * Select and Mask ו-Color Range הם חלונות צפים (בלי רקע חוסם) — רואים את התצוגה המקדימה על הקנבס ואפשר ללחוץ עליו.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '../editor';
import { renderDoc } from '../render';
import { applyRefined, borderOrSmooth, deleteChannel, loadSelection, saveSelection, type MaskOutput } from '../select-cmds';
import { alphaOf, canvasFromAlpha, pixelsOf } from '../select-ops';
import { colorRange, refineAlpha, type RangePreset, type RefineOpts } from '../selection-algo';
import { combine, type SelMode } from '../selection';
import { Modal } from './dialogs';
import { Check, Num, Seg, Slider, useEditor } from './widgets';

/** חלון צפי בעיצוב של הדיאלוגים, בלי רקע שחוסם את הקנבס */
function FloatPanel({ title, children, footer, onClose }: { title: string; children: ReactNode; footer: ReactNode; onClose: () => void }) {
  return (
    <div className="pe-float-dlg" dir="rtl">
      <div className="pe-modal" role="dialog" aria-label={title} onKeyDown={(e) => e.stopPropagation()}>
        <div className="pe-modal-head">
          <h3>{title}</h3>
          <button type="button" className="pe-x" onClick={onClose} aria-label="סגירה">×</button>
        </div>
        <div className="pe-modal-body">{children}</div>
        <div className="pe-modal-foot">{footer}</div>
      </div>
    </div>
  );
}

const SEL_OPS: Array<[SelMode, string]> = [['new', 'חדשה · New'], ['add', 'הוספה · Add'], ['sub', 'חיסור · Subtract'], ['int', 'חיתוך · Intersect']];

/* ======================= Select and Mask ======================= */

function SelectMaskDialog({ ed }: { ed: Editor }) {
  const d = ed.doc!, a = ed.active, st = ed.st!;
  const fromMask = st.maskEdit && !!a?.mask;
  const src = useMemo(() => alphaOf(fromMask ? a!.mask!.canvas : d.selection!), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [view, setView] = useState<'overlay' | 'black' | 'white' | 'ants'>('overlay');
  const [p, setP] = useState<RefineOpts>({ smooth: 0, feather: 0, contrast: 0, shift: 0 });
  const canMask = !!a && a.type !== 'adjust';
  const [out, setOut] = useState<MaskOutput>(fromMask ? 'mask' : 'selection');
  const result = useRef<HTMLCanvasElement | null>(null);
  const compute = () => canvasFromAlpha(refineAlpha(src, d.width, d.height, p), d.width, d.height);
  useEffect(() => {
    const t = window.setTimeout(() => { result.current = compute(); ed.live.selPreview = { canvas: result.current, mode: view }; ed.redraw(false); }, 90);
    return () => window.clearTimeout(t);
  }, [p]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (result.current) { ed.live.selPreview = { canvas: result.current, mode: view }; ed.redraw(false); } }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = () => {
    const c = compute();
    ed.closeDialog();
    applyRefined(ed, c, canMask ? out : 'selection');
  };
  const set = (k: keyof RefineOpts) => (v: number) => setP({ ...p, [k]: v });
  return (
    <FloatPanel title="Select and Mask · בחירה ומסכה" onClose={() => ed.closeDialog()}
      footer={<><button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button><button type="button" className="pe-btn" onClick={() => setP({ smooth: 0, feather: 0, contrast: 0, shift: 0 })}>איפוס</button><button type="button" className="pe-btn primary" onClick={ok}>OK</button></>}>
      <div className="pe-field">תצוגה · View
        <Seg value={view} onChange={setView} options={[['overlay', 'Overlay'], ['black', 'On Black'], ['white', 'On White'], ['ants', 'Marching Ants']]} />
      </div>
      <p className="pe-hint">{fromMask ? `משפר את המסכה של "${a!.name}".` : 'משפר את הבחירה הפעילה.'} האדום מסמן את מה שמחוץ לבחירה.</p>
      <h4 className="pe-sm-h">Global Refinements · שיפור קצוות</h4>
      <Slider label="Smooth · החלקה" value={p.smooth} min={0} max={100} onChange={set('smooth')} />
      <Slider label="Feather · ריכוך" value={p.feather} min={0} max={250} step={0.1} digits={1} unit="px" onChange={set('feather')} />
      <Slider label="Contrast · ניגודיות" value={p.contrast} min={0} max={100} unit="%" onChange={set('contrast')} />
      <Slider label="Shift Edge · הזזת קצה" value={p.shift} min={-100} max={100} unit="%" onChange={set('shift')} />
      <div className="pe-field">Output To · פלט
        <select value={canMask ? out : 'selection'} disabled={!canMask} onChange={(e) => setOut(e.target.value as MaskOutput)}>
          <option value="selection">Selection · בחירה</option>
          <option value="mask">Layer Mask · מסכת שכבה</option>
          <option value="newLayerMask">New Layer with Layer Mask · שכבה חדשה עם מסכה</option>
        </select>
      </div>
    </FloatPanel>
  );
}

/* ======================= Color Range ======================= */

function ColorRangeDialog({ ed }: { ed: Editor }) {
  const d = ed.doc!;
  const W = d.width, H = d.height;
  const full = useMemo(() => pixelsOf(renderDoc(d, { scale: 1 })), []); // eslint-disable-line react-hooks/exhaustive-deps
  const k = Math.min(1, 220 / Math.max(W, H));
  const small = useMemo(() => { const c = renderDoc(d, { scale: k }); return { px: pixelsOf(c), w: c.width, h: c.height }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [preset, setPreset] = useState<RangePreset>('sampled');
  const [fuzz, setFuzz] = useState(40);
  const [invert, setInvert] = useState(false);
  const [samples, setSamples] = useState<number[][]>([]);
  const [subs, setSubs] = useState<number[][]>([]);
  const [pickMode, setPickMode] = useState<'set' | 'add' | 'sub'>('set');
  const prev = useRef<HTMLCanvasElement>(null);
  const opts = { preset, samples, subs, fuzz, invert };

  const sampleAt = (x: number, y: number, mode: 'set' | 'add' | 'sub') => {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
    const i = (yi * W + xi) * 4;
    const c = [full[i], full[i + 1], full[i + 2]];
    setPreset('sampled');
    if (mode === 'set') { setSamples([c]); setSubs([]); }
    else if (mode === 'add') setSamples((s) => [...s, c]);
    else setSubs((s) => [...s, c]);
  };

  // לחיצה על הקנבס דוגמת צבע (Shift = הוספה, Alt = חיסור), כמו הטפטפות בפוטושופ
  useEffect(() => {
    ed.live.pick = (e) => sampleAt(e.doc.x, e.doc.y, e.shift ? 'add' : e.alt ? 'sub' : pickMode);
    return () => { ed.live.pick = null; };
  }, [pickMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = prev.current;
    if (!c) return;
    c.width = small.w; c.height = small.h;
    const a = colorRange(small.px, small.w, small.h, opts);
    const x = c.getContext('2d')!;
    const img = x.createImageData(small.w, small.h);
    for (let i = 0; i < a.length; i++) { const j = i * 4; img.data[j] = img.data[j + 1] = img.data[j + 2] = a[i]; img.data[j + 3] = 255; }
    x.putImageData(img, 0, 0);
  }, [preset, fuzz, invert, samples, subs]); // eslint-disable-line react-hooks/exhaustive-deps

  const ok = () => {
    const c = canvasFromAlpha(colorRange(full, W, H, opts), W, H);
    const next = d.selection ? combine(d, c, 'int') : combine({ ...d, selection: null }, c, 'new');
    ed.closeDialog();
    ed.setSelection(next, 'Color Range · טווח צבעים');
  };

  return (
    <FloatPanel title="Color Range · טווח צבעים" onClose={() => ed.closeDialog()}
      footer={<><button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button><button type="button" className="pe-btn primary" onClick={ok} disabled={preset === 'sampled' && !samples.length}>OK</button></>}>
      <div className="pe-field">Select · בחירה לפי
        <select value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)}>
          <option value="sampled">Sampled Colors · צבעים שנדגמו</option>
          <option value="highlights">Highlights · אזורים בהירים</option>
          <option value="midtones">Midtones · טונים אמצעיים</option>
          <option value="shadows">Shadows · צללים</option>
          <option value="skin">Skin Tones · גווני עור (משוער)</option>
        </select>
      </div>
      {preset === 'sampled' && (
        <>
          <Seg value={pickMode} onChange={setPickMode} options={[['set', 'דגימה · Sample'], ['add', '＋ הוספה · Add'], ['sub', '－ חיסור · Subtract']]} />
          <p className="pe-hint">לחיצה על הקנבס או על התצוגה דוגמת צבע · Shift = הוספה · Alt = חיסור{samples.length ? ` · ${samples.length} דגימות${subs.length ? `, ${subs.length} הוחסרו` : ''}` : ''}</p>
        </>
      )}
      {(preset === 'sampled' || preset === 'skin') && <Slider label="Fuzziness · סבולת" value={fuzz} min={0} max={200} onChange={setFuzz} />}
      <canvas ref={prev} className="pe-cr-preview" title="תצוגת הבחירה: לבן = נבחר · לחיצה דוגמת צבע"
        onPointerDown={(e) => {
          const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
          sampleAt(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H, e.shiftKey ? 'add' : e.altKey ? 'sub' : pickMode);
        }} />
      <Check label="Invert · היפוך" checked={invert} onChange={setInvert} />
      {d.selection && <p className="pe-hint">יש בחירה פעילה — התוצאה תוגבל אליה.</p>}
    </FloatPanel>
  );
}

/* ======================= Border / Smooth ======================= */

function SelModify2({ ed, op }: { ed: Editor; op: 'border' | 'smooth' }) {
  const [v, setV] = useState(op === 'border' ? 10 : 5);
  return (
    <Modal title={op === 'border' ? 'Border Selection · מסגרת בחירה' : 'Smooth Selection · החלקת בחירה'} onClose={() => ed.closeDialog()}
      footer={<><button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button><button type="button" className="pe-btn primary" onClick={() => { ed.closeDialog(); borderOrSmooth(ed, op, v); }}>OK</button></>}>
      <Num label={op === 'border' ? 'Width · רוחב' : 'Sample Radius · רדיוס'} value={v} min={1} max={op === 'border' ? 200 : 100} unit="px" width={60} onChange={setV} />
      <p className="pe-hint">{op === 'border' ? 'בוחר רצועה סביב קו הבחירה הקיים.' : 'מחליק פינות וקצוות משוננים לפי רוב הפיקסלים ברדיוס.'}</p>
    </Modal>
  );
}

/* ======================= Save / Load Selection ======================= */

function SaveSelDialog({ ed }: { ed: Editor }) {
  const d = ed.doc!;
  const chans = d.channels ?? [];
  const [name, setName] = useState('');
  const [into, setInto] = useState<string>('');
  const [op, setOp] = useState<SelMode>('new');
  const ok = () => { ed.closeDialog(); saveSelection(ed, name, into || null, op); };
  return (
    <Modal title="Save Selection · שמירת בחירה" onClose={() => ed.closeDialog()}
      footer={<><button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button><button type="button" className="pe-btn primary" onClick={ok}>OK</button></>}>
      <div className="pe-field">Channel · ערוץ
        <select value={into} onChange={(e) => setInto(e.target.value)}>
          <option value="">ערוץ חדש · New</option>
          {chans.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {!into ? (
        <label className="pe-field">שם · Name<input value={name} placeholder={`Alpha ${chans.length + 1}`} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ok(); }} /></label>
      ) : (
        <div className="pe-field">Operation · פעולה<Seg value={op} onChange={setOp} options={[['new', 'החלפה · Replace'], ['add', 'הוספה · Add'], ['sub', 'חיסור · Subtract'], ['int', 'חיתוך · Intersect']]} /></div>
      )}
      <p className="pe-hint">הבחירה נשמרת בתוך המסמך כערוץ אלפא, ונשארת גם אחרי שמירה ופתיחה מחדש.</p>
    </Modal>
  );
}

function LoadSelDialog({ ed }: { ed: Editor }) {
  useEditor(ed);
  const d = ed.doc!;
  const chans = d.channels ?? [];
  const [id, setId] = useState(chans[chans.length - 1]?.id ?? '');
  const [invert, setInvert] = useState(false);
  const [op, setOp] = useState<SelMode>('new');
  const cur = chans.find((c) => c.id === id) ?? chans[0];
  const ok = () => { if (!cur) return; ed.closeDialog(); loadSelection(ed, cur.id, invert, d.selection ? op : 'new'); };
  return (
    <Modal title="Load Selection · טעינת בחירה" onClose={() => ed.closeDialog()}
      footer={<>
        <button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button>
        <button type="button" className="pe-btn danger" disabled={!cur} onClick={() => { if (cur) { deleteChannel(ed, cur.id); setId((d.channels ?? [])[0]?.id ?? ''); if (!(d.channels ?? []).length) ed.closeDialog(); } }}>מחיקת הערוץ</button>
        <button type="button" className="pe-btn primary" disabled={!cur} onClick={ok}>OK</button>
      </>}>
      <div className="pe-field">Channel · ערוץ
        <select value={cur?.id ?? ''} onChange={(e) => setId(e.target.value)}>
          {chans.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <Check label="Invert · היפוך" checked={invert} onChange={setInvert} />
      {d.selection && <div className="pe-field">Operation · פעולה<Seg value={op} onChange={setOp} options={SEL_OPS} /></div>}
    </Modal>
  );
}

/** נקרא מ-Dialogs לכל סוג דיאלוג שהוא לא מכיר */
export function SelectDialogs({ ed }: { ed: Editor }) {
  const dlg = ed.dialog;
  if (!dlg || !ed.doc) return null;
  switch (dlg.type) {
    case 'selectMask': return ed.doc.selection || (ed.st?.maskEdit && ed.active?.mask) ? <SelectMaskDialog ed={ed} /> : null;
    case 'colorRange': return <ColorRangeDialog ed={ed} />;
    case 'selModify2': return ed.doc.selection ? <SelModify2 ed={ed} op={dlg.data.op} /> : null;
    case 'saveSel': return ed.doc.selection ? <SaveSelDialog ed={ed} /> : null;
    case 'loadSel': return ed.doc.channels?.length ? <LoadSelDialog ed={ed} /> : null;
    default: return null;
  }
}
