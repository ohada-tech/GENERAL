/** ממשק משטחי עבודה: סרגל האפשרויות של כלי Artboard, מאפייני משטח בפאנל Properties, ודיאלוג Artboards to Files. */
import { useEffect, useState } from 'react';
import type { Editor } from '../editor';
import { cloud, type ExportOpts } from '../io';
import { type Artboard, AB_PRESETS, abFill, artboardsOf, presetOf } from '../artboards';
import { addNewArtboard, artboardFileName, exportArtboards, newArtboardSize, resizeArtboard, selectedArtboard, setArtboardBg } from '../artboard-ops';
import { Modal } from './dialogs';
import { Check, ColorField, Ico, Num, Seg, Slider, useEditor } from './widgets';

type BgKind = 'white' | 'black' | 'transparent' | 'custom';
const bgKind = (bg: string): BgKind => {
  const f = abFill(bg);
  return !f ? 'transparent' : f.toLowerCase() === '#ffffff' ? 'white' : f.toLowerCase() === '#000000' ? 'black' : 'custom';
};

/** Size: רשימת המידות הקבועות + Custom */
function SizeSelect({ w, h, onPick }: { w: number; h: number; onPick: (w: number, h: number) => void }) {
  const p = presetOf(w, h);
  return (
    <select value={p?.id ?? 'custom'} title="Size · מידה" onChange={(e) => { const q = AB_PRESETS.find((x) => x.id === e.target.value); if (q) onPick(q.w, q.h); }}>
      {AB_PRESETS.map((q) => <option key={q.id} value={q.id}>{q.name} · {q.he} ({q.w}×{q.h})</option>)}
      <option value="custom" disabled={!!p}>Custom · מותאם</option>
    </select>
  );
}

/** סרגל האפשרויות של כלי Artboard */
export function ArtboardOptions({ ed }: { ed: Editor }) {
  useEditor(ed);
  const a = selectedArtboard(ed);
  const w = a ? a.artboard.w : newArtboardSize.w, h = a ? a.artboard.h : newArtboardSize.h;
  const set = (nw: number, nh: number, soft = false) => {
    if (a) resizeArtboard(ed, a, nw, nh, soft);
    else { newArtboardSize.w = Math.max(1, Math.round(nw)); newArtboardSize.h = Math.max(1, Math.round(nh)); ed.emit(); }
  };
  return (
    <>
      <b className="pe-opt-title">Artboard · משטח עבודה</b>
      <span className="pe-lbl">Size</span>
      <SizeSelect w={w} h={h} onPick={(nw, nh) => set(nw, nh)} />
      <Num label="W" value={w} min={1} max={20000} unit="px" width={52} onChange={(v) => set(v, h, true)} />
      <button type="button" className="pe-small-btn" title="Orientation · החלפת כיוון" onClick={() => set(h, w)}>⇄</button>
      <Num label="H" value={h} min={1} max={20000} unit="px" width={52} onChange={(v) => set(w, v, true)} />
      <button type="button" className="pe-btn" disabled={!ed.doc} title="משטח חדש מימין למשטח הנבחר" onClick={() => addNewArtboard(ed)}>
        <Ico n="artboard" size={14} /> Add New Artboard · משטח חדש
      </button>
      <span className="pe-opt-hint">{a ? 'גרירה = הזזה עם התוכן · Alt+גרירה = שכפול · ידיות = גודל · + = משטח צמוד' : 'גרירה על ה-Pasteboard = משטח חדש · לחיצה על משטח או על השם שלו = בחירה'}</span>
    </>
  );
}

/** מאפייני משטח בפאנל Properties */
export function ArtboardProps({ ed, a }: { ed: Editor; a: Artboard }) {
  const kind = bgKind(a.artboard.bg);
  const custom = kind === 'custom' ? abFill(a.artboard.bg)! : '#f5efe6';
  return (
    <div className="pe-props pe-ab-props">
      <h4>Artboard · משטח עבודה</h4>
      <div className="pe-row"><span className="pe-lbl">Size</span><SizeSelect w={a.artboard.w} h={a.artboard.h} onPick={(w, h) => resizeArtboard(ed, a, w, h)} /></div>
      <div className="pe-row">
        <Num label="W" value={a.artboard.w} min={1} max={20000} unit="px" width={56} onChange={(v) => resizeArtboard(ed, a, v, a.artboard.h, true)} />
        <button type="button" className="pe-small-btn" title="החלפת כיוון" onClick={() => resizeArtboard(ed, a, a.artboard.h, a.artboard.w)}>⇄</button>
        <Num label="H" value={a.artboard.h} min={1} max={20000} unit="px" width={56} onChange={(v) => resizeArtboard(ed, a, a.artboard.w, v, true)} />
      </div>
      <div className="pe-field">Background · רקע
        <Seg value={kind} onChange={(k) => setArtboardBg(ed, a, k === 'white' ? '#ffffff' : k === 'black' ? '#000000' : k === 'transparent' ? 'transparent' : custom)}
          options={[['white', 'White'], ['black', 'Black'], ['transparent', 'Transparent'], ['custom', 'Custom']]} />
        {kind === 'custom' && <ColorField value={custom} onChange={(c) => setArtboardBg(ed, a, c, true)} />}
      </div>
      <p className="pe-hint">{a.children.length} שכבות · מה שמחוץ למשטח לא מיוצא</p>
    </div>
  );
}

