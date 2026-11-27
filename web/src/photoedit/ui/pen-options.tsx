/**
 * סרגל האפשרויות של כלי העט ובחירת הנתיבים, ובורר ה-Custom Shape. כל פקד כאן מחובר לפעולה אמיתית.
 */
import type { ReactNode } from 'react';
import type { Editor } from '../editor';
import type { ToolId } from '../tools';
import { CUSTOM_SHAPES } from '../custom-shapes';
import { toSvgD } from '../paths';
import { createPathShape, currentTarget, docSubs } from '../path-doc';
import { Check, ColorField, Num, Seg } from './widgets';

/** Make: Shape — שכבת צורה וקטורית מהנתיב הפעיל */
function shapeFromPath(ed: Editor) {
  const t = currentTarget(ed);
  if (!t) { ed.toast('אין נתיב פעיל', 'error'); return; }
  const subs = docSubs(t);
  if (!subs.some((s) => s.pts.length > 1)) { ed.toast('הנתיב ריק', 'error'); return; }
  createPathShape(ed, subs);
  ed.commit('צורה מהנתיב');
}

function MakeButtons({ ed }: { ed: Editor }) {
  const t = currentTarget(ed);
  return (
    <>
      <span className="pe-lbl">Make:</span>
      <button type="button" className="pe-btn" disabled={!t} title="טעינת הנתיב כבחירה (Ctrl+Enter)" onClick={() => ed.run('path.toSelection')}>Selection</button>
      <button type="button" className="pe-btn" disabled={!t || !ed.active} title="Vector Mask לשכבה הפעילה מהנתיב" onClick={() => ed.run('layer.vmaskCurrent')}>Mask</button>
      <button type="button" className="pe-btn" disabled={!t || t.kind === 'shape'} title="שכבת צורה וקטורית מהנתיב" onClick={() => shapeFromPath(ed)}>Shape</button>
    </>
  );
}

function ShapeStyle({ ed, up }: { ed: Editor; up: () => void }) {
  const s = ed.opts.shape;
  return (
    <>
      <span className="pe-lbl">Fill</span>
      <select value={s.fill.type} onChange={(e) => { s.fill = { ...s.fill, type: e.target.value as typeof s.fill.type }; up(); }}><option value="solid">Solid</option><option value="linear">Linear</option><option value="radial">Radial</option><option value="none">None</option></select>
      <ColorField value={s.fill.color} onChange={(c) => { s.fill = { ...s.fill, color: c }; up(); }} title="צבע מילוי" />
      {s.fill.type !== 'solid' && s.fill.type !== 'none' && <ColorField value={s.fill.color2} onChange={(c) => { s.fill = { ...s.fill, color2: c }; up(); }} />}
      <Check label="Stroke" checked={s.strokeOn} onChange={(v) => { s.strokeOn = v; up(); }} />
      <ColorField value={s.strokeColor} onChange={(c) => { s.strokeColor = c; up(); }} title="צבע קו מתאר" />
      <Num value={s.strokeWidth} min={1} max={500} unit="px" width={36} onChange={(v) => { s.strokeWidth = v; up(); }} title="עובי קו" />
    </>
  );
}

