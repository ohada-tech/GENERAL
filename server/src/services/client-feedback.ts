/**
 * ייבוא הערות לקוח: קישור Google Doc, קובץ Word או טקסט מודבק ← רשימת הערות, כל אחת משויכת לסצנה ←
 * תיקון אחד של התסריט (ChatGPT כותב, Claude בודק) ← גרסה חדשה + טבלת "הערה ← מה שונה" בממשק.
 *
 * מזהה ב-Word: הערות צד (comments), הצעות במצב מעקב (ins/del), עריכה ישירה בטבלת התסריט שהמערכת ייצאה,
 * וטקסט שהלקוח כתב בחלק "הערות ואישור הלקוח". מסמך שאינו בתבנית שלנו: כל פסקה = הערה.
 */
import zlib from 'node:zlib';
import type { ScriptContent, ScriptVersion } from '@apos/shared';
import { GateError, NotFoundError, type Ctx } from '../context.js';
import { json, tx, uid } from '../db/db.js';
import { getProject, getScript, listScripts } from '../db/repo.js';
import { enqueueJob } from '../workflow/queue.js';
import { targetScenes } from '../workflow/revision-scope.js';
import { recordFeedback } from './learning.js';

export type FeedbackKind = 'comment' | 'suggestion' | 'edit' | 'note';

export interface FeedbackItem {
  id: string;
  kind: FeedbackKind;
  author: string;
  /** הטקסט בתסריט שההערה מתייחסת אליו (אם יש) */
  quote: string;
  text: string;
  /** סצנות (מ-0). ריק = הערה כללית */
  scenes: number[];
  include: boolean;
  /** עריכה ישירה: השדה והנוסח החדש של הלקוח (לחישוב האורך אחרי ההערות) */
  field?: 'narration' | 'onScreenText' | 'visualAction';
  value?: string;
  /** מה אוהד מחליט על ההערה, נכנס לתיקון כהנחיה */
  myNote?: string;
}

export type ReviewVerdict = 'agree' | 'partly' | 'disagree' | 'question';

/** הדעה של ChatGPT על ההערות, לפני שמשנים משהו בתסריט */
export interface FeedbackReview {
  status: 'running' | 'done' | 'failed';
  at: string;
  error?: string;
  model?: string;
  /** אורך הקריינות המשוער (שניות): עכשיו, ואחרי העריכות הישירות של הלקוח. מחושב בקוד ולא במודל */
  timing?: { targetSec: number | null; beforeSec: number; afterSec: number };
  summary?: string;
  items?: Array<{ itemId: string; verdict: ReviewVerdict; understanding: string; reasoning: string; suggestion: string }>;
  conflicts?: string[];
  questionsForClient?: string[];
  recommendation?: string;
}

export interface FeedbackImport {
  id: string;
  projectId: string;
  baseVersionId: string;
  resultVersionId: string | null;
  source: 'gdoc' | 'docx' | 'text' | 'call';
  sourceName: string;
  detectedLabel: string | null;
  items: FeedbackItem[];
  status: 'draft' | 'applied';
  review: FeedbackReview | null;
  /** ייבוא מתוך שיחה מוקלטת */
  callId: string | null;
  createdAt: string;
}

/* ---------------- zip (docx) ---------------- */

/** קורא קבצים מתוך zip בלי תלות חיצונית (docx = zip של XML) */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new GateError('הקובץ לא נקרא כ-Word (docx). שמור אותו מחדש כ-.docx ונסה שוב.', 400);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, zlib.inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* ---------------- docx XML ---------------- */

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

const attr = (attrs: string, name: string) => decode(attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '');
const clean = (s: string) => s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();

interface Parsed {
  paragraphs: string[];
  /** טבלאות: שורות ← תאים ← טקסט */
  tables: string[][][];
  comments: { author: string; quote: string; text: string }[];
  suggestions: { author: string; kind: 'ins' | 'del'; text: string; context: string }[];
}

