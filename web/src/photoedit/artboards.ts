/**
 * Artboards (משטחי עבודה) — שכבת המודל. משטח עבודה = GroupLayer ברמה העליונה עם שדה artboard {x,y,w,h,bg}.
 * המסמך עצמו הוא ה-Pasteboard: width/height שלו = האיחוד של כל המשטחים (ושל תוכן שמונח על ה-Pasteboard),
 * ועוד שוליים קבועים. fitDocToArtboards מעדכן אותו בכל commit, כך שבחירות, מסכות וכל הכלים הקיימים
 * ממשיכים לעבוד במרחב המסמך הרגיל. כאן אין תלות בעורך (רק טיפוסים), כדי ש-io ו-render יוכלו לייבא.
 */
import type { ArtboardSpec, Doc, GroupLayer, Layer, Pt, Rect } from './model';
import { cloneLayer, ctx2d, findLayer, isXf, makeGroup, makeShape, newCanvas, touch, unionRect, walk } from './model';
import { contentBounds, layerBounds } from './render';
import { mapDocVectors } from './path-doc';

export type Artboard = GroupLayer & { artboard: ArtboardSpec };

/** מרווח בין משטחים שנוספים בכפתורי + (כמו בפוטושופ) */
export const AB_GAP = 100;
/** שוליים של ה-Pasteboard סביב המשטחים */
export const AB_PAD = 300;
/** תוכן על ה-Pasteboard נכנס לגבולות המסמך רק עד המרחק הזה מהמשטחים (כדי שתמונה ענקית לא תנפח את המסמך) */
const AB_REACH = 4000;

export const AB_PRESETS: Array<{ id: string; name: string; he: string; w: number; h: number }> = [
  { id: 'post', name: 'Instagram Post', he: 'פוסט', w: 1080, h: 1350 },
  { id: 'square', name: 'Square', he: 'ריבוע', w: 1080, h: 1080 },
  { id: 'story', name: 'Story', he: 'סטורי', w: 1080, h: 1920 },
  { id: 'landscape', name: 'Landscape', he: 'רוחבי', w: 1920, h: 1080 },
  { id: 'youtube', name: 'YouTube', he: 'יוטיוב', w: 1280, h: 720 },
];

export const presetOf = (w: number, h: number) => AB_PRESETS.find((p) => p.w === w && p.h === h) ?? null;

export const isArtboard = (l: Layer | null | undefined): l is Artboard => !!l && l.type === 'group' && !!l.artboard;
export const artboardsOf = (doc: Doc | null | undefined): Artboard[] => (doc ? doc.layers.filter(isArtboard) : []);
export const hasArtboards = (doc: Doc | null | undefined) => !!doc && doc.layers.some(isArtboard);
export const abRect = (a: Artboard): Rect => ({ x: a.artboard.x, y: a.artboard.y, w: a.artboard.w, h: a.artboard.h });
/** צבע המילוי של הרקע, או null לשקוף */
export const abFill = (bg: string): string | null => (bg === 'transparent' ? null : bg === 'white' ? '#ffffff' : bg === 'black' ? '#000000' : bg);

export function artboardsUnion(doc: Doc): Rect | null {
  let r: Rect | null = null;
  for (const a of artboardsOf(doc)) r = unionRect(r, abRect(a));
  return r;
}

const inRect = (p: Pt, r: Rect) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;
const expand = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
const contains = (o: Rect, i: Rect) => i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h;
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** המשטח העליון שמכיל את הנקודה */
export function artboardAt(doc: Doc, p: Pt, visibleOnly = true): Artboard | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (isArtboard(l) && (!visibleOnly || l.visible) && inRect(p, abRect(l))) return l;
  }
  return null;
}

/** המשטח שהשכבה נמצאת בתוכו (או המשטח עצמו) */
export function artboardOf(doc: Doc, id: string | null): Artboard | null {
  if (!id) return null;
  for (const l of doc.layers) {
    if (l.id === id) return isArtboard(l) ? l : null;
    if (isArtboard(l) && findLayer(l.children, id)) return l;
  }
  return null;
}

/** המשטח של השכבה הפעילה, ואם אין — הראשון. זה מה ש-Export As ו-Quick Export מייצאים */
export function activeArtboard(doc: Doc, activeId: string | null): Artboard | null {
  return artboardOf(doc, activeId) ?? artboardsOf(doc)[0] ?? null;
}

