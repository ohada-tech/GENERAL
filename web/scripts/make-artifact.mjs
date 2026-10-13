// הופך את בניית הענן לעמוד Artifact: עמוד קטן (בלי doctype/html/head/body — הפלטפורמה עוטפת)
// שטוען את קבצי ה-JS/CSS/הגופנים שבתיקיית assets, ורשימת הקבצים לפרסום (files.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist-cloud');
const s = fs.readFileSync(path.join(dir, 'cloud.html'), 'utf8');
const head = s.match(/<head>([\s\S]*)<\/head>/)[1];
const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
const strip = (tag) => tag.replace(/\s+crossorigin(?=[\s>])/g, '').replace(/(src|href)="\.\//g, '$1="');
const styles = (head.match(/<link rel="stylesheet"[^>]*>/g) ?? []).map(strip);
const scripts = (head.match(/<script[^>]*><\/script>/g) ?? []).map(strip);
const page = [
  title,
  '<style>html,body{direction:rtl}</style>',
  ...styles,
  '<div id="root" dir="rtl" lang="he"></div>',
  ...scripts,
].join('\n');
fs.writeFileSync(path.join(dir, 'ai-production-ap.html'), page + '\n');
const files = Object.fromEntries(
  fs.readdirSync(path.join(dir, 'assets')).map((f) => [`assets/${f}`, path.join('web/dist-cloud/assets', f)]),
);
fs.writeFileSync(path.join(dir, 'files.json'), JSON.stringify(files, null, 2));
console.log(`artifact page + ${Object.keys(files).length} files → ${path.relative(process.cwd(), dir)}`);
