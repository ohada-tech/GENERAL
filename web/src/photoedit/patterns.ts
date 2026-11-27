/**
 * דפוסים (Patterns) — לחותמת הדוגמה ול-Edit > Fill. כמה דפוסים מובנים שנוצרים בקוד,
 * ודפוסים של המשתמש מ-Edit > Define Pattern (מהבחירה או מהשכבה). דפוסי המשתמש נשמרים בדפדפן.
 */
import type { Editor } from './editor';
import type { RasterLayer } from './model';
import { copyCanvas, ctx2d, isXf, newCanvas, touch } from './model';
import { layerMatrix } from './render';
import { selBounds } from './selection';
import { patternPixels, type PatternKind } from './pixel-algo';

export interface Pattern { id: string; name: string; canvas: HTMLCanvasElement }

const BUILTIN: Array<{ id: PatternKind; name: string; size: number; c1: [number, number, number]; c2: [number, number, number] }> = [
  { id: 'checker', name: 'שחמט · Checkerboard', size: 32, c1: [255, 255, 255], c2: [204, 204, 204] },
  { id: 'dots', name: 'נקודות · Dots', size: 24, c1: [255, 255, 255], c2: [40, 40, 48] },
  { id: 'stripes', name: 'פסים אלכסוניים · Stripes', size: 24, c1: [255, 214, 10], c2: [28, 28, 30] },
  { id: 'grid', name: 'רשת · Grid', size: 32, c1: [255, 255, 255], c2: [0, 122, 255] },
  { id: 'bricks', name: 'לבנים · Bricks', size: 48, c1: [178, 74, 52], c2: [232, 226, 214] },
  { id: 'noise', name: 'רעש · Noise', size: 64, c1: [40, 40, 40], c2: [215, 215, 215] },
];

let cache: Pattern[] | null = null;
const user: Pattern[] = [];
const STORE = 'photoedit.patterns.v1';
let loaded = false;

function builtins(): Pattern[] {
  if (cache) return cache;
  cache = BUILTIN.map((b) => {
    const c = newCanvas(b.size, b.size);
    const px = patternPixels(b.id, b.size, b.c1, b.c2);
    ctx2d(c).putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, b.size, b.size), 0, 0);
    return { id: b.id, name: b.name, canvas: c };
  });
  return cache;
}

function loadUser() {
  if (loaded) return;
  loaded = true;
  try {
    const list = JSON.parse(localStorage.getItem(STORE) || '[]') as Array<{ id: string; name: string; url: string }>;
    for (const p of list) {
      const img = new Image();
      const c = newCanvas(1, 1);
      const pat: Pattern = { id: p.id, name: p.name, canvas: c };
      img.onload = () => { c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d')!.drawImage(img, 0, 0); };
      img.src = p.url;
      user.push(pat);
    }
  } catch { /* אין אחסון — רק דפוסים מובנים */ }
}

function saveUser() {
  try { localStorage.setItem(STORE, JSON.stringify(user.slice(-12).map((p) => ({ id: p.id, name: p.name, url: p.canvas.toDataURL('image/png') })))); } catch { /* מלא — נשאר לסשן */ }
}

export function listPatterns(): Pattern[] { loadUser(); return [...builtins(), ...user]; }
export function getPattern(id: string): Pattern { return listPatterns().find((p) => p.id === id) ?? builtins()[0]; }

/** Edit > Define Pattern: מהבחירה (המלבן שתוחם אותה) בשכבה הפעילה, או מכל תוכן השכבה */
export function definePattern(ed: Editor): Pattern | null {
  const d = ed.doc!, a = ed.active;
  if (!a || !isXf(a)) { ed.toast('בחר שכבת פיקסלים, טקסט או צורה', 'error'); return null; }
  const px = ed.selectedPixels(a, d.selection);
  if (!px) return null;
  const b = d.selection ? selBounds(d.selection) : selBounds(px);
  if (!b || b.w < 1 || b.h < 1) { ed.toast('אין פיקסלים להגדרת דפוס', 'error'); return null; }
  if (b.w * b.h > 2048 * 2048) { ed.toast('הדפוס גדול מדי (עד 2048×2048)', 'error'); return null; }
  const c = newCanvas(b.w, b.h);
  c.getContext('2d')!.drawImage(px, -b.x, -b.y);
  loadUser();
  const p: Pattern = { id: `user-${Date.now().toString(36)}`, name: `דפוס ${user.length + 1} (${b.w}×${b.h})`, canvas: c };
  user.push(p);
  saveUser();
  ed.opts.patternStamp.pattern = p.id;
  ed.toast(`הדפוס הוגדר: ${p.name}`, 'ok');
  ed.emit();
  return p;
}

/** Edit > Fill > Pattern: ממלא את הבחירה (או את כל השכבה) בדפוס, באטימות */
export function fillPattern(ed: Editor, id: string, opacity: number) {
  const d = ed.doc!;
  let l = ed.active;
  if (l?.locked) { ed.toast('השכבה נעולה', 'error'); return; }
  if (!l || l.type !== 'raster') l = ed.newLayer();
  const r = l as RasterLayer;
  ed.ensureCoverage(r);
  const tmp = newCanvas(d.width, d.height), tx = tmp.getContext('2d')!;
  tx.globalAlpha = opacity;
  tx.fillStyle = tx.createPattern(getPattern(id).canvas, 'repeat')!;
  tx.fillRect(0, 0, d.width, d.height);
  if (d.selection) { tx.globalAlpha = 1; tx.globalCompositeOperation = 'destination-in'; tx.drawImage(d.selection, 0, 0); }
  const c = copyCanvas(r.canvas), x = c.getContext('2d')!;
  x.setTransform(layerMatrix(r).inverse());
  x.drawImage(tmp, 0, 0);
  r.canvas = c;
  touch(r);
  ed.commit('מילוי בדפוס');
}
