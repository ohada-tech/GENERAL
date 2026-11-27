/**
 * פאנל Paths (כמו בפוטושופ): Work Path, נתיבים שמורים, ונתיב השכבה הפעילה (Shape Path / Vector Mask).
 * לחיצה = נתיב פעיל · Ctrl+לחיצה = טעינה כבחירה (Shift מוסיף, Alt מחסיר) · דאבל-קליק = שמירה / שינוי שם ·
 * לחיצה על אזור ריק = הסתרת הנתיב. הכפתורים למטה: מילוי, קו מתאר, בחירה, נתיב מהבחירה, מסכה, חדש, מחיקה.
 */
import { useState } from 'react';
import type { Editor } from '../editor';
import type { SubPath } from '../paths';
import { mapSubs, toSvgD } from '../paths';
import {
  currentTarget, docSubs, loadPathAsSelection, pathsOf, renamePath, resolveTarget, savePath, setActivePath, type Target,
} from '../path-doc';
import { Ico, Num, Seg, useEditor } from './widgets';

function PathThumb({ subs, w, h }: { subs: SubPath[]; w: number; h: number }) {
  const W = 40, H = 30;
  const k = Math.min(W / Math.max(1, w), H / Math.max(1, h));
  const d = toSvgD(mapSubs(subs, { a: k, b: 0, c: 0, d: k, e: (W - w * k) / 2, f: (H - h * k) / 2 }));
  return (
    <svg className="pe-path-thumb" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <rect x={(W - w * k) / 2} y={(H - h * k) / 2} width={w * k} height={h * k} className="pe-path-thumb-doc" />
      {d && <path d={d} className="pe-path-thumb-path" fillRule="nonzero" />}
    </svg>
  );
}

