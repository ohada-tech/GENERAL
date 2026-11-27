/** סרגל האפשרויות של Warp ו-Puppet Warp, והכפתורים הנוספים של Free Transform (Skew/Distort/Perspective/Warp). */
import type { ReactNode } from 'react';
import type { Editor } from '../editor';
import type { ToolId } from '../tools';
import { clearPins, endPuppet, endWarp, puppetOpts, puppetPinCount, rebuildPuppet, setTransformMode, setWarpParams, startWarp, warpLayer, warpParams } from '../tools-warp';
import { WARP_PRESETS, type WarpPreset } from '../warp-algo';
import { Check, Ico, Num, Seg } from './widgets';

/** בתוך Free Transform: מצב הידיות ומעבר ל-Warp */
export function FreeTransformExtras({ ed }: { ed: Editor }) {
  const ft = ed.live.freeTransform;
  if (!ft) return null;
  const one = ed.transformable().length === 1;
  const modes: Array<['skew' | 'distort' | 'perspective', string, string]> = [['skew', 'Skew', 'הטיה'], ['distort', 'Distort', 'עיוות'], ['perspective', 'Perspective', 'פרספקטיבה']];
  return (
    <>
      <span className="pe-opt-sep" />
      {modes.map(([m, en, he]) => (
        <button key={m} type="button" className={`pe-btn pe-xf-mode ${ft.mode === m ? 'on' : ''}`} disabled={!one} title={`${en} · ${he} — גרירה רגילה של ידית (Ctrl+גרירה עובד תמיד)`} onClick={() => setTransformMode(ed, m)}>{en}</button>
      ))}
      <button type="button" className="pe-icon-btn" disabled={!one} title="Warp · עיקום (מעבר בין Free Transform ל-Warp)" onClick={() => startWarp(ed)}><Ico n="warp" size={16} /></button>
      <span className="pe-opt-hint">Ctrl+פינה = Distort · Ctrl+צלע = Skew · Ctrl+Alt+Shift+פינה = Perspective</span>
    </>
  );
}

export function warpOptions(ed: Editor, t: ToolId): ReactNode | null {
  if (t === 'warp') {
    const l = warpLayer(ed);
    const p = warpParams(l);
    const preset = p.preset !== 'none' && p.preset !== 'custom';
    return (
      <>
        <b className="pe-opt-title">Warp · עיקום</b>
        <span className="pe-lbl">Warp</span>
        <select value={p.preset} disabled={!l} title="Warp Preset · סגנון" onChange={(e) => setWarpParams(ed, { preset: e.target.value as WarpPreset })}>
          {WARP_PRESETS.map(([id, en, he]) => <option key={id} value={id}>{en} · {he}</option>)}
        </select>
        <button type="button" className={`pe-icon-btn ${p.vertical ? 'on' : ''}`} disabled={!preset} title="Change Warp Orientation · כיוון אופקי/אנכי" onClick={() => setWarpParams(ed, { vertical: !p.vertical })}><Ico n="warpOrient" size={16} /></button>
        <Num label="Bend" value={p.bend} min={-100} max={100} unit="%" width={40} onChange={(v) => setWarpParams(ed, { bend: v })} />
        <Num label="H" value={p.h} min={-100} max={100} unit="%" width={40} title="Horizontal Distortion" onChange={(v) => setWarpParams(ed, { h: v })} />
        <Num label="V" value={p.v} min={-100} max={100} unit="%" width={40} title="Vertical Distortion" onChange={(v) => setWarpParams(ed, { v: v })} />
        <button type="button" className="pe-btn" disabled={!l} title="איפוס הרשת" onClick={() => setWarpParams(ed, { preset: 'none' })}>Reset · איפוס</button>
        <span className="pe-opt-hint">גרירה של נקודה או של שטח ברשת · Ctrl+Z = צעד אחורה</span>
        <button type="button" className="pe-btn" onClick={() => endWarp(ed, false)} title="Esc">ביטול</button>
        <button type="button" className="pe-btn primary" onClick={() => endWarp(ed, true)} title="Enter">✓ אישור</button>
      </>
    );
  }
  if (t === 'puppet') {
    const o = puppetOpts;
    const up = () => { rebuildPuppet(ed); ed.emit(); };
    return (
      <>
        <b className="pe-opt-title">Puppet Warp · עיוות בובה</b>
        <span className="pe-lbl">Density</span>
        <Seg value={o.density} onChange={(v) => { o.density = v; up(); }} options={[['fewer', 'Fewer Points'], ['normal', 'Normal'], ['more', 'More Points']]} />
        <Num label="Expansion" value={o.expansion} min={-20} max={60} unit="px" width={40} onChange={(v) => { o.expansion = v; up(); }} />
        <Check label="Show Mesh" checked={o.showMesh} onChange={(v) => { o.showMesh = v; ed.emit(); ed.redraw(false); }} />
        <button type="button" className="pe-btn" disabled={!puppetPinCount()} title="Remove All Pins · מחיקת כל הנעצים" onClick={() => clearPins(ed)}>Remove All Pins</button>
        <span className="pe-opt-hint">לחיצה = נעץ · גרירה = עיוות · Alt+לחיצה = מחיקת נעץ · {puppetPinCount()} נעצים</span>
        <button type="button" className="pe-btn" onClick={() => endPuppet(ed, false)} title="Esc">ביטול</button>
        <button type="button" className="pe-btn primary" onClick={() => endPuppet(ed, true)} title="Enter">✓ אישור</button>
      </>
    );
  }
  return null;
}