/** טקסט של קטע XML (פסקאות מופרדות בשורה חדשה) */
function textOf(xml: string) {
  let out = '';
  const re = /<w:(t|delText|tab|br|cr|p)\b([^>]*?)(\/?)>([^<]*)|<\/w:p>/g;
  for (const m of xml.matchAll(re)) {
    if (m[0] === '</w:p>') out += '\n';
    else if (m[1] === 't') out += m[3] ? '' : decode(m[4]);
    else if (m[1] === 'tab') out += ' ';
    else if (m[1] === 'br' || m[1] === 'cr') out += '\n';
  }
  return clean(out);
}

export function parseDocx(buf: Buffer): Parsed {
  const files = unzip(buf);
  const doc = files.get('word/document.xml')?.toString('utf8');
  if (!doc) throw new GateError('לא נמצא תוכן בקובץ ה-Word', 400);

  // הערות צד
  const commentText = new Map<string, { author: string; text: string }>();
  const cx = files.get('word/comments.xml')?.toString('utf8') ?? '';
  for (const m of cx.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)) {
    commentText.set(attr(m[1], 'w:id'), { author: attr(m[1], 'w:author'), text: textOf(m[2]) });
  }

  const body = doc.replace(/^[\s\S]*?<w:body>/, '').replace(/<\/w:body>[\s\S]*$/, '');

  // מעבר אחד על המסמך: פסקאות, טבלאות, טווחי הערות והצעות
  const paragraphs: string[] = [];
  const tables: string[][][] = [];
  const quotes = new Map<string, string>();
  const open = new Set<string>();
  const suggestions: Parsed['suggestions'] = [];
  let para = '';
  let cell = '';
  let row: string[] | null = null;
  let table: string[][] | null = null;
  let depth = 0;
  let sug: { author: string; kind: 'ins' | 'del'; text: string } | null = null;

  const re =
    /<(\/?)w:(p|t|delText|tab|br|cr|tbl|tr|tc|ins|del|commentRangeStart|commentRangeEnd)\b([^>]*?)(\/?)>([^<]*)/g;
  for (const m of body.matchAll(re)) {
    const [, close, tag, attrs, selfClose, tail] = m;
    let add = '';
    if (!close && (tag === 't' || tag === 'delText') && !selfClose) add = decode(tail);
    else if (!close && (tag === 'tab' || tag === 'br' || tag === 'cr')) add = tag === 'tab' ? ' ' : '\n';

    if (add) {
      if (tag !== 'delText') {
        para += add;
        for (const id of open) quotes.set(id, (quotes.get(id) ?? '') + add);
      }
      if (sug) sug.text += add;
      continue;
    }
    if (tag === 'commentRangeStart') open.add(attr(attrs, 'w:id'));
    else if (tag === 'commentRangeEnd') open.delete(attr(attrs, 'w:id'));
    else if ((tag === 'ins' || tag === 'del') && !selfClose) {
      if (!close) sug = { author: attr(attrs, 'w:author'), kind: tag, text: '' };
      else if (sug) {
        if (sug.text.trim()) suggestions.push({ ...sug, text: clean(sug.text), context: '' });
        sug = null;
      }
    } else if (tag === 'p' && close) {
      const t = clean(para);
      if (depth > 0) cell += (cell ? '\n' : '') + t;
      else if (t) paragraphs.push(t);
      for (const s of suggestions) if (!s.context) s.context = t;
      para = '';
    } else if (tag === 'tbl') {
      if (!close) {
        depth++;
        if (depth === 1) table = [];
      } else {
        depth--;
        if (depth === 0 && table) tables.push(table);
      }
    } else if (tag === 'tr' && depth === 1) {
      if (!close) row = [];
      else if (row && table) {
        table.push(row);
        row = null;
      }
    } else if (tag === 'tc' && depth === 1) {
      if (!close) cell = '';
      else if (row) row.push(clean(cell));
    }
  }

  const comments = [...commentText.entries()].map(([id, c]) => ({ author: c.author, quote: clean(quotes.get(id) ?? ''), text: c.text }));
  return { paragraphs, tables, comments, suggestions };
}