/* ---------- File > Export > Artboards to Files ---------- */

function ArtboardsExportDialog({ ed }: { ed: Editor }) {
  const d = ed.doc!;
  const all = artboardsOf(d);
  const [ids, setIds] = useState<string[]>(all.filter((a) => a.visible).map((a) => a.id));
  const [format, setFormat] = useState<'png' | 'jpg' | 'webp' | 'svg'>('png');
  const [quality, setQuality] = useState(92);
  const [scale, setScale] = useState(1);
  const [transparent, setTransparent] = useState(true);
  const [bg, setBg] = useState('#ffffff');
  const [pid, setPid] = useState<string>(d.projectId ?? '');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { cloud.projects().then(setProjects, () => setProjects([])); }, []);
  const opts: ExportOpts = { format, quality: quality / 100, scale, transparent, bg };
  const ext = format === 'jpg' ? 'jpg' : format;
  const go = async (toProject: boolean) => {
    setBusy('מייצא…');
    try {
      await exportArtboards(ed, ids, opts, toProject ? pid : null, (i, n) => setBusy(`${Math.min(i + 1, n)}/${n}`));
      ed.closeDialog();
    } catch (e) { ed.toast(e instanceof Error ? e.message : String(e), 'error'); }
    finally { setBusy(null); }
  };
  const toggle = (id: string, on: boolean) => setIds(on ? [...ids, id] : ids.filter((x) => x !== id));
  return (
    <Modal title="Artboards to Files · משטחים לקבצים" onClose={() => ed.closeDialog()}
      footer={<>
        <button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button>
        {pid && <button type="button" className="pe-btn" disabled={!!busy || !ids.length} onClick={() => go(true)}>שליחה לפרויקט</button>}
        <button type="button" className="pe-btn primary" disabled={!!busy || !ids.length} onClick={() => go(false)}>{busy ?? `הורדת ${ids.length} קבצים`}</button>
      </>}>
      <div className="pe-ab-export-list">
        {all.map((a) => (
          <label key={a.id} className="pe-ab-export-row">
            <input type="checkbox" checked={ids.includes(a.id)} onChange={(e) => toggle(a.id, e.target.checked)} />
            <span dir="auto">{a.name}</span>
            <small dir="ltr">{Math.round(a.artboard.w * (format === 'svg' ? 1 : scale))}×{Math.round(a.artboard.h * (format === 'svg' ? 1 : scale))}</small>
            <code dir="ltr">{artboardFileName(d, a, ext)}</code>
          </label>
        ))}
      </div>
      <div className="pe-field">פורמט<Seg value={format} onChange={setFormat} options={[['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WEBP'], ['svg', 'SVG']]} /></div>
      {(format === 'jpg' || format === 'webp') && <Slider label="איכות" value={quality} min={10} max={100} unit="%" onChange={setQuality} />}
      {format !== 'svg' && (
        <div className="pe-row">
          <Num label="Scale" value={Math.round(scale * 100)} min={10} max={400} unit="%" width={44} onChange={(v) => setScale(v / 100)} />
          <button type="button" className="pe-small-btn" onClick={() => setScale(1)}>1x</button>
          <button type="button" className="pe-small-btn" onClick={() => setScale(2)}>2x</button>
        </div>
      )}
      {format !== 'jpg' && <Check label="רקע שקוף (למשטח עם רקע Transparent)" checked={transparent} onChange={setTransparent} />}
      {(format === 'jpg' || !transparent) && <div className="pe-row"><span className="pe-lbl">צבע רקע</span><ColorField value={bg} onChange={setBg} /></div>}
      <label className="pe-field">פרויקט לשליחה
        <select value={pid} onChange={(e) => setPid(e.target.value)}>
          <option value="">— בלי —</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <p className="pe-hint" dir="rtl">כל משטח נחתך לגבולות שלו, עם הרקע שלו. שכבות על ה-Pasteboard לא נכנסות.</p>
    </Modal>
  );
}

/** הדיאלוגים של משטחי העבודה (מוצג לצד Dialogs) */
export function ArtboardDialogs({ ed }: { ed: Editor }) {
  useEditor(ed);
  if (ed.dialog?.type === 'artboardsExport' && ed.doc) return <ArtboardsExportDialog ed={ed} />;
  return null;
}