export function PathsPanel({ ed }: { ed: Editor }) {
  useEditor(ed);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const st = ed.st;
  if (!st) return <div className="pe-empty-panel">אין מסמך פתוח</div>;
  const d = st.doc;
  const cur = currentTarget(ed);
  const a = ed.active;
  const rows: Target[] = [];
  const work = pathsOf(d).find((p) => p.work);
  if (work) rows.push(resolveTarget(ed, work.id)!);
  for (const p of pathsOf(d)) if (!p.work) rows.push(resolveTarget(ed, p.id)!);
  // נתיבים של השכבה הפעילה (זמניים בפאנל, כמו בפוטושופ)
  if (a?.type === 'shape' && a.shape === 'path') { const t = resolveTarget(ed, `shape:${a.id}`); if (t) rows.push(t); }
  if (a?.vmask) { const t = resolveTarget(ed, `vmask:${a.id}`); if (t) rows.push(t); }
  const p = ed.opts.pen;

  const onRow = (e: React.MouseEvent, t: Target) => {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      loadPathAsSelection(ed, e.shiftKey && e.altKey ? 'int' : e.shiftKey ? 'add' : e.altKey ? 'sub' : 'new', t);
      return;
    }
    setActivePath(ed, t.key);
  };
  const onDouble = (t: Target) => {
    if (t.kind === 'path' && t.path!.work) {
      // דאבל-קליק על Work Path = Save Path, ואז שינוי שם
      const sp = savePath(ed, t);
      if (sp) setRenaming(sp.id);
    } else if (t.kind === 'path') setRenaming(t.key);
  };

  return (
    <div className="pe-paths" onClick={() => setActivePath(ed, null)}>
      <div className="pe-path-list">
        {rows.map((t) => (
          <div key={t.key} className={`pe-path-row ${cur?.key === t.key ? 'sel' : ''} ${t.kind === 'path' && t.path!.work ? 'work' : ''} ${t.kind !== 'path' ? 'layer' : ''}`}
            title="Ctrl+לחיצה = טעינה כבחירה · דאבל-קליק = שמירה/שינוי שם"
            onClick={(e) => onRow(e, t)} onDoubleClick={() => onDouble(t)}>
            <PathThumb subs={docSubs(t)} w={d.width} h={d.height} />
            {renaming === t.key ? (
              <input className="pe-rename" autoFocus defaultValue={t.name}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }}
                onBlur={(e) => { const v = e.target.value; setRenaming(null); renamePath(ed, t.key, v); }} />
            ) : (
              <span className="pe-path-name" dir="auto">{t.kind === 'path' && t.path!.work ? 'Work Path · נתיב עבודה' : t.name}</span>
            )}
            {t.kind === 'vmask' && !t.layer!.vmask!.enabled && <span className="pe-path-off">כבויה</span>}
          </div>
        ))}
        {!rows.length && <div className="pe-empty-panel">אין נתיבים · ציירו בעט (P) או Make Work Path מבחירה</div>}
      </div>
      <div className="pe-path-opts" onClick={(e) => e.stopPropagation()}>
        <span className="pe-lbl">Stroke</span>
        <Seg value={p.strokeTool} onChange={(v) => { p.strokeTool = v; ed.emit(); }} options={[['brush', 'Brush', 'לפי Size/Hardness/Opacity של המברשת'], ['solid', 'Solid', 'קו אחיד בעובי קבוע']]} />
        {p.strokeTool === 'solid' && <Num value={p.strokeWidth} min={0.5} max={500} digits={1} unit="px" width={38} onChange={(v) => { p.strokeWidth = v; ed.emit(); }} title="עובי הקו" />}
        <Num label="Tolerance" value={p.tolerance} min={0.5} max={10} step={0.5} digits={1} unit="px" width={34} onChange={(v) => { p.tolerance = v; ed.emit(); }} title="Make Work Path: סבולת ההתאמה לקו המתאר של הבחירה" />
      </div>
      <div className="pe-layers-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="pe-menu-anchor">
          <button type="button" title="תפריט Paths" onClick={() => setMenu(!menu)}><Ico n="pathMenu" /></button>
          {menu && (
            <div className="pe-dropmenu up" onMouseLeave={() => setMenu(false)}>
              {([
                ['Save Path · שמירת נתיב', 'path.save', !cur || (cur.kind === 'path' && !cur.path!.work)],
                ['Duplicate Path · שכפול נתיב', 'path.save', !cur || (cur.kind === 'path' && !!cur.path!.work)],
                ['Delete Path · מחיקה', 'path.delete', !cur || cur.kind === 'shape'],
                ['Make Work Path · נתיב מהבחירה', 'path.fromSelection', !d.selection],
                ['Make Selection · טעינה כבחירה', 'path.toSelection', !cur],
                ['Fill Path · מילוי בצבע הקדמי', 'path.fill', !cur],
                ['Stroke Path (Brush) · קו במברשת', 'path.strokeBrush', !cur],
                ['Stroke Path (Solid) · קו אחיד', 'path.strokeSolid', !cur],
                ['Vector Mask · מסכה וקטורית מהנתיב', 'layer.vmaskCurrent', !cur || !a],
                ['Hide Path · הסתרת הנתיב', 'path.deselect', !cur],
              ] as Array<[string, string, boolean]>).map(([label, cmd, dis]) => (
                <button key={label} type="button" disabled={dis} onClick={() => { setMenu(false); ed.run(cmd); }}>{label}</button>
              ))}
            </div>
          )}
        </div>
        <button type="button" title="Fill path with foreground color · מילוי הנתיב בצבע הקדמי" disabled={!cur} onClick={() => ed.run('path.fill')}><Ico n="fillPath" /></button>
        <button type="button" title="Stroke path · קו מתאר לנתיב (Brush/Solid לפי הבחירה למעלה)" disabled={!cur} onClick={() => ed.run('path.stroke')}><Ico n="strokePath" /></button>
        <button type="button" title="Load path as a selection · טעינה כבחירה (Ctrl+Enter)" disabled={!cur} onClick={() => ed.run('path.toSelection')}><Ico n="pathToSel" /></button>
        <button type="button" title="Make work path from selection · נתיב עבודה מהבחירה" disabled={!d.selection} onClick={() => ed.run('path.fromSelection')}><Ico n="selToPath" /></button>
        <button type="button" title="Add vector mask · מסכה וקטורית מהנתיב לשכבה הפעילה" disabled={!cur || !a} onClick={() => ed.run('layer.vmaskCurrent')}><Ico n="mask" /></button>
        <button type="button" title="Create new path · נתיב חדש" onClick={() => ed.run('path.new')}><Ico n="plus" /></button>
        <button type="button" title="Delete current path · מחיקת הנתיב" disabled={!cur || cur.kind === 'shape'} onClick={() => ed.run('path.delete')}><Ico n="trash" /></button>
      </div>
    </div>
  );
}
