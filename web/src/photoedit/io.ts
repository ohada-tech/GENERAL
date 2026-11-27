/**
 * File Manager + Export Engine + Project Persistence.
 * פורמט הפרויקט (.photoedit, JSON): כל השכבות במבנה מלא — טקסט נשאר טקסט, צורות נשארות צורות, פיקסלים ומסכות כ-PNG.
 * שמירה בענן = השרת של AI Production AP (דיסק קבוע). שחזור אחרי קריסה = IndexedDB בדפדפן.
 */
import type { Doc, Layer, XfLayer } from './model';
import { ctx2d, isXf, newCanvas, rgba, uid } from './model';
import { layerMatrix, localSize, renderDoc, renderSingle, shapePath } from './render';
import { layoutText, verticalChars } from './text';
import { hasEffects } from './model';
import { thumbSource } from './artboards';

export const FORMAT = 'photoedit';
export const VERSION = 1;

/* ---------- קנבס <-> PNG ---------- */

const encCache = new WeakMap<HTMLCanvasElement, Promise<string>>();
export function encodeCanvas(c: HTMLCanvasElement): Promise<string> {
  const hit = encCache.get(c);
  if (hit) return hit;
  const p = new Promise<string>((resolve, reject) => {
    c.toBlob((b) => {
      if (!b) return reject(new Error('קידוד תמונה נכשל'));
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(b);
    }, 'image/png');
  });
  encCache.set(c, p);
  return p;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('לא הצלחתי לטעון את התמונה'));
    img.src = src;
  });
}

export async function decodeCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const img = await loadImage(dataUrl);
  const c = newCanvas(img.naturalWidth, img.naturalHeight);
  c.getContext('2d')!.drawImage(img, 0, 0);
  encCache.set(c, Promise.resolve(dataUrl));
  return c;
}

/** קובץ תמונה (כולל SVG) לקנבס בגודל המקורי. SVG בלי מידות מקבל רוחב ברירת מחדל */
export async function fileToCanvas(file: Blob, svgMin = 0): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let w = img.naturalWidth || 1000, h = img.naturalHeight || 1000;
    if (file.type === 'image/svg+xml' && svgMin && Math.max(w, h) < svgMin) { const k = svgMin / Math.max(w, h); w *= k; h *= k; }
    const c = newCanvas(w, h);
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function urlToCanvas(url: string): Promise<HTMLCanvasElement> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`טעינת התמונה נכשלה (${res.status})`);
  return fileToCanvas(await res.blob(), 2000);
}

/* ---------- סריאליזציה ---------- */

type SLayer = Record<string, any>;

async function serLayer(l: Layer): Promise<SLayer> {
  const out: SLayer = { ...l };
  if (l.mask) out.mask = { enabled: l.mask.enabled, density: l.mask.density ?? 1, feather: l.mask.feather ?? 0, png: await encodeCanvas(l.mask.canvas) };
  if (l.type === 'raster') { delete out.canvas; out.png = await encodeCanvas(l.canvas); }
  if (l.type === 'group') out.children = await Promise.all(l.children.map(serLayer));
  return out;
}

async function deLayer(s: SLayer): Promise<Layer> {
  const l = { ...s } as any;
  if (s.mask) {
    l.mask = { enabled: s.mask.enabled !== false, canvas: await decodeCanvas(s.mask.png) };
    // שדות חדשים (Density/Feather) — קבצים ישנים בלעדיהם נטענים כרגיל
    if (typeof s.mask.density === 'number' && s.mask.density < 1) l.mask.density = Math.max(0, s.mask.density);
    if (typeof s.mask.feather === 'number' && s.mask.feather > 0) l.mask.feather = s.mask.feather;
  }
  else l.mask = null;
  if (s.type === 'raster') { l.canvas = await decodeCanvas(s.png); delete l.png; }
  if (s.type === 'group') l.children = await Promise.all((s.children ?? []).map(deLayer));
  // משטח עבודה (נוסף אחרי הגרסה הראשונה): קבצים ישנים בלי השדה נטענים כקבוצה רגילה
  if (s.type === 'group') {
    const a = s.artboard;
    if (a && [a.x, a.y, a.w, a.h].every((v: unknown) => typeof v === 'number' && Number.isFinite(v)) && a.w > 0 && a.h > 0) {
      l.artboard = { x: Math.round(a.x), y: Math.round(a.y), w: Math.round(a.w), h: Math.round(a.h), bg: typeof a.bg === 'string' ? a.bg : '#ffffff' };
    } else delete l.artboard;
  }
  l.rev = Date.now() + Math.random();
  return l as Layer;
}

