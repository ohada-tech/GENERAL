/**
 * תסריט כקובץ Word לשליחה ללקוח: לוגו, פרטי הפרויקט, טבלת סצנות ומקום לאישור.
 * בלי מידע פנימי — בלי הערות גרסה, בלי שמות מודלים, בלי הערות הפקה.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { computeTiming, isEnglishScript, STORY_ROLE_LABELS, STORY_ROLE_LABELS_EN, type ScriptVersion } from '@apos/shared';
import { REPO_ROOT } from '../config.js';
import type { BrandImage } from './branding.js';

const FONT = 'Arial';
const INK = '1A1A1F';
const MUTED = '6B6B78';
const ACCENT = '7A5CFA';
const HEAD_BG = 'F1EEFF';
const LINE = 'D9D6E6';

/**
 * כיוון הקובץ: תסריט באנגלית נבנה כולו משמאל לימין עם תוויות באנגלית; בעברית — מימין לשמאל.
 * נקבע בתחילת scriptDocx (בניית המסמך סינכרונית, כך שאין ערבוב בין בקשות).
 */
let LTR = false;

const run = (text: string, o: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}) =>
  new TextRun({ text, font: FONT, rightToLeft: !LTR, bold: o.bold, italics: o.italics, size: o.size ?? 22, color: o.color ?? INK });

const para = (children: TextRun[] | string, o: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; before?: number } = {}) =>
  new Paragraph({
    bidirectional: !LTR,
    alignment: o.align ?? (LTR ? AlignmentType.LEFT : AlignmentType.RIGHT),
    spacing: { after: o.after ?? 80, before: o.before ?? 0, line: 300 },
    children: typeof children === 'string' ? [run(children)] : children,
  });

/** טקסט עם ירידות שורה → כמה פסקאות בתא */
const lines = (text: string, o: { size?: number; color?: string; bold?: boolean } = {}) => {
  const parts = (text || '—').split(/\r?\n/);
  return parts.map((t) => para([run(t || ' ', o)], { after: 40 }));
};

const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };

function cell(children: Paragraph[], widthPct: number, o: { head?: boolean } = {}) {
  return new TableCell({
    children,
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    shading: o.head ? { type: ShadingType.CLEAR, fill: HEAD_BG, color: 'auto' } : undefined,
  });
}

function logo(): ImageRun | null {
  const p = path.join(REPO_ROOT, 'web', 'public', 'icons', 'icon-192.png');
  if (!fs.existsSync(p)) return null;
  return new ImageRun({ type: 'png', data: fs.readFileSync(p), transformation: { width: 56, height: 56 } });
}

/** פס כהה ברוחב הדף עם הלוגו של Genesis (הלוגו לבן — על דף לבן הוא לא היה נראה). בלי לוגו שהועלה: השם בטקסט. */
function genesisBand(img: BrandImage | null) {
  const W = 230;
  const content = img
    ? new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({ type: img.type, data: img.data, transformation: { width: W, height: Math.round((W * img.height) / img.width) } })],
      })
    : new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'GENESIS', font: FONT, bold: true, size: 56, color: 'FFFFFF' })] });
  const none = { style: BorderStyle.NONE, size: 0, color: 'auto' };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: [content],
            shading: { type: ShadingType.CLEAR, fill: '111114', color: 'auto' },
            margins: { top: 260, bottom: 260, left: 200, right: 200 },
            verticalAlign: VerticalAlign.CENTER,
          }),
        ],
      }),
    ],
  });
}

const HE = {
  project: 'פרויקט', client: 'לקוח', version: 'גרסה', date: 'תאריך', length: 'אורך משוער', seconds: 'שניות',
  narration: 'קריינות', screen: 'טקסט על המסך', visual: 'מה רואים', sec: 'שניות',
  approvalTitle: 'הערות ואישור הלקוח', notes: 'הערות', name: 'שם', approved: 'מאושר', changes: 'נדרשים שינויים',
  script: 'תסריט', page: 'עמוד',
};
const EN: typeof HE = {
  project: 'Project', client: 'Client', version: 'Version', date: 'Date', length: 'Est. length', seconds: 'seconds',
  narration: 'Narration', screen: 'On-screen text', visual: 'Visual', sec: 'Sec',
  approvalTitle: 'Client notes & approval', notes: 'Notes', name: 'Name', approved: 'Approved', changes: 'Changes needed',
  script: 'Script', page: 'Page',
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(LTR ? 'en-GB' : 'he-IL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' });

