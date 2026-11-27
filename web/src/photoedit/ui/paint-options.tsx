/**
 * סרגל האפשרויות של כלי הציור, הרטוש והמדידה (נקרא מ-OptionsBar). כל ערך כאן מחובר לכלי שעובד בפועל.
 */
import type { ReactNode } from 'react';
import type { Editor } from '../editor';
import type { ToolId } from '../tools';
import { listPatterns } from '../patterns';
import { MAX_SAMPLERS, rulerMeasure, samplersOf } from '../tools-measure';
import { Check, Num, Seg } from './widgets';

const pct = (v: number) => Math.round(v * 100);

function BrushNums({ o, up, hard = true }: { o: { size: number; hardness: number }; up: () => void; hard?: boolean }) {
  return (
    <>
      <Num label="Size" value={o.size} min={1} max={2500} unit="px" onChange={(v) => { o.size = v; up(); }} />
      {hard && <Num label="Hardness" value={pct(o.hardness)} min={0} max={100} unit="%" onChange={(v) => { o.hardness = v / 100; up(); }} />}
    </>
  );
}

const Sampling = ({ v, set }: { v: 'continuous' | 'once'; set: (v: 'continuous' | 'once') => void }) => (
  <>
    <span className="pe-lbl">Sampling</span>
    <Seg value={v} onChange={set} options={[['continuous', 'Continuous', 'דגימה רציפה — הצבע נדגם מחדש תוך כדי גרירה'], ['once', 'Once', 'פעם אחת — רק הצבע שבו התחלתם']]} />
  </>
);

const thumbCache = new WeakMap<HTMLCanvasElement, { w: number; url: string }>();
function thumbUrl(c: HTMLCanvasElement) {
  if (c.width <= 1) return '';
  const hit = thumbCache.get(c);
  if (hit && hit.w === c.width) return hit.url;
  const url = c.toDataURL();
  thumbCache.set(c, { w: c.width, url });
  return url;
}

/** בורר דפוסים קטן: תמונות ממוזערות של הדפוסים המובנים והמוגדרים */
export function PatternPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const list = listPatterns();
  const thumbs = list.map((p) => ({ id: p.id, name: p.name, url: thumbUrl(p.canvas) }));
  return (
    <div className="pe-pattern-pick" role="listbox" aria-label="Pattern">
      {thumbs.map((t) => (
        <button key={t.id} type="button" role="option" aria-selected={t.id === value} className={t.id === value ? 'on' : ''} title={t.name}
          style={{ backgroundImage: t.url ? `url(${t.url})` : undefined }} onClick={() => onChange(t.id)} />
      ))}
    </div>
  );
}

