/** דיאלוגים: מסמך חדש, פתיחה, שמירה בשם, ייצוא, גודל תמונה/קנבס, התאמות ופילטרים, מילוי, בחירה, קיצורים. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { adjustDef, FILTERS } from '../adjust';
import type { Editor } from '../editor';
import { cloud, recovery, deserialize, type CloudDoc, type RecoveryEntry, exportBlob } from '../io';
import { comboOf, pretty, BROWSER_RESERVED } from '../shortcuts';
import { AdjustParams } from './panels';
import { SelectDialogs } from './select-dialogs';
import { PatternPicker } from './paint-options';
import { fillPattern } from '../patterns';
import { Check, ColorField, Num, Seg, Slider, useEditor } from './widgets';
import { exportDoc } from '../artboard-ops';
import { hasArtboards } from '../artboards';

export const PRESETS: Array<{ name: string; w: number; h: number; note?: string }> = [
  { name: 'Instagram Post', w: 1080, h: 1350, note: '4:5' },
  { name: 'Instagram Square', w: 1080, h: 1080, note: '1:1' },
  { name: 'Story / Reel', w: 1080, h: 1920, note: '9:16' },
  { name: 'Landscape', w: 1920, h: 1080, note: '16:9' },
  { name: 'YouTube Thumbnail', w: 1280, h: 720, note: '16:9' },
  { name: 'Facebook Cover', w: 1640, h: 624 },
  { name: 'LinkedIn Post', w: 1200, h: 1200 },
  { name: 'Banner רחב', w: 1920, h: 720 },
  { name: 'A4 (300dpi)', w: 2480, h: 3508 },
];

export function Modal({ title, children, onClose, footer, wide }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="pe-modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`pe-modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title} onKeyDown={(e) => e.stopPropagation()}>
        <div className="pe-modal-head">
          <h3>{title}</h3>
          <button type="button" className="pe-x" onClick={onClose} aria-label="סגירה">×</button>
        </div>
        <div className="pe-modal-body">{children}</div>
        {footer && <div className="pe-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- New ---------- */

