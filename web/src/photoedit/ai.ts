/**
 * כלי ה-AI של PHOTOEDIT:
 *  - Remove Background (Layer / Properties) ו-Select Subject: מודל סגמנטציה שרץ בדפדפן עצמו (@imgly/background-removal,
 *    ONNX). התמונה לא יוצאת מהמחשב, אין עלות. המודל (~40MB) נטען בפעם הראשונה ונשמר במטמון של הדפדפן.
 *    הסרת רקע היא לא הרסנית — היא מוסיפה מסכת שכבה, כמו בפוטושופ.
 *  - Generative Fill: החיתוך סביב הבחירה נשלח לשרת (/api/photoedit/ai/fill) — OpenAI עם מסכה, או Nano Banana Pro
 *    בהיגספילד דרך העובד המקומי. התוצאה חוזרת כשכבה עם מסכה מהבחירה; כמה וריאציות = קבוצה, אחת גלויה.
 */
import type { Editor, DocState } from './editor';
import type { Doc, GroupLayer, Layer, RasterLayer, Rect } from './model';
import { copyCanvas, makeGroup, makeRaster, newCanvas, touch } from './model';
import { layerBounds, renderDoc, renderSingle } from './render';
import { alphaOf, canvasFromAlpha } from './select-ops';
import { selBounds } from './selection';

/* ---------- מצב משותף לתצוגה ---------- */

export interface FillJob {
  id: string;
  engine: FillEngine;
  prompt: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'canceled';
  error: string;
  cost: string;
  st: DocState;
  rect: Rect;
  selection: HTMLCanvasElement;
  startedAt: number;
}
export type FillEngine = 'openai' | 'higgsfield';

export const ai = {
  /** פעולה מקומית שרצה עכשיו (טעינת מודל / סגמנטציה) */
  busy: null as null | { label: string; pct: number | null },
  jobs: [] as FillJob[],
};

/* ---------- סגמנטציה מקומית ---------- */

async function toBlob(c: HTMLCanvasElement) {
  return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('לא הצלחתי לקודד את התמונה'))), 'image/png'));
}

/** מסכת אלפא של הנושא בתמונה (בגודל התמונה) */
export async function segment(ed: Editor, src: HTMLCanvasElement): Promise<Uint8ClampedArray> {
  const setBusy = (label: string, pct: number | null) => { ai.busy = { label, pct }; ed.emit(); };
  setBusy('טוען את מודל ההפרדה…', null);
  try {
    const { removeBackground } = await import('@imgly/background-removal');
    // רקע לבן מאחורי פיקסלים שקופים — המודל לא אוהב שקיפות
    const flat = newCanvas(src.width, src.height), fx = flat.getContext('2d')!;
    fx.fillStyle = '#fff';
    fx.fillRect(0, 0, flat.width, flat.height);
    fx.drawImage(src, 0, 0);
    const out = await removeBackground(await toBlob(flat), {
      model: 'isnet_fp16',
      output: { format: 'image/png', quality: 1 },
      progress: (key: string, cur: number, total: number) => {
        if (key.startsWith('fetch')) setBusy('מוריד את מודל ההפרדה (פעם ראשונה בלבד)…', total ? Math.round((cur / total) * 100) : null);
        else setBusy('מפריד את הנושא מהרקע…', null);
      },
    });
    setBusy('מפריד את הנושא מהרקע…', null);
    const bmp = await createImageBitmap(out);
    const c = newCanvas(src.width, src.height);
    c.getContext('2d')!.drawImage(bmp, 0, 0, src.width, src.height);
    bmp.close();
    const a = alphaOf(c), sa = alphaOf(src);
    // לא מעבר לפיקסלים שקיימים במקור
    for (let i = 0; i < a.length; i++) a[i] = Math.min(a[i], sa[i]);
    return a;
  } finally {
    ai.busy = null;
    ed.emit();
  }
}