export async function serialize(doc: Doc) {
  return {
    format: FORMAT,
    version: VERSION,
    id: doc.id,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    dpi: doc.dpi,
    guides: doc.guides,
    fonts: doc.fonts,
    projectId: doc.projectId,
    serverId: doc.serverId,
    layers: await Promise.all(doc.layers.map(serLayer)),
    channels: await Promise.all((doc.channels ?? []).map(async (c) => ({ id: c.id, name: c.name, png: await encodeCanvas(c.canvas) }))),
  };
}

export async function deserialize(j: any): Promise<Doc> {
  if (!j || j.format !== FORMAT) throw new Error('זה לא קובץ PHOTOEDIT');
  for (const f of j.fonts ?? []) await registerFont(f.family, f.data).catch(() => undefined);
  return {
    id: j.id || uid(),
    name: j.name || 'ללא שם',
    width: j.width,
    height: j.height,
    dpi: j.dpi || 72,
    guides: j.guides ?? { v: [], h: [] },
    fonts: j.fonts ?? [],
    projectId: j.projectId ?? null,
    serverId: j.serverId ?? null,
    selection: null,
    layers: await Promise.all((j.layers ?? []).map(deLayer)),
    // ערוצי אלפא נוספו אחרי הגרסה הראשונה — קובץ בלי השדה נפתח עם רשימה ריקה
    channels: await Promise.all((Array.isArray(j.channels) ? j.channels : []).filter((c: any) => c && typeof c.png === 'string').map(async (c: any) => ({ id: c.id || uid(), name: c.name || 'Alpha', canvas: await decodeCanvas(c.png) }))),
  };
}

/* ---------- פונטים שהועלו ---------- */

export async function registerFont(family: string, dataUrl: string) {
  const buf = await (await fetch(dataUrl)).arrayBuffer();
  const face = new FontFace(family, buf);
  await face.load();
  document.fonts.add(face);
}

/* ---------- ייצוא ---------- */

export interface ExportOpts { format: 'png' | 'jpg' | 'webp' | 'svg'; quality: number; scale: number; transparent: boolean; bg: string }

export function exportCanvas(doc: Doc, o: Pick<ExportOpts, 'scale' | 'transparent' | 'bg' | 'format'>): HTMLCanvasElement {
  const comp = renderDoc(doc, { scale: o.scale });
  if (o.transparent && o.format !== 'jpg') return comp;
  const out = newCanvas(comp.width, comp.height), x = out.getContext('2d')!;
  x.fillStyle = o.bg || '#ffffff';
  x.fillRect(0, 0, out.width, out.height);
  x.drawImage(comp, 0, 0);
  return out;
}

