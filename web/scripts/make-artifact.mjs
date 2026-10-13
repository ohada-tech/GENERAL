// הופך את קובץ ה-HTML היחיד של גרסת הענן לעמוד Artifact (בלי doctype/html/head/body — הפלטפורמה עוטפת).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist-cloud');
const s = fs.readFileSync(path.join(dir, 'cloud.html'), 'utf8');
const head = s.match(/<head>([\s\S]*)<\/head>/)[1];
const body = s.match(/<body>([\s\S]*)<\/body>/)[1];
const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
const styles = head.match(/<style[^>]*>[\s\S]*?<\/style>/g) ?? [];
const scripts = head.match(/<script[^>]*>[\s\S]*?<\/script>/g) ?? [];
const page = [
  title,
  ...styles,
  '<style>html,body{direction:rtl}</style>',
  body.trim().replace('<div id="root"></div>', '<div id="root" dir="rtl" lang="he"></div>'),
  ...scripts,
].join('\n');
const out = path.join(dir, 'ai-production-ap.html');
fs.writeFileSync(out, page + '\n');
console.log(`artifact page → ${path.relative(process.cwd(), out)} (${(page.length / 1024 / 1024).toFixed(2)} MB)`);