const docRect = (d: Doc): Rect => ({ x: 0, y: 0, w: d.width, h: d.height });
function intersect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 - x0 >= 1 && y1 - y0 >= 1 ? { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) } : null;
}
function crop(c: HTMLCanvasElement, r: Rect) {
  const o = newCanvas(r.w, r.h);
  o.getContext('2d')!.drawImage(c, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return o;
}

/** Layer > Remove Background: מסכת שכבה מהנושא (משולבת עם מסכה קיימת) */
export async function removeBackgroundCmd(ed: Editor) {
  const d = ed.doc, l = ed.active;
  if (!d || !l) return ed.toast('בחר שכבה', 'error');
  if (l.type === 'adjust' || l.type === 'group') return ed.toast('הסרת רקע עובדת על שכבת תמונה', 'error');
  if (ai.busy) return;
  const b = intersect(layerBounds(l) ?? docRect(d), docRect(d));
  if (!b) return ed.toast('השכבה מחוץ למסמך', 'error');
  try {
    const src = crop(renderSingle(l, d), b);
    const a = await segment(ed, src);
    if (ed.doc !== d || !findIn(d.layers, l)) return;
    const m = newCanvas(d.width, d.height), x = m.getContext('2d')!;
    x.drawImage(canvasFromAlpha(a, b.w, b.h), b.x, b.y);
    if (l.mask) { x.globalCompositeOperation = 'destination-in'; x.drawImage(l.mask.canvas, 0, 0); }
    l.mask = { canvas: m, enabled: true, density: l.mask?.density, feather: l.mask?.feather };
    touch(l);
    ed.commit('הסרת רקע · Remove Background');
    ed.toast('הרקע הוסר (מסכת שכבה — אפשר לתקן במברשת)', 'ok');
  } catch (e) {
    ed.toast(`הסרת הרקע נכשלה: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

/** Select > Subject: בחירה של הנושא מכל השכבות הגלויות */
export async function selectSubjectCmd(ed: Editor) {
  const d = ed.doc;
  if (!d || ai.busy) return;
  try {
    const a = await segment(ed, renderDoc(d, { scale: 1 }));
    if (ed.doc !== d) return;
    let any = false;
    for (let i = 0; i < a.length; i += 7) if (a[i] > 127) { any = true; break; }
    if (!any) return ed.toast('לא נמצא נושא בתמונה', 'error');
    ed.setSelection(canvasFromAlpha(a, d.width, d.height), 'בחירת נושא · Select Subject');
  } catch (e) {
    ed.toast(`בחירת הנושא נכשלה: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

function findIn(ls: Layer[], t: Layer): boolean {
  return ls.some((l) => l === t || (l.type === 'group' && findIn(l.children, t)));
}

/* ---------- Generative Fill ---------- */

const OPENAI = [{ a: 1, size: '1024x1024', w: 1024, h: 1024 }, { a: 1.5, size: '1536x1024', w: 1536, h: 1024 }, { a: 2 / 3, size: '1024x1536', w: 1024, h: 1536 }];
const HF = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '4:5', '5:4', '21:9'].map((s) => { const [w, h] = s.split(':').map(Number); return { s, a: w / h }; });

/** אזור החיתוך: הבחירה + שוליים להקשר, ביחס הגובה-רוחב שהמנוע תומך בו, בתוך המסמך ככל האפשר */
export function planCrop(d: Doc, sel: Rect, ratios: number[]) {
  const pad = Math.max(48, 0.4 * Math.max(sel.w, sel.h));
  const b = intersect({ x: sel.x - pad, y: sel.y - pad, w: sel.w + 2 * pad, h: sel.h + 2 * pad }, docRect(d)) ?? sel;
  const want = b.w / b.h;
  const a = ratios.reduce((best, r) => (Math.abs(Math.log(r / want)) < Math.abs(Math.log(best / want)) ? r : best), ratios[0]);
  let w = b.w, h = b.h;
  if (w / h < a) w = h * a; else h = w / a;
  const place = (c: number, len: number, max: number) => (len <= max ? Math.min(Math.max(0, c - len / 2), max - len) : (max - len) / 2);
  const x = place(b.x + b.w / 2, w, d.width), y = place(b.y + b.h / 2, h, d.height);
  return { rect: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }, ratio: a };
}

/** הבחירה בתוך אזור החיתוך, בקנה מידה של התמונה שנשלחת */
function selIn(sel: HTMLCanvasElement, r: Rect, W: number, H: number) {
  const c = newCanvas(W, H);
  c.getContext('2d')!.drawImage(sel, r.x, r.y, r.w, r.h, 0, 0, W, H);
  return c;
}

export async function engines(): Promise<{ openai: { ready: boolean; model: string; note: string; cost: Record<string, string>; usd: Record<string, number> }; higgsfield: { ready: boolean; model: string; note: string; cost: string; credits: number; usdPerCredit: number } }> {
  const r = await fetch('/api/photoedit/ai/engines');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** שולח ג'וב ומחזיר מיד; התוצאה נכנסת לבד כשהיא מוכנה */
export async function generativeFill(ed: Editor, o: { engine: FillEngine; prompt: string; n: number; quality: 'low' | 'medium' | 'high' }) {
  const d = ed.doc, st = ed.st;
  if (!d || !st || !d.selection) throw new Error('צריך בחירה');
  const sb = selBounds(d.selection);
  if (!sb) throw new Error('הבחירה ריקה');
  const comp = renderDoc(d, { scale: 1 });
  const fd = new FormData();
  fd.append('engine', o.engine);
  fd.append('prompt', o.prompt);
  fd.append('n', String(o.n));
  fd.append('quality', o.quality);
  let rect: Rect;
  if (o.engine === 'openai') {
    const p = planCrop(d, sb, OPENAI.map((x) => x.a));
    rect = p.rect;
    const s = OPENAI.find((x) => x.a === p.ratio)!;
    const img = newCanvas(s.w, s.h), ix = img.getContext('2d')!;
    ix.imageSmoothingQuality = 'high';
    ix.drawImage(comp, rect.x, rect.y, rect.w, rect.h, 0, 0, s.w, s.h);
    // מסכה של OpenAI: שקוף = לערוך. הבחירה, וגם כל מה שמחוץ למסמך
    const mask = newCanvas(s.w, s.h), mx = mask.getContext('2d')!;
    mx.fillStyle = '#000';
    mx.fillRect(0, 0, s.w, s.h);
    mx.globalCompositeOperation = 'destination-out';
    mx.drawImage(selIn(d.selection, rect, s.w, s.h), 0, 0);
    const kx = s.w / rect.w, ky = s.h / rect.h;
    if (rect.x < 0) mx.fillRect(0, 0, -rect.x * kx, s.h);
    if (rect.y < 0) mx.fillRect(0, 0, s.w, -rect.y * ky);
    if (rect.x + rect.w > d.width) mx.fillRect((d.width - rect.x) * kx, 0, s.w, s.h);
    if (rect.y + rect.h > d.height) mx.fillRect(0, (d.height - rect.y) * ky, s.w, s.h);
    fd.append('size', s.size);
    fd.append('image', await toBlob(img), 'image.png');
    fd.append('mask', await toBlob(mask), 'mask.png');
  } else {
    const p = planCrop(d, sb, HF.map((x) => x.a));
    rect = p.rect;
    const k = Math.min(1, 2048 / Math.max(rect.w, rect.h));
    const W = Math.max(1, Math.round(rect.w * k)), H = Math.max(1, Math.round(rect.h * k));
    const img = newCanvas(W, H), ix = img.getContext('2d')!;
    ix.fillStyle = '#fff';
    ix.fillRect(0, 0, W, H);
    ix.imageSmoothingQuality = 'high';
    ix.drawImage(comp, rect.x, rect.y, rect.w, rect.h, 0, 0, W, H);
    // תמונת עזר: האזור לעריכה באדום חצי-שקוף, עם קו מתאר
    const red = selIn(d.selection, rect, W, H), rx = red.getContext('2d')!;
    rx.globalCompositeOperation = 'source-in';
    rx.fillStyle = '#ff1a1a';
    rx.fillRect(0, 0, W, H);
    const hint = copyCanvas(img), hx = hint.getContext('2d')!;
    hx.globalAlpha = 0.55;
    hx.drawImage(red, 0, 0);
    fd.append('aspect', HF.find((x) => x.a === p.ratio)!.s);
    fd.append('image', await toBlob(img), 'image.png');
    fd.append('hint', await toBlob(hint), 'hint.png');
  }
  const res = await fetch('/api/photoedit/ai/fill', { method: 'POST', body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || j.message || `HTTP ${res.status}`);
  const job: FillJob = { id: j.id, engine: o.engine, prompt: o.prompt, status: j.status, error: '', cost: j.cost, st, rect, selection: d.selection, startedAt: Date.now() };
  ai.jobs.push(job);
  ed.emit();
  void poll(ed, job);
  return job;
}

async function poll(ed: Editor, job: FillJob) {
  for (;;) {
    await new Promise((r) => setTimeout(r, job.engine === 'openai' ? 2500 : 5000));
    if (job.status === 'canceled') return;
    let j: { status: FillJob['status']; error: string; outputs: string[] };
    try {
      const r = await fetch(`/api/photoedit/ai/jobs/${job.id}`);
      if (!r.ok) continue;
      j = await r.json();
    } catch { continue; }
    if (j.status !== job.status) { job.status = j.status; ed.emit(); }
    if (j.status === 'done') { await place(ed, job, j.outputs); return; }
    if (j.status === 'failed' || j.status === 'canceled') {
      job.error = j.error;
      ed.emit();
      if (j.status === 'failed') ed.toast(`Generative Fill נכשל: ${j.error || 'שגיאה לא ידועה'}`, 'error');
      return;
    }
  }
}

export async function cancelJob(ed: Editor, job: FillJob) {
  try { await fetch(`/api/photoedit/ai/jobs/${job.id}`, { method: 'DELETE' }); } catch {}
  job.status = 'canceled';
  ai.jobs = ai.jobs.filter((x) => x !== job);
  ed.emit();
}

export function dismissJob(ed: Editor, job: FillJob) { ai.jobs = ai.jobs.filter((x) => x !== job); ed.emit(); }

async function loadImage(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return createImageBitmap(await r.blob());
}

/** התוצאות נכנסות כשכבות עם מסכה מהבחירה, מעל השכבה שהייתה פעילה */
async function place(ed: Editor, job: FillJob, urls: string[]) {
  try {
    const st = job.st;
    const i = ed.docs.indexOf(st);
    if (i < 0) { ed.toast('המסמך נסגר לפני שהתוצאה הגיעה', 'error'); return; }
    if (ed.st !== st) ed.switchTo(i);
    const d = st.doc;
    const r = job.rect;
    const name = job.prompt.trim() ? job.prompt.trim().slice(0, 40) : 'מילוי גנרטיבי';
    const layers: RasterLayer[] = [];
    for (const [k, u] of urls.entries()) {
      const bmp = await loadImage(u);
      const c = newCanvas(r.w, r.h), x = c.getContext('2d')!;
      x.imageSmoothingQuality = 'high';
      x.drawImage(bmp, 0, 0, r.w, r.h);
      bmp.close();
      const l = makeRaster(urls.length > 1 ? `וריאציה ${k + 1}` : `✨ ${name}`, c, r.x + r.w / 2, r.y + r.h / 2);
      l.mask = { canvas: copyCanvas(job.selection), enabled: true };
      if (k > 0) l.visible = false;
      layers.push(l);
    }
    if (!layers.length) return;
    let top: Layer = layers[0];
    if (layers.length > 1) {
      const g = makeGroup(layers.reverse(), `✨ ${name}`) as GroupLayer;
      g.gen = { prompt: job.prompt, engine: job.engine };
      top = g;
    }
    ed.insert(top);
    ed.commit('Generative Fill');
    ed.toast(layers.length > 1 ? `Generative Fill מוכן · ${layers.length} וריאציות (החלפה בסרגל למעלה)` : 'Generative Fill מוכן', 'ok');
  } catch (e) {
    ed.toast(`לא הצלחתי לטעון את התוצאה: ${e instanceof Error ? e.message : String(e)}`, 'error');
  } finally {
    ai.jobs = ai.jobs.filter((x) => x !== job);
    ed.emit();
  }
}

/** קבוצת וריאציות של Generative Fill שהשכבה הפעילה שייכת אליה */
export function genGroupOf(ed: Editor): GroupLayer | null {
  const d = ed.doc, a = ed.active;
  if (!d || !a) return null;
  if (a.type === 'group' && a.gen) return a;
  const walk = (ls: Layer[]): GroupLayer | null => {
    for (const l of ls) if (l.type === 'group') { if (l.gen && l.children.includes(a)) return l; const r = walk(l.children); if (r) return r; }
    return null;
  };
  return walk(d.layers);
}

/** מעבר בין וריאציות: אחת גלויה בכל רגע */
export function showVariant(ed: Editor, g: GroupLayer, i: number) {
  const n = g.children.length;
  // בפאנל השכבות הראשונה למעלה = האחרונה במערך
  const idx = ((i % n) + n) % n;
  g.children.forEach((c, k) => { c.visible = k === n - 1 - idx; touch(c); });
  touch(g);
  ed.commit('בחירת וריאציה');
}
export const variantIndex = (g: GroupLayer) => { const n = g.children.length; const k = g.children.findIndex((c) => c.visible); return k < 0 ? 0 : n - 1 - k; };

/** פקודות ה-AI (Editor.run מעביר לכאן) */
export function runAiCmd(ed: Editor, id: string): boolean {
  switch (id) {
    case 'edit.generativeFill':
      if (!ed.doc?.selection) { ed.toast('קודם לבחור אזור — Generative Fill ממלא את הבחירה', 'error'); return true; }
      ed.openDialog('genFill');
      return true;
    case 'layer.removeBg': void removeBackgroundCmd(ed); return true;
    case 'select.subject': void selectSubjectCmd(ed); return true;
  }
  return false;
}