function NewDialog({ ed, projectId }: { ed: Editor; projectId: string | null }) {
  const [name, setName] = useState('');
  const [w, setW] = useState(1080);
  const [h, setH] = useState(1350);
  const [dpi, setDpi] = useState(72);
  const [bg, setBg] = useState<'white' | 'black' | 'transparent' | 'custom'>('white');
  const [custom, setCustom] = useState('#f5efe6');
  const [artboard, setArtboard] = useState(false);
  const create = () => { ed.closeDialog(); ed.newDoc({ name, width: w, height: h, dpi, background: bg === 'custom' ? custom : bg, projectId, artboard }); };
  return (
    <Modal title="New Document · מסמך חדש" onClose={() => ed.closeDialog()} wide
      footer={<><button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button><button type="button" className="pe-btn primary" onClick={create}>Create · יצירה</button></>}>
      <div className="pe-new">
        <div className="pe-presets">
          {PRESETS.map((p) => (
            <button key={p.name} type="button" className={w === p.w && h === p.h ? 'on' : ''} onClick={() => { setW(p.w); setH(p.h); if (p.name.startsWith('A4')) setDpi(300); }}>
              <span className="pe-preset-shape" style={{ aspectRatio: `${p.w}/${p.h}` }} />
              <b dir="ltr">{p.name}</b>
              <small dir="ltr">{p.w}×{p.h}{p.note ? ` · ${p.note}` : ''}</small>
            </button>
          ))}
        </div>
        <div className="pe-new-form">
          <label className="pe-field">שם<input value={name} placeholder="ללא שם" onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') create(); }} /></label>
          <div className="pe-row"><Num label="Width" value={w} min={1} max={20000} unit="px" width={64} onChange={setW} /><button type="button" className="pe-small-btn" title="החלפת כיוון" onClick={() => { setW(h); setH(w); }}>⇄</button><Num label="Height" value={h} min={1} max={20000} unit="px" width={64} onChange={setH} /></div>
          <Num label="Resolution" value={dpi} min={1} max={1200} unit="ppi" width={52} onChange={setDpi} />
          <Check label="Artboards · משטחי עבודה" checked={artboard} onChange={setArtboard} title="המסמך נפתח עם משטח עבודה אחד במידה הזו; אפשר להוסיף לידו משטחים במידות אחרות (Shift+V)" />
          <div className="pe-field">רקע
            <Seg value={bg} onChange={setBg} options={[['white', 'White'], ['black', 'Black'], ['transparent', 'Transparent'], ['custom', 'Custom']]} />
            {bg === 'custom' && <ColorField value={custom} onChange={setCustom} />}
          </div>
          <p className="pe-hint">{artboard ? 'משטח עבודה אחד במידות האלה, עם הרקע שנבחר; לידו אפשר להוסיף עוד משטחים (פוסט, ריבוע, סטורי) שחולקים את אותם נכסים.' : 'המסמך נוצר בדיוק במידות האלה.'} {projectId ? 'הוא יקושר לפרויקט שממנו נפתח PHOTOEDIT.' : ''}</p>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Open ---------- */

function Thumbs({ docs, onOpen, onDelete }: { docs: CloudDoc[]; onOpen: (d: CloudDoc) => void; onDelete?: (d: CloudDoc) => void }) {
  return (
    <div className="pe-doc-grid">
      {docs.map((d) => (
        <div key={d.id} className="pe-doc-card">
          <button type="button" onClick={() => onOpen(d)} title={`פתיחה · ${d.width}×${d.height}`}>
            <img src={d.thumbUrl} alt="" loading="lazy" />
            <b dir="auto">{d.name}</b>
            <small dir="ltr">{d.width}×{d.height} · {new Date(d.updatedAt).toLocaleDateString('he-IL')}</small>
          </button>
          {onDelete && <button type="button" className="pe-doc-del" title="מחיקה" onClick={() => onDelete(d)}>×</button>}
        </div>
      ))}
    </div>
  );
}

export function useCloudDocs(ed: Editor, projectId: string | null, all = false) {
  const [docs, setDocs] = useState<CloudDoc[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reload = () => {
    cloud.list(all ? null : projectId).then((d) => { setDocs(d); ed.cloudOk = true; }, (e) => { setErr(String(e?.message ?? e)); setDocs([]); });
  };
  useEffect(reload, [projectId, all]);
  return { docs, err, reload };
}

export function ProjectImages({ ed, projectId, onPick }: { ed: Editor; projectId: string; onPick: (url: string, name: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof cloud.sources>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { cloud.sources(projectId).then(setData, (e) => setErr(String(e?.message ?? e))); }, [projectId]);
  void ed;
  if (err) return <p className="pe-hint">{err}</p>;
  if (!data) return <p className="pe-hint">טוען תמונות מהפרויקט…</p>;
  if (!data.images.length) return <p className="pe-hint">אין עדיין תמונות בפרויקט {data.project.name}.</p>;
  return (
    <div className="pe-doc-grid small">
      {data.images.map((im) => (
        <div key={im.id} className="pe-doc-card">
          <button type="button" onClick={() => onPick(im.url, im.label)} title={im.label}>
            <img src={im.url} alt="" loading="lazy" />
            <b dir="auto">{im.label}</b>
            <small>{im.group}</small>
          </button>
        </div>
      ))}
    </div>
  );
}

function OpenDialog({ ed, projectId }: { ed: Editor; projectId: string | null }) {
  const [tab, setTab] = useState<'cloud' | 'project' | 'recovery'>(projectId ? 'project' : 'cloud');
  const { docs, err, reload } = useCloudDocs(ed, projectId, true);
  const [rec, setRec] = useState<RecoveryEntry[]>([]);
  useEffect(() => { void recovery.list().then(setRec); }, []);
  const [confirmDel, setConfirmDel] = useState<CloudDoc | null>(null);
  return (
    <Modal title="Open · פתיחה" onClose={() => ed.closeDialog()} wide
      footer={<><button type="button" className="pe-btn" onClick={() => { ed.closeDialog(); ed.pickFiles(true); }}>מהמחשב… (PNG, JPG, WEBP, SVG, .photoedit)</button><button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button></>}>
      <Seg value={tab} onChange={setTab} options={[['cloud', 'השמורים בענן'], ...(projectId ? [['project', 'תמונות מהפרויקט'] as ['project', string]] : []), ['recovery', `שחזור (${rec.length})`]]} />
      <div className="pe-open-body">
        {tab === 'cloud' && (err ? <p className="pe-hint">{err}</p> : !docs ? <p className="pe-hint">טוען…</p> : docs.length ? (
          <Thumbs docs={docs} onOpen={(d) => { ed.closeDialog(); void ed.openCloud(d.id); }} onDelete={setConfirmDel} />
        ) : <p className="pe-hint">אין עדיין מסמכים שמורים. Ctrl+S שומר את המסמך הפתוח.</p>)}
        {tab === 'project' && projectId && <ProjectImages ed={ed} projectId={projectId} onPick={(url, name) => { ed.closeDialog(); void ed.openUrl(url, name, projectId); }} />}
        {tab === 'recovery' && (rec.length ? (
          <div className="pe-rec-list">
            {rec.map((r) => (
              <div key={r.id} className="pe-rec-row">
                <span dir="auto">{r.name}</span>
                <small>{new Date(r.time).toLocaleString('he-IL')}</small>
                <button type="button" className="pe-btn" onClick={async () => { const doc = await deserialize(JSON.parse(r.data)); ed.closeDialog(); ed.addDoc(doc, 'שחזור'); }}>שחזור</button>
                <button type="button" className="pe-btn" onClick={async () => { await recovery.remove(r.id); setRec(await recovery.list()); }}>מחיקה</button>
              </div>
            ))}
          </div>
        ) : <p className="pe-hint">אין עבודה לשחזור. כל שינוי נשמר כאן אוטומטית עד שהמסמך נשמר בענן.</p>)}
      </div>
      {confirmDel && (
        <div className="pe-inline-confirm">
          <span>למחוק לצמיתות את "{confirmDel.name}"?</span>
          <button type="button" className="pe-btn danger" onClick={async () => { await cloud.remove(confirmDel.id); setConfirmDel(null); reload(); }}>מחיקה</button>
          <button type="button" className="pe-btn" onClick={() => setConfirmDel(null)}>ביטול</button>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Save As ---------- */

function useProjects() {
  const [list, setList] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => { cloud.projects().then(setList, () => setList([])); }, []);
  return list;
}

function SaveAsDialog({ ed }: { ed: Editor }) {
  const d = ed.doc!;
  const [name, setName] = useState(d.name);
  const [pid, setPid] = useState<string>(d.projectId ?? '');
  const projects = useProjects();
  const save = () => { ed.closeDialog(); void ed.save(!!d.serverId, name.trim() || d.name, pid || null); };
  return (
    <Modal title="Save As · שמירה בשם" onClose={() => ed.closeDialog()}
      footer={<><button type="button" className="pe-btn" onClick={() => void ed.downloadProject()}>הורדת קובץ .photoedit</button><button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button><button type="button" className="pe-btn primary" onClick={save}>שמירה בענן</button></>}>
      <label className="pe-field">שם המסמך<input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} /></label>
      <label className="pe-field">פרויקט
        <select value={pid} onChange={(e) => setPid(e.target.value)}>
          <option value="">ללא פרויקט</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <p className="pe-hint">{d.serverId ? 'יישמר כעותק חדש; המקור נשאר.' : 'השכבות, הטקסטים והמסכות נשמרים במלואם. מכאן והלאה גם שמירה אוטומטית.'}</p>
    </Modal>
  );
}

/* ---------- Export ---------- */

function ExportDialog({ ed }: { ed: Editor }) {
  // עם משטחי עבודה: מייצאים את המשטח הפעיל (מסמך זמני בגודל המשטח)
  const abDoc = useMemo(() => (hasArtboards(ed.doc) ? exportDoc(ed) : null), [ed]);
  const d = abDoc ?? ed.doc!;
  const [format, setFormat] = useState<'png' | 'jpg' | 'webp' | 'svg'>('png');
  const [quality, setQuality] = useState(92);
  const [scale, setScale] = useState(1);
  const [transparent, setTransparent] = useState(true);
  const [bg, setBg] = useState('#ffffff');
  const [name, setName] = useState(d.name);
  const [pid, setPid] = useState<string>(d.projectId ?? '');
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  const projects = useProjects();
  const opts = { format, quality: quality / 100, scale, transparent, bg };
  useEffect(() => {
    let live = true;
    setSize(null);
    const t = window.setTimeout(() => { exportBlob(d, opts).then((b) => live && setSize(b.size), () => undefined); }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [format, quality, scale, transparent, bg]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async (toProject: boolean) => {
    setBusy(true);
    try { await ed.exportAs(opts, name, toProject ? pid : null); ed.closeDialog(); }
    catch (e) { ed.toast(e instanceof Error ? e.message : String(e), 'error'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Export As · ייצוא" onClose={() => ed.closeDialog()}
      footer={<>
        <button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button>
        {pid && <button type="button" className="pe-btn" disabled={busy} onClick={() => go(true)}>שליחה לפרויקט</button>}
        <button type="button" className="pe-btn primary" disabled={busy} onClick={() => go(false)}>{busy ? 'מייצא…' : 'הורדה'}</button>
      </>}>
      <label className="pe-field">שם קובץ<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      {abDoc && <p className="pe-hint" dir="rtl">מייצא את משטח העבודה הפעיל בלבד ({abDoc.width}×{abDoc.height}). לכל המשטחים: File › Artboards to Files.</p>}
      <div className="pe-field">פורמט<Seg value={format} onChange={setFormat} options={[['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WEBP'], ['svg', 'SVG']]} /></div>
      {(format === 'jpg' || format === 'webp') && <Slider label="איכות" value={quality} min={10} max={100} unit="%" onChange={setQuality} />}
      {format !== 'svg' && (
        <div className="pe-row">
          <Num label="Scale" value={Math.round(scale * 100)} min={10} max={400} unit="%" width={44} onChange={(v) => setScale(v / 100)} />
          <Num label="W" value={Math.round(d.width * scale)} min={1} unit="px" width={56} onChange={(v) => setScale(v / d.width)} />
          <Num label="H" value={Math.round(d.height * scale)} min={1} unit="px" width={56} onChange={(v) => setScale(v / d.height)} />
          <button type="button" className="pe-small-btn" onClick={() => setScale(2)}>2x</button>
        </div>
      )}
      {format !== 'jpg' && <Check label="רקע שקוף" checked={transparent} onChange={setTransparent} />}
      {(format === 'jpg' || !transparent) && <div className="pe-row"><span className="pe-lbl">צבע רקע</span><ColorField value={bg} onChange={setBg} /></div>}
      <label className="pe-field">פרויקט לשליחה
        <select value={pid} onChange={(e) => setPid(e.target.value)}>
          <option value="">— בלי —</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <p className="pe-hint" dir="rtl">{format === 'svg' ? 'טקסטים וצורות נשארים וקטוריים; פיקסלים ואפקטים נכנסים כתמונה.' : `${Math.round(d.width * scale)}×${Math.round(d.height * scale)} px`}{size != null ? ` · ${(size / 1024 / 1024).toFixed(2)} MB` : ''}</p>
    </Modal>
  );
}

/* ---------- Image Size / Canvas Size ---------- */

function ImageSizeDialog({ ed }: { ed: Editor }) {
  const d = ed.doc!;
  const [w, setW] = useState(d.width);
  const [h, setH] = useState(d.height);
  const [link, setLink] = useState(true);
  return (
    <Modal title="Image Size · גודל תמונה" onClose={() => ed.closeDialog()}
      footer={<><button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button><button type="button" className="pe-btn primary" onClick={() => { ed.closeDialog(); ed.resizeImage(w, h); }}>OK</button></>}>
      <div className="pe-row"><Num label="Width" value={w} min={1} max={30000} unit="px" width={64} onChange={(v) => { setW(v); if (link) setH(Math.round((v * d.height) / d.width)); }} /></div>
      <div className="pe-row"><Num label="Height" value={h} min={1} max={30000} unit="px" width={64} onChange={(v) => { setH(v); if (link) setW(Math.round((v * d.width) / d.height)); }} /></div>
      <Check label="שמירה על יחס" checked={link} onChange={setLink} />
      <p className="pe-hint">שכבות פיקסלים שומרות את המקור, כך שהגדלה אחרי הקטנה לא מאבדת איכות. טקסט וצורות נשארים חדים.</p>
    </Modal>
  );
}

function CanvasSizeDialog({ ed }: { ed: Editor }) {
  const d = ed.doc!;
  const [w, setW] = useState(d.width);
  const [h, setH] = useState(d.height);
  const [anchor, setAnchor] = useState(4);
  const [fill, setFill] = useState<'none' | 'bg' | 'white'>('none');
  const ax = anchor % 3, ay = Math.floor(anchor / 3);
  return (
    <Modal title="Canvas Size · גודל קנבס" onClose={() => ed.closeDialog()}
      footer={<><button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button><button type="button" className="pe-btn primary" onClick={() => { ed.closeDialog(); ed.resizeCanvas(w, h, ((w - d.width) * ax) / 2, ((h - d.height) * ay) / 2, 'גודל קנבס', fill === 'none' ? undefined : fill === 'white' ? '#ffffff' : ed.bg); }}>OK</button></>}>
      <div className="pe-row"><Num label="Width" value={w} min={1} max={30000} unit="px" width={64} onChange={setW} /><Num label="Height" value={h} min={1} max={30000} unit="px" width={64} onChange={setH} /></div>
      <div className="pe-field">עוגן
        <div className="pe-anchor" dir="ltr">{Array.from({ length: 9 }, (_, i) => <button key={i} type="button" className={i === anchor ? 'on' : ''} onClick={() => setAnchor(i)} />)}</div>
      </div>
      <div className="pe-field">מילוי השטח החדש<Seg value={fill} onChange={setFill} options={[['none', 'שקוף'], ['white', 'לבן'], ['bg', 'צבע רקע']]} /></div>
    </Modal>
  );
}

/* ---------- Adjust (destructive) / Filter ---------- */

function AdjustDialog({ ed, kind }: { ed: Editor; kind: Parameters<typeof adjustDef>[0] }) {
  const def = adjustDef(kind);
  const [p, setP] = useState(def.defaults());
  const [preview, setPreview] = useState(true);
  const target = ed.active;
  const ok = target?.type === 'raster';
  useEffect(() => { if (ok && preview) ed.previewAdjust(kind, p); else { ed.live.paint = null; ed.redraw(true); } }, [p, preview]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title={`${def.en} · ${def.name}`} onClose={() => ed.closeDialog()}
      footer={<>
        {!ok && <button type="button" className="pe-btn" onClick={() => { ed.closeDialog(); ed.addAdjustLayer(kind); ed.openPanel('Properties'); }}>כשכבת התאמה</button>}
        <button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button>
        <button type="button" className="pe-btn primary" disabled={!ok} onClick={() => { ed.applyAdjustDestructive(kind, p); ed.closeDialog(); }}>OK</button>
      </>}>
      {!ok && <p className="pe-hint">Image &gt; Adjustments עובד על שכבת פיקסלים. אפשר להוסיף את זה כשכבת התאמה לא הרסנית.</p>}
      <AdjustParams kind={kind} p={p} onChange={setP} />
      <Check label="Preview" checked={preview} onChange={setPreview} />
    </Modal>
  );
}

function FilterDialog({ ed, id }: { ed: Editor; id: string }) {
  const f = FILTERS.find((x) => x.id === id)!;
  const [p, setP] = useState<Record<string, number>>(() => Object.fromEntries(f.params.map((x) => [x.key, ed.lastFilter?.id === id ? ed.lastFilter.p[x.key] : x.def])));
  const [preview, setPreview] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => { if (preview) ed.previewFilter(id, p); else { ed.live.paint = null; ed.redraw(true); } }, 120);
    return () => window.clearTimeout(t);
  }, [p, preview]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title={`${f.en} · ${f.name}`} onClose={() => ed.closeDialog()}
      footer={<><button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button><button type="button" className="pe-btn primary" onClick={() => { ed.applyFilterDestructive(id, p); ed.closeDialog(); }}>OK</button></>}>
      {f.params.map((x) => <Slider key={x.key} label={x.label} value={p[x.key]} min={x.min} max={x.max} step={x.step} digits={x.step < 1 ? 1 : 0} onChange={(v) => setP({ ...p, [x.key]: v })} />)}
      <Check label="Preview" checked={preview} onChange={setPreview} />
      <p className="pe-hint">{ed.doc?.selection ? 'יחול רק בתוך הבחירה.' : 'יחול על כל השכבה.'} Ctrl+Alt+F מפעיל שוב את הפילטר האחרון.</p>
    </Modal>
  );
}

function FillDialog({ ed }: { ed: Editor }) {
  const [src, setSrc] = useState<'fg' | 'bg' | 'custom' | 'white' | 'black' | 'pattern'>('fg');
  const [custom, setCustom] = useState('#ff3b30');
  const [pattern, setPattern] = useState(ed.opts.patternStamp.pattern);
  const [op, setOp] = useState(100);
  const color = { fg: ed.fg, bg: ed.bg, custom, white: '#ffffff', black: '#000000', pattern: '' }[src];
  return (
    <Modal title="Fill · מילוי" onClose={() => ed.closeDialog()}
      footer={<><button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button><button type="button" className="pe-btn primary" onClick={() => { ed.closeDialog(); if (src === 'pattern') fillPattern(ed, pattern, op / 100); else ed.fill(color, op / 100); }}>OK</button></>}>
      <Seg value={src} onChange={setSrc} options={[['fg', 'צבע קדמי'], ['bg', 'צבע רקע'], ['custom', 'צבע…'], ['white', 'לבן'], ['black', 'שחור'], ['pattern', 'דפוס · Pattern']]} />
      {src === 'custom' && <ColorField value={custom} onChange={setCustom} />}
      {src === 'pattern' && <PatternPicker value={pattern} onChange={setPattern} />}
      {src === 'pattern' && <p className="pe-hint">דפוס משלכם: Edit &gt; Define Pattern (מהבחירה או מהשכבה).</p>}
      <Slider label="Opacity" value={op} min={1} max={100} unit="%" onChange={setOp} />
    </Modal>
  );
}

function SelModifyDialog({ ed, op }: { ed: Editor; op: 'feather' | 'expand' | 'contract' }) {
  const [v, setV] = useState(op === 'feather' ? 10 : 5);
  const title = { feather: 'Feather Selection · ריכוך', expand: 'Expand Selection · הרחבה', contract: 'Contract Selection · כיווץ' }[op];
  return (
    <Modal title={title} onClose={() => ed.closeDialog()}
      footer={<><button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button><button type="button" className="pe-btn primary" onClick={() => { ed.closeDialog(); ed.modifySelection(op, v); }}>OK</button></>}>
      <Num label="Radius" value={v} min={0.1} max={500} digits={1} unit="px" width={60} onChange={setV} />
    </Modal>
  );
}

/* ---------- Shortcuts ---------- */

function ShortcutsDialog({ ed }: { ed: Editor }) {
  useEditor(ed);
  const [q, setQ] = useState('');
  const [rec, setRec] = useState<string | null>(null);
  useEffect(() => {
    if (!rec) return;
    const on = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRec(null); return; }
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      const c = comboOf(e);
      if (!c) return;
      ed.shortcuts.set(rec, [c]);
      setRec(null);
      ed.emit();
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [rec, ed]);
  const groups = useMemo(() => {
    const m = new Map<string, typeof ed.shortcuts.defs>();
    for (const d of ed.shortcuts.defs) {
      if (q && !`${d.label} ${d.en} ${d.keys.join(' ')}`.toLowerCase().includes(q.toLowerCase())) continue;
      if (!m.has(d.group)) m.set(d.group, []);
      m.get(d.group)!.push(d);
    }
    return [...m];
  }, [q, ed.version]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="Keyboard Shortcuts · קיצורי מקלדת" onClose={() => ed.closeDialog()} wide
      footer={<><button type="button" className="pe-btn" onClick={() => { ed.shortcuts.reset(); ed.emit(); }}>איפוס לברירת מחדל</button><button type="button" className="pe-btn primary" onClick={() => ed.closeDialog()}>סגירה</button></>}>
      <input className="pe-search" placeholder="חיפוש פעולה או קיצור…" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="pe-hint">לחיצה על קיצור כדי להקליט קיצור חדש. Space + גרירה = יד · Alt + גלגלת = זום · Ctrl בכל כלי = הזזה זמנית · Alt במברשת = דוגם צבע · 1–0 = אטימות. קיצורים שהדפדפן שומר לעצמו (Ctrl+N/T/W) עובדים במסך מלא (F) או באפליקציה המותקנת, ויש להם חלופה עם Alt.</p>
      <div className="pe-sc-list">
        {groups.map(([g, list]) => (
          <section key={g}>
            <h4>{g}</h4>
            {list.map((d) => (
              <div key={d.id} className="pe-sc-row">
                <span>{d.label} <small dir="ltr">{d.en}</small></span>
                <button type="button" className={`pe-kbd ${rec === d.id ? 'rec' : ''}`} dir="ltr" onClick={() => setRec(d.id)}>
                  {rec === d.id ? 'הקש צירוף…' : d.keys.length ? d.keys.map((k) => pretty(k) + (BROWSER_RESERVED.has(k) ? '*' : '')).join('  /  ') : '—'}
                </button>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}

function ConfirmClose({ ed, index }: { ed: Editor; index: number }) {
  const st = ed.docs[index];
  if (!st) return null;
  return (
    <Modal title="שינויים שלא נשמרו" onClose={() => ed.closeDialog()}
      footer={<>
        <button type="button" className="pe-btn danger" onClick={() => { ed.closeDialog(); ed.close(index, true); }}>סגירה בלי לשמור</button>
        <button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button>
        <button type="button" className="pe-btn primary" onClick={async () => { ed.closeDialog(); ed.switchTo(index); await ed.save(); if (!ed.isDirty(st)) ed.close(index, true); }}>שמירה</button>
      </>}>
      <p>לשמור את "{st.doc.name}" לפני הסגירה?</p>
    </Modal>
  );
}

function PlaceFromProject({ ed, projectId }: { ed: Editor; projectId: string }) {
  return (
    <Modal title="תמונה מהפרויקט" onClose={() => ed.closeDialog()} wide>
      <ProjectImages ed={ed} projectId={projectId} onPick={(url, name) => { ed.closeDialog(); void ed.openUrl(url, name, projectId, true); }} />
    </Modal>
  );
}

function AboutDialog({ ed }: { ed: Editor }) {
  return (
    <Modal title="PHOTOEDIT" onClose={() => ed.closeDialog()} wide>
      <div className="pe-about">
        <p>עורך העיצובים הסטטיים של AI Production AP. שכבות אמיתיות, טקסט שנשאר עריך, מסכות, שכבות התאמה, Clipping, היסטוריה מלאה ושמירה בענן של המערכת.</p>
        <h4>עובד עכשיו</h4>
        <p>Move · Free Transform · Marquee · Lasso / Polygonal · Magic Wand · Crop · Brush · Eraser · Clone Stamp · Gradient · Paint Bucket · Type (עברית RTL) · Shapes · Eyedropper · Hand · Zoom · Layers (קבוצות, מסכות, Clipping, Blend Modes, מיזוג, Rasterize) · Layer Style (צל, קו מתאר, זוהר, שכבת צבע) · 14 שכבות התאמה · 5 פילטרים · Rulers / Guides / Grid / Smart Guides / Snap · Align & Distribute · Image Size · Canvas Size · ייצוא PNG / JPG / WEBP / SVG · קובץ .photoedit</p>
        <h4>במפת הדרכים</h4>
        <p>Pen Tool ו-Paths · Healing Brush · Content-Aware Fill · Liquify · Smart Objects · Perspective / Warp · Artboards · Actions ו-Batch Export · PSD Import / Export · הסרת רקע, הסרת אובייקטים, Generative Fill והרחבת תמונה דרך כלי ה-AI של המערכת.</p>
      </div>
    </Modal>
  );
}

export function Dialogs({ ed, projectId }: { ed: Editor; projectId: string | null }) {
  useEditor(ed);
  const dlg = ed.dialog;
  if (!dlg) return null;
  switch (dlg.type) {
    case 'new': return <NewDialog ed={ed} projectId={projectId} />;
    case 'open': return <OpenDialog ed={ed} projectId={projectId} />;
    case 'saveAs': return ed.doc ? <SaveAsDialog ed={ed} /> : null;
    case 'export': return ed.doc ? <ExportDialog ed={ed} /> : null;
    case 'imageSize': return ed.doc ? <ImageSizeDialog ed={ed} /> : null;
    case 'canvasSize': return ed.doc ? <CanvasSizeDialog ed={ed} /> : null;
    case 'adjust': return ed.doc ? <AdjustDialog ed={ed} kind={dlg.data.kind} /> : null;
    case 'filter': return ed.doc ? <FilterDialog ed={ed} id={dlg.data.id} /> : null;
    case 'fill': return ed.doc ? <FillDialog ed={ed} /> : null;
    case 'selModify': return ed.doc ? <SelModifyDialog ed={ed} op={dlg.data.op} /> : null;
    case 'shortcuts': return <ShortcutsDialog ed={ed} />;
    case 'confirmClose': return <ConfirmClose ed={ed} index={dlg.data.index} />;
    case 'placeProject': return projectId ? <PlaceFromProject ed={ed} projectId={projectId} /> : null;
    case 'about': return <AboutDialog ed={ed} />;
    default: return <SelectDialogs ed={ed} />;
  }
}
