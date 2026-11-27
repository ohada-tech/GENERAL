/**
 * Artboards — פעולות ברמת העורך: יצירה, הוספה צמודה (+), שינוי גודל/רקע, המרה מקבוצה/שכבות, הזזה עם התוכן,
 * שכפול, קינון אוטומטי (שכבה שהוזזה אל משטח נכנסת אליו), ייצוא. כל פעולה נגמרת ב-commit עם תווית בעברית;
 * Editor.commit מתאים את גבולות המסמך למשטחים לפני תמונת המצב.
 */
import type { Editor } from './editor';
import type { Doc, Layer, Pt, Rect, XfLayer, Xf } from './model';
import { cloneLayer, findLayer, flatForPanel, touch, unionRect, xfLeaves, walk } from './model';
import { layerBounds } from './render';
import { cloud, downloadBlob, exportBlob, safeName, type ExportOpts } from './io';
import {
  type Artboard, abRect, activeArtboard, adjacentRect, artboardAt, artboardDoc, artboardOf, artboardsOf, hasArtboards,
  isArtboard, makeArtboard, nextArtboardName, setArtboardRect, shiftMask, AB_PRESETS,
} from './artboards';

/* ---------- בחירה ---------- */

/** המשטח הנבחר (כשורה בפאנל השכבות / בכלי Artboard) */
export function selectedArtboard(ed: Editor): Artboard | null {
  return (ed.topSelected().find(isArtboard) as Artboard | undefined) ?? null;
}

export const selectedArtboards = (ed: Editor): Artboard[] => ed.topSelected().filter(isArtboard);

/** גודל ברירת המחדל למשטח חדש (Size בסרגל האפשרויות כשאין משטח נבחר) */
export const newArtboardSize = { w: AB_PRESETS[0].w, h: AB_PRESETS[0].h };

function selectOnly(ed: Editor, ids: string[]) {
  ed.st!.selected = ids;
  ed.st!.active = ids[ids.length - 1] ?? null;
  ed.st!.maskEdit = false;
}

/* ---------- יצירה ---------- */

export function addArtboard(ed: Editor, r: Rect, label = 'משטח עבודה חדש', bg = '#ffffff'): Artboard {
  const d = ed.doc!;
  const a = makeArtboard(r, nextArtboardName(d), bg);
  d.layers.push(a);
  selectOnly(ed, [a.id]);
  ed.commit(label);
  return a;
}

/** כפתורי + סביב משטח נבחר: משטח ריק באותו גודל, במרווח 100px */
export function addAdjacent(ed: Editor, a: Artboard, dir: 'left' | 'right' | 'top' | 'bottom') {
  return addArtboard(ed, adjacentRect(ed.doc!, abRect(a), dir), 'הוספת משטח עבודה צמוד', a.artboard.bg);
}

/**
 * Layer > New > Artboard / "Add New Artboard": משטח חדש מימין למשטח הנבחר (או האחרון).
 * במסמך בלי משטחים — כל השכבות הקיימות נכנסות קודם למשטח 1 בגודל המסמך (רקע שקוף, כך שהעיצוב לא משתנה).
 */
export function addNewArtboard(ed: Editor) {
  const d = ed.doc!;
  let base = selectedArtboard(ed) ?? artboardOf(d, ed.st!.active) ?? artboardsOf(d).slice(-1)[0] ?? null;
  if (!base) {
    base = makeArtboard({ x: 0, y: 0, w: d.width, h: d.height }, nextArtboardName(d), 'transparent', d.layers);
    d.layers = [base];
  }
  const sel = selectedArtboard(ed);
  const w = sel ? base.artboard.w : newArtboardSize.w, h = sel ? base.artboard.h : newArtboardSize.h;
  const a = makeArtboard(adjacentRect(d, abRect(base), 'right', w, h), nextArtboardName(d), '#ffffff');
  d.layers.push(a);
  selectOnly(ed, [a.id]);
  ed.commit('משטח עבודה חדש');
  return a;
}

