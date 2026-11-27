/**
 * PHOTOEDIT — מסך העורך המלא בתוך AI Production AP (נתיב /photoedit).
 * ?project=<id> מקשר מסמכים חדשים לפרויקט ומציג את התמונות שלו; ?doc=<id> פותח מסמך שמור; ?image=<url> פותח תמונה כמסמך.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ADJUSTMENTS, FILTERS } from '../adjust';
import { Editor } from '../editor';
import { loadGoogleFonts } from '../fonts';
import { cloud, recovery, deserialize, type CloudDoc, type RecoveryEntry } from '../io';
import { pretty } from '../shortcuts';
import { pointerDown, pointerMove, pointerUp, TOOLS, type PtrEvt, type ToolId } from '../tools';
import { Dialogs, PRESETS, ProjectImages, useCloudDocs } from './dialogs';
import { AdjustmentsPanel, AlignPanel, CharacterPanel, ColorPanel, FontSelect, HistoryPanel, LayersPanel, ParagraphPanel, PropertiesPanel, SwatchesPanel, TransformPanel, applyTextStyle } from './panels';
import { Check, ColorField, Ico, Num, Seg, useEditor } from './widgets';
import { endSelTransform } from '../tools-select';
import { groupCurrent, TOOL_NAMES } from '../tool-registry';
import { paintOptions } from './paint-options';
import { InfoPanel } from './info-panel';
import { PathsPanel } from './paths-panel';
import { CustomShapePicker, penOptions } from './pen-options';
import { ArtboardDialogs, ArtboardOptions } from './artboard-ui';
import { FreeTransformExtras, warpOptions } from './warp-options';
import { LiquifyDialog } from './liquify-dialog';
import { hasDeform } from '../tools-warp';
import { hasArtboards } from '../artboards';
import '../photoedit.css';

/** עורך יחיד לכל האפליקציה — מעבר לעמוד אחר וחזרה לא סוגר מסמכים פתוחים */
let singleton: Editor | null = null;
/** חשוף גם ל-Claude (אוטומציה ובדיקות): window.__PHOTOEDIT__ */
const getEditor = () => {
  if (!singleton) { singleton = new Editor(); (window as unknown as { __PHOTOEDIT__?: Editor }).__PHOTOEDIT__ = singleton; }
  return singleton;
};

/* ======================= תפריטים ======================= */

interface MenuItem { label?: string; en?: string; cmd?: string; act?: () => void; key?: string; checked?: boolean; disabled?: boolean; sub?: MenuItem[]; sep?: boolean }