export function nextArtboardName(doc: Doc): string {
  let n = 1;
  walk(doc.layers, (l) => { const m = /^משטח עבודה (\d+)$/.exec(l.name); if (m) n = Math.max(n, Number(m[1]) + 1); });
  return `משטח עבודה ${n}`;
}

export function makeArtboard(r: Rect, name: string, bg = '#ffffff', children: Layer[] = []): Artboard {
  const g = makeGroup(children, name) as Artboard;
  g.artboard = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)), bg };
  return g;
}

export function setArtboardRect(a: Artboard, r: Partial<Rect>) {
  a.artboard = {
    ...a.artboard,
    ...(r.x != null ? { x: Math.round(r.x) } : {}), ...(r.y != null ? { y: Math.round(r.y) } : {}),
    ...(r.w != null ? { w: Math.max(1, Math.round(r.w)) } : {}), ...(r.h != null ? { h: Math.max(1, Math.round(r.h)) } : {}),
  };
  touch(a);
}

/** מקום פנוי למשטח בגודל w×h ליד המשטח a בכיוון dir (מדלגים על משטחים שכבר תופסים את המקום) */
export function adjacentRect(doc: Doc, a: Rect, dir: 'left' | 'right' | 'top' | 'bottom', w = a.w, h = a.h): Rect {
  const step = (r: Rect): Rect => dir === 'right' ? { x: r.x + r.w + AB_GAP, y: r.y, w, h }
    : dir === 'left' ? { x: r.x - AB_GAP - w, y: r.y, w, h }
    : dir === 'bottom' ? { x: r.x, y: r.y + r.h + AB_GAP, w, h }
    : { x: r.x, y: r.y - AB_GAP - h, w, h };
  let r = step(a);
  for (let i = 0; i < 50; i++) {
    const hit = artboardsOf(doc).find((b) => intersects(abRect(b), r));
    if (!hit) break;
    r = step(dir === 'right' || dir === 'bottom' ? { ...abRect(hit), w: hit.artboard.w, h: hit.artboard.h } : abRect(hit));
  }
  return r;
}

/* ---------- הזזת מסכות ותוכן (copy-on-write) ---------- */

/** צבע ברירת המחדל של מסכה מחוץ לתוכן שלה: לפי רוב הפינות (מסכה "חושפת" → לבן, "מסתירה" → שקוף) */
function maskDefaultWhite(c: HTMLCanvasElement): boolean {
  const x = ctx2d(c, true), w = c.width - 1, h = c.height - 1;
  let n = 0;
  for (const [px, py] of [[0, 0], [w, 0], [0, h], [w, h]]) if (x.getImageData(px, py, 1, 1).data[3] > 127) n++;
  return n >= 2;
}

/** מסכה במיקום חדש: קנבס בגודל w×h, המקור מצויר ב-(dx,dy), השטח שהתפנה בצבע ברירת המחדל של המסכה */
export function shiftMask(c: HTMLCanvasElement, dx: number, dy: number, w = c.width, h = c.height, white = maskDefaultWhite(c)): HTMLCanvasElement {
  const n = newCanvas(w, h), x = n.getContext('2d')!;
  if (white) { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.clearRect(dx, dy, c.width, c.height); }
  x.drawImage(c, dx, dy);
  return n;
}

/** הזזת עץ שכבות: מיקומים, מלבני משטחים ומסכות (לא נוגע בפיקסלים של השכבות) */
export function offsetTree(l: Layer, dx: number, dy: number) {
  walk([l], (n) => {
    if (isXf(n)) { n.t.x += dx; n.t.y += dy; }
    if (isArtboard(n)) n.artboard = { ...n.artboard, x: n.artboard.x + dx, y: n.artboard.y + dy };
    if (n.mask) n.mask = { ...n.mask, canvas: shiftMask(n.mask.canvas, dx, dy) };
    touch(n);
  });
  // מסכות וקטוריות (במרחב המסמך) זזות עם התוכן
  mapDocVectors(null, { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy }, [l], false);
}

/**
 * מזיז את כל המסמך ומשנה את גודלו (כמו Canvas Size, בלי commit): ox/oy = היסט, w/h = הגודל החדש.
 * מסכות מקבלות לבן בשטח החדש (כמו resizeCanvas), בחירה וערוצים — שקוף.
 */