/** Artboard from Group / Artboard from Layers: המשטח בגודל התיבה של הבחירה, והבחירה בתוכו */
export function artboardFromSelection(ed: Editor, fromGroup: boolean) {
  const d = ed.doc!;
  const sel = ed.topSelected().filter((l) => !isArtboard(l));
  if (!sel.length) { ed.toast(fromGroup ? 'בחרו קבוצה בפאנל השכבות' : 'בחרו שכבות בפאנל השכבות', 'error'); return; }
  let box: Rect | null = null;
  for (const l of sel) { const b = layerBounds(l); if (b) box = unionRect(box, b); }
  if (!box || box.w < 1 || box.h < 1) { ed.toast('לבחירה אין תוכן שאפשר למדוד', 'error'); return; }
  const r = { x: Math.floor(box.x), y: Math.floor(box.y), w: Math.ceil(box.x + box.w) - Math.floor(box.x), h: Math.ceil(box.y + box.h) - Math.floor(box.y) };
  // המיקום ברמה העליונה: מעל האב העליון של השכבה העליונה בבחירה
  const flat = flatForPanel(d.layers).map((x) => x.layer.id);
  const topMost = sel.reduce((a, b) => (flat.indexOf(a.id) < flat.indexOf(b.id) ? a : b));
  const anchor = d.layers.find((t) => t.id === topMost.id || (t.type === 'group' && findLayer(t.children, topMost.id)));
  const g = sel.length === 1 && sel[0].type === 'group' ? sel[0] : null;
  if (fromGroup && g) {
    const f = findLayer(d.layers, g.id)!;
    f.parent.splice(f.index, 1);
    g.artboard = { ...r, bg: '#ffffff' };
    touch(g);
    const at = anchor && anchor !== g ? d.layers.indexOf(anchor) + 1 : f.parent === d.layers ? f.index : d.layers.length;
    d.layers.splice(Math.min(at, d.layers.length), 0, g);
    selectOnly(ed, [g.id]);
    ed.commit('משטח עבודה מקבוצה');
    return;
  }
  const ordered = [...sel].sort((a, b) => flat.indexOf(b.id) - flat.indexOf(a.id));
  for (const l of ordered) { const f = findLayer(d.layers, l.id)!; f.parent.splice(f.index, 1); }
  const a = makeArtboard(r, nextArtboardName(d), '#ffffff', ordered);
  const at = anchor && d.layers.includes(anchor) ? d.layers.indexOf(anchor) + 1 : d.layers.length;
  d.layers.splice(at, 0, a);
  selectOnly(ed, [a.id]);
  ed.commit(fromGroup ? 'משטח עבודה מקבוצה' : 'משטח עבודה משכבות');
}

/* ---------- מאפיינים ---------- */

/** שינוי גודל ששומר על הפינה השמאלית העליונה (כמו Size בסרגל האפשרויות של פוטושופ). התוכן לא זז */
export function resizeArtboard(ed: Editor, a: Artboard, w: number, h: number, soft = false) {
  if (Math.round(w) === a.artboard.w && Math.round(h) === a.artboard.h) return;
  setArtboardRect(a, { w, h });
  if (soft) ed.softCommit('גודל משטח עבודה'); else ed.commit('גודל משטח עבודה');
}

export function setArtboardBg(ed: Editor, a: Artboard, bg: string, soft = false) {
  a.artboard = { ...a.artboard, bg };
  touch(a);
  if (soft) ed.softCommit('רקע משטח עבודה'); else ed.commit('רקע משטח עבודה');
}

/* ---------- הזזה עם התוכן ---------- */

export interface AbMove {
  abs: Array<{ a: Artboard; r0: Rect }>;
  leaves: Array<{ l: XfLayer; t0: Xf }>;
  masks: Array<{ l: Layer; c0: HTMLCanvasElement; white: boolean }>;
  box: Rect;
  ids: Set<string>;
}

function maskWhite(c: HTMLCanvasElement) {
  const x = c.getContext('2d', { willReadFrequently: true })!, w = c.width - 1, h = c.height - 1;
  let n = 0;
  for (const [px, py] of [[0, 0], [w, 0], [0, h], [w, h]]) if (x.getImageData(px, py, 1, 1).data[3] > 127) n++;
  return n >= 2;
}

/** מתחיל הזזה של משטחים: withLeaves = גם מיקומי השכבות שבתוכם (כלי Artboard); בכלי Move השכבות כבר זזות שם */
export function beginArtboardMove(abs: Artboard[], withLeaves: boolean): AbMove | null {
  const list = abs.filter((a) => !a.locked);
  if (!list.length) return null;
  let box: Rect | null = null;
  const ids = new Set<string>();
  const masks: AbMove['masks'] = [];
  for (const a of list) {
    box = unionRect(box, abRect(a));
    walk([a], (n) => { ids.add(n.id); if (n.mask) masks.push({ l: n, c0: n.mask.canvas, white: maskWhite(n.mask.canvas) }); });
  }
  const leaves = withLeaves ? list.flatMap(xfLeaves).map((l) => ({ l, t0: { ...l.t } })) : [];
  return { abs: list.map((a) => ({ a, r0: abRect(a) })), leaves, masks, box: box!, ids };
}

export function applyArtboardMove(m: AbMove, dx: number, dy: number) {
  dx = Math.round(dx); dy = Math.round(dy);
  for (const { a, r0 } of m.abs) { a.artboard = { ...a.artboard, x: r0.x + dx, y: r0.y + dy }; touch(a); }
  for (const { l, t0 } of m.leaves) { l.t.x = t0.x + dx; l.t.y = t0.y + dy; touch(l); }
  for (const { l, c0, white } of m.masks) { if (l.mask) { l.mask = { ...l.mask, canvas: dx || dy ? shiftMask(c0, dx, dy, c0.width, c0.height, white) : c0 }; touch(l); } }
}