function menus(ed: Editor, projectId: string | null): Array<{ title: string; items: MenuItem[] }> {
  const d = ed.doc;
  const no = !d;
  const a = ed.active;
  const abDoc = hasArtboards(d);
  return [
    { title: 'File', items: [
      { label: 'מסמך חדש…', en: 'New', cmd: 'file.new' },
      { label: 'פתיחה…', en: 'Open', cmd: 'file.open' },
      { label: 'פתיחה מהמחשב…', en: 'Open File', act: () => ed.pickFiles(true) },
      ...(projectId ? [{ label: 'תמונה מהפרויקט כשכבה…', en: 'Place from Project', act: () => ed.openDialog('placeProject'), disabled: no }] : []),
      { label: 'הוספת תמונה כשכבה…', en: 'Place Embedded', cmd: 'file.place', disabled: no },
      { sep: true },
      { label: 'שמירה', en: 'Save', cmd: 'file.save', disabled: no },
      { label: 'שמירה בשם…', en: 'Save As', cmd: 'file.saveAs', disabled: no },
      { label: 'הורדת קובץ פרויקט (.photoedit)', en: 'Download Project', act: () => void ed.downloadProject(), disabled: no },
      { sep: true },
      { label: 'ייצוא…', en: 'Export As', cmd: 'file.export', disabled: no },
      { label: 'ייצוא מהיר PNG', en: 'Quick Export as PNG', cmd: 'file.quickPng', disabled: no },
      { label: 'משטחי עבודה לקבצים…', en: 'Artboards to Files', cmd: 'artboard.exportAll', disabled: !abDoc },
      { sep: true },
      { label: 'סגירה', en: 'Close', cmd: 'file.close', disabled: no },
    ] },
    { title: 'Edit', items: [
      { label: `ביטול${d?.layers && ed.st?.history.canUndo ? ` — ${ed.st.history.states[ed.st.history.index].label}` : ''}`, en: 'Undo', cmd: 'edit.undo', disabled: !ed.st?.history.canUndo },
      { label: 'חזרה', en: 'Redo', cmd: 'edit.redo', disabled: !ed.st?.history.canRedo },
      { sep: true },
      { label: 'גזירה', en: 'Cut', cmd: 'edit.cut', disabled: no },
      { label: 'העתקה', en: 'Copy', cmd: 'edit.copy', disabled: no },
      { label: 'העתקה ממוזגת', en: 'Copy Merged', cmd: 'edit.copyMerged', disabled: no },
      { label: 'הדבקה', en: 'Paste', key: 'Ctrl+V', act: () => ed.toast('הדבקה: Ctrl+V על הקנבס') },
      { sep: true },
      { label: 'מילוי…', en: 'Fill', cmd: 'edit.fill', disabled: no },
      { label: 'הגדרת דפוס', en: 'Define Pattern', cmd: 'edit.definePattern', disabled: no || !a },
      { label: 'Free Transform', en: '', cmd: 'edit.freeTransform', disabled: no },
      { label: 'Transform', en: '', disabled: no, sub: [
        { label: 'היפוך אופקי', en: 'Flip Horizontal', cmd: 'edit.flipH' },
        { label: 'היפוך אנכי', en: 'Flip Vertical', cmd: 'edit.flipV' },
        { label: 'סיבוב 90° עם השעון', en: 'Rotate 90° CW', act: () => ed.rotateLayers(90) },
        { label: 'סיבוב 90° נגד השעון', en: 'Rotate 90° CCW', act: () => ed.rotateLayers(-90) },
        { label: 'סיבוב 180°', en: 'Rotate 180°', act: () => ed.rotateLayers(180) },
        { sep: true },
        { label: 'הטיה', en: 'Skew', cmd: 'edit.skew', checked: ed.live.freeTransform?.mode === 'skew' },
        { label: 'עיוות', en: 'Distort', cmd: 'edit.distort', checked: ed.live.freeTransform?.mode === 'distort' },
        { label: 'פרספקטיבה', en: 'Perspective', cmd: 'edit.perspective', checked: ed.live.freeTransform?.mode === 'perspective' },
        { label: 'עיקום', en: 'Warp', cmd: 'edit.warp' },
        { sep: true },
        { label: 'ביטול עיוות', en: 'Remove Distort / Warp', cmd: 'edit.resetDeform', disabled: !ed.topSelected().some((l) => hasDeform(l)) },
      ] },
      { label: 'עיוות בובה', en: 'Puppet Warp', cmd: 'edit.puppetWarp', disabled: no || !a },
      { sep: true },
      { label: 'קיצורי מקלדת…', en: 'Keyboard Shortcuts', cmd: 'edit.shortcuts' },
    ] },
    { title: 'Image', items: [
      { label: 'Adjustments', disabled: no, sub: [
        ...ADJUSTMENTS.filter((x) => x.kind !== 'invert').map((x) => ({ label: x.name, en: x.en, act: () => ed.openDialog('adjust', { kind: x.kind }), key: ({ levels: 'image.levels', curves: 'image.curves', hueSat: 'image.hueSat', colorBalance: 'image.colorBalance', bw: 'image.bw' } as Record<string, string>)[x.kind] })),
        { sep: true },
        { label: 'היפוך צבעים', en: 'Invert', cmd: 'image.invert' },
        { label: 'ביטול רוויה', en: 'Desaturate', cmd: 'image.desaturate' },
      ] },
      { sep: true },
      { label: 'גודל תמונה…', en: 'Image Size', cmd: 'image.size', disabled: no },
      { label: 'גודל קנבס…', en: 'Canvas Size', cmd: 'image.canvasSize', disabled: no },
      { label: 'סיבוב קנבס', disabled: no, sub: [
        { label: '180°', en: '', act: () => ed.rotateCanvas(180) },
        { label: '90° עם השעון', en: '', act: () => ed.rotateCanvas(90) },
        { label: '90° נגד השעון', en: '', act: () => ed.rotateCanvas(-90) },
        { label: 'היפוך אופקי', en: 'Flip Canvas Horizontal', act: () => ed.flipCanvas(true) },
        { label: 'היפוך אנכי', en: 'Flip Canvas Vertical', act: () => ed.flipCanvas(false) },
      ] },
      { label: 'חיתוך לפי הבחירה', en: 'Crop', act: () => ed.cropToSelection(), disabled: !d?.selection },
      { label: 'קיצוץ שקיפות', en: 'Trim', act: () => ed.trim(), disabled: no },
    ] },
    { title: 'Layer', items: [
      { label: 'שכבה חדשה', en: 'New Layer', cmd: 'layer.new', disabled: no },
      { label: 'New', en: '', disabled: no, sub: [
        { label: 'שכבה', en: 'Layer', cmd: 'layer.new' },
        { label: 'משטח עבודה', en: 'Artboard', cmd: 'artboard.new' },
      ] },
      { label: 'משטח עבודה מקבוצה', en: 'Artboard from Group', cmd: 'artboard.fromGroup', disabled: no || a?.type !== 'group' || !!a.artboard },
      { label: 'משטח עבודה משכבות', en: 'Artboard from Layers', cmd: 'artboard.fromLayers', disabled: no || !ed.topSelected().some((l) => !(l.type === 'group' && l.artboard)) },
      { label: 'שכפול שכבה', en: 'Duplicate', cmd: 'layer.duplicate', disabled: no },
      { label: 'שכבה בגזירה', en: 'Layer via Cut', cmd: 'layer.viaCut', disabled: !d?.selection },
      { label: 'מחיקה', en: 'Delete Layer', act: () => ed.deleteSelected(), disabled: no },
      { sep: true },
      { label: 'שכבת התאמה חדשה', disabled: no, sub: ADJUSTMENTS.map((x) => ({ label: x.name, en: x.en, act: () => { ed.addAdjustLayer(x.kind); ed.openPanel('Properties'); } })) },
      { label: 'Layer Mask', disabled: no || !a, sub: [
        { label: 'הצג הכול', en: 'Reveal All', cmd: 'layer.maskRevealAll', disabled: !!a?.mask },
        { label: 'הסתר הכול', en: 'Hide All', cmd: 'layer.maskHideAll', disabled: !!a?.mask },
        { label: 'מסכה מהבחירה', en: 'Reveal Selection', cmd: 'layer.maskRevealSel', disabled: !!a?.mask || !d?.selection },
        { label: 'מסכה שמסתירה את הבחירה', en: 'Hide Selection (Alt)', cmd: 'layer.maskHideSel', disabled: !!a?.mask || !d?.selection },
        { sep: true },
        { label: 'היפוך מסכה', en: 'Invert Mask', act: () => ed.invertMask(), disabled: !a?.mask },
        { label: 'כיבוי/הפעלת מסכה', en: 'Disable / Enable', act: () => a && ed.toggleMaskEnabled(a), disabled: !a?.mask },
        { label: 'טעינת המסכה כבחירה', en: 'Load as Selection', cmd: 'mask.toSelection', disabled: !a?.mask },
        { label: 'שכבת אדום של המסכה', en: 'Mask Overlay', cmd: 'mask.overlay', disabled: !a?.mask, checked: ed.live.maskView?.mode === 'overlay' && ed.live.maskView.layerId === a?.id },
        { sep: true },
        { label: 'החלת מסכה', en: 'Apply', act: () => ed.deleteMask(true), disabled: !a?.mask || a.type !== 'raster' },
        { label: 'מחיקת מסכה', en: 'Delete', act: () => ed.deleteMask(false), disabled: !a?.mask },
      ] },
      { label: 'Vector Mask', en: '', disabled: no || !a, sub: [
        { label: 'מהנתיב הנוכחי', en: 'Current Path', cmd: 'layer.vmaskCurrent' },
        { label: 'הסתר הכול', en: 'Hide All', cmd: 'layer.vmaskHideAll', disabled: !!a?.vmask },
        { sep: true },
        { label: 'כיבוי/הפעלת מסכה וקטורית', en: 'Disable / Enable', cmd: 'layer.vmaskToggle', disabled: !a?.vmask, checked: !!a?.vmask && !a.vmask.enabled },
        { label: 'עריכה בבחירה ישירה', en: 'Edit (Direct Selection)', cmd: 'layer.vmaskEdit', disabled: !a?.vmask },
        { label: 'מחיקת מסכה וקטורית', en: 'Delete', cmd: 'layer.vmaskDelete', disabled: !a?.vmask },
      ] },
      { label: 'Create Clipping Mask', en: '', cmd: 'layer.clip', disabled: no },
      { sep: true },
      { label: 'קיבוץ', en: 'Group Layers', cmd: 'layer.group', disabled: no },
      { label: 'פירוק קבוצה', en: 'Ungroup', cmd: 'layer.ungroup', disabled: no },
      { label: 'Arrange', disabled: no, sub: [
        { label: 'לראש', en: 'Bring to Front', cmd: 'layer.front' },
        { label: 'קדימה', en: 'Bring Forward', cmd: 'layer.forward' },
        { label: 'אחורה', en: 'Send Backward', cmd: 'layer.backward' },
        { label: 'לתחתית', en: 'Send to Back', cmd: 'layer.back' },
      ] },
      { label: 'Rasterize', en: '', cmd: 'layer.rasterize', disabled: !a || !['text', 'shape', 'group'].includes(a.type) },
      { label: 'המרה לצורה', en: 'Convert to Shape', cmd: 'layer.convertToShape', disabled: a?.type !== 'shape' || a.shape === 'path' || a.shape === 'line' },
      { sep: true },
      { label: 'מיזוג', en: 'Merge Down', cmd: 'layer.mergeDown', disabled: no },
      { label: 'מיזוג הגלויות', en: 'Merge Visible', cmd: 'layer.mergeVisible', disabled: no },
      { label: 'חותמת ממוזגת', en: 'Stamp Visible', cmd: 'layer.stamp', disabled: no },
      { label: 'שיטוח', en: 'Flatten Image', act: () => ed.flatten(), disabled: no },
    ] },
    { title: 'Type', items: [
      { label: 'כלי טקסט', en: 'Type Tool', act: () => ed.setTool('text'), key: 'tool.text' },
      { label: 'טקסט אנכי', en: 'Vertical Type Tool', act: () => ed.setTool('vtext') },
      { label: 'מסכת טקסט', en: 'Horizontal Type Mask Tool', act: () => ed.setTool('htmask') },
      { label: 'מסכת טקסט אנכית', en: 'Vertical Type Mask Tool', act: () => ed.setTool('vtmask') },
      { sep: true },
      { label: 'Character', en: 'פאנל', act: () => ed.openPanel('Character') },
      { label: 'Paragraph', en: 'פאנל', act: () => ed.openPanel('Paragraph') },
      { sep: true },
      { label: 'כיוון: מימין לשמאל', en: 'RTL', act: () => applyTextStyle(ed, { dir: 'rtl', align: 'right' }) },
      { label: 'כיוון: משמאל לימין', en: 'LTR', act: () => applyTextStyle(ed, { dir: 'ltr', align: 'left' }) },
      { label: 'העלאת פונט…', en: 'Upload Font', act: () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.ttf,.otf,.woff,.woff2'; i.onchange = () => { const f = i.files?.[0]; if (f) void ed.uploadFont(f); }; i.click(); } },
      { label: 'Rasterize Type Layer', en: '', cmd: 'layer.rasterize', disabled: a?.type !== 'text' },
    ] },
    { title: 'Select', items: [
      { label: 'בחירת הכול', en: 'All', cmd: 'select.all', disabled: no },
      { label: 'ביטול בחירה', en: 'Deselect', cmd: 'select.deselect', disabled: !d?.selection },
      { label: 'בחירה חוזרת', en: 'Reselect', cmd: 'select.reselect', disabled: no },
      { label: 'היפוך בחירה', en: 'Inverse', cmd: 'select.inverse', disabled: !d?.selection },
      { sep: true },
      { label: 'כל השכבות', en: 'All Layers', cmd: 'select.allLayers', disabled: no },
      { label: 'בחירה מהשכבה', en: 'Load Layer Pixels', act: () => a && ed.selectionFromLayer(a), disabled: !a },
      { sep: true },
      { label: 'טווח צבעים…', en: 'Color Range', cmd: 'select.colorRange', disabled: no },
      { label: 'בחירת נושא · בקרוב · AI', en: 'Subject', disabled: true },
      { label: 'בחירת שמיים · בקרוב · AI', en: 'Sky', disabled: true },
      { sep: true },
      { label: 'בחירה ומסכה…', en: 'Select and Mask', cmd: 'select.selectAndMask', disabled: !d?.selection && !(ed.st?.maskEdit && a?.mask) },
      { label: 'Modify', disabled: !d?.selection, sub: [
        { label: 'מסגרת…', en: 'Border', cmd: 'select.border' },
        { label: 'החלקה…', en: 'Smooth', cmd: 'select.smooth' },
        { label: 'הרחבה…', en: 'Expand', cmd: 'select.expand' },
        { label: 'כיווץ…', en: 'Contract', cmd: 'select.contract' },
        { label: 'ריכוך…', en: 'Feather', cmd: 'select.feather' },
      ] },
      { label: 'הרחבה לפי צבע', en: 'Grow', cmd: 'select.grow', disabled: !d?.selection },
      { label: 'צבעים דומים', en: 'Similar', cmd: 'select.similar', disabled: !d?.selection },
      { sep: true },
      { label: 'שינוי צורת הבחירה', en: 'Transform Selection', cmd: 'select.transform', disabled: !d?.selection },
      { label: 'עריכה במסכה מהירה', en: 'Edit in Quick Mask Mode', cmd: 'select.quickMask', disabled: no, checked: !!ed.st?.qmask },
      { sep: true },
      { label: 'טעינת בחירה…', en: 'Load Selection', cmd: 'select.load', disabled: !d?.channels?.length },
      { label: 'שמירת בחירה…', en: 'Save Selection', cmd: 'select.save', disabled: !d?.selection },
    ] },
    { title: 'Filter', items: [
      { label: ed.lastFilter ? `שוב: ${FILTERS.find((f) => f.id === ed.lastFilter!.id)?.en}` : 'פילטר אחרון', en: 'Last Filter', cmd: 'filter.last', disabled: !ed.lastFilter || no },
      { sep: true },
      { label: 'נזילות…', en: 'Liquify', cmd: 'filter.liquify', disabled: no || !a },
      { sep: true },
      ...FILTERS.map((f) => ({ label: f.name, en: f.en, act: () => ed.openDialog('filter', { id: f.id }), disabled: no })),
    ] },
    { title: 'View', items: [
      { label: 'הגדלה', en: 'Zoom In', cmd: 'view.zoomIn' },
      { label: 'הקטנה', en: 'Zoom Out', cmd: 'view.zoomOut' },
      { label: 'התאמה למסך', en: 'Fit on Screen', cmd: 'view.fit' },
      { label: '100%', en: 'Actual Pixels', cmd: 'view.actual' },
      { label: 'כלי סיבוב תצוגה', en: 'Rotate View', act: () => ed.setTool('rotateView'), key: 'tool.rotateView' },
      { label: 'איפוס סיבוב התצוגה', en: 'Reset View Rotation', cmd: 'view.resetRotation', disabled: !ed.st?.rot },
      { sep: true },
      { label: 'סרגלים', en: 'Rulers', cmd: 'view.rulers', checked: ed.view.rulers },
      { label: 'קווי עזר', en: 'Guides', cmd: 'view.guides', checked: ed.view.guides },
      { label: 'רשת', en: 'Grid', cmd: 'view.grid', checked: ed.view.grid },
      { label: 'Smart Guides', en: '', act: () => { ed.view.smartGuides = !ed.view.smartGuides; ed.emit(); }, checked: ed.view.smartGuides },
      { label: 'הצמדה', en: 'Snap', cmd: 'view.snap', checked: ed.view.snap },
      { label: 'תוספות', en: 'Extras', cmd: 'view.extras', checked: ed.view.extras },
      { sep: true },
      { label: 'קו עזר חדש באמצע', en: 'New Guide', act: () => { if (d) { d.guides.v.push(Math.round(d.width / 2)); ed.commit('קו עזר'); } }, disabled: no },
      { label: 'ניקוי קווי עזר', en: 'Clear Guides', act: () => { if (d) { d.guides = { v: [], h: [] }; ed.commit('ניקוי קווי עזר'); } }, disabled: no },
      { sep: true },
      { label: 'מסך מלא', en: 'Full Screen', cmd: 'view.screenMode' },
    ] },
    { title: 'Window', items: [
      ...['Layers', 'Properties', 'Adjustments', 'History', 'Paths', 'Color', 'Swatches', 'Info', 'Character', 'Paragraph', 'Align', 'Transform'].map((p) => ({ label: p, en: '', act: () => ed.openPanel(p) })),
      { sep: true },
      { label: 'הסתרת/הצגת פאנלים', en: 'Tab', cmd: 'view.togglePanels' },
    ] },
    { title: 'Help', items: [
      { label: 'קיצורי מקלדת', en: 'F1', cmd: 'edit.shortcuts' },
      { label: 'על PHOTOEDIT ומפת הדרכים', en: 'About', act: () => ed.openDialog('about') },
    ] },
  ];
}

function MenuList({ ed, items, close }: { ed: Editor; items: MenuItem[]; close: () => void }) {
  const [sub, setSub] = useState<number | null>(null);
  return (
    <div className="pe-menu-list" role="menu">
      {items.map((it, i) => {
        if (it.sep) return <div key={i} className="pe-menu-sep" />;
        const key = it.key ? (it.key.includes('.') ? ed.shortcuts.label(it.key) : pretty(it.key)) : it.cmd ? ed.shortcuts.label(it.cmd) : '';
        return (
          <div key={i} className="pe-menu-item-wrap" onMouseEnter={() => setSub(it.sub ? i : null)}>
            <button type="button" role="menuitem" className="pe-menu-item" disabled={it.disabled}
              onClick={() => { if (it.sub) { setSub(i); return; } close(); if (it.act) it.act(); else if (it.cmd) ed.run(it.cmd); }}>
              <span className="pe-mi-check">{it.checked ? '✓' : ''}</span>
              <span className="pe-mi-label">{it.label}{it.en ? <small dir="ltr"> {it.en}</small> : null}</span>
              <span className="pe-mi-key" dir="ltr">{it.sub ? '▸' : key}</span>
            </button>
            {it.sub && sub === i && !it.disabled && <div className="pe-submenu"><MenuList ed={ed} items={it.sub} close={close} /></div>}
          </div>
        );
      })}
    </div>
  );
}

function MenuBar({ ed, projectId, projectName }: { ed: Editor; projectId: string | null; projectName: string | null }) {
  useEditor(ed);
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open == null) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    window.addEventListener('pointerdown', off);
    return () => window.removeEventListener('pointerdown', off);
  }, [open]);
  const ms = menus(ed, projectId);
  const st = ed.st;
  return (
    <div className="pe-menubar" ref={ref}>
      <Link to={projectId ? `/projects/${projectId}` : '/'} className="pe-logo" title="חזרה למערכת">PE</Link>
      {ms.map((m, i) => (
        <div key={m.title} className="pe-menu-root">
          <button type="button" className={`pe-menu-title ${open === i ? 'on' : ''}`} onClick={() => setOpen(open === i ? null : i)} onMouseEnter={() => open != null && setOpen(i)}>{m.title}</button>
          {open === i && <div className="pe-dropdown"><MenuList ed={ed} items={m.items} close={() => setOpen(null)} /></div>}
        </div>
      ))}
      <div className="pe-menubar-side">
        {projectName && <Link to={`/projects/${projectId}`} className="pe-proj-chip" title="חזרה לפרויקט">↩ {projectName}</Link>}
        {st && <span className={`pe-save-state ${st.saveError ? 'err' : ''}`}>{st.saving ? 'שומר…' : st.saveError ? 'השמירה נכשלה' : ed.isDirty(st) ? (st.doc.serverId ? 'שינויים לא שמורים' : 'לא נשמר עדיין · Ctrl+S') : 'נשמר בענן ✓'}</span>}
        {ed.cloudOk === false && <span className="pe-save-state err" title="אין חיבור לשרת המערכת — העבודה נשמרת רק בדפדפן">מצב מקומי</span>}
        <button type="button" className="pe-small-btn" title="מסך מלא (F)" onClick={() => ed.toggleFullscreen()}>⛶</button>
      </div>
    </div>
  );
}