export async function scriptDocx(input: {
  version: ScriptVersion;
  projectName: string;
  clientName: string;
  language: string;
  targetSec: number | null;
  studio?: string;
  /** genesis: לוגו Genesis בגדול על פס כהה + השם שלך בקטן, בלי הלוגו של הסטודיו */
  brand?: 'genesis' | 'studio';
  genesisLogo?: BrandImage | null;
  ownerName?: string;
}): Promise<Buffer> {
  const { version: v } = input;
  const c = v.content;
  LTR = isEnglishScript(c);
  const L = LTR ? EN : HE;
  const roles = LTR ? STORY_ROLE_LABELS_EN : STORY_ROLE_LABELS;
  // באנגלית לא מציגים שם פרויקט שכתוב בעברית (הכותרת של התסריט כבר שם)
  const showProject = !LTR || !/[\u0590-\u05FF]/.test(input.projectName);
  const timing = computeTiming(c, input.language, input.targetSec);
  const total = timing.totalSec || timing.narrationSec;
  const genesis = input.brand === 'genesis';
  const maker = genesis ? input.ownerName || 'Ohad Alfi' : (input.studio ?? 'Ohad Alfi · AI Production Studio');
  const img = genesis ? null : logo();

  const header: (Paragraph | Table)[] = [
    ...(genesis ? [genesisBand(input.genesisLogo ?? null), para([run(maker, { size: 16, color: MUTED })], { after: 280 })] : []),
    ...(img ? [new Paragraph({ alignment: LTR ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [img], spacing: { after: 60 } })] : []),
    ...(genesis ? [] : [para([run(maker, { size: 18, color: MUTED })], { after: 280 })]),
    para([run(c.title || input.projectName, { bold: true, size: 40 })], { after: 100 }),
    ...(c.logline ? [para([run(c.logline, { size: 24, color: MUTED, italics: true })], { after: 200 })] : []),
    para(
      [
        ...(showProject ? [run(`${L.project}: `, { bold: true, size: 20 }), run(input.projectName, { size: 20 })] : []),
        ...(input.clientName ? [run(`${showProject ? '   ·   ' : ''}${L.client}: `, { bold: true, size: 20 }), run(input.clientName, { size: 20 })] : []),
      ],
      { after: 40 },
    ),
    para(
      [
        run(`${L.version}: `, { bold: true, size: 20 }),
        run(`v${v.label}`, { size: 20 }),
        run(`   ·   ${L.date}: `, { bold: true, size: 20 }),
        run(fmtDate(v.createdAt), { size: 20 }),
        ...(total ? [run(`   ·   ${L.length}: `, { bold: true, size: 20 }), run(`${Math.round(total)} ${L.seconds}`, { size: 20 })] : []),
      ],
      { after: 300 },
    ),
  ];

  const W = { n: 8, narration: 36, screen: 20, visual: 28, dur: 8 };
  const headRow = new TableRow({
    tableHeader: true,
    children: [
      cell([para([run('#', { bold: true, size: 20, color: ACCENT })])], W.n, { head: true }),
      cell([para([run(L.narration, { bold: true, size: 20, color: ACCENT })])], W.narration, { head: true }),
      cell([para([run(L.screen, { bold: true, size: 20, color: ACCENT })])], W.screen, { head: true }),
      cell([para([run(L.visual, { bold: true, size: 20, color: ACCENT })])], W.visual, { head: true }),
      cell([para([run(L.sec, { bold: true, size: 20, color: ACCENT })])], W.dur, { head: true }),
    ],
  });
  const rows = c.scenes.map(
    (s, i) =>
      new TableRow({
        cantSplit: true,
        children: [
          cell(
            [para([run(String(i + 1), { bold: true, size: 22 })], { after: 20 }), para([run(roles[s.storyRole] ?? '', { size: 16, color: MUTED })])],
            W.n,
          ),
          cell(lines(s.narration, { size: 22 }), W.narration),
          cell(lines(s.onScreenText, { size: 20, bold: !!s.onScreenText }), W.screen),
          cell(lines(s.visualAction, { size: 20, color: MUTED }), W.visual),
          cell([para([run(s.estDurationSec ? String(s.estDurationSec) : '—', { size: 20 })])], W.dur),
        ],
      }),
  );
  const table = new Table({
    rows: [headRow, ...rows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    visuallyRightToLeft: !LTR,
    borders,
  });

  const approval = [
    para([run(L.approvalTitle, { bold: true, size: 24 })], { before: 400, after: 160 }),
    para([run(`${L.notes}: ______________________________________________________________`, { size: 20, color: MUTED })], { after: 200 }),
    para([run('______________________________________________________________________', { size: 20, color: MUTED })], { after: 280 }),
    para([run(`${L.name}: ____________________     ${L.date}: ____________     `, { size: 20, color: MUTED }), run(`☐ ${L.approved}   ☐ ${L.changes}`, { size: 20 })]),
  ];

  const doc = new Document({
    creator: genesis ? 'Genesis' : maker,
    title: `${input.projectName} — ${L.script} v${v.label}`,
    styles: { default: { document: { run: { font: FONT, rightToLeft: !LTR } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 900, right: 900 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                bidirectional: !LTR,
                alignment: AlignmentType.CENTER,
                children: [run(`${showProject ? `${input.projectName} · ` : ''}${L.script} v${v.label} · ${L.page} `, { size: 16, color: MUTED }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED, font: FONT })],
              }),
            ],
          }),
        },
        children: [...header, table, ...approval],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