export function paintOptions(ed: Editor, t: ToolId): ReactNode | null {
  const o = ed.opts;
  const up = () => { ed.emit(); ed.redraw(false); };
  const keys = <span className="pe-opt-hint">[ ] = גודל · Shift+[ ] = קשיחות · Shift+לחיצה = קו ישר</span>;
  switch (t) {
    case 'pencil': {
      const b = o.pencil;
      return (
        <>
          <b className="pe-opt-title">Pencil · עיפרון</b>
          <BrushNums o={b} up={up} hard={false} />
          <Num label="Opacity" value={pct(b.opacity)} min={1} max={100} unit="%" onChange={(v) => { b.opacity = v / 100; up(); }} />
          <Check label="Auto Erase" checked={b.autoErase} onChange={(v) => { b.autoErase = v; up(); }} title="התחלה על פיקסל בצבע הקדמי מציירת בצבע הרקע" />
          <span className="pe-opt-hint">קו קשיח בלי החלקת קצוות · Alt = דוגם צבע · [ ] = גודל</span>
        </>
      );
    }
    case 'colorReplace': {
      const b = o.colorReplace;
      return (
        <>
          <b className="pe-opt-title">Color Replacement · החלפת צבע</b>
          <BrushNums o={b} up={up} />
          <span className="pe-lbl">Mode</span>
          <select value={b.mode} onChange={(e) => { b.mode = e.target.value as typeof b.mode; up(); }}>
            <option value="hue">Hue · גוון</option><option value="saturation">Saturation · רוויה</option><option value="color">Color · צבע</option><option value="luminosity">Luminosity · בהירות</option>
          </select>
          <Sampling v={b.sampling} set={(v) => { b.sampling = v; up(); }} />
          <Num label="Tolerance" value={b.tolerance} min={1} max={100} unit="%" onChange={(v) => { b.tolerance = Math.round(v); up(); }} />
          <Check label="Anti-alias" checked={b.antiAlias} onChange={(v) => { b.antiAlias = v; up(); }} />
          <span className="pe-opt-hint">מחליף את הצבע שנדגם במרכז המברשת בצבע הקדמי</span>
        </>
      );
    }
    case 'bgEraser': {
      const b = o.bgEraser;
      return (
        <>
          <b className="pe-opt-title">Background Eraser · מחק רקע</b>
          <BrushNums o={b} up={up} />
          <Sampling v={b.sampling} set={(v) => { b.sampling = v; up(); }} />
          <span className="pe-lbl">Limits</span>
          <Seg value={b.limits} onChange={(v) => { b.limits = v; up(); }} options={[['contiguous', 'Contiguous', 'רק פיקסלים שמחוברים למרכז המברשת'], ['discontiguous', 'Discontiguous', 'כל הפיקסלים הדומים תחת המברשת']]} />
          <Num label="Tolerance" value={b.tolerance} min={1} max={100} unit="%" onChange={(v) => { b.tolerance = Math.round(v); up(); }} />
          <Check label="Protect Foreground Color" checked={b.protectFg} onChange={(v) => { b.protectFg = v; up(); }} title="לא מוחק פיקסלים בצבע הקדמי" />
          <span className="pe-opt-hint">מוחק את הצבע שמתחת לצלב שבמרכז המברשת</span>
        </>
      );
    }
    case 'magicEraser': {
      const b = o.magicEraser;
      return (
        <>
          <b className="pe-opt-title">Magic Eraser · מחק קסם</b>
          <Num label="Tolerance" value={b.tolerance} min={0} max={255} onChange={(v) => { b.tolerance = Math.round(v); up(); }} />
          <Check label="Contiguous" checked={b.contiguous} onChange={(v) => { b.contiguous = v; up(); }} />
          <Check label="Sample All Layers" checked={b.allLayers} onChange={(v) => { b.allLayers = v; up(); }} />
          <Num label="Opacity" value={pct(b.opacity)} min={1} max={100} unit="%" onChange={(v) => { b.opacity = v / 100; up(); }} />
          <span className="pe-opt-hint">לחיצה מוחקת את האזור בצבע דומה בשכבה הפעילה</span>
        </>
      );
    }
    case 'historyBrush': {
      const b = o.historyBrush;
      return (
        <>
          <b className="pe-opt-title">History Brush · מברשת היסטוריה</b>
          <BrushNums o={b} up={up} />
          <Num label="Opacity" value={pct(b.opacity)} min={1} max={100} unit="%" onChange={(v) => { b.opacity = v / 100; up(); }} />
          <Num label="Flow" value={pct(b.flow)} min={1} max={100} unit="%" onChange={(v) => { b.flow = v / 100; up(); }} />
          <button type="button" className="pe-btn" onClick={() => ed.openPanel('History')}>History…</button>
          <span className="pe-opt-hint">מצייר בחזרה את הפיקסלים של השכבה ממצב המקור · המקור נבחר בעמודה הקטנה בפאנל History</span>
        </>
      );
    }
    case 'patternStamp': {
      const b = o.patternStamp;
      return (
        <>
          <b className="pe-opt-title">Pattern Stamp · חותמת דוגמה</b>
          <BrushNums o={b} up={up} />
          <PatternPicker value={b.pattern} onChange={(id) => { b.pattern = id; up(); }} />
          <Num label="Opacity" value={pct(b.opacity)} min={1} max={100} unit="%" onChange={(v) => { b.opacity = v / 100; up(); }} />
          <Num label="Flow" value={pct(b.flow)} min={1} max={100} unit="%" onChange={(v) => { b.flow = v / 100; up(); }} />
          <Check label="Aligned" checked={b.aligned} onChange={(v) => { b.aligned = v; up(); }} title="הדפוס רציף בין משיחות" />
          <button type="button" className="pe-btn" disabled={!ed.doc} onClick={() => ed.run('edit.definePattern')}>Define Pattern…</button>
          {keys}
        </>
      );
    }
    case 'blur': case 'sharpen': case 'smudge': {
      const b = o[t];
      const name = { blur: 'Blur · טשטוש', sharpen: 'Sharpen · חידוד', smudge: 'Smudge · מריחה' }[t];
      return (
        <>
          <b className="pe-opt-title">{name}</b>
          <BrushNums o={b} up={up} />
          <Num label="Strength" value={pct(b.strength)} min={1} max={100} unit="%" onChange={(v) => { b.strength = v / 100; up(); }} />
          <Check label="Sample All Layers" checked={b.allLayers} onChange={(v) => { b.allLayers = v; up(); }} title="דוגם מהתמונה המורכבת וכותב לשכבה הפעילה" />
          {t === 'smudge' && <Check label="Finger Painting" checked={o.smudge.finger} onChange={(v) => { o.smudge.finger = v; up(); }} title="כל משיחה מתחילה בצבע הקדמי" />}
          {keys}
        </>
      );
    }
    case 'dodge': case 'burn': {
      const b = o[t];
      return (
        <>
          <b className="pe-opt-title">{t === 'dodge' ? 'Dodge · הבהרה' : 'Burn · הכהיה'}</b>
          <BrushNums o={b} up={up} />
          <span className="pe-lbl">Range</span>
          <select value={b.range} onChange={(e) => { b.range = e.target.value as typeof b.range; up(); }}>
            <option value="shadows">Shadows · צללים</option><option value="midtones">Midtones · אמצע</option><option value="highlights">Highlights · אורות</option>
          </select>
          <Num label="Exposure" value={pct(b.exposure)} min={1} max={100} unit="%" onChange={(v) => { b.exposure = v / 100; up(); }} />
          <Check label="Protect Tones" checked={b.protect} onChange={(v) => { b.protect = v; up(); }} title="שומר על הגוון והרוויה — משנה רק בהירות" />
          {keys}
        </>
      );
    }
    case 'sponge': {
      const b = o.sponge;
      return (
        <>
          <b className="pe-opt-title">Sponge · ספוג</b>
          <BrushNums o={b} up={up} />
          <Seg value={b.mode} onChange={(v) => { b.mode = v; up(); }} options={[['desaturate', 'Desaturate', 'הורדת רוויה'], ['saturate', 'Saturate', 'הגברת רוויה']]} />
          <Num label="Flow" value={pct(b.flow)} min={1} max={100} unit="%" onChange={(v) => { b.flow = v / 100; up(); }} />
          <Check label="Vibrance" checked={b.vibrance} onChange={(v) => { b.vibrance = v; up(); }} title="מגן על צבעים שכבר רוויים" />
          {keys}
        </>
      );
    }
    case 'spotHeal': {
      const b = o.spotHeal;
      return (
        <>
          <b className="pe-opt-title">Spot Healing · ריפוי נקודתי</b>
          <BrushNums o={b} up={up} />
          <Check label="Sample All Layers" checked={b.allLayers} onChange={(v) => { b.allLayers = v; up(); }} title="מאפשר לרפא לתוך שכבה ריקה מעל התמונה" />
          <span className="pe-opt-hint">צבעו על הפגם — בשחרור הוא מתמלא במרקם מהסביבה ומותאם לצבע ולתאורה</span>
        </>
      );
    }
    case 'heal': {
      const b = o.heal;
      return (
        <>
          <b className="pe-opt-title">Healing Brush · מברשת ריפוי</b>
          <BrushNums o={b} up={up} />
          <Check label="Aligned" checked={b.aligned} onChange={(v) => { b.aligned = v; up(); }} />
          <Check label="Sample All Layers" checked={b.allLayers} onChange={(v) => { b.allLayers = v; up(); }} />
          <span className="pe-opt-hint">Alt+לחיצה = נקודת מקור · המרקם מהמקור, הצבע והתאורה מהיעד (מחושב בשחרור)</span>
        </>
      );
    }
    case 'patch':
      return (
        <>
          <b className="pe-opt-title">Patch · טלאי</b>
          <span className="pe-opt-hint">ציור = בחירה (Shift מוסיף, Alt מחסיר) · גרירה מתוך הבחירה אל אזור נקי = האזור הנבחר מתמלא במרקם משם ומותאם לסביבה</span>
        </>
      );
    case 'redEye': {
      const b = o.redEye;
      return (
        <>
          <b className="pe-opt-title">Red Eye · עיניים אדומות</b>
          <Num label="Pupil Size" value={b.pupil} min={1} max={100} unit="%" onChange={(v) => { b.pupil = Math.round(v); up(); }} />
          <Num label="Darken Amount" value={b.darken} min={1} max={100} unit="%" onChange={(v) => { b.darken = Math.round(v); up(); }} />
          <span className="pe-opt-hint">לחיצה במרכז האישון או גרירת מלבן סביב העין</span>
        </>
      );
    }
    case 'colorSampler': {
      const n = samplersOf(ed.st).length;
      return (
        <>
          <b className="pe-opt-title">Color Sampler · דוגם צבע קבוע</b>
          <span className="pe-opt-hint" dir="ltr">{n} / {MAX_SAMPLERS}</span>
          <button type="button" className="pe-btn" disabled={!n} onClick={() => ed.run('sampler.clear')}>Clear All</button>
          <button type="button" className="pe-btn" onClick={() => ed.openPanel('Info')}>Info…</button>
          <span className="pe-opt-hint">לחיצה מוסיפה נקודה · גרירה מזיזה · Alt+לחיצה מוחקת · הערכים בפאנל Info</span>
        </>
      );
    }
    case 'ruler': {
      const m = rulerMeasure(ed.st);
      return (
        <>
          <b className="pe-opt-title">Ruler · סרגל</b>
          {m ? (
            <span className="pe-opt-hint pe-measure" dir="ltr">W {m.w.toFixed(1)} · H {(-m.h).toFixed(1)} · A {m.angle.toFixed(1)}° · L {m.dist.toFixed(1)} px</span>
          ) : <span className="pe-opt-hint">גררו קו למדידה · Shift = כל 45°</span>}
          <button type="button" className="pe-btn" disabled={!m} onClick={() => ed.run('ruler.straighten')} title="מסובב את השכבה כך שהקו יהיה ישר">Straighten Layer</button>
          <button type="button" className="pe-btn" disabled={!m} onClick={() => ed.run('ruler.clear')}>Clear</button>
        </>
      );
    }
    case 'rotateView': {
      const r = ed.st?.rot ?? 0;
      return (
        <>
          <b className="pe-opt-title">Rotate View · סיבוב תצוגה</b>
          <Num label="Rotation Angle" value={r} min={-180} max={180} digits={1} unit="°" onChange={(v) => ed.setViewRotation(v)} />
          <button type="button" className="pe-btn" disabled={!r} onClick={() => ed.run('view.resetRotation')} title="Esc">Reset View</button>
          <span className="pe-opt-hint">גרירה מסובבת את התצוגה בלבד (לא את הפיקסלים) · Shift = כל 15° · Esc או דאבל-קליק = איפוס</span>
        </>
      );
    }
  }
  return null;
}