export function shiftDoc(doc: Doc, w: number, h: number, ox: number, oy: number) {
  walk(doc.layers, (l) => {
    if (isXf(l)) { l.t.x += ox; l.t.y += oy; }
    if (isArtboard(l)) l.artboard = { ...l.artboard, x: l.artboard.x + ox, y: l.artboard.y + oy };
    if (l.mask) l.mask = { ...l.mask, canvas: shiftMask(l.mask.canvas, ox, oy, w, h, true) };
    touch(l);
  });
  doc.selection = doc.selection ? shiftMask(doc.selection, ox, oy, w, h, false) : null;
  doc.channels = doc.channels?.map((c) => ({ ...c, canvas: shiftMask(c.canvas, ox, oy, w, h, false) }));
  doc.guides = { v: doc.guides.v.map((g) => g + ox).filter((g) => g >= 0 && g <= w), h: doc.guides.h.map((g) => g + oy).filter((g) => g >= 0 && g <= h) };
  mapDocVectors(doc, { a: 1, b: 0, c: 0, d: 1, e: ox, f: oy });
  doc.width = w;
  doc.height = h;
}

/** תיבת התוכן של שכבה על ה-Pasteboard (שכבת פיקסלים ריקה לא נחשבת) */
function pasteboardBounds(l: Layer): Rect | null {
  if (!l.visible || isArtboard(l)) return null;
  if (l.type === 'raster' && !contentBounds(l.canvas)) return null;
  if (l.type === 'group') {
    let r: Rect | null = null;
    for (const c of l.children) { const b = pasteboardBounds(c); if (b) r = unionRect(r, b); }
    return r;
  }
  return layerBounds(l);
}

