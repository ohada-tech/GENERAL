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
import { computeTiming, STORY_ROLE_LABELS, type ScriptVersion } from '@apos/shared';
import { REPO_ROOT } from '../config.js';

const FONT = 'Arial';
const INK = '1A1A1F';
const MUTED = '6B6B78';
const ACCENT = '7A5CFA';
const HEAD_BG = 'F1EEFF';
const LINE = 'D9D6E6';

const run = (text: string, o: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}) =>
  new TextRun({ text, font: FONT, rightToLeft: true, bold: o.bold, italics: o.italics, size: o.size ?? 22, color: o.color ?? INK });

const para = (children: TextRun[] | string, o: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; before?: number } = {}) =>
  new Paragraph({
    bidirectional: true,
    alignment: o.align ?? AlignmentType.RIGHT,
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

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' });

export async function scriptDocx(input: {
  version: ScriptVersion;
  projectName: string;
  clientName: string;
  language: string;
  targetSec: number | null;
  studio?: string;
}): Promise<Buffer> {
  const { version: v } = input;
  const c = v.content;
  const timing = computeTiming(c, input.language, input.targetSec);
  const total = timing.totalSec || timing.narrationSec;
  const img = logo();

  const header: Paragraph[] = [
    ...(img ? [new Paragraph({ alignment: AlignmentType.RIGHT, children: [img], spacing: { after: 60 } })] : []),
    para([run(input.studio ?? 'Ohad Alfi · AI Production Studio', { size: 18, color: MUTED })], { after: 280 }),
    para([run(c.title || input.projectName, { bold: true, size: 40 })], { after: 100 }),
    ...(c.logline ? [para([run(c.logline, { size: 24, color: MUTED, italics: true })], { after: 200 })] : []),
    para(
      [
        run('פרויקט: ', { bold: true, size: 20 }),
        run(input.projectName, { size: 20 }),
        ...(input.clientName ? [run('   ·   לקוח: ', { bold: true, size: 20 }), run(input.clientName, { size: 20 })] : []),
      ],
      { after: 40 },
    ),
    para(
      [
        run('גרסה: ', { bold: true, size: 20 }),
        run(`v${v.version}`, { size: 20 }),
        run('   ·   תאריך: ', { bold: true, size: 20 }),
        run(fmtDate(v.createdAt), { size: 20 }),
        ...(total ? [run('   ·   אורך משוער: ', { bold: true, size: 20 }), run(`${Math.round(total)} שניות`, { size: 20 })] : []),
      ],
      { after: 300 },
    ),
  ];

  const W = { n: 8, narration: 36, screen: 20, visual: 28, dur: 8 };
  const headRow = new TableRow({
    tableHeader: true,
    children: [
      cell([para([run('#', { bold: true, size: 20, color: ACCENT })])], W.n, { head: true }),
      cell([para([run('קריינות', { bold: true, size: 20, color: ACCENT })])], W.narration, { head: true }),
      cell([para([run('טקסט על המסך', { bold: true, size: 20, color: ACCENT })])], W.screen, { head: true }),
      cell([para([run('מה רואים', { bold: true, size: 20, color: ACCENT })])], W.visual, { head: true }),
      cell([para([run('שניות', { bold: true, size: 20, color: ACCENT })])], W.dur, { head: true }),
    ],
  });
  const rows = c.scenes.map(
    (s, i) =>
      new TableRow({
        cantSplit: true,
        children: [
          cell(
            [para([run(String(i + 1), { bold: true, size: 22 })], { after: 20 }), para([run(STORY_ROLE_LABELS[s.storyRole] ?? '', { size: 16, color: MUTED })])],
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
    visuallyRightToLeft: true,
    borders,
  });

  const approval = [
    para([run('הערות ואישור הלקוח', { bold: true, size: 24 })], { before: 400, after: 160 }),
    para([run('הערות: ______________________________________________________________', { size: 20, color: MUTED })], { after: 200 }),
    para([run('______________________________________________________________________', { size: 20, color: MUTED })], { after: 280 }),
    para([run('שם: ____________________     תאריך: ____________     ', { size: 20, color: MUTED }), run('☐ מאושר   ☐ נדרשים שינויים', { size: 20 })]),
  ];

  const doc = new Document({
    creator: input.studio ?? 'Ohad Alfi · AI Production Studio',
    title: `${input.projectName} — תסריט v${v.version}`,
    styles: { default: { document: { run: { font: FONT, rightToLeft: true } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 900, right: 900 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                bidirectional: true,
                alignment: AlignmentType.CENTER,
                children: [run(`${input.projectName} · תסריט v${v.version} · עמוד `, { size: 16, color: MUTED }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED, font: FONT })],
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
