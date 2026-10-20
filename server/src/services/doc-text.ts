/**
 * טקסט מקובץ שמצרפים להנחיה (שיפור תסריט): Word, טקסט או Markdown.
 * PDF לא נתמך כרגע — צריך ספרייה נוספת.
 */
import { GateError } from '../context.js';
import { parseDocx } from './client-feedback.js';

export const DOC_TEXT_LIMIT = 15_000;

export function extractDocText(name: string, data: Buffer): { name: string; text: string; truncated: boolean } {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  let text: string;
  if (ext === 'docx') {
    const p = parseDocx(data);
    const tables = p.tables.map((t) => t.map((row) => row.join(' | ')).join('\n'));
    const comments = p.comments.map((c) => `[הערה${c.author ? ` של ${c.author}` : ''}] ${c.text}`);
    text = [...p.paragraphs, ...tables, ...comments].join('\n');
  } else if (['txt', 'md', 'markdown', 'csv'].includes(ext)) {
    text = data.toString('utf8').replace(/^﻿/, '');
  } else if (ext === 'pdf') {
    throw new GateError('PDF עוד לא נתמך — שמור כ-Word או העתק את הטקסט להנחיה', 400);
  } else {
    throw new GateError('אפשר לצרף Word (.docx), טקסט (.txt) או Markdown (.md)', 400);
  }
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new GateError('לא נמצא טקסט בקובץ', 400);
  return { name, text: text.slice(0, DOC_TEXT_LIMIT), truncated: text.length > DOC_TEXT_LIMIT };
}
