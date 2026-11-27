/**
 * פקודות Select ו-Layer Mask בסגנון פוטושופ: Quick Mask, Grow/Similar, Modify (Border/Smooth), Save/Load Selection,
 * Select and Mask ו-Color Range (התוצאה), מסכה מבחירה, Density/Feather, תצוגת מסכה, העברת מסכה בין שכבות.
 * Editor.run מעביר לכאן כל פקודה שהוא לא מכיר (runSelectCmd).
 */
import type { Editor } from './editor';
import type { Layer } from './model';
import { cloneLayer, copyCanvas, findLayer, newCanvas, touch, uid } from './model';
import { effectiveMask } from './render';
import { alphaOf, canvasFromAlpha, sourceFor } from './select-ops';
import { borderAlpha, growSimilar, isFull, smoothAlpha } from './selection-algo';
import { allSel, combine, type SelMode } from './selection';
import { startSelTransform } from './tools-select';

/* ---------- Quick Mask ---------- */

export function toggleQuickMask(ed: Editor) {
  const st = ed.st, d = ed.doc;
  if (!st || !d) return;
  if (!st.qmask) {
    st.qmask = true;
    // בלי בחירה: הכול "נבחר" (אין אדום), וצביעה בשחור מוסיפה מסכה
    if (!d.selection) d.selection = allSel(d);
    ed.commit('Quick Mask · כניסה למסכה מהירה');
  } else {
    st.qmask = false;
    ed.live.qmask = null;
    if (d.selection && isFull(alphaOf(d.selection))) d.selection = null;
    ed.commit('Quick Mask · יציאה מהמסכה המהירה');
  }
}

/* ---------- Grow / Similar / Border / Smooth ---------- */

export function growOrSimilar(ed: Editor, contiguous: boolean) {
  const d = ed.doc!;
  if (!d.selection) { ed.toast('אין בחירה', 'error'); return; }
  const o = ed.opts.wand;
  const src = sourceFor(ed, o.allLayers, false);
  const out = growSimilar(src.px, d.width, d.height, alphaOf(d.selection), o.tolerance, contiguous);
  ed.setSelection(canvasFromAlpha(out, d.width, d.height), contiguous ? 'Grow · הרחבה לפי צבע' : 'Similar · צבעים דומים');
}

export function borderOrSmooth(ed: Editor, op: 'border' | 'smooth', v: number) {
  const d = ed.doc!;
  if (!d.selection) return;
  const a = alphaOf(d.selection);
  const out = op === 'border' ? borderAlpha(a, d.width, d.height, Math.max(1, v)) : smoothAlpha(a, d.width, d.height, Math.max(1, Math.round(v)));
  ed.setSelection(canvasFromAlpha(out, d.width, d.height), op === 'border' ? 'Border · מסגרת בחירה' : 'Smooth · החלקת בחירה');
}

/* ---------- Save / Load Selection (ערוצי אלפא) ---------- */

export function saveSelection(ed: Editor, name: string, into: string | null, op: SelMode) {
  const d = ed.doc!;
  if (!d.selection) { ed.toast('אין בחירה לשמירה', 'error'); return; }
  const list = [...(d.channels ?? [])];
  const i = into ? list.findIndex((c) => c.id === into) : -1;
  if (i >= 0) {
    // שמירה לערוץ קיים: החלפה / הוספה / חיסור / חיתוך — כמו בדיאלוג של פוטושופ
    const merged = op === 'new' ? copyCanvas(d.selection) : combine({ ...d, selection: list[i].canvas }, d.selection, op) ?? newCanvas(d.width, d.height);
    list[i] = { ...list[i], canvas: merged };
  } else {
    let n = list.length + 1;
    while (list.some((c) => c.name === `Alpha ${n}`)) n++;
    list.push({ id: uid(), name: name.trim() || `Alpha ${n}`, canvas: copyCanvas(d.selection) });
  }
  d.channels = list;
  ed.commit(`Save Selection · ${i >= 0 ? list[i].name : list[list.length - 1].name}`);
  ed.toast('הבחירה נשמרה במסמך', 'ok');
}