export async function exportBlob(doc: Doc, o: ExportOpts): Promise<Blob> {
  if (o.format === 'svg') return new Blob([await exportSvg(doc, o)], { type: 'image/svg+xml' });
  const c = exportCanvas(doc, o);
  const type = o.format === 'jpg' ? 'image/jpeg' : o.format === 'webp' ? 'image/webp' : 'image/png';
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('הייצוא נכשל'))), type, o.quality));
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** SVG: טקסט וצורות נשארים וקטוריים; פיקסלים, אפקטים, מסכות ושכבות התאמה נכנסים כתמונה */
export async function exportSvg(doc: Doc, o: Pick<ExportOpts, 'transparent' | 'bg'>): Promise<string> {
  const parts: string[] = [];
  if (!o.transparent) parts.push(`<rect width="${doc.width}" height="${doc.height}" fill="${o.bg || '#fff'}"/>`);
  const simple = (l: Layer) => isXf(l) && !l.mask && !hasEffects(l.fx) && !l.clip;
  const hasAdjust = (ls: Layer[]): boolean => ls.some((l) => l.type === 'adjust' || (l.type === 'group' && hasAdjust(l.children)));
  if (hasAdjust(doc.layers)) {
    const png = await encodeCanvas(renderDoc(doc, { scale: 1 }));
    parts.push(`<image width="${doc.width}" height="${doc.height}" href="${png}"/>`);
  } else {
    const emit = async (ls: Layer[]) => {
      for (const l of ls) {
        if (!l.visible) continue;
        const op = l.opacity < 1 ? ` opacity="${l.opacity}"` : '';
        const blend = l.blend !== 'normal' ? ` style="mix-blend-mode:${l.blend}"` : '';
        if (l.type === 'group' && !l.mask && !hasEffects(l.fx)) {
          parts.push(`<g${op}${blend}>`);
          await emit(l.children);
          parts.push('</g>');
        } else if (simple(l)) parts.push(await svgLayer(l as XfLayer, op + blend));
        else parts.push(`<image width="${doc.width}" height="${doc.height}"${op}${blend} href="${await encodeCanvas(renderSingle(l, doc))}"/>`);
      }
    };
    await emit(doc.layers);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">\n${parts.join('\n')}\n</svg>\n`;
}

async function svgLayer(l: XfLayer, attrs: string): Promise<string> {
  const m = layerMatrix(l);
  const tf = `transform="matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})"`;
  if (l.type === 'raster') return `<image ${tf}${attrs} width="${l.canvas.width}" height="${l.canvas.height}" href="${await encodeCanvas(l.canvas)}"/>`;
  if (l.type === 'shape') {
    // הנתיב נבנה דרך Path2D-לוגיקה זהה לרינדור, ונכתב כ-SVG פשוט לפי סוג הצורה
    const { w, h } = localSize(l);
    const fill = l.fill.type === 'none' ? 'none' : l.fill.color;
    const stroke = l.stroke.on ? ` stroke="${l.stroke.color}" stroke-width="${l.stroke.width}"` : '';
    let grad = '';
    let fillRef = fill;
    if (l.fill.type === 'linear' || l.fill.type === 'radial') {
      const gid = `g${l.id.slice(0, 8)}`;
      const a = (l.fill.angle * Math.PI) / 180;
      grad = l.fill.type === 'linear'
        ? `<defs><linearGradient id="${gid}" x1="${0.5 - Math.cos(a) / 2}" y1="${0.5 + Math.sin(a) / 2}" x2="${0.5 + Math.cos(a) / 2}" y2="${0.5 - Math.sin(a) / 2}"><stop offset="0" stop-color="${l.fill.color}"/><stop offset="1" stop-color="${l.fill.color2}"/></linearGradient></defs>`
        : `<defs><radialGradient id="${gid}"><stop offset="0" stop-color="${l.fill.color}"/><stop offset="1" stop-color="${l.fill.color2}"/></radialGradient></defs>`;
      fillRef = `url(#${gid})`;
    }
    let el: string;
    if (l.shape === 'rect') el = `<rect width="${w}" height="${h}" rx="${Math.min(l.radius, w / 2, h / 2)}" fill="${fillRef}"${stroke}/>`;
    else if (l.shape === 'ellipse') el = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fillRef}"${stroke}/>`;
    else if (l.shape === 'line') el = `<line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="${l.fill.type === 'none' ? l.stroke.color : l.fill.color}" stroke-width="${Math.max(1, h)}" stroke-linecap="round"/>`;
    else {
      const pts: string[] = [];
      const rec = { moveTo: (x: number, y: number) => pts.push(`${x},${y}`), lineTo: (x: number, y: number) => pts.push(`${x},${y}`), beginPath() {}, closePath() {}, rect() {}, roundRect() {}, ellipse() {} };
      shapePath(rec as unknown as CanvasRenderingContext2D, l);
      el = `<polygon points="${pts.join(' ')}" fill="${fillRef}"${stroke}/>`;
    }
    return `${grad}<g ${tf}${attrs}>${el}</g>`;
  }
  const L = layoutText(l), s = l.style;
  if (L.vertical) {
    // טקסט אנכי: תו לכל tspan, ממורכז בעמודה — כמו ברינדור על הקנבס
    const adv = L.adv ?? s.size;
    const spans = L.lines.flatMap((col, i) => verticalChars(col).map((ch, k) => `<tspan x="${L.w - (i + 0.5) * L.lineH}" y="${(k + 0.5) * adv}">${esc(ch)}</tspan>`));
    return `<text ${tf}${attrs} text-anchor="middle" dominant-baseline="central" font-family="${esc(s.family)}" font-size="${s.size}" font-weight="${s.weight}"${s.italic ? ' font-style="italic"' : ''} fill="${s.color}">${spans.join('')}</text>`;
  }
  const anchor = s.align === 'center' ? 'middle' : (s.align === 'right') === (s.dir === 'rtl') ? 'start' : 'end';
  const x = s.align === 'center' ? L.w / 2 : s.align === 'left' ? 0 : s.align === 'right' ? L.w : s.dir === 'rtl' ? L.w : 0;
  const spans = L.lines.map((line, i) => {
    const base = i * L.lineH + (L.lineH - (L.ascent + L.descent)) / 2 + L.ascent;
    return `<tspan x="${x}" y="${base}">${esc(line)}</tspan>`;
  });
  const deco = s.underline ? ' text-decoration="underline"' : '';
  return `<text ${tf}${attrs} direction="${s.dir}" text-anchor="${anchor}" font-family="${esc(s.family)}" font-size="${s.size}" font-weight="${s.weight}"${s.italic ? ' font-style="italic"' : ''} letter-spacing="${L.spacing}" fill="${s.color}"${deco}>${spans.join('')}</text>`;
}