/* ======================= סרגל כלים ======================= */

type FlyItem = { label: string; icon: string; set: (ed: Editor) => void; on: (ed: Editor) => boolean; key?: string };

/** כפתור של קבוצת כלים נפרדים (B, E, S, J, O, I, T, H…): מציג את הכלי האחרון שנבחר בקבוצה */
function group(id: ToolId, name: string, items: Array<[ToolId, string]>, keyOf?: (m: ToolId) => string) {
  const icon = (m: ToolId) => (m === 'text' ? 'text' : m);
  return {
    id, name, members: items.map(([m]) => m),
    icon: () => icon(groupCurrent(id)),
    flyout: items.map(([m, label]): FlyItem => ({ label, icon: icon(m), set: (ed) => ed.setTool(m), on: () => groupCurrent(id) === m, key: keyOf?.(m) })),
  };
}

const TOOL_BAR: Array<{ id: ToolId; icon: (ed: Editor) => string; name: string; members?: ToolId[]; flyout?: FlyItem[] }> = [
  group('move', 'Move / Artboard', [['move', 'Move · הזזה'], ['artboard', 'Artboard · משטח עבודה']]),
  { id: 'marquee', icon: (ed) => ({ rect: 'marquee', ellipse: 'ellipse', row: 'rowsel', col: 'colsel' }[ed.opts.marquee.shape]), name: 'Marquee Tool', flyout: [
    { label: 'Rectangular Marquee · מלבן', icon: 'marquee', set: (ed) => { modeSwitch(ed, 'marquee'); ed.opts.marquee.shape = 'rect'; }, on: (ed) => ed.opts.marquee.shape === 'rect' },
    { label: 'Elliptical Marquee · אליפסה', icon: 'ellipse', set: (ed) => { modeSwitch(ed, 'marquee'); ed.opts.marquee.shape = 'ellipse'; }, on: (ed) => ed.opts.marquee.shape === 'ellipse' },
    { label: 'Single Row Marquee · שורה בודדת', icon: 'rowsel', set: (ed) => { modeSwitch(ed, 'marquee'); ed.opts.marquee.shape = 'row'; }, on: (ed) => ed.opts.marquee.shape === 'row' },
    { label: 'Single Column Marquee · עמודה בודדת', icon: 'colsel', set: (ed) => { modeSwitch(ed, 'marquee'); ed.opts.marquee.shape = 'col'; }, on: (ed) => ed.opts.marquee.shape === 'col' },
  ] },
  { id: 'lasso', icon: (ed) => ({ free: 'lasso', poly: 'poly', magnetic: 'magnetic' }[ed.opts.lasso.mode]), name: 'Lasso Tool', flyout: [
    { label: 'Lasso · לאסו', icon: 'lasso', set: (ed) => { modeSwitch(ed, 'lasso'); ed.opts.lasso.mode = 'free'; }, on: (ed) => ed.opts.lasso.mode === 'free' },
    { label: 'Polygonal Lasso · לאסו מצולע', icon: 'poly', set: (ed) => { modeSwitch(ed, 'lasso'); ed.opts.lasso.mode = 'poly'; }, on: (ed) => ed.opts.lasso.mode === 'poly' },
    { label: 'Magnetic Lasso · לאסו מגנטי', icon: 'magnetic', set: (ed) => { modeSwitch(ed, 'lasso'); ed.opts.lasso.mode = 'magnetic'; }, on: (ed) => ed.opts.lasso.mode === 'magnetic' },
  ] },
  { id: 'wand', icon: (ed) => (ed.opts.wand.mode === 'quick' ? 'quicksel' : 'wand'), name: 'Quick Selection / Magic Wand', flyout: [
    { label: 'Quick Selection · בחירה מהירה', icon: 'quicksel', set: (ed) => { modeSwitch(ed, 'wand'); ed.opts.wand.mode = 'quick'; }, on: (ed) => ed.opts.wand.mode === 'quick' },
    { label: 'Magic Wand · מטה קסם', icon: 'wand', set: (ed) => { modeSwitch(ed, 'wand'); ed.opts.wand.mode = 'wand'; }, on: (ed) => ed.opts.wand.mode === 'wand' },
  ] },
  { id: 'crop', icon: () => 'crop', name: 'Crop Tool' },
  group('eyedropper', 'Eyedropper / Color Sampler / Ruler', [['eyedropper', 'Eyedropper · דוגם צבע'], ['colorSampler', 'Color Sampler · דוגם צבע קבוע'], ['ruler', 'Ruler · סרגל']]),
  group('spotHeal', 'Healing Tools', [['spotHeal', 'Spot Healing Brush · ריפוי נקודתי'], ['heal', 'Healing Brush · מברשת ריפוי'], ['patch', 'Patch · טלאי'], ['redEye', 'Red Eye · עיניים אדומות']]),
  group('brush', 'Brush / Pencil / Color Replacement', [['brush', 'Brush · מברשת'], ['pencil', 'Pencil · עיפרון'], ['colorReplace', 'Color Replacement · החלפת צבע']]),
  group('clone', 'Clone Stamp / Pattern Stamp', [['clone', 'Clone Stamp · חותמת שכפול'], ['patternStamp', 'Pattern Stamp · חותמת דוגמה']]),
  { id: 'historyBrush', icon: () => 'historyBrush', name: 'History Brush · מברשת היסטוריה' },
  group('eraser', 'Eraser Tools', [['eraser', 'Eraser · מחק'], ['bgEraser', 'Background Eraser · מחק רקע'], ['magicEraser', 'Magic Eraser · מחק קסם']]),
  { id: 'gradient', icon: (ed) => (ed.opts.gradient.mode === 'bucket' ? 'bucket' : 'gradient'), name: 'Gradient / Paint Bucket', flyout: [
    { label: 'Gradient Tool', icon: 'gradient', set: (ed) => { ed.opts.gradient.mode = 'gradient'; }, on: (ed) => ed.opts.gradient.mode === 'gradient' },
    { label: 'Paint Bucket Tool', icon: 'bucket', set: (ed) => { ed.opts.gradient.mode = 'bucket'; }, on: (ed) => ed.opts.gradient.mode === 'bucket' },
  ] },
  group('blur', 'Blur / Sharpen / Smudge', [['blur', 'Blur · טשטוש'], ['sharpen', 'Sharpen · חידוד'], ['smudge', 'Smudge · מריחה']]),
  group('dodge', 'Dodge / Burn / Sponge', [['dodge', 'Dodge · הבהרה'], ['burn', 'Burn · הכהיה'], ['sponge', 'Sponge · ספוג']]),
  group('pen', 'Pen Tools', [['pen', 'Pen · עט'], ['freePen', 'Freeform Pen · עט חופשי'], ['curvPen', 'Curvature Pen · עט עקומות'], ['addAnchor', 'Add Anchor Point · הוספת נקודה'], ['delAnchor', 'Delete Anchor Point · מחיקת נקודה'], ['convertPt', 'Convert Point · המרת נקודה']]),
  group('text', 'Type Tools', [['text', 'Horizontal Type · טקסט'], ['vtext', 'Vertical Type · טקסט אנכי'], ['htmask', 'Horizontal Type Mask · מסכת טקסט'], ['vtmask', 'Vertical Type Mask · מסכת טקסט אנכית']]),
  group('pathSel', 'Path / Direct Selection', [['pathSel', 'Path Selection · בחירת נתיב'], ['directSel', 'Direct Selection · בחירה ישירה']]),
  { id: 'shape', icon: (ed) => (ed.opts.shape.kind === 'path' ? 'customShape' : 'shape'), name: 'Shape Tool', flyout: (['rect', 'ellipse', 'triangle', 'polygon', 'star', 'line', 'path'] as const).map((k) => ({
    label: { rect: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle', polygon: 'Polygon', star: 'Star', line: 'Line', path: 'Custom Shape · צורה מותאמת' }[k], icon: k === 'path' ? 'customShape' : 'shape', set: (ed: Editor) => { ed.opts.shape.kind = k; }, on: (ed: Editor) => ed.opts.shape.kind === k,
  })) },
  group('hand', 'Hand / Rotate View', [['hand', 'Hand · יד'], ['rotateView', 'Rotate View · סיבוב תצוגה']], (m) => `tool.${m}`),
  { id: 'zoom', icon: () => 'zoom', name: 'Zoom Tool' },
];

/** מעבר בין מצבים של אותו כלי (Lasso → Magnetic וכו') מנקה עבודה חצי-גמורה של המצב הקודם */
function modeSwitch(ed: Editor, id: ToolId) { if (ed.tool === id) ed.activeTool().deactivate?.(ed); }

function Toolbar({ ed }: { ed: Editor }) {
  useEditor(ed);
  const [fly, setFly] = useState<ToolId | null>(null);
  const cur = ed.springTool ?? ed.tool;
  return (
    <div className="pe-toolbar" onMouseLeave={() => setFly(null)}>
      {TOOL_BAR.map((t) => {
        const on = t.members ? t.members.includes(cur) : cur === t.id;
        const shown = t.members ? groupCurrent(t.id) : t.id;
        const key = ed.shortcuts.label(`tool.${shown}`) || ed.shortcuts.label(`tool.${t.id}`);
        return (
        <div key={t.id} className="pe-tool-wrap">
          <button type="button" className={`pe-tool ${on ? 'on' : ''} ${t.flyout ? 'has-fly' : ''}`} title={`${TOOL_NAMES[shown] ?? t.name}${key ? ` (${key})` : ''}${t.flyout ? ' · קליק ימני לכלים נוספים' : ''}`}
            onClick={() => ed.setTool(shown)} onContextMenu={(e) => { e.preventDefault(); if (t.flyout) setFly(t.id); }}
            onPointerDown={(e) => { if (!t.flyout) return; const timer = window.setTimeout(() => setFly(t.id), 450); const up = () => { window.clearTimeout(timer); window.removeEventListener('pointerup', up); }; window.addEventListener('pointerup', up); void e; }}>
            <Ico n={t.icon(ed)} />
          </button>
          {fly === t.id && t.flyout && (
            <div className="pe-flyout">
              {t.flyout.map((f) => (
                <button key={f.label} type="button" className={f.on(ed) ? 'on' : ''} onClick={() => { f.set(ed); if (!t.members) ed.setTool(t.id); setFly(null); ed.emit(); }}>
                  <Ico n={f.icon} size={16} /> <span>{f.label}</span> <small>{ed.shortcuts.label(f.key ?? `tool.${t.id}`)}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        );
      })}
      <div className="pe-fgbg">
        <button type="button" className="pe-fg" style={{ background: ed.fg }} title="צבע קדמי — לחיצה לבחירה" onClick={() => ed.openPanel('Color')} />
        <button type="button" className="pe-bg" style={{ background: ed.bg }} title="צבע רקע" onClick={() => ed.openPanel('Color')} />
        <button type="button" className="pe-swapc" title="החלפה (X)" onClick={() => ed.run('colors.swap')}><Ico n="swap" size={11} /></button>
        <button type="button" className="pe-defc" title="ברירת מחדל (D)" onClick={() => ed.run('colors.default')} />
      </div>
      <button type="button" className={`pe-qmask-btn ${ed.st?.qmask ? 'on' : ''}`} disabled={!ed.doc} aria-pressed={!!ed.st?.qmask}
        title={`Quick Mask · מסכה מהירה (${ed.shortcuts.label('select.quickMask')})${ed.st?.qmask ? ' — פעיל: מברשת שחורה מסירה מהבחירה, לבנה מוסיפה' : ''}`}
        onClick={() => ed.run('select.quickMask')}>
        <Ico n="qmask" size={16} />
      </button>
    </div>
  );
}

/* ======================= סרגל אפשרויות ======================= */

function OptionsBar({ ed }: { ed: Editor }) {
  useEditor(ed);
  const t = ed.springTool ?? ed.tool;
  const o = ed.opts;
  const up = () => { ed.emit(); ed.redraw(false); };
  const selModes = <span className="pe-opt-hint">Shift = הוספה · Alt = חיסור · Shift+Alt = חיתוך</span>;
  const refineBtn = <button type="button" className="pe-btn" disabled={!ed.doc?.selection} title="Ctrl+Alt+R" onClick={() => ed.run('select.selectAndMask')}>Select and Mask…</button>;
  let body: ReactNode = null;
  const extra = paintOptions(ed, t) ?? warpOptions(ed, t) ?? penOptions(ed, t);
  if (extra) body = extra;
  else if (t === 'artboard') body = <ArtboardOptions ed={ed} />;
  else if (t === 'move') {
    body = ed.live.freeTransform ? (
      <>
        <b className="pe-opt-title">Free Transform</b>
        <TransformPanel ed={ed} />
        <FreeTransformExtras ed={ed} />
        <button type="button" className="pe-btn" onClick={() => ed.cancelFreeTransform()} title="Esc">ביטול</button>
        <button type="button" className="pe-btn primary" onClick={() => ed.commitFreeTransform()} title="Enter">✓ אישור</button>
      </>
    ) : (
      <>
        <Check label="Auto-Select" checked={o.move.autoSelect} onChange={(v) => { o.move.autoSelect = v; up(); }} title="בחירה אוטומטית של השכבה בלחיצה (Ctrl הופך זמנית)" />
        <select value={o.move.autoGroup ? 'group' : 'layer'} onChange={(e) => { o.move.autoGroup = e.target.value === 'group'; up(); }}><option value="layer">Layer</option><option value="group">Group</option></select>
        <Check label="Show Transform Controls" checked={o.move.showTransform} onChange={(v) => { o.move.showTransform = v; up(); }} />
        <span className="pe-opt-sep" />
        {(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map((k) => (
          <button key={k} type="button" className="pe-icon-btn" disabled={!ed.topSelected().length} title={`Align ${k}`} onClick={() => ed.align(k)}>
            <Ico n={{ left: 'alignL', hcenter: 'alignHC', right: 'alignR', top: 'alignT', vcenter: 'alignVC', bottom: 'alignB' }[k]} size={16} />
          </button>
        ))}
        <span className="pe-opt-hint">Alt+גרירה = שכפול · Shift = קו ישר · חיצים = 1px</span>
      </>
    );
  } else if (t === 'marquee') {
    body = (
      <>
        <Seg value={o.marquee.shape} onChange={(v) => { modeSwitch(ed, 'marquee'); o.marquee.shape = v; up(); }} options={[['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['row', 'Single Row'], ['col', 'Single Column']]} />
        {o.marquee.shape === 'rect' || o.marquee.shape === 'ellipse' ? (
          <>
            <Num label="Feather" value={o.marquee.feather} min={0} max={250} unit="px" onChange={(v) => { o.marquee.feather = v; up(); }} />
            <span className="pe-lbl">Style</span>
            <select value={o.marquee.ratio} onChange={(e) => { o.marquee.ratio = e.target.value; up(); }}>
              <option value="free">Normal</option><option value="1:1">1:1</option><option value="4:5">4:5</option><option value="9:16">9:16</option><option value="16:9">16:9</option>
            </select>
          </>
        ) : <span className="pe-opt-hint">{o.marquee.shape === 'row' ? 'לחיצה בוחרת שורה ברוחב פיקסל אחד לכל רוחב המסמך · גרירה מזיזה אותה' : 'לחיצה בוחרת עמודה ברוחב פיקסל אחד לכל גובה המסמך · גרירה מזיזה אותה'}</span>}
        {refineBtn}
        {selModes}
      </>
    );
  } else if (t === 'lasso') {
    body = (
      <>
        <Seg value={o.lasso.mode} onChange={(v) => { modeSwitch(ed, 'lasso'); o.lasso.mode = v; up(); }} options={[['free', 'Lasso'], ['poly', 'Polygonal'], ['magnetic', 'Magnetic']]} />
        <Num label="Feather" value={o.lasso.feather} min={0} max={250} unit="px" onChange={(v) => { o.lasso.feather = v; up(); }} />
        {o.lasso.mode === 'magnetic' && (
          <>
            <Num label="Width" value={o.lasso.width} min={1} max={256} unit="px" title="רוחב · כמה רחוק מהסמן מחפשים קצה" onChange={(v) => { o.lasso.width = Math.round(v); up(); }} />
            <Num label="Contrast" value={o.lasso.contrast} min={1} max={100} unit="%" title="ניגודיות · כמה חזק צריך להיות קצה כדי להיצמד אליו" onChange={(v) => { o.lasso.contrast = Math.round(v); up(); }} />
            <Num label="Frequency" value={o.lasso.frequency} min={0} max={100} title="תדירות · כל כמה זמן נקבעת נקודת עיגון אוטומטית" onChange={(v) => { o.lasso.frequency = Math.round(v); up(); }} />
          </>
        )}
        {refineBtn}
        {selModes}
        {o.lasso.mode === 'poly' && <span className="pe-opt-hint">דאבל-קליק או Enter לסגירה · Backspace מוחק נקודה</span>}
        {o.lasso.mode === 'magnetic' && <span className="pe-opt-hint">לחיצה מתחילה · הזזת העכבר נצמדת לקצוות · לחיצה = נקודה · Backspace מוחק נקודה · דאבל-קליק או Enter סוגר · Esc מבטל</span>}
      </>
    );
  } else if (t === 'wand') {
    const q = o.quick;
    body = o.wand.mode === 'quick' ? (
      <>
        <b className="pe-opt-title">Quick Selection · בחירה מהירה</b>
        <Seg value={q.mode} onChange={(v) => { q.mode = v; up(); }} options={[['new', 'New', 'בחירה חדשה'], ['add', 'Add', 'הוספה לבחירה'], ['sub', 'Subtract', 'חיסור מהבחירה']]} />
        <Num label="Size" value={q.size} min={1} max={2500} unit="px" onChange={(v) => { q.size = Math.round(v); up(); }} />
        <Check label="Sample All Layers" checked={q.allLayers} onChange={(v) => { q.allLayers = v; up(); }} />
        <Check label="Auto-Enhance" checked={q.autoEnhance} onChange={(v) => { q.autoEnhance = v; up(); }} title="החלקת קצוות אוטומטית" />
        {refineBtn}
        <span className="pe-opt-hint">צבעו על האזור · Alt = חיסור · Shift = הוספה · [ ] = גודל · אחרי המשיכה הראשונה עובר להוספה</span>
      </>
    ) : (<><Num label="Tolerance" value={o.wand.tolerance} min={0} max={255} onChange={(v) => { o.wand.tolerance = v; up(); }} /><Check label="Contiguous" checked={o.wand.contiguous} onChange={(v) => { o.wand.contiguous = v; up(); }} /><Check label="Sample All Layers" checked={o.wand.allLayers} onChange={(v) => { o.wand.allLayers = v; up(); }} />{refineBtn}{selModes}</>);
  } else if (t === 'crop') {
    body = (
      <>
        <span className="pe-lbl">Ratio</span>
        <select value={o.crop.ratio} onChange={(e) => { o.crop.ratio = e.target.value; up(); }}>
          <option value="free">Ratio חופשי</option><option value="original">Original</option><option value="1:1">1:1</option><option value="4:5">4:5 (Instagram)</option><option value="9:16">9:16 (Story)</option><option value="16:9">16:9</option><option value="3:2">3:2</option><option value="2:3">2:3</option>
        </select>
        {ed.live.crop && <span className="pe-opt-hint" dir="ltr">{Math.round(ed.live.crop.w)} × {Math.round(ed.live.crop.h)}</span>}
        <button type="button" className="pe-btn" onClick={() => TOOLS.crop.key!(ed, 'Escape', new KeyboardEvent('keydown'))}>איפוס</button>
        <button type="button" className="pe-btn primary" onClick={() => TOOLS.crop.key!(ed, 'Enter', new KeyboardEvent('keydown'))}>✓ חיתוך (Enter)</button>
        <span className="pe-opt-hint">הפיקסלים מחוץ לחיתוך לא נמחקים מהשכבות</span>
      </>
    );
  } else if (t === 'eyedropper') {
    body = (<><span className="pe-lbl">Sample Size</span><select value={o.eyedropper.sample} onChange={(e) => { o.eyedropper.sample = Number(e.target.value); up(); }}><option value={1}>Point Sample</option><option value={3}>3 by 3 Average</option><option value={5}>5 by 5 Average</option><option value={11}>11 by 11 Average</option></select><span className="pe-opt-hint">Alt = צבע רקע</span></>);
  } else if (t === 'brush' || t === 'eraser' || t === 'clone') {
    const b = o[t];
    body = (
      <>
        <Num label="Size" value={b.size} min={1} max={2500} unit="px" onChange={(v) => { b.size = v; up(); }} />
        <Num label="Hardness" value={Math.round(b.hardness * 100)} min={0} max={100} unit="%" onChange={(v) => { b.hardness = v / 100; up(); }} />
        <Num label="Opacity" value={Math.round(b.opacity * 100)} min={1} max={100} unit="%" onChange={(v) => { b.opacity = v / 100; up(); }} />
        <Num label="Flow" value={Math.round(b.flow * 100)} min={1} max={100} unit="%" onChange={(v) => { b.flow = v / 100; up(); }} />
        {t === 'clone' && <Check label="Aligned" checked={o.clone.aligned} onChange={(v) => { o.clone.aligned = v; up(); }} />}
        <span className="pe-opt-hint">{t === 'clone' ? 'Alt+לחיצה = נקודת מקור' : t === 'brush' ? 'Alt = דוגם צבע' : ''} · [ ] = גודל · Shift+[ ] = קשיחות · Shift+לחיצה = קו ישר{ed.st?.qmask && t !== 'clone' ? ' · Quick Mask: שחור מסיר מהבחירה, לבן מוסיף, אפור חלקי' : ed.st?.maskEdit ? ' · מצייר על המסכה' : ''}</span>
      </>
    );
  } else if (t === 'gradient') {
    const g = o.gradient;
    body = (
      <>
        <Seg value={g.mode} onChange={(v) => { g.mode = v; up(); }} options={[['gradient', 'Gradient'], ['bucket', 'Paint Bucket']]} />
        {g.mode === 'gradient' ? (
          <>
            <span className="pe-gradbar" style={{ background: `linear-gradient(90deg, ${g.reverse ? ed.bg : ed.fg}, ${g.reverse ? ed.fg : ed.bg})` }} title="מהצבע הקדמי לצבע הרקע" />
            <Seg value={g.type} onChange={(v) => { g.type = v; up(); }} options={[['linear', 'Linear'], ['radial', 'Radial']]} />
            <Check label="Reverse" checked={g.reverse} onChange={(v) => { g.reverse = v; up(); }} />
          </>
        ) : (
          <><Num label="Tolerance" value={g.tolerance} min={0} max={255} onChange={(v) => { g.tolerance = v; up(); }} /><Check label="Contiguous" checked={g.contiguous} onChange={(v) => { g.contiguous = v; up(); }} /></>
        )}
        <Num label="Opacity" value={Math.round(g.opacity * 100)} min={1} max={100} unit="%" onChange={(v) => { g.opacity = v / 100; up(); }} />
      </>
    );
  } else if (t === 'text' || t === 'vtext' || t === 'htmask' || t === 'vtmask') {
    const modeHint = t === 'vtext' ? 'טקסט אנכי: תווים מלמעלה למטה, Enter = עמודה חדשה משמאל' : t === 'htmask' || t === 'vtmask' ? 'מסכת טקסט: בסיום ההקלדה (Ctrl+Enter) הטקסט הופך לבחירה' : null;
    const s = (ed.live.textEdit ? (ed.layer(ed.live.textEdit.layerId) as { style?: typeof o.text } | null)?.style : null) ?? (ed.active?.type === 'text' ? ed.active.style : o.text);
    body = (
      <>
        <FontSelect ed={ed} value={s.family} onChange={(family) => applyTextStyle(ed, { family })} />
        <Num label="Size" value={s.size} min={1} max={2000} digits={1} unit="px" onChange={(v) => applyTextStyle(ed, { size: v })} />
        <Seg value={s.align} onChange={(align) => applyTextStyle(ed, { align })} options={[['right', <Ico key="r" n="textR" size={16} />], ['center', <Ico key="c" n="textC" size={16} />], ['left', <Ico key="l" n="textLft" size={16} />], ['justify', <Ico key="j" n="textJ" size={16} />]]} />
        <Seg value={s.dir} onChange={(dir) => applyTextStyle(ed, { dir, align: dir === 'rtl' ? 'right' : 'left' })} options={[['rtl', 'RTL'], ['ltr', 'LTR']]} />
        <ColorField value={s.color} onChange={(c) => applyTextStyle(ed, { color: c })} title="צבע טקסט" />
        <button type="button" className="pe-btn" onClick={() => ed.openPanel('Character')}>Character…</button>
        {ed.live.textEdit ? <button type="button" className="pe-btn primary" onClick={() => ed.commitTextEdit()}>✓ אישור (Ctrl+Enter)</button> : <span className="pe-opt-hint">{modeHint ?? 'לחיצה = טקסט בשורה · גרירה = תיבת פסקה · לחיצה על טקסט קיים = עריכה'}</span>}
      </>
    );
  } else if (t === 'shape') {
    const s = o.shape;
    body = (
      <>
        <select value={s.kind} onChange={(e) => { s.kind = e.target.value as typeof s.kind; up(); }}>
          <option value="rect">Rectangle</option><option value="ellipse">Ellipse</option><option value="triangle">Triangle</option><option value="polygon">Polygon</option><option value="star">Star</option><option value="line">Line</option><option value="path">Custom Shape</option>
        </select>
        <span className="pe-lbl">Fill</span>
        <select value={s.fill.type} onChange={(e) => { s.fill = { ...s.fill, type: e.target.value as typeof s.fill.type }; up(); }}><option value="solid">Solid</option><option value="linear">Linear</option><option value="radial">Radial</option><option value="none">None</option></select>
        <ColorField value={s.fill.color} onChange={(c) => { s.fill = { ...s.fill, color: c }; up(); }} />
        {s.fill.type !== 'solid' && s.fill.type !== 'none' && <ColorField value={s.fill.color2} onChange={(c) => { s.fill = { ...s.fill, color2: c }; up(); }} />}
        <Check label="Stroke" checked={s.strokeOn} onChange={(v) => { s.strokeOn = v; up(); }} />
        <ColorField value={s.strokeColor} onChange={(c) => { s.strokeColor = c; up(); }} />
        <Num value={s.strokeWidth} min={1} max={500} unit="px" width={36} onChange={(v) => { s.strokeWidth = v; up(); }} title="עובי קו" />
        {s.kind === 'rect' && <Num label="Radius" value={s.radius} min={0} max={5000} unit="px" onChange={(v) => { s.radius = v; up(); }} />}
        {(s.kind === 'polygon' || s.kind === 'star') && <Num label="Sides" value={s.sides} min={3} max={64} onChange={(v) => { s.sides = Math.round(v); up(); }} />}
        {s.kind === 'path' && <><span className="pe-lbl">Shape</span><CustomShapePicker ed={ed} /></>}
        <span className="pe-opt-hint">Shift = ריבוע/עיגול · Alt = מהמרכז</span>
      </>
    );
  } else if (t === 'hand') {
    body = (<><button type="button" className="pe-btn" onClick={() => ed.zoomTo(1)}>100%</button><button type="button" className="pe-btn" onClick={() => ed.fit()}>Fit Screen</button><span className="pe-opt-hint">Space + גרירה מכל כלי</span></>);
  } else if (t === 'selxf') {
    const x = ed.live.selxf;
    body = (
      <>
        <b className="pe-opt-title">Transform Selection · שינוי צורת הבחירה</b>
        {x && <span className="pe-opt-hint" dir="ltr">W {Math.round(Math.abs(x.sx) * 100)}% · H {Math.round(Math.abs(x.sy) * 100)}% · {Math.round(x.rot)}°</span>}
        <span className="pe-opt-hint">גרירה בפנים = הזזה · ידיות = גודל (Shift חופשי, Alt מהמרכז) · מחוץ לפינה = סיבוב (Shift = 15°)</span>
        <button type="button" className="pe-btn" onClick={() => endSelTransform(ed, false)} title="Esc">ביטול</button>
        <button type="button" className="pe-btn primary" onClick={() => endSelTransform(ed, true)} title="Enter">✓ אישור</button>
      </>
    );
  } else if (t === 'zoom') {
    body = (<><button type="button" className="pe-btn" onClick={() => ed.zoomStep(1)}>＋</button><button type="button" className="pe-btn" onClick={() => ed.zoomStep(-1)}>－</button><button type="button" className="pe-btn" onClick={() => ed.zoomTo(1)}>100%</button><button type="button" className="pe-btn" onClick={() => ed.fit()}>Fit Screen</button><span className="pe-opt-hint">Alt = הקטנה · גרירה = זום רציף · Alt+גלגלת בכל כלי</span></>);
  }
  return <div className="pe-options">{body}</div>;
}

/* ======================= אזור העבודה ======================= */

function Viewport({ ed }: { ed: Editor }) {
  useEditor(ed);
  const canvas = useRef<HTMLCanvasElement>(null);
  const rx = useRef<HTMLCanvasElement>(null);
  const ry = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    ed.attach(canvas.current!, rx.current!, ry.current!, host.current!);
    const ro = new ResizeObserver(() => ed.redraw(false));
    ro.observe(canvas.current!);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!ed.st) return;
      const rc = canvas.current!.getBoundingClientRect();
      const at = { x: e.clientX - rc.left, y: e.clientY - rc.top };
      if (e.altKey || e.ctrlKey || e.metaKey) ed.zoomTo(ed.st.zoom * Math.exp(-e.deltaY * (e.ctrlKey && !e.altKey ? 0.01 : 0.0025)), at);
      else ed.pan(e.shiftKey ? -e.deltaY : -e.deltaX, e.shiftKey ? 0 : -e.deltaY);
    };
    const el = canvas.current!;
    el.addEventListener('wheel', wheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener('wheel', wheel); ed.detach(); };
  }, [ed]);

  const evt = (e: React.PointerEvent | React.MouseEvent): PtrEvt => {
    const rc = canvas.current!.getBoundingClientRect();
    const screen = { x: e.clientX - rc.left, y: e.clientY - rc.top };
    const mac = /Mac/.test(navigator.platform);
    return { screen, doc: ed.st ? ed.toDoc(screen.x, screen.y) : screen, shift: e.shiftKey, alt: e.altKey, ctrl: mac ? e.metaKey : e.ctrlKey, button: e.button, clicks: e.detail };
  };

  const setCursor = (e: PtrEvt | null) => { if (canvas.current) canvas.current.style.cursor = ed.activeTool().cursor(ed, e); };

  /** גרירת קו עזר מהסרגל */
  const rulerDown = (axis: 'v' | 'h') => (e: React.PointerEvent) => {
    const d = ed.doc;
    if (!d) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    d.guides[axis].push(-1000);
    const i = d.guides[axis].length - 1;
    const move = (ev: PointerEvent) => {
      const rc = canvas.current!.getBoundingClientRect();
      const p = ed.toDoc(ev.clientX - rc.left, ev.clientY - rc.top);
      d.guides[axis][i] = Math.round(axis === 'v' ? p.x : p.y);
      ed.view.guides = true;
      ed.redraw(false);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const rc = canvas.current!.getBoundingClientRect();
      const inside = ev.clientX > rc.left && ev.clientY > rc.top;
      if (!inside) d.guides[axis].splice(i, 1);
      ed.commit('קו עזר חדש');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const ft = !!ed.live.freeTransform;
  return (
    <div className={`pe-viewport ${ed.view.rulers ? 'rulers' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        const files = [...e.dataTransfer.files];
        if (!files.length) return;
        const rc = canvas.current!.getBoundingClientRect();
        const at = ed.st ? ed.toDoc(e.clientX - rc.left, e.clientY - rc.top) : undefined;
        void ed.importFiles(files, false, at);
      }}>
      <div className="pe-ruler-corner" />
      <canvas ref={rx} className="pe-ruler-x" onPointerDown={rulerDown('h')} title="גרירה למטה = קו עזר אופקי" />
      <canvas ref={ry} className="pe-ruler-y" onPointerDown={rulerDown('v')} title="גרירה ימינה = קו עזר אנכי" />
      <div className="pe-canvas-wrap">
        <canvas ref={canvas} className="pe-canvas" tabIndex={0}
          onPointerDown={(e) => {
            if (e.button === 2) return;
            canvas.current!.focus();
            setCtx(null);
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            pressed.current = true;
            pointerDown(ed, evt(e));
          }}
          onPointerMove={(e) => { const ev = evt(e); pointerMove(ed, ev, pressed.current); if (!pressed.current) setCursor(ev); ed.redraw(false); }}
          onPointerUp={(e) => { if (!pressed.current) return; pressed.current = false; pointerUp(ed, evt(e)); setCursor(evt(e)); const ta = ed.textArea; if (ta) setTimeout(() => ta.focus(), 0); }}
          onPointerLeave={() => { ed.cursorDoc = null; ed.redraw(false); }}
          onContextMenu={(e) => { e.preventDefault(); if (ed.doc) setCtx({ x: e.clientX, y: e.clientY }); }}
        />
        <div ref={host} className="pe-overlay-host" />
        {!ed.doc && <div className="pe-canvas-empty">גרור לכאן תמונה או בחר מסמך חדש</div>}
        {dropping && <div className="pe-drop-hint">שחרר כדי להוסיף כשכבה</div>}
      </div>
      {ctx && (
        <div className="pe-context" style={{ left: ctx.x, top: ctx.y }} onPointerLeave={() => setCtx(null)}>
          <MenuList ed={ed} close={() => setCtx(null)} items={ft ? [
            { label: 'היפוך אופקי', en: 'Flip Horizontal', act: () => ed.flip(true) },
            { label: 'היפוך אנכי', en: 'Flip Vertical', act: () => ed.flip(false) },
            { label: 'סיבוב 90° עם השעון', act: () => ed.rotateLayers(90) },
            { label: 'סיבוב 90° נגד השעון', act: () => ed.rotateLayers(-90) },
            { label: 'סיבוב 180°', act: () => ed.rotateLayers(180) },
            { sep: true },
            { label: 'הטיה', en: 'Skew', cmd: 'edit.skew', checked: ed.live.freeTransform?.mode === 'skew' },
            { label: 'עיוות', en: 'Distort', cmd: 'edit.distort', checked: ed.live.freeTransform?.mode === 'distort' },
            { label: 'פרספקטיבה', en: 'Perspective', cmd: 'edit.perspective', checked: ed.live.freeTransform?.mode === 'perspective' },
            { label: 'עיקום', en: 'Warp', cmd: 'edit.warp' },
            { sep: true },
            { label: 'אישור', en: 'Enter', act: () => ed.commitFreeTransform() },
            { label: 'ביטול', en: 'Esc', act: () => ed.cancelFreeTransform() },
          ] : [
            { label: 'Free Transform', cmd: 'edit.freeTransform' },
            { label: 'שכפול שכבה', en: 'Layer via Copy', cmd: 'layer.duplicate' },
            { label: 'מחיקה', en: 'Delete', cmd: 'edit.clear' },
            { sep: true },
            { label: 'ביטול בחירה', en: 'Deselect', cmd: 'select.deselect', disabled: !ed.doc?.selection },
            { label: 'היפוך בחירה', en: 'Select Inverse', cmd: 'select.inverse', disabled: !ed.doc?.selection },
            { label: 'ריכוך…', en: 'Feather', cmd: 'select.feather', disabled: !ed.doc?.selection },
            { label: 'מילוי…', en: 'Fill', cmd: 'edit.fill' },
            { sep: true },
            { label: 'הוספת מסכה', en: 'Add Mask', act: () => ed.addMask() },
            { label: 'Rasterize', cmd: 'layer.rasterize' },
          ]} />
        </div>
      )}
    </div>
  );
}

function Tabs({ ed }: { ed: Editor }) {
  useEditor(ed);
  if (!ed.docs.length) return null;
  return (
    <div className="pe-tabs" dir="ltr">
      {ed.docs.map((st, i) => (
        <div key={st.doc.id} className={`pe-tab ${i === ed.cur ? 'on' : ''}`} onClick={() => ed.switchTo(i)} onAuxClick={(e) => { if (e.button === 1) ed.close(i); }}>
          <span dir="auto">{st.doc.name}{ed.isDirty(st) ? '*' : ''}</span>
          <small>@ {Math.round(st.zoom * 100)}%</small>
          <button type="button" className="pe-tab-x" onClick={(e) => { e.stopPropagation(); ed.close(i); }} title="סגירה (Ctrl+W)">×</button>
        </div>
      ))}
      <button type="button" className="pe-tab-new" title="מסמך חדש" onClick={() => ed.run('file.new')}>+</button>
    </div>
  );
}

function StatusBar({ ed }: { ed: Editor }) {
  useEditor(ed);
  const st = ed.st;
  const c = ed.cursorDoc;
  return (
    <div className="pe-status" dir="ltr">
      {st ? (
        <>
          <Num value={Math.round(st.zoom * 100)} min={2} max={6400} unit="%" width={42} onChange={(v) => ed.zoomTo(v / 100)} />
          <span>{st.doc.width} × {st.doc.height} px · {st.doc.dpi} ppi</span>
          {c && <span>X {Math.round(c.x)} · Y {Math.round(c.y)}</span>}
          <span>{st.selected.length} נבחרו</span>
          {ed.status && <span className="pe-status-live">{ed.status}</span>}
          {st.qmask && <span className="pe-status-qmask" dir="rtl">Quick Mask · מסכה מהירה (Q)</span>}
          {ed.live.maskView && <span className="pe-status-qmask" dir="rtl">{ed.live.maskView.mode === 'alone' ? 'מסכה לבד' : 'Mask Overlay'}</span>}
          {st.rot ? <span className="pe-status-qmask" dir="rtl">תצוגה מסובבת {st.rot.toFixed(1)}° · R ואז Esc לאיפוס</span> : null}
          <span className="pe-status-tool">{(ed.springTool ?? ed.tool) === 'selxf' ? 'Transform Selection' : TOOL_NAMES[ed.springTool ?? ed.tool] ?? TOOL_BAR.find((t) => t.id === (ed.springTool ?? ed.tool))?.name}</span>
        </>
      ) : <span>PHOTOEDIT</span>}
    </div>
  );
}

/* ======================= פאנלים ======================= */

const PANEL_GROUPS: Array<{ key: string; names: string[]; cls: string }> = [
  { key: 'top', names: ['Color', 'Swatches', 'Info'], cls: 'pe-pg-top' },
  { key: 'mid', names: ['Properties', 'Adjustments', 'Character', 'Paragraph', 'Align', 'Transform'], cls: 'pe-pg-mid' },
  { key: 'bottom', names: ['Layers', 'History', 'Paths'], cls: 'pe-pg-bottom' },
];

function PanelBody({ ed, name }: { ed: Editor; name: string }) {
  switch (name) {
    case 'Color': return <ColorPanel ed={ed} />;
    case 'Swatches': return <SwatchesPanel ed={ed} />;
    case 'Info': return <InfoPanel ed={ed} />;
    case 'Properties': return <PropertiesPanel ed={ed} />;
    case 'Adjustments': return <AdjustmentsPanel ed={ed} />;
    case 'Character': return <CharacterPanel ed={ed} />;
    case 'Paragraph': return <ParagraphPanel ed={ed} />;
    case 'Align': return <AlignPanel ed={ed} />;
    case 'Transform': return <TransformPanel ed={ed} />;
    case 'Layers': return <LayersPanel ed={ed} />;
    case 'History': return <HistoryPanel ed={ed} />;
    case 'Paths': return <PathsPanel ed={ed} />;
    default: return null;
  }
}

function Panels({ ed }: { ed: Editor }) {
  useEditor(ed);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  if (!ed.view.panels) return null;
  return (
    <aside className="pe-panels">
      {PANEL_GROUPS.map((g) => (
        <section key={g.key} className={`pe-pg ${g.cls} ${collapsed[g.key] ? 'collapsed' : ''}`}>
          <div className="pe-pg-tabs">
            {g.names.map((n) => (
              <button key={n} type="button" className={ed.panelTabs[g.key] === n ? 'on' : ''} onClick={() => { ed.panelTabs[g.key] = n; setCollapsed({ ...collapsed, [g.key]: false }); ed.emit(); }}>{n}</button>
            ))}
            <button type="button" className="pe-pg-collapse" title="כיווץ" onClick={() => setCollapsed({ ...collapsed, [g.key]: !collapsed[g.key] })}>{collapsed[g.key] ? '▾' : '▴'}</button>
          </div>
          {!collapsed[g.key] && <div className="pe-pg-body" dir="rtl"><PanelBody ed={ed} name={ed.panelTabs[g.key]} /></div>}
        </section>
      ))}
    </aside>
  );
}

/* ======================= מסך פתיחה ======================= */

function Home({ ed, projectId, projectName }: { ed: Editor; projectId: string | null; projectName: string | null }) {
  const { docs, err } = useCloudDocs(ed, projectId, false);
  const all = useCloudDocs(ed, null, true);
  const [rec, setRec] = useState<RecoveryEntry[]>([]);
  useEffect(() => { void recovery.list().then(setRec); }, []);
  const show = (projectId ? docs : all.docs) ?? null;
  return (
    <div className="pe-home" dir="rtl">
      <div className="pe-home-head">
        <h1>PHOTOEDIT</h1>
        <p>עורך העיצובים הסטטיים של המערכת — מודעות, באנרים ופוסטים, בשכבות אמיתיות ובקיצורי פוטושופ.{projectName ? ` מקושר לפרויקט ${projectName}.` : ''}</p>
      </div>
      <section>
        <h2>מסמך חדש</h2>
        <div className="pe-home-presets">
          {PRESETS.slice(0, 5).map((p) => (
            <button key={p.name} type="button" onClick={() => ed.newDoc({ width: p.w, height: p.h, background: 'white', projectId })}>
              <span className="pe-preset-shape" style={{ aspectRatio: `${p.w}/${p.h}` }} />
              <b dir="ltr">{p.name}</b>
              <small dir="ltr">{p.w}×{p.h}</small>
            </button>
          ))}
          <button type="button" onClick={() => ed.openDialog('new')}><span className="pe-preset-shape custom">+</span><b>Custom</b><small>כל מידה</small></button>
          <button type="button" onClick={() => ed.pickFiles(true)}><span className="pe-preset-shape custom"><Ico n="folder" /></span><b>פתיחת קובץ</b><small>PNG · JPG · WEBP · SVG</small></button>
        </div>
      </section>
      {rec.length > 0 && (
        <section>
          <h2>עבודה שלא נשמרה</h2>
          <div className="pe-rec-list">
            {rec.slice(0, 6).map((r) => (
              <div key={r.id} className="pe-rec-row">
                <span dir="auto">{r.name}</span>
                <small>{new Date(r.time).toLocaleString('he-IL')}</small>
                <button type="button" className="pe-btn primary" onClick={async () => { const doc = await deserialize(JSON.parse(r.data)); ed.addDoc(doc, 'שחזור'); }}>שחזור</button>
                <button type="button" className="pe-btn" onClick={async () => { await recovery.remove(r.id); setRec(await recovery.list()); }}>מחיקה</button>
              </div>
            ))}
          </div>
        </section>
      )}
      {projectId && (
        <section>
          <h2>תמונות מהפרויקט · פתיחה כמסמך</h2>
          <ProjectImages ed={ed} projectId={projectId} onPick={(url, name) => void ed.openUrl(url, name, projectId)} />
        </section>
      )}
      <section>
        <h2>{projectId ? 'עיצובים של הפרויקט' : 'עיצובים אחרונים'}</h2>
        {err && ed.cloudOk === false ? <p className="pe-hint">אין חיבור לשרת המערכת; העבודה תישמר בדפדפן.</p> : !show ? <p className="pe-hint">טוען…</p> : show.length ? (
          <div className="pe-doc-grid">
            {show.map((d: CloudDoc) => (
              <div key={d.id} className="pe-doc-card">
                <button type="button" onClick={() => void ed.openCloud(d.id)}>
                  <img src={d.thumbUrl} alt="" loading="lazy" />
                  <b dir="auto">{d.name}</b>
                  <small dir="ltr">{d.width}×{d.height} · {new Date(d.updatedAt).toLocaleDateString('he-IL')}</small>
                </button>
              </div>
            ))}
          </div>
        ) : <p className="pe-hint">עוד אין עיצובים שמורים. צור מסמך חדש למעלה.</p>}
      </section>
    </div>
  );
}

/* ======================= האפליקציה ======================= */

export default function PhotoEditApp() {
  const ed = getEditor();
  useEditor(ed);
  const [params] = useSearchParams();
  const projectId = params.get('project');
  const [projectName, setProjectName] = useState<string | null>(null);

  useEffect(() => {
    loadGoogleFonts();
    document.title = 'PHOTOEDIT · AI Production AP';
    void ed.probeCloud();
    const kd = (e: KeyboardEvent) => ed.onKeyDown(e);
    const ku = (e: KeyboardEvent) => ed.onKeyUp(e);
    const paste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      void ed.paste(e);
    };
    const blur = () => { ed.clipboardFresh = false; };
    const before = (e: BeforeUnloadEvent) => { if (ed.docs.some((s) => ed.isDirty(s))) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('paste', paste);
    window.addEventListener('blur', blur);
    window.addEventListener('beforeunload', before);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('paste', paste);
      window.removeEventListener('blur', blur);
      window.removeEventListener('beforeunload', before);
    };
  }, [ed]);

  // פתיחה מתוך פרויקט: מסמך שמור או תמונה
  const opened = useRef('');
  useEffect(() => {
    const key = params.toString();
    if (opened.current === key) return;
    opened.current = key;
    const doc = params.get('doc'), image = params.get('image');
    if (doc) void ed.openCloud(doc);
    else if (image) void ed.openUrl(image, params.get('name') || 'תמונה', projectId);
  }, [params, ed, projectId]);

  useEffect(() => {
    if (!projectId) { setProjectName(null); return; }
    fetch(`/api/projects/${projectId}`).then((r) => (r.ok ? r.json() : null)).then((d) => setProjectName(d?.project?.name ?? null), () => setProjectName(null));
  }, [projectId]);

  return (
    <div className="pe-app" dir="ltr">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" precedence="default" />
      <MenuBar ed={ed} projectId={projectId} projectName={projectName} />
      <OptionsBar ed={ed} />
      <div className="pe-main">
        <Toolbar ed={ed} />
        <div className="pe-center">
          <Tabs ed={ed} />
          <div className="pe-stage">
            <Viewport ed={ed} />
            {!ed.docs.length && <Home ed={ed} projectId={projectId} projectName={projectName} />}
          </div>
        </div>
        <Panels ed={ed} />
      </div>
      <StatusBar ed={ed} />
      <Dialogs ed={ed} projectId={projectId} />
      <ArtboardDialogs ed={ed} />
      <LiquifyDialog ed={ed} />
      {ed.toastMsg && <div className={`pe-toast ${ed.toastMsg.tone}`} dir="rtl">{ed.toastMsg.text}</div>}
    </div>
  );
}

export { cloud };