export function loadSelection(ed: Editor, id: string, invert: boolean, op: SelMode) {
  const d = ed.doc!;
  const ch = d.channels?.find((c) => c.id === id);
  if (!ch) return;
  let c = ch.canvas;
  if (invert) {
    c = allSel(d);
    const x = c.getContext('2d')!;
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(ch.canvas, 0, 0);
  }
  ed.setSelection(combine(d, c, op), `Load Selection · ${ch.name}`);
}

export function deleteChannel(ed: Editor, id: string) {
  const d = ed.doc!;
  const ch = d.channels?.find((c) => c.id === id);
  if (!ch) return;
  d.channels = (d.channels ?? []).filter((c) => c.id !== id);
  ed.commit(`מחיקת ערוץ ${ch.name}`);
}

/* ---------- מסכות שכבה ---------- */

export type MaskMode = 'revealAll' | 'hideAll' | 'revealSel' | 'hideSel';

export function addMaskMode(ed: Editor, mode: MaskMode) {
  const d = ed.doc!, l = ed.active;
  if (!l) { ed.toast('בחר שכבה', 'error'); return; }
  if (l.mask) { ed.toast('לשכבה כבר יש מסכה'); return; }
  if ((mode === 'revealSel' || mode === 'hideSel') && !d.selection) { ed.toast('אין בחירה', 'error'); return; }
  const c = newCanvas(d.width, d.height), x = c.getContext('2d')!;
  if (mode === 'revealAll' || mode === 'hideSel') { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
  if (mode === 'revealSel') x.drawImage(d.selection!, 0, 0);
  if (mode === 'hideSel') { x.globalCompositeOperation = 'destination-out'; x.drawImage(d.selection!, 0, 0); }
  l.mask = { canvas: c, enabled: true };
  touch(l);
  ed.st!.maskEdit = true;
  // כמו בפוטושופ: הבחירה הופכת למסכה ונעלמת
  if (mode === 'revealSel' || mode === 'hideSel') { ed.st!.lastSelection = d.selection; d.selection = null; }
  ed.commit({ revealAll: 'Reveal All · מסכה', hideAll: 'Hide All · מסכה', revealSel: 'Reveal Selection · מסכה מהבחירה', hideSel: 'Hide Selection · מסכה מסתירה' }[mode]);
}

/** Ctrl+לחיצה על תמונת המסכה: המסכה (כפי שהיא חלה) כבחירה */
export function maskToSelection(ed: Editor, l: Layer, mode: SelMode = 'new') {
  const d = ed.doc!;
  if (!l.mask) return;
  ed.setSelection(combine(d, copyCanvas(effectiveMask(l.mask)), mode), 'טעינת מסכה כבחירה');
}

/** Density/Feather — שינוי רציף מסליידר נאסף לפעולה אחת בהיסטוריה */
export function setMaskProp(ed: Editor, l: Layer, key: 'density' | 'feather', v: number) {
  if (!l.mask) return;
  l.mask = { ...l.mask, [key]: v };
  touch(l);
  ed.softCommit(key === 'density' ? 'Mask Density · צפיפות מסכה' : 'Mask Feather · ריכוך מסכה');
}

/** גרירת תמונת מסכה לשכבה אחרת: העברה, או העתקה עם Alt */
export function moveMask(ed: Editor, fromId: string, toId: string, copy: boolean) {
  const d = ed.doc!;
  if (fromId === toId) return;
  const from = findLayer(d.layers, fromId)?.layer, to = findLayer(d.layers, toId)?.layer;
  if (!from?.mask || !to) return;
  const replaced = !!to.mask;
  to.mask = { ...from.mask };
  if (!copy) from.mask = null;
  touch(from); touch(to);
  ed.st!.selected = [to.id];
  ed.st!.active = to.id;
  ed.st!.maskEdit = true;
  ed.commit(copy ? 'העתקת מסכה' : 'העברת מסכה');
  if (replaced) ed.toast('המסכה הקודמת של השכבה הוחלפה');
}

/** Alt+לחיצה על המסכה = המסכה לבד בגווני אפור; \ = שכבת אדום מעל התמונה */
export function toggleMaskView(ed: Editor, l: Layer | null, mode: 'alone' | 'overlay') {
  if (!l?.mask) { if (ed.live.maskView) { ed.live.maskView = null; ed.redraw(false); ed.emit(); } else ed.toast('לשכבה אין מסכה'); return; }
  const mv = ed.live.maskView;
  ed.live.maskView = mv && mv.layerId === l.id && mv.mode === mode ? null : { layerId: l.id, mode };
  ed.status = ed.live.maskView ? (mode === 'alone' ? 'מציג את המסכה לבד · Alt+לחיצה על המסכה לחזרה' : 'Mask Overlay · \\ לכיבוי') : '';
  ed.redraw(false);
  ed.emit();
}

/* ---------- Select and Mask / Color Range: יישום התוצאה ---------- */

export type MaskOutput = 'selection' | 'mask' | 'newLayerMask';

export function applyRefined(ed: Editor, c: HTMLCanvasElement, out: MaskOutput) {
  const d = ed.doc!, l = ed.active;
  if (out === 'selection' || !l) { ed.setSelection(c, 'Select and Mask · בחירה ומסכה'); return; }
  if (out === 'mask') {
    l.mask = { ...(l.mask ?? { enabled: true }), canvas: c, enabled: true };
    touch(l);
    ed.st!.maskEdit = true;
    d.selection = null;
    ed.commit('Select and Mask · מסכת שכבה');
    return;
  }
  const f = findLayer(d.layers, l.id)!;
  const nl = cloneLayer(l, true);
  nl.name = `${l.name} עותק`;
  nl.mask = { canvas: c, enabled: true };
  l.visible = false;
  touch(l); touch(nl);
  f.parent.splice(f.index + 1, 0, nl);
  ed.st!.selected = [nl.id];
  ed.st!.active = nl.id;
  ed.st!.maskEdit = true;
  d.selection = null;
  ed.commit('Select and Mask · שכבה חדשה עם מסכה');
}

/* ---------- ניתוב פקודות ---------- */

export function runSelectCmd(ed: Editor, id: string): boolean {
  const d = ed.doc;
  if (!d) return false;
  const needSel = () => { if (!d.selection) { ed.toast('אין בחירה פעילה', 'error'); return false; } return true; };
  switch (id) {
    case 'select.quickMask': toggleQuickMask(ed); return true;
    case 'select.selectAndMask': {
      const a = ed.active;
      if (!d.selection && !(ed.st!.maskEdit && a?.mask)) { ed.toast('Select and Mask צריך בחירה פעילה (או מסכה נבחרת)', 'error'); return true; }
      ed.openDialog('selectMask');
      return true;
    }
    case 'select.colorRange': ed.openDialog('colorRange'); return true;
    case 'select.grow': if (needSel()) growOrSimilar(ed, true); return true;
    case 'select.similar': if (needSel()) growOrSimilar(ed, false); return true;
    case 'select.border': if (needSel()) ed.openDialog('selModify2', { op: 'border' }); return true;
    case 'select.smooth': if (needSel()) ed.openDialog('selModify2', { op: 'smooth' }); return true;
    case 'select.expand': if (needSel()) ed.openDialog('selModify', { op: 'expand' }); return true;
    case 'select.contract': if (needSel()) ed.openDialog('selModify', { op: 'contract' }); return true;
    case 'select.transform': startSelTransform(ed); return true;
    case 'select.save': if (needSel()) ed.openDialog('saveSel'); return true;
    case 'select.load': if (d.channels?.length) ed.openDialog('loadSel'); else ed.toast('אין בחירות שמורות במסמך · Select > Save Selection', 'error'); return true;
    case 'mask.overlay': toggleMaskView(ed, ed.active, 'overlay'); return true;
    case 'mask.toSelection': if (ed.active?.mask) maskToSelection(ed, ed.active); return true;
    case 'layer.maskRevealAll': addMaskMode(ed, 'revealAll'); return true;
    case 'layer.maskHideAll': addMaskMode(ed, 'hideAll'); return true;
    case 'layer.maskRevealSel': addMaskMode(ed, 'revealSel'); return true;
    case 'layer.maskHideSel': addMaskMode(ed, 'hideSel'); return true;
  }
  return false;
}