/** תמונה ממוזערת לרשימת המסמכים */
export function thumbBlob(doc: Doc, max = 360): Promise<Blob> {
  // מסמך עם משטחי עבודה: כל המשטחים (בלי ה-Pasteboard), על רקע אפור כמו בסביבת העבודה
  const ab = thumbSource(doc);
  if (ab) {
    const { crop } = ab;
    const k = Math.min(1, max / Math.max(crop.w, crop.h));
    const c = renderDoc(ab.doc, { scale: k });
    const out = newCanvas(crop.w * k, crop.h * k), x = out.getContext('2d')!;
    x.fillStyle = '#2b2c31';
    x.fillRect(0, 0, out.width, out.height);
    x.drawImage(c, -crop.x * k, -crop.y * k);
    return new Promise((resolve) => out.toBlob((b) => resolve(b ?? new Blob()), 'image/png'));
  }
  const k = Math.min(1, max / Math.max(doc.width, doc.height));
  const c = renderDoc(doc, { scale: k });
  const out = newCanvas(c.width, c.height), x = out.getContext('2d')!;
  const s = 8;
  for (let yy = 0; yy < out.height; yy += s) for (let xx = 0; xx < out.width; xx += s) { x.fillStyle = (xx / s + yy / s) % 2 ? '#d9d9d9' : '#f4f4f4'; x.fillRect(xx, yy, s, s); }
  x.drawImage(c, 0, 0);
  return new Promise((resolve) => out.toBlob((b) => resolve(b ?? new Blob()), 'image/png'));
}

/* ---------- ענן (שרת המערכת) ---------- */