/** הגבולות שהמסמך צריך: איחוד המשטחים + תוכן ה-Pasteboard הקרוב, ועוד שוליים */
export function neededDocRect(doc: Doc): Rect | null {
  const u = artboardsUnion(doc);
  if (!u) return null;
  const reach = expand(u, AB_REACH);
  let r: Rect = { ...u };
  for (const l of doc.layers) {
    const b = pasteboardBounds(l);
    if (!b) continue;
    const x0 = Math.max(b.x, reach.x), y0 = Math.max(b.y, reach.y);
    const x1 = Math.min(b.x + b.w, reach.x + reach.w), y1 = Math.min(b.y + b.h, reach.y + reach.h);
    if (x1 > x0 && y1 > y0) r = unionRect(r, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  const e = expand(r, AB_PAD);
  const x = Math.floor(e.x), y = Math.floor(e.y);
  return { x, y, w: Math.ceil(e.x + e.w) - x, h: Math.ceil(e.y + e.h) - y };
}

/**
 * מתאים את גבולות המסמך למשטחים. יציב: לא משנה כלום כל עוד מה שצריך כבר בפנים והמסמך לא גדול ממנו
 * ביותר משוליים נוספים — כדי שהזזה קטנה לא תזיז את ראשית הצירים. מחזיר את ההיסט שבוצע (לתיקון התצוגה).
 */
export function fitDocToArtboards(doc: Doc): { ox: number; oy: number } | null {
  const need = neededDocRect(doc);
  if (!need) return null;
  const cur: Rect = { x: 0, y: 0, w: doc.width, h: doc.height };
  const slack = expand(need, AB_PAD);
  if (contains(cur, need) && contains(slack, cur)) return null;
  // גדילה: עדיף להרחיב את המסמך הנוכחי (הראשית לא זזה אם לא חייבים); אחרת בדיוק מה שצריך
  const grown = unionRect(cur, need);
  const next = contains(slack, grown) ? grown : need;
  const ox = -next.x, oy = -next.y;
  if (!ox && !oy && next.w === doc.width && next.h === doc.height) return null;
  shiftDoc(doc, next.w, next.h, ox, oy);
  return { ox, oy };
}

/* ---------- ייצוא ---------- */

/**
 * מסמך עצמאי בגודל המשטח, להעברה ל-exportBlob/renderDoc: עותק של המשטח (כקבוצה רגילה, עם רקע
 * כשכבת צורה וקטורית בתחתית — כך גם SVG נשאר וקטורי), מוזז לראשית הצירים. החיתוך = גבולות המסמך.
 */
export function artboardDoc(doc: Doc, a: Artboard, name = `${doc.name}-${a.name}`): Doc {
  const r = abRect(a);
  const g = cloneLayer(a) as GroupLayer;
  delete g.artboard;
  g.visible = true;
  walk([g], (n) => {
    if (isXf(n)) { n.t.x -= r.x; n.t.y -= r.y; }
    if (n.mask) n.mask = { ...n.mask, canvas: shiftMask(n.mask.canvas, -r.x, -r.y, r.w, r.h, true) };
  });
  const fill = abFill(a.artboard.bg);
  if (fill) {
    const bg = makeShape('rect', r.w / 2, r.h / 2, r.w, r.h, { type: 'solid', color: fill, color2: fill, angle: 0 }, { on: false, color: '#000000', width: 0 });
    bg.name = 'רקע המשטח';
    g.children = [bg, ...g.children];
  }
  return { ...doc, name, width: r.w, height: r.h, layers: [g], selection: null, channels: [], guides: { v: [], h: [] } };
}

/** לתמונה הממוזערת: רק המשטחים, חתוכים לאיחוד שלהם */
export function thumbSource(doc: Doc): { doc: Doc; crop: Rect } | null {
  const u = artboardsUnion(doc);
  if (!u) return null;
  return { doc: { ...doc, layers: artboardsOf(doc).filter((a) => a.visible) }, crop: u };
}

/* ---------- ציור על הקנבס (במרחב המסמך, אחרי הטרנספורם של התצוגה) ---------- */

let checker: HTMLCanvasElement | null = null;

/** צל רך, רקע לבן ולוח שחמט למשטחים שקופים — לפני הקומפוזיציה */
export function paintArtboardBackdrop(x: CanvasRenderingContext2D, doc: Doc, z: number, dx: number, dy: number) {
  for (const a of artboardsOf(doc)) {
    if (!a.visible) continue;
    const r = abRect(a), sx = dx + r.x * z, sy = dy + r.y * z, w = r.w * z, h = r.h * z;
    x.save();
    x.shadowColor = 'rgba(0,0,0,.55)';
    x.shadowBlur = 16;
    x.shadowOffsetY = 3;
    x.fillStyle = '#ffffff';
    x.fillRect(sx, sy, w, h);
    x.restore();
    if (!abFill(a.artboard.bg)) {
      if (!checker) {
        checker = newCanvas(16, 16);
        const c = checker.getContext('2d')!;
        c.fillStyle = '#ffffff'; c.fillRect(0, 0, 16, 16);
        c.fillStyle = '#cccccc'; c.fillRect(8, 0, 8, 8); c.fillRect(0, 8, 8, 8);
      }
      const pat = x.createPattern(checker, 'repeat')!;
      pat.setTransform(new DOMMatrix().translateSelf(sx, sy));
      x.fillStyle = pat;
      x.fillRect(sx, sy, w, h);
    }
  }
}

/** קו מתאר דק סביב כל משטח — אחרי הקומפוזיציה */
export function paintArtboardFrames(x: CanvasRenderingContext2D, doc: Doc, z: number, dx: number, dy: number) {
  x.lineWidth = 1;
  x.strokeStyle = 'rgba(255,255,255,.16)';
  for (const a of artboardsOf(doc)) {
    if (!a.visible) continue;
    const r = abRect(a);
    x.strokeRect(Math.round(dx + r.x * z) - 0.5, Math.round(dy + r.y * z) - 0.5, Math.round(r.w * z) + 1, Math.round(r.h * z) + 1);
  }
}

/** מלבן המסגרת שהתצוגה מתאימה אליו (Fit on Screen): כל המשטחים, או כל המסמך */
export function fitRect(doc: Doc): Rect {
  return artboardsUnion(doc) ?? { x: 0, y: 0, w: doc.width, h: doc.height };
}

/** נקודות הצמדה: קצוות ומרכזים של המשטחים (חוץ מהמוחרגים) */
export function artboardSnapTargets(doc: Doc, exclude: Set<string>): { xs: number[]; ys: number[] } {
  const xs: number[] = [], ys: number[] = [];
  for (const a of artboardsOf(doc)) {
    if (!a.visible || exclude.has(a.id)) continue;
    const r = abRect(a);
    xs.push(r.x, r.x + r.w / 2, r.x + r.w);
    ys.push(r.y, r.y + r.h / 2, r.y + r.h);
  }
  return { xs, ys };
}