export function penOptions(ed: Editor, t: ToolId): ReactNode | null {
  const p = ed.opts.pen;
  const up = () => { ed.emit(); ed.redraw(false); };
  if (t === 'pen' || t === 'freePen' || t === 'curvPen') {
    return (
      <>
        <Seg value={p.mode} onChange={(v) => { p.mode = v; up(); }} options={[['path', 'Path', 'נתיב עבודה בפאנל Paths'], ['shape', 'Shape', 'שכבת צורה וקטורית']]} />
        {p.mode === 'shape' ? <ShapeStyle ed={ed} up={up} /> : <MakeButtons ed={ed} />}
        {t === 'pen' && <Check label="Auto Add/Delete" checked={p.autoAddDelete} onChange={(v) => { p.autoAddDelete = v; up(); }} title="לחיצה על קטע מוסיפה נקודה, על נקודה מוחקת" />}
        {t === 'pen' && <Check label="Rubber Band" checked={p.rubberBand} onChange={(v) => { p.rubberBand = v; up(); }} title="תצוגה מקדימה של הקטע הבא עד הסמן" />}
        {t === 'freePen' && <Num label="Curve Fit" value={p.curveFit} min={0.5} max={10} step={0.5} digits={1} unit="px" onChange={(v) => { p.curveFit = v; up(); }} title="כמה העקומה נצמדת לתנועת היד (פחות = יותר נקודות)" />}
        <span className="pe-opt-hint">
          {t === 'pen' ? 'לחיצה = פינה · גרירה = עקומה · Alt+גרירה = שבירת ידית · Shift = 45° · Enter/Esc = סיום · Ctrl = בחירה ישירה · Alt על נקודה = המרה'
            : t === 'freePen' ? 'גרירה = ציור חופשי שהופך לעקומות · סיום ליד ההתחלה סוגר · Ctrl = בחירה ישירה'
              : 'לחיצה = נקודה שהעקומה עוברת בה · דאבל-קליק = פינה · גרירת נקודה מזיזה · Enter = סיום'}
          {p.mode === 'shape' ? ' · Shift בלחיצה הראשונה = הוספה לצורה הנבחרת' : ''}
        </span>
      </>
    );
  }
  if (t === 'addAnchor' || t === 'delAnchor' || t === 'convertPt') {
    return (
      <>
        <MakeButtons ed={ed} />
        <span className="pe-opt-hint">
          {t === 'addAnchor' ? 'לחיצה על קטע מוסיפה נקודת עיגון (גרירה מזיזה אותה)' : t === 'delAnchor' ? 'לחיצה על נקודת עיגון מוחקת אותה — הנתיב נשאר מחובר' : 'לחיצה על נקודה חלקה = פינה · גרירה מנקודה = ידיות חדשות · גרירת ידית = שבירה'}
          {' · Ctrl = בחירה ישירה'}
        </span>
      </>
    );
  }
  if (t === 'pathSel' || t === 'directSel') {
    return (
      <>
        <MakeButtons ed={ed} />
        <button type="button" className="pe-btn" disabled={!currentTarget(ed)} onClick={() => ed.run('path.fill')} title="מילוי הנתיב בצבע הקדמי">Fill Path</button>
        <button type="button" className="pe-btn" disabled={!currentTarget(ed)} onClick={() => ed.run('path.stroke')} title="קו מתאר לנתיב (לפי הגדרת הפאנל Paths)">Stroke Path</button>
        <span className="pe-opt-hint">
          {t === 'pathSel' ? 'לחיצה בוחרת רכיב נתיב שלם · גרירה מזיזה · Alt+גרירה משכפלת · Shift = הוספה · Delete מוחק · חיצים מזיזים · Ctrl = בחירה ישירה'
            : 'לחיצה בוחרת נקודה · גרירת ידית (Alt שובר) · גרירת קטע מעצבת אותו · מלבן גרירה בוחר כמה · Delete מוחק נקודות · חיצים מזיזים'}
        </span>
      </>
    );
  }
  return null;
}

/** בורר Custom Shape לסרגל האפשרויות של כלי הצורות */
export function CustomShapePicker({ ed }: { ed: Editor }) {
  const cur = ed.opts.customShape.id;
  return (
    <div className="pe-cshape-pick" role="listbox" aria-label="Custom Shape">
      {CUSTOM_SHAPES.map((s) => {
        const k = 16 / Math.max(s.w, s.h);
        const d = toSvgD(s.subs(), { a: k, b: 0, c: 0, d: k, e: (20 - s.w * k) / 2, f: (20 - s.h * k) / 2 });
        return (
          <button key={s.id} type="button" role="option" aria-selected={cur === s.id} className={cur === s.id ? 'on' : ''} title={`${s.en} · ${s.name}`}
            onClick={() => { ed.opts.customShape.id = s.id; ed.emit(); }}>
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d={d} fill="currentColor" fillRule="nonzero" /></svg>
          </button>
        );
      })}
    </div>
  );
}