/* ---------------- items ---------------- */

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const FIELD_LABEL = { narration: 'קריינות', onScreenText: 'טקסט על המסך', visualAction: 'מה רואים' } as const;
/** שורות של התבנית שלנו (קווים למילוי, חתימה) — לא הערות */
const TEMPLATE_LINE = /^(הערות:?\s*_*|Notes:?\s*_*|_+|שם:\s*_+.*|Name:\s*_+.*|.*☐\s*(מאושר|Approved).*)$/;

/** סצנות שההערה מכוונת אליהן: ציטוט/שם סצנה (כמו בתיקון ממוקד), או מספר בתחילת ההערה ("7 — לחדד", "7.5 לחדד" = משך של סצנה) */
export function scenesFor(base: ScriptContent, quote: string, text: string): number[] {
  const found = new Set(targetScenes(base, `${quote}\n${text}`));
  const lead = text.match(/^\s*(\d+(?:\.\d+)?)(?=[\s\-–—:.)]|$)/)?.[1];
  if (lead && !found.size) {
    const n = Number(lead);
    if (Number.isInteger(n) && n >= 1 && n <= base.scenes.length) found.add(n - 1);
    else {
      const byDur = base.scenes.flatMap((s, i) => (s.estDurationSec === n ? [i] : []));
      if (byDur.length === 1) found.add(byDur[0]);
    }
  }
  return [...found].sort((a, b) => a - b);
}

const item = (kind: FeedbackKind, author: string, quote: string, text: string, base: ScriptContent): FeedbackItem => ({
  id: uid(),
  kind,
  author,
  quote,
  text,
  scenes: scenesFor(base, quote, text),
  include: true,
});

const letters = (s: string, re: RegExp) => s.match(re)?.length ?? 0;
const HEB = /[֐-׿]/g;
const LAT = /[A-Za-z]/g;

/** תסריט שהקריינות שלו באנגלית (או שפה לטינית אחרת) */
export function isLatinScript(base: ScriptContent) {
  const all = base.scenes.map((s) => s.narration).join(' ');
  return letters(all, LAT) > letters(all, HEB) * 4;
}

/** פסקה שרובה עברית */
export const isHebrewAside = (t: string) => letters(t, HEB) > letters(t, LAT);

/** הערות מתוך מסמך Word שנקרא */
export function itemsFromDocx(p: Parsed, base: ScriptContent): FeedbackItem[] {
  const out: FeedbackItem[] = [];
  for (const c of p.comments) if (c.text) out.push(item('comment', c.author, c.quote, c.text, base));
  for (const s of p.suggestions) {
    out.push(item('suggestion', s.author, s.context, s.kind === 'ins' ? `להוסיף: "${s.text}"` : `למחוק: "${s.text}"`, base));
  }

  // עריכה ישירה בטבלת התסריט שהמערכת ייצאה: # | קריינות | טקסט על המסך | מה רואים | שניות
  const scriptTable = p.tables.find((t) => /קריינות|Narration/.test(t[0]?.[1] ?? ''));
  const latin = isLatinScript(base);
  const seen = new Set<number>();
  for (const row of scriptTable?.slice(1) ?? []) {
    const n = Number(row[0]?.match(/^\d+/)?.[0]);
    const scene = base.scenes[n - 1];
    if (!scene) continue;
    // שורה שהלקוח הוסיף מתחת לסצנה ("7 Dana"): מה שאחרי המספר הוא מי שכתב
    const author = seen.has(n) ? (row[0] ?? '').replace(/^\d+/, '').replace(/\s+/g, ' ').trim() : '';
    seen.add(n);
    const asides: string[] = [];
    (['narration', 'onScreenText', 'visualAction'] as const).forEach((f, k) => {
      const paras = (row[k + 1] ?? '').split('\n');
      // בתסריט באנגלית, פסקה בעברית בתוך התא היא הערה של הלקוח ולא נוסח חדש
      const notes = latin ? paras.filter(isHebrewAside) : [];
      if (notes.length) asides.push(notes.join(' · '));
      const now = paras.filter((t) => !notes.includes(t)).join('\n').trim().replace(/^—$/, '');
      if (!now && notes.length) return; // כל התא הוא הערה ← בשדה עצמו לא נגעו
      if (norm(now) !== norm(scene[f])) {
        out.push({
          id: uid(),
          kind: 'edit',
          author,
          quote: scene[f],
          text: now ? `${author || 'הלקוח'} שינה את "${FIELD_LABEL[f]}" ל: "${now}"` : `${author || 'הלקוח'} מחק את "${FIELD_LABEL[f]}"`,
          scenes: [n - 1],
          include: true,
          field: f,
          value: now,
        });
      }
    });
    // עמודת השניות: מספר = תזמון, כל דבר אחר = הערה
    const sec = (row[4] ?? '').trim();
    if (sec && !/^\d+(?:\.\d+)?$/.test(sec)) asides.push(sec.replace(/\n+/g, ' · '));
    for (const a of asides) out.push({ id: uid(), kind: 'comment', author, quote: '', text: a, scenes: [n - 1], include: true });
  }

  // טקסט חופשי: מה שנכתב בחלק "הערות ואישור הלקוח"; מסמך שאינו בתבנית שלנו — כל הפסקאות
  const notesAt = p.paragraphs.findIndex((t) => t.startsWith('הערות ואישור הלקוח') || t.startsWith('Client notes & approval'));
  const free = notesAt >= 0 ? p.paragraphs.slice(notesAt + 1) : scriptTable || out.length ? [] : p.paragraphs;
  for (const raw of free) {
    const t = raw.replace(/^(הערות|Notes):\s*/, '').trim();
    if (t && !TEMPLATE_LINE.test(t)) out.push(item('note', '', '', t, base));
  }
  return out;
}