/** Alt+גרירה: עותק של המשטחים (עם התוכן) מעל המקור; העותקים נבחרים */
export function duplicateArtboards(ed: Editor, abs: Artboard[]): Artboard[] {
  const d = ed.doc!;
  const out: Artboard[] = [];
  for (const a of abs) {
    const c = cloneLayer(a, true) as Artboard;
    c.name = `${a.name} עותק`;
    d.layers.splice(d.layers.indexOf(a) + 1, 0, c);
    out.push(c);
  }
  selectOnly(ed, out.map((a) => a.id));
  return out;
}

/** חיצים במקלדת על משטח נבחר: המלבן והמסכות זזים (המיקומים של השכבות זזים ב-Editor.nudge) */
export function nudgeArtboards(ed: Editor, dx: number, dy: number) {
  const m = beginArtboardMove(selectedArtboards(ed), false);
  if (m) applyArtboardMove(m, dx, dy);
}

/**
 * קינון אוטומטי (כמו בפוטושופ): שכבה שהוזזה כך שמרכז התיבה שלה מעל משטח — עוברת לראש המשטח;
 * שכבה שיצאה מכל משטח — עוברת ל-Pasteboard (מעל המשטח שיצאה ממנו). שכבות בתוך קבוצה רגילה נשארות בקבוצה.
 */
export function autoNest(ed: Editor, layers: Layer[]): boolean {
  const d = ed.doc!;
  if (!hasArtboards(d)) return false;
  let changed = false;
  for (const l of layers) {
    if (isArtboard(l)) continue;
    const f = findLayer(d.layers, l.id);
    if (!f) continue;
    const cur = artboardOf(d, l.id);
    // רק שכבות שיושבות ישירות על ה-Pasteboard או ישירות במשטח
    if (!(f.parent === d.layers || (cur && f.parent === cur.children))) continue;
    const b = layerBounds(l);
    if (!b) continue;
    const target = artboardAt(d, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    if ((target?.id ?? null) === (cur?.id ?? null)) continue;
    f.parent.splice(f.index, 1);
    if (target) { target.children.push(l); target.open = true; }
    else d.layers.splice(cur ? d.layers.indexOf(cur) + 1 : d.layers.length, 0, l);
    touch(l);
    changed = true;
  }
  return changed;
}

/* ---------- ייצוא ---------- */

/** מה ש-Export As / Quick Export מייצאים: המשטח הפעיל, או כל המסמך כשאין משטחים */
export function exportDoc(ed: Editor): Doc {
  const d = ed.doc!;
  const a = hasArtboards(d) ? activeArtboard(d, ed.st!.active) : null;
  return a ? artboardDoc(d, a) : d;
}

export const artboardFileName = (doc: Doc, a: Artboard, ext: string) => `${safeName(doc.name)}-${safeName(a.name)}.${ext}`;

/** Artboards to Files: כל משטח לקובץ משלו, להורדה או לפרויקט */
export async function exportArtboards(ed: Editor, ids: string[], o: ExportOpts, toProject: string | null, onProgress?: (i: number, n: number) => void) {
  const d = ed.doc!;
  ed.commitTextEdit();
  const list = artboardsOf(d).filter((a) => ids.includes(a.id));
  const ext = o.format === 'jpg' ? 'jpg' : o.format;
  for (let i = 0; i < list.length; i++) {
    onProgress?.(i, list.length);
    const a = list[i];
    const blob = await exportBlob(artboardDoc(d, a), o);
    const file = artboardFileName(d, a, ext);
    if (toProject) await cloud.sendToProject(toProject, blob, file);
    else {
      downloadBlob(blob, file);
      // הדפדפן מוריד כמה קבצים ברצף רק עם הפסקה קטנה ביניהם
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  onProgress?.(list.length, list.length);
  ed.toast(toProject ? `${list.length} משטחים נשלחו לפרויקט ✓` : `${list.length} משטחים יוצאו ✓`, 'ok');
}

/* ---------- פקודות (תפריטים) ---------- */

export function runArtboardCmd(ed: Editor, id: string): boolean {
  if (!id.startsWith('artboard.')) return false;
  if (!ed.doc) return true;
  switch (id) {
    case 'artboard.new': addNewArtboard(ed); return true;
    case 'artboard.fromGroup': artboardFromSelection(ed, true); return true;
    case 'artboard.fromLayers': artboardFromSelection(ed, false); return true;
    case 'artboard.exportAll':
      if (!hasArtboards(ed.doc)) { ed.toast('אין במסמך משטחי עבודה', 'error'); return true; }
      ed.openDialog('artboardsExport');
      return true;
  }
  return false;
}

export type { Pt };
