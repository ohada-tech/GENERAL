/**
 * תסריט כדף לצפייה בדפדפן ולשמירה כ-PDF: אותו תוכן ומיתוג כמו קובץ ה-Word, בלי מידע פנימי.
 * נפתח בכל מחשב וטלפון; "שמור כ-PDF" משתמש בהדפסה של הדפדפן (A4, בלי סרגל הכלים).
 */
import fs from 'node:fs';
import path from 'node:path';
import { computeTiming, STORY_ROLE_LABELS, type ScriptVersion } from '@apos/shared';
import { REPO_ROOT } from '../config.js';
import type { BrandImage } from './branding.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const lines = (s: string) => (s.trim() ? esc(s).replace(/\r?\n/g, '<br>') : '—');
const dataUri = (img: { type: string; data: Buffer }) => `data:image/${img.type === 'jpg' ? 'jpeg' : img.type};base64,${img.data.toString('base64')}`;

function studioLogo() {
  const p = path.join(REPO_ROOT, 'web', 'public', 'icons', 'icon-192.png');
  return fs.existsSync(p) ? dataUri({ type: 'png', data: fs.readFileSync(p) }) : null;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' });

export function scriptHtml(input: {
  version: ScriptVersion;
  projectName: string;
  clientName: string;
  language: string;
  targetSec: number | null;
  brand?: 'genesis' | 'studio';
  genesisLogo?: BrandImage | null;
  ownerName?: string;
}): string {
  const { version: v } = input;
  const c = v.content;
  const timing = computeTiming(c, input.language, input.targetSec);
  const total = timing.totalSec || timing.narrationSec;
  const genesis = input.brand === 'genesis';
  const docTitle = `${input.projectName} - תסריט v${v.label}`;

  const brandBlock = genesis
    ? `<div class="band">${input.genesisLogo ? `<img src="${dataUri(input.genesisLogo)}" alt="Genesis">` : '<span class="band-word">GENESIS</span>'}</div>
       <div class="maker">${esc(input.ownerName || 'Ohad Alfi')}</div>`
    : `${studioLogo() ? `<img class="studio-logo" src="${studioLogo()}" alt="">` : ''}<div class="maker">Ohad Alfi · AI Production Studio</div>`;

  const rows = c.scenes
    .map(
      (s, i) => `<tr>
        <td class="n"><b>${i + 1}</b><span>${esc(STORY_ROLE_LABELS[s.storyRole] ?? '')}</span></td>
        <td dir="auto" class="vo">${lines(s.narration)}</td>
        <td dir="auto" class="ost">${lines(s.onScreenText)}</td>
        <td dir="auto" class="vis">${lines(s.visualAction)}</td>
        <td class="dur">${s.estDurationSec || '—'}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(docTitle)}</title>
<style>
  :root { --ink: #1a1a1f; --muted: #6b6b78; --accent: #7a5cfa; --head: #f1eeff; --line: #d9d6e6; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #ecebf1; color: var(--ink); font-family: Arial, 'Assistant', sans-serif; font-size: 14px; line-height: 1.5; }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; gap: 10px; align-items: center; justify-content: center; flex-wrap: wrap; padding: 10px 16px; background: #141418; color: #f2f1f4; font-size: 14px; }
  .bar button { font: inherit; font-weight: 700; border: 0; border-radius: 999px; padding: 8px 20px; cursor: pointer; background: linear-gradient(115deg,#7ee6e6,#a9bef7 45%,#c8a6ff); color: #0a0a0b; }
  .bar span { color: #a5a4ae; }
  .page { max-width: 210mm; margin: 24px auto; background: #fff; padding: 16mm 14mm; box-shadow: 0 10px 40px -20px rgba(0,0,0,.4); }
  .band { background: #111114; padding: 22px 16px; display: flex; justify-content: center; align-items: center; margin-bottom: 6px; }
  .band img { max-width: 230px; max-height: 70px; }
  .band-word { color: #fff; font-weight: 800; font-size: 30px; letter-spacing: .08em; font-family: Arial, sans-serif; }
  .studio-logo { width: 56px; height: 56px; display: block; margin-bottom: 4px; }
  .maker { color: var(--muted); font-size: 11px; margin-bottom: 18px; }
  h1 { font-size: 24px; margin: 0 0 6px; }
  .logline { color: var(--muted); font-style: italic; font-size: 15px; margin: 0 0 12px; }
  .meta { font-size: 12.5px; margin: 2px 0; }
  .meta b { font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-top: 18px; table-layout: fixed; }
  th { background: var(--head); color: var(--accent); font-size: 12.5px; text-align: start; }
  th, td { border: 1px solid var(--line); padding: 7px 8px; vertical-align: top; overflow-wrap: anywhere; }
  td.n { width: 8%; } td.n b { display: block; font-size: 15px; } td.n span { color: var(--muted); font-size: 10.5px; }
  td.vo { font-size: 13.5px; } td.ost { font-weight: 700; font-size: 12.5px; } td.vis { color: var(--muted); font-size: 12.5px; } td.dur { width: 8%; text-align: center; }
  tr { break-inside: avoid; }
  .approve { margin-top: 26px; }
  .approve h2 { font-size: 16px; margin: 0 0 10px; }
  .approve .fill { color: var(--muted); border-bottom: 1px solid var(--line); height: 26px; margin-bottom: 10px; }
  .approve .sign { display: flex; gap: 24px; flex-wrap: wrap; color: var(--muted); font-size: 13px; margin-top: 14px; }
  .approve .sign b { color: var(--ink); font-weight: 400; }
  @media (max-width: 700px) { .page { margin: 0; padding: 18px 14px; box-shadow: none; } table { table-layout: auto; font-size: 12px; } }
  @page { size: A4; margin: 12mm; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .page { margin: 0; padding: 0; max-width: none; box-shadow: none; }
    .band, th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="bar"><button type="button" onclick="window.print()">⬇ שמור כ-PDF</button><span>בחלון שנפתח: יעד ← "שמירה כ-PDF"</span></div>
  <main class="page">
    ${brandBlock}
    <h1 dir="auto">${esc(c.title || input.projectName)}</h1>
    ${c.logline ? `<p class="logline" dir="auto">${esc(c.logline)}</p>` : ''}
    <div class="meta"><b>פרויקט:</b> <bdi dir="rtl">${esc(input.projectName)}</bdi>${input.clientName ? ` &nbsp;·&nbsp; <b>לקוח:</b> <bdi dir="rtl">${esc(input.clientName)}</bdi>` : ''}</div>
    <div class="meta"><b>גרסה:</b> v${esc(v.label)} &nbsp;·&nbsp; <b>תאריך:</b> ${fmtDate(v.createdAt)}${total ? ` &nbsp;·&nbsp; <b>אורך משוער:</b> ${Math.round(total)} שניות` : ''}</div>
    <table>
      <colgroup><col style="width:8%"><col style="width:36%"><col style="width:20%"><col style="width:28%"><col style="width:8%"></colgroup>
      <thead><tr><th>#</th><th>קריינות</th><th>טקסט על המסך</th><th>מה רואים</th><th>שניות</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <section class="approve">
      <h2>הערות ואישור הלקוח</h2>
      <div class="fill">הערות:</div>
      <div class="fill"></div>
      <div class="sign"><span>שם: ____________________</span><span>תאריך: ____________</span><b>☐ מאושר &nbsp; ☐ נדרשים שינויים</b></div>
    </section>
  </main>
</body>
</html>`;
}