/** טקסט מודבק: כל פסקה / שורת תבליט = הערה */
export function itemsFromText(text: string, base: ScriptContent): FeedbackItem[] {
  return text
    .split(/\n\s*\n|\n(?=\s*(?:[-•*]|\d+[.)])\s)/)
    .map((t) => t.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean)
    .map((t) => item('note', '', '', t, base));
}

/* ---------------- Google Doc ---------------- */

export function googleDocId(url: string) {
  return url.match(/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([\w-]{20,})/)?.[1] ?? null;
}

/** מוריד את המסמך כ-Word (כולל הערות צד והצעות). עובד רק כשהמסמך משותף "לכל מי שיש לו את הקישור". */
export async function fetchGoogleDoc(url: string, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const id = googleDocId(url);
  if (!id) throw new GateError('זה לא נראה כמו קישור ל-Google Doc (docs.google.com/document/d/…)', 400);
  let res: Response;
  try {
    res = await fetcher(`https://docs.google.com/document/d/${id}/export?format=docx`, { redirect: 'follow' });
  } catch {
    throw new GateError('אין חיבור ל-Google Docs כרגע. נסה שוב, או הורד את המסמך כ-Word והעלה אותו.', 502);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok || buf.subarray(0, 2).toString() !== 'PK') {
    throw new GateError(
      'אין גישה למסמך. ב-Google Docs: שיתוף ← "כל מי שיש לו את הקישור" (צופה), או קובץ ← הורדה ← Word, והעלה את הקובץ כאן.',
      400,
    );
  }
  return buf;
}

/* ---------------- DB + commands ---------------- */

const map = (r: any): FeedbackImport => ({
  id: r.id,
  projectId: r.project_id,
  baseVersionId: r.base_version_id,
  resultVersionId: r.result_version_id ?? null,
  source: r.source,
  sourceName: r.source_name,
  detectedLabel: r.detected_label ?? null,
  items: JSON.parse(r.items || '[]'),
  status: r.status,
  review: r.review ? JSON.parse(r.review) : null,
  callId: r.call_id ?? null,
  createdAt: r.created_at,
});