export interface CloudDoc { id: string; projectId: string | null; name: string; width: number; height: number; size: number; updatedAt: string; thumbUrl: string }

async function json<T>(res: Response): Promise<T> {
  const t = await res.text();
  const d = t ? JSON.parse(t) : undefined;
  if (!res.ok) throw new Error(d?.error ?? `שגיאה ${res.status}`);
  return d as T;
}

export const cloud = {
  async list(projectId?: string | null): Promise<CloudDoc[]> {
    const r = await fetch(`/api/photoedit/docs${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`);
    return (await json<{ docs: CloudDoc[] }>(r)).docs;
  },
  async load(id: string): Promise<Doc> {
    const r = await fetch(`/api/photoedit/docs/${id}`);
    const doc = await deserialize(await json(r));
    doc.serverId = id;
    return doc;
  },
  async save(doc: Doc): Promise<CloudDoc> {
    const body = JSON.stringify(await serialize(doc));
    const fd = new FormData();
    if (doc.serverId) fd.append('id', doc.serverId);
    fd.append('name', doc.name);
    if (doc.projectId) fd.append('projectId', doc.projectId);
    fd.append('width', String(doc.width));
    fd.append('height', String(doc.height));
    fd.append('doc', new Blob([body], { type: 'application/json' }), 'doc.photoedit');
    fd.append('thumb', await thumbBlob(doc), 'thumb.png');
    return json<CloudDoc>(await fetch('/api/photoedit/docs', { method: 'POST', body: fd }));
  },
  async remove(id: string) {
    await json(await fetch(`/api/photoedit/docs/${id}`, { method: 'DELETE' }));
  },
  async sources(projectId: string): Promise<{ project: { id: string; name: string }; images: Array<{ id: string; label: string; group: string; url: string }> }> {
    return json(await fetch(`/api/photoedit/sources/${projectId}`));
  },
  async projects(): Promise<Array<{ id: string; name: string; clientName?: string }>> {
    const d = await json<{ projects: Array<{ id: string; name: string; clientName?: string }> }>(await fetch('/api/dashboard'));
    return d.projects;
  },
  /** התוצאה חוזרת לפרויקט כקובץ (kind=photoedit) דרך נתיב הנכסים הקיים */
  async sendToProject(projectId: string, blob: Blob, filename: string) {
    const fd = new FormData();
    fd.append('file', new File([blob], filename, { type: blob.type }));
    return json<{ id: string }>(await fetch(`/api/projects/${projectId}/assets?kind=photoedit`, { method: 'POST', body: fd }));
  },
};

/* ---------- שחזור מקומי (IndexedDB) ---------- */

const DB = 'photoedit';
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('recovery', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export interface RecoveryEntry { id: string; name: string; time: number; data: string }

export const recovery = {
  async put(doc: Doc) {
    try {
      const data = JSON.stringify(await serialize(doc));
      const db = await idb();
      await new Promise<void>((res, rej) => {
        const tx = db.transaction('recovery', 'readwrite');
        tx.objectStore('recovery').put({ id: doc.id, name: doc.name, time: Date.now(), data } satisfies RecoveryEntry);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    } catch { /* אחסון חסום — ממשיכים בלי שחזור מקומי */ }
  },
  async list(): Promise<RecoveryEntry[]> {
    try {
      const db = await idb();
      return await new Promise((res) => {
        const r = db.transaction('recovery').objectStore('recovery').getAll();
        r.onsuccess = () => res((r.result as RecoveryEntry[]).sort((a, b) => b.time - a.time));
        r.onerror = () => res([]);
      });
    } catch { return []; }
  },
  async remove(id: string) {
    try {
      const db = await idb();
      db.transaction('recovery', 'readwrite').objectStore('recovery').delete(id);
    } catch { /* */ }
  },
};

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const safeName = (s: string) => (s || 'photoedit').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'photoedit';

export { rgba, ctx2d };
