/**
 * Keyboard Shortcut Manager — כל הקיצורים במקום אחד. כלים ופקודות נרשמים לפי מזהה, והמשתמש יכול לשנות קיצור
 * (נשמר בדפדפן). המקשים מזוהים לפי e.code, כך שהם עובדים גם כשהמקלדת בעברית. ב-Mac: ⌘ במקום Ctrl, ⌥ במקום Alt.
 */

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export interface ShortcutDef {
  id: string;
  label: string;
  en: string;
  group: string;
  keys: string[];
}

/** קיצורים שהדפדפן לא מאפשר לדרוס בלשונית רגילה (עובדים באפליקציה המותקנת ובמסך מלא) — יש להם חלופה */
export const BROWSER_RESERVED = new Set(['Ctrl+N', 'Ctrl+T', 'Ctrl+W', 'Ctrl+Shift+N', 'Ctrl+Shift+T', 'Ctrl+Shift+W']);

export const DEFAULTS: ShortcutDef[] = [
  // כלים
  { id: 'tool.move', label: 'הזזה', en: 'Move Tool', group: 'כלים', keys: ['V'] },
  { id: 'tool.marquee', label: 'בחירה מלבנית/אליפטית/שורה/עמודה', en: 'Marquee Tool', group: 'כלים', keys: ['M'] },
  { id: 'tool.lasso', label: 'לאסו / מצולע / מגנטי', en: 'Lasso Tool', group: 'כלים', keys: ['L'] },
  { id: 'tool.wand', label: 'בחירה מהירה / מטה קסם', en: 'Quick Selection / Magic Wand', group: 'כלים', keys: ['W'] },
  { id: 'tool.crop', label: 'חיתוך', en: 'Crop Tool', group: 'כלים', keys: ['C'] },
  { id: 'tool.eyedropper', label: 'דוגם צבע / Color Sampler / סרגל', en: 'Eyedropper / Color Sampler / Ruler', group: 'כלים', keys: ['I'] },
  { id: 'tool.brush', label: 'מברשת / עיפרון / החלפת צבע', en: 'Brush / Pencil / Color Replacement', group: 'כלים', keys: ['B'] },
  { id: 'tool.clone', label: 'חותמת שכפול / חותמת דוגמה', en: 'Clone Stamp / Pattern Stamp', group: 'כלים', keys: ['S'] },
  { id: 'tool.historyBrush', label: 'מברשת היסטוריה', en: 'History Brush Tool', group: 'כלים', keys: ['Y'] },
  { id: 'tool.eraser', label: 'מחק / מחק רקע / מחק קסם', en: 'Eraser / Background Eraser / Magic Eraser', group: 'כלים', keys: ['E'] },
  { id: 'tool.blur', label: 'טשטוש / חידוד / מריחה', en: 'Blur / Sharpen / Smudge', group: 'כלים', keys: [] },
  { id: 'tool.dodge', label: 'הבהרה / הכהיה / ספוג', en: 'Dodge / Burn / Sponge', group: 'כלים', keys: ['O'] },
  { id: 'tool.spotHeal', label: 'ריפוי נקודתי / מברשת ריפוי / טלאי / עיניים אדומות', en: 'Spot Healing / Healing / Patch / Red Eye', group: 'כלים', keys: ['J'] },
  { id: 'tool.gradient', label: 'מעבר צבע / דלי', en: 'Gradient / Paint Bucket', group: 'כלים', keys: ['G'] },
  { id: 'tool.text', label: 'טקסט אופקי / אנכי / מסכות טקסט', en: 'Type / Vertical Type / Type Mask', group: 'כלים', keys: ['T'] },
  { id: 'tool.shape', label: 'צורות / צורה מותאמת', en: 'Shape / Custom Shape Tool', group: 'כלים', keys: ['U'] },
  { id: 'tool.pen', label: 'עט / עט חופשי / עט עקומות', en: 'Pen / Freeform Pen / Curvature Pen', group: 'כלים', keys: ['P'] },
  { id: 'tool.pathSel', label: 'בחירת נתיב / בחירה ישירה', en: 'Path Selection / Direct Selection', group: 'כלים', keys: ['A'] },
  { id: 'tool.hand', label: 'יד', en: 'Hand Tool', group: 'כלים', keys: ['H'] },
  { id: 'tool.rotateView', label: 'סיבוב תצוגה', en: 'Rotate View Tool', group: 'כלים', keys: ['R'] },
  { id: 'tool.zoom', label: 'זכוכית מגדלת', en: 'Zoom Tool', group: 'כלים', keys: ['Z'] },
  { id: 'colors.default', label: 'צבעי ברירת מחדל', en: 'Default Colors', group: 'כלים', keys: ['D'] },
  { id: 'colors.swap', label: 'החלפת צבעים', en: 'Swap Colors', group: 'כלים', keys: ['X'] },
  { id: 'brush.smaller', label: 'מברשת קטנה יותר', en: 'Decrease Brush Size', group: 'כלים', keys: ['['] },
  { id: 'brush.bigger', label: 'מברשת גדולה יותר', en: 'Increase Brush Size', group: 'כלים', keys: [']'] },
  { id: 'brush.softer', label: 'מברשת רכה יותר', en: 'Decrease Hardness', group: 'כלים', keys: ['Shift+['] },
  { id: 'brush.harder', label: 'מברשת קשה יותר', en: 'Increase Hardness', group: 'כלים', keys: ['Shift+]'] },
  { id: 'view.screenMode', label: 'מסך מלא', en: 'Screen Mode', group: 'View', keys: ['F'] },
  { id: 'view.togglePanels', label: 'הסתרת פאנלים', en: 'Hide Panels', group: 'View', keys: ['Tab'] },

  // File
  { id: 'file.new', label: 'מסמך חדש', en: 'New…', group: 'File', keys: ['Ctrl+N', 'Alt+N'] },
  { id: 'file.open', label: 'פתיחה', en: 'Open…', group: 'File', keys: ['Ctrl+O'] },
  { id: 'file.save', label: 'שמירה', en: 'Save', group: 'File', keys: ['Ctrl+S'] },
  { id: 'file.saveAs', label: 'שמירה בשם', en: 'Save As…', group: 'File', keys: ['Ctrl+Shift+S'] },
  { id: 'file.export', label: 'ייצוא', en: 'Export As…', group: 'File', keys: ['Ctrl+Alt+Shift+W', 'Alt+E'] },
  { id: 'file.quickPng', label: 'ייצוא מהיר PNG', en: 'Quick Export as PNG', group: 'File', keys: ['Ctrl+Alt+Shift+Q'] },
  { id: 'file.place', label: 'הוספת תמונה כשכבה', en: 'Place Embedded…', group: 'File', keys: ['Ctrl+Shift+P'] },
  { id: 'file.close', label: 'סגירת מסמך', en: 'Close', group: 'File', keys: ['Ctrl+W', 'Alt+W'] },

  // Edit
  { id: 'edit.undo', label: 'ביטול', en: 'Undo', group: 'Edit', keys: ['Ctrl+Z'] },
  { id: 'edit.redo', label: 'חזרה', en: 'Redo', group: 'Edit', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  { id: 'edit.stepBack', label: 'צעד אחורה', en: 'Step Backward', group: 'Edit', keys: ['Ctrl+Alt+Z'] },
  { id: 'edit.cut', label: 'גזירה', en: 'Cut', group: 'Edit', keys: ['Ctrl+X'] },
  { id: 'edit.copy', label: 'העתקה', en: 'Copy', group: 'Edit', keys: ['Ctrl+C'] },
  { id: 'edit.copyMerged', label: 'העתקה ממוזגת', en: 'Copy Merged', group: 'Edit', keys: ['Ctrl+Shift+C'] },
  { id: 'edit.fill', label: 'מילוי', en: 'Fill…', group: 'Edit', keys: ['Shift+F5'] },
  { id: 'edit.generativeFill', label: 'מילוי גנרטיבי (AI)', en: 'Generative Fill…', group: 'Edit', keys: [] },
  { id: 'edit.fillFg', label: 'מילוי בצבע קדמי', en: 'Fill with Foreground', group: 'Edit', keys: ['Alt+Backspace', 'Alt+Delete'] },
  { id: 'edit.fillBg', label: 'מילוי בצבע רקע', en: 'Fill with Background', group: 'Edit', keys: ['Ctrl+Backspace', 'Ctrl+Delete'] },
  { id: 'edit.clear', label: 'מחיקה', en: 'Clear / Delete Layer', group: 'Edit', keys: ['Delete', 'Backspace'] },
  { id: 'edit.freeTransform', label: 'Free Transform', en: 'Free Transform', group: 'Edit', keys: ['Ctrl+T', 'Alt+T'] },
  { id: 'edit.flipH', label: 'היפוך אופקי', en: 'Flip Horizontal', group: 'Edit', keys: [] },
  { id: 'edit.flipV', label: 'היפוך אנכי', en: 'Flip Vertical', group: 'Edit', keys: [] },
  { id: 'edit.skew', label: 'הטיה', en: 'Transform > Skew', group: 'Edit', keys: [] },
  { id: 'edit.distort', label: 'עיוות', en: 'Transform > Distort', group: 'Edit', keys: [] },
  { id: 'edit.perspective', label: 'פרספקטיבה', en: 'Transform > Perspective', group: 'Edit', keys: [] },
  { id: 'edit.warp', label: 'עיקום', en: 'Transform > Warp', group: 'Edit', keys: [] },
  { id: 'edit.puppetWarp', label: 'עיוות בובה', en: 'Puppet Warp', group: 'Edit', keys: [] },
  { id: 'edit.definePattern', label: 'הגדרת דפוס', en: 'Define Pattern…', group: 'Edit', keys: [] },
  { id: 'edit.shortcuts', label: 'קיצורי מקלדת', en: 'Keyboard Shortcuts…', group: 'Edit', keys: ['Ctrl+Alt+Shift+K', 'F1'] },

  // Image
  { id: 'image.levels', label: 'רמות', en: 'Levels…', group: 'Image', keys: ['Ctrl+L'] },
  { id: 'image.curves', label: 'עקומות', en: 'Curves…', group: 'Image', keys: ['Ctrl+M'] },
  { id: 'image.hueSat', label: 'גוון/רוויה', en: 'Hue/Saturation…', group: 'Image', keys: ['Ctrl+U'] },
  { id: 'image.colorBalance', label: 'איזון צבע', en: 'Color Balance…', group: 'Image', keys: ['Ctrl+B'] },
  { id: 'image.bw', label: 'שחור-לבן', en: 'Black & White…', group: 'Image', keys: ['Ctrl+Alt+Shift+B'] },
  { id: 'image.invert', label: 'היפוך צבעים', en: 'Invert', group: 'Image', keys: ['Ctrl+I'] },
  { id: 'image.desaturate', label: 'ביטול רוויה', en: 'Desaturate', group: 'Image', keys: ['Ctrl+Shift+U'] },
  { id: 'image.size', label: 'גודל תמונה', en: 'Image Size…', group: 'Image', keys: ['Ctrl+Alt+I'] },
  { id: 'image.canvasSize', label: 'גודל קנבס', en: 'Canvas Size…', group: 'Image', keys: ['Ctrl+Alt+C'] },

  // Layer
  { id: 'layer.new', label: 'שכבה חדשה', en: 'New Layer', group: 'Layer', keys: ['Ctrl+Shift+N', 'Ctrl+Alt+Shift+N'] },
  { id: 'layer.removeBg', label: 'הסרת רקע (AI)', en: 'Remove Background', group: 'Layer', keys: [] },
  { id: 'layer.duplicate', label: 'שכפול שכבה', en: 'Layer via Copy / Duplicate', group: 'Layer', keys: ['Ctrl+J'] },
  { id: 'layer.viaCut', label: 'שכבה בגזירה', en: 'Layer via Cut', group: 'Layer', keys: ['Ctrl+Shift+J'] },
  { id: 'layer.group', label: 'קיבוץ שכבות', en: 'Group Layers', group: 'Layer', keys: ['Ctrl+G'] },
  { id: 'layer.ungroup', label: 'פירוק קבוצה', en: 'Ungroup Layers', group: 'Layer', keys: ['Ctrl+Shift+G'] },
  { id: 'layer.clip', label: 'Clipping Mask', en: 'Create/Release Clipping Mask', group: 'Layer', keys: ['Ctrl+Alt+G'] },
  { id: 'layer.mergeDown', label: 'מיזוג למטה', en: 'Merge Down / Merge Layers', group: 'Layer', keys: ['Ctrl+E'] },
  { id: 'layer.mergeVisible', label: 'מיזוג הגלויות', en: 'Merge Visible', group: 'Layer', keys: ['Ctrl+Shift+E'] },
  { id: 'layer.stamp', label: 'חותמת ממוזגת', en: 'Stamp Visible', group: 'Layer', keys: ['Ctrl+Alt+Shift+E'] },
  { id: 'layer.forward', label: 'קדימה', en: 'Bring Forward', group: 'Layer', keys: ['Ctrl+]'] },
  { id: 'layer.backward', label: 'אחורה', en: 'Send Backward', group: 'Layer', keys: ['Ctrl+['] },
  { id: 'layer.front', label: 'לראש', en: 'Bring to Front', group: 'Layer', keys: ['Ctrl+Shift+]'] },
  { id: 'layer.back', label: 'לתחתית', en: 'Send to Back', group: 'Layer', keys: ['Ctrl+Shift+['] },
  { id: 'layer.selectUp', label: 'בחירת השכבה שמעל', en: 'Select Layer Above', group: 'Layer', keys: ['Alt+]'] },
  { id: 'layer.selectDown', label: 'בחירת השכבה שמתחת', en: 'Select Layer Below', group: 'Layer', keys: ['Alt+['] },
  { id: 'layer.rasterize', label: 'המרה לפיקסלים', en: 'Rasterize Layer', group: 'Layer', keys: [] },
  { id: 'layer.addMask', label: 'הוספת מסכה', en: 'Add Layer Mask', group: 'Layer', keys: [] },
  { id: 'layer.lock', label: 'נעילה', en: 'Lock Layer', group: 'Layer', keys: ['Ctrl+/'] },
  { id: 'layer.hideOthers', label: 'הסתרה/הצגה', en: 'Hide Layers', group: 'Layer', keys: ['Ctrl+,'] },

  // Select
  { id: 'select.all', label: 'בחירת הכול', en: 'All', group: 'Select', keys: ['Ctrl+A'] },
  { id: 'select.deselect', label: 'ביטול בחירה', en: 'Deselect', group: 'Select', keys: ['Ctrl+D'] },
  { id: 'select.reselect', label: 'בחירה חוזרת', en: 'Reselect', group: 'Select', keys: ['Ctrl+Shift+D'] },
  { id: 'select.inverse', label: 'היפוך בחירה', en: 'Inverse', group: 'Select', keys: ['Ctrl+Shift+I'] },
  { id: 'select.feather', label: 'ריכוך', en: 'Feather…', group: 'Select', keys: ['Shift+F6'] },
  { id: 'select.allLayers', label: 'כל השכבות', en: 'All Layers', group: 'Select', keys: ['Ctrl+Alt+A'] },
  { id: 'select.quickMask', label: 'מסכה מהירה', en: 'Edit in Quick Mask Mode', group: 'Select', keys: ['Q'] },
  { id: 'select.selectAndMask', label: 'בחירה ומסכה', en: 'Select and Mask…', group: 'Select', keys: ['Ctrl+Alt+R'] },
  { id: 'select.colorRange', label: 'טווח צבעים', en: 'Color Range…', group: 'Select', keys: [] },
  { id: 'select.subject', label: 'בחירת נושא (AI)', en: 'Subject', group: 'Select', keys: [] },
  { id: 'select.grow', label: 'הרחבה לפי צבע', en: 'Grow', group: 'Select', keys: [] },
  { id: 'select.similar', label: 'צבעים דומים', en: 'Similar', group: 'Select', keys: [] },
  { id: 'select.border', label: 'מסגרת בחירה', en: 'Modify > Border…', group: 'Select', keys: [] },
  { id: 'select.smooth', label: 'החלקת בחירה', en: 'Modify > Smooth…', group: 'Select', keys: [] },
  { id: 'select.expand', label: 'הרחבת בחירה', en: 'Modify > Expand…', group: 'Select', keys: [] },
  { id: 'select.contract', label: 'כיווץ בחירה', en: 'Modify > Contract…', group: 'Select', keys: [] },
  { id: 'select.transform', label: 'שינוי צורת הבחירה', en: 'Transform Selection', group: 'Select', keys: [] },
  { id: 'select.save', label: 'שמירת בחירה', en: 'Save Selection…', group: 'Select', keys: [] },
  { id: 'select.load', label: 'טעינת בחירה', en: 'Load Selection…', group: 'Select', keys: [] },
  { id: 'path.toSelection', label: 'טעינת הנתיב כבחירה', en: 'Load Path as Selection', group: 'Select', keys: ['Ctrl+Enter'] },
  { id: 'path.fromSelection', label: 'נתיב עבודה מהבחירה', en: 'Make Work Path', group: 'Select', keys: [] },
  { id: 'layer.vmaskCurrent', label: 'מסכה וקטורית מהנתיב', en: 'Vector Mask > Current Path', group: 'Layer', keys: [] },
  { id: 'layer.convertToShape', label: 'המרה לצורה', en: 'Convert to Shape', group: 'Layer', keys: [] },
  { id: 'mask.overlay', label: 'שכבת אדום של המסכה', en: 'Toggle Mask Overlay', group: 'Layer', keys: ['\\'] },
  { id: 'mask.toSelection', label: 'מסכה כבחירה', en: 'Load Mask as Selection', group: 'Layer', keys: [] },
  { id: 'layer.maskRevealAll', label: 'מסכה: הצג הכול', en: 'Layer Mask > Reveal All', group: 'Layer', keys: [] },
  { id: 'layer.maskHideAll', label: 'מסכה: הסתר הכול', en: 'Layer Mask > Hide All', group: 'Layer', keys: [] },
  { id: 'layer.maskRevealSel', label: 'מסכה מהבחירה', en: 'Layer Mask > Reveal Selection', group: 'Layer', keys: [] },
  { id: 'layer.maskHideSel', label: 'מסכה שמסתירה את הבחירה', en: 'Layer Mask > Hide Selection', group: 'Layer', keys: [] },

  // Filter
  { id: 'filter.last', label: 'פילטר אחרון', en: 'Last Filter', group: 'Filter', keys: ['Ctrl+Alt+F'] },
  { id: 'filter.liquify', label: 'נזילות', en: 'Liquify…', group: 'Filter', keys: ['Ctrl+Shift+X'] },

  // View
  { id: 'view.zoomIn', label: 'הגדלה', en: 'Zoom In', group: 'View', keys: ['Ctrl+=', 'Ctrl+Shift+='] },
  { id: 'view.zoomOut', label: 'הקטנה', en: 'Zoom Out', group: 'View', keys: ['Ctrl+-'] },
  { id: 'view.fit', label: 'התאמה למסך', en: 'Fit on Screen', group: 'View', keys: ['Ctrl+0'] },
  { id: 'view.actual', label: 'פיקסלים אמיתיים 100%', en: '100%', group: 'View', keys: ['Ctrl+1'] },
  { id: 'view.rulers', label: 'סרגלים', en: 'Rulers', group: 'View', keys: ['Ctrl+R'] },
  { id: 'view.guides', label: 'קווי עזר', en: 'Show Guides', group: 'View', keys: ['Ctrl+;'] },
  { id: 'view.grid', label: 'רשת', en: 'Show Grid', group: 'View', keys: ["Ctrl+'"] },
  { id: 'view.snap', label: 'הצמדה', en: 'Snap', group: 'View', keys: ['Ctrl+Shift+;'] },
  { id: 'view.extras', label: 'תוספות תצוגה', en: 'Extras', group: 'View', keys: ['Ctrl+H'] },
  { id: 'view.resetRotation', label: 'איפוס סיבוב התצוגה', en: 'Reset View Rotation', group: 'View', keys: [] },
];

const STORE = 'photoedit.shortcuts.v1';

export class Shortcuts {
  defs: ShortcutDef[];
  private map = new Map<string, string>();

  constructor() {
    let overrides: Record<string, string[]> = {};
    try { overrides = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { /* אין אחסון — ברירות מחדל */ }
    this.defs = DEFAULTS.map((d) => ({ ...d, keys: overrides[d.id] ?? d.keys }));
    this.rebuild();
  }

  private rebuild() {
    this.map.clear();
    for (const d of this.defs) for (const k of d.keys) this.map.set(k, d.id);
  }

  set(id: string, keys: string[]) {
    // מקש שעבר לפקודה חדשה יורד מהקודמת — בלי התנגשויות
    for (const d of this.defs) if (d.id !== id) d.keys = d.keys.filter((k) => !keys.includes(k));
    const d = this.defs.find((x) => x.id === id);
    if (d) d.keys = keys;
    this.rebuild();
    const overrides: Record<string, string[]> = {};
    for (const x of this.defs) {
      const def = DEFAULTS.find((y) => y.id === x.id)!;
      if (JSON.stringify(def.keys) !== JSON.stringify(x.keys)) overrides[x.id] = x.keys;
    }
    try { localStorage.setItem(STORE, JSON.stringify(overrides)); } catch { /* */ }
  }

  reset() {
    this.defs = DEFAULTS.map((d) => ({ ...d }));
    this.rebuild();
    try { localStorage.removeItem(STORE); } catch { /* */ }
  }

  lookup(combo: string) { return this.map.get(combo); }
  keysOf(id: string) { return this.defs.find((d) => d.id === id)?.keys ?? []; }
  label(id: string) { const k = this.keysOf(id)[0]; return k ? pretty(k) : ''; }
}

const CODE: Record<string, string> = {
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  Equal: '=', Minus: '-', Backquote: '`', Space: 'Space', NumpadAdd: '=', NumpadSubtract: '-', Numpad0: '0', Numpad1: '1',
};

/** הצירוף מהאירוע, לפי מיקום המקש (לא לפי האות) — עובד גם בעברית */
export function comboOf(e: KeyboardEvent): string | null {
  let key: string;
  if (e.code.startsWith('Key')) key = e.code.slice(3);
  else if (e.code.startsWith('Digit')) key = e.code.slice(5);
  else if (/^F\d+$/.test(e.code)) key = e.code;
  else if (CODE[e.code]) key = CODE[e.code];
  else if (['Backspace', 'Delete', 'Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.code)) key = e.code;
  else if (e.code === 'NumpadEnter') key = 'Enter';
  else return null;
  const ctrl = isMac ? e.metaKey : e.ctrlKey;
  return `${ctrl ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${key}`;
}

export function pretty(k: string) {
  if (!isMac) return k.replace('Backspace', '⌫');
  return k.replace('Ctrl+', '⌘').replace('Alt+', '⌥').replace('Shift+', '⇧').replace('Backspace', '⌫');
}