export function listFeedbackImports(ctx: Ctx, projectId: string) {
  return (ctx.db.prepare('SELECT * FROM client_feedback WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as any[]).map(map);
}

export function getFeedbackImport(ctx: Ctx, id: string) {
  const r = ctx.db.prepare('SELECT * FROM client_feedback WHERE id = ?').get(id);
  return r ? map(r) : null;
}

/** הגרסה שהמסמך נכתב עליה ("גרסה: v4.2" בקובץ שייצאנו), אחרת האחרונה */
function pickBase(versions: ScriptVersion[], paragraphs: string[]) {
  const label = paragraphs.join('\n').match(/(?:גרסה|Version):\s*v?(\d+(?:\.\d+)?)/)?.[1] ?? null;
  return { base: (label && versions.find((v) => v.label === label)) || versions[0], label };
}

export async function importClientFeedback(
  ctx: Ctx,
  projectId: string,
  input: { url?: string; text?: string; file?: { name: string; data: Buffer } },
  fetcher?: typeof fetch,
) {
  if (!getProject(ctx.db, projectId)) throw new NotFoundError('פרויקט');
  const versions = listScripts(ctx.db, projectId);
  if (!versions.length) throw new GateError('אין עדיין תסריט בפרויקט — אין על מה להחיל הערות', 400);

  let source: FeedbackImport['source'];
  let sourceName: string;
  let items: FeedbackItem[];
  let label: string | null = null;
  let base = versions[0];
  if (input.text?.trim()) {
    source = 'text';
    sourceName = 'טקסט מודבק';
    items = itemsFromText(input.text, base.content);
  } else {
    const buf = input.file ? input.file.data : input.url?.trim() ? await fetchGoogleDoc(input.url.trim(), fetcher) : null;
    if (!buf) throw new GateError('צרף קובץ Word, הדבק קישור ל-Google Doc או הדבק את ההערות', 400);
    source = input.file ? 'docx' : 'gdoc';
    sourceName = input.file?.name ?? input.url!.trim();
    const parsed = parseDocx(buf);
    ({ base, label } = pickBase(versions, parsed.paragraphs));
    items = itemsFromDocx(parsed, base.content);
  }
  if (!items.length) throw new GateError('לא נמצאו הערות במסמך (לא הערות צד, לא הצעות, ולא טקסט בחלק ההערות)', 400);

  const id = uid();
  ctx.db
    .prepare(
      `INSERT INTO client_feedback (id, project_id, base_version_id, source, source_name, detected_label, items, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
    )
    .run(id, projectId, base.id, source, sourceName.slice(0, 500), label, json(items), ctx.now().toISOString());
  return getFeedbackImport(ctx, id)!;
}

const KIND_LABEL: Record<FeedbackKind, string> = { comment: 'הערה במסמך', suggestion: 'הצעת שינוי', edit: 'עריכה ישירה', note: 'הערה' };

/** פרומפט התיקון: כל הערה ממוספרת, עם הסצנה והציטוט שלה */
export function feedbackPrompt(clientName: string, items: FeedbackItem[]) {
  const lines = items.map((it, i) => {
    const where = it.scenes.length ? `סצנה ${it.scenes.map((s) => s + 1).join(', ')}` : 'כללי';
    const quote = it.quote && it.kind !== 'edit' ? ` (על הקטע: "${it.quote.slice(0, 300)}")` : '';
    const mine = it.myNote?.trim() ? `\n   ההחלטה של הסטודיו על ההערה הזאת (גוברת על נוסח הלקוח): ${it.myNote.trim()}` : '';
    return `${i + 1}. [${where} · ${KIND_LABEL[it.kind]}${it.author ? ` · ${it.author}` : ''}]${quote} ${it.text}${mine}`;
  });
  return [
    `הערות הלקוח${clientName ? ` (${clientName})` : ''} על התסריט. טפל בכל הערה בנקודה שלה, ואל תשנה דברים שאף הערה לא ביקשה.`,
    'עריכה ישירה של הלקוח: אמץ את הנוסח שלו כמעט מילה במילה (רק התאמה לאורך ולתזמון), אלא אם הסטודיו החליט אחרת על אותה הערה.',
    'הערה שמבקשת להוסיף מסר: שלב אותו בסצנה הכי מתאימה בלי להאריך את הסרטון מעבר לנדרש.',
    '',
    ...lines,
  ].join('\n');
}

export function applyClientFeedback(ctx: Ctx, importId: string, input: { items?: FeedbackItem[]; baseVersionId?: string }) {
  const imp = getFeedbackImport(ctx, importId);
  if (!imp) throw new NotFoundError('ייבוא הערות');
  const baseId = input.baseVersionId || imp.baseVersionId;
  const base = getScript(ctx.db, baseId);
  if (!base || base.projectId !== imp.projectId) throw new NotFoundError('גרסת תסריט');
  const items = cleanItems(input.items ?? imp.items, base.content.scenes.length);
  const chosen = items.filter((it) => it.include && it.text);
  if (!chosen.length) throw new GateError('לא נבחרה אף הערה לתיקון', 400);
  const project = getProject(ctx.db, imp.projectId)!;
  // נעילה לסצנות רק כשכל ההערות ממוקדות; הערה כללית אחת = כל התסריט פתוח לתיקון
  const targets = chosen.every((it) => it.scenes.length) ? [...new Set(chosen.flatMap((it) => it.scenes))].sort((a, b) => a - b) : [];

  return tx(ctx.db, () => {
    ctx.db.prepare('UPDATE client_feedback SET items = ?, base_version_id = ? WHERE id = ?').run(json(items), baseId, importId);
    for (const it of chosen) {
      recordFeedback(ctx, imp.projectId, 'script', it.text);
      // ההחלטה של אוהד על ההערה נלמדת כמו כל הערה שלו
      if (it.myNote) recordFeedback(ctx, imp.projectId, 'script', it.myNote);
    }
    return enqueueJob(ctx, {
      projectId: imp.projectId,
      type: 'script.revise',
      payload: { baseVersionId: baseId, feedback: feedbackPrompt(project.clientName, chosen), targets, feedbackImportId: importId, feedbackCount: chosen.length },
      idempotencyKey: `script.client-feedback:${importId}:${uid()}`,
      actor: ctx.config.ownerName,
    });
  });
}

/** ניקוי הערות שחוזרות מהממשק: טקסט, סצנות בטווח, ההחלטה של אוהד */
export function cleanItems(items: FeedbackItem[], sceneCount: number): FeedbackItem[] {
  return items.map((it) => ({
    ...it,
    text: String(it.text ?? '').trim(),
    scenes: (it.scenes ?? []).filter((s) => Number.isInteger(s) && s >= 0 && s < sceneCount),
    myNote: String(it.myNote ?? '').trim().slice(0, 4000),
  }));
}

/** שמירת הבחירות של אוהד (מה נכלל, לאיזו סצנה, ההחלטה שלו) בלי להפעיל תיקון */
export function saveFeedbackItems(ctx: Ctx, importId: string, input: { items?: FeedbackItem[]; baseVersionId?: string }) {
  const imp = getFeedbackImport(ctx, importId);
  if (!imp) throw new NotFoundError('ייבוא הערות');
  if (imp.status === 'applied') throw new GateError('ההערות כבר הוחלו על התסריט', 409);
  const baseId = input.baseVersionId || imp.baseVersionId;
  const base = getScript(ctx.db, baseId);
  if (!base || base.projectId !== imp.projectId) throw new NotFoundError('גרסת תסריט');
  const items = cleanItems(input.items ?? imp.items, base.content.scenes.length);
  ctx.db.prepare('UPDATE client_feedback SET items = ?, base_version_id = ? WHERE id = ?').run(json(items), baseId, importId);
  return getFeedbackImport(ctx, importId)!;
}

/** התסריט עם העריכות הישירות של הלקוח (רק כדי למדוד אורך) */
export function withClientEdits(base: ScriptContent, items: FeedbackItem[]): ScriptContent {
  const scenes = base.scenes.map((s) => ({ ...s }));
  for (const it of items) {
    if (!it.include || it.kind !== 'edit' || !it.field || it.scenes.length !== 1) continue;
    const s = scenes[it.scenes[0]];
    if (s) s[it.field] = it.value ?? '';
  }
  return { ...base, scenes };
}

export { KIND_LABEL };
