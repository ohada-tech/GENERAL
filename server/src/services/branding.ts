/**
 * מיתוג הקבצים שיוצאים ללקוח, לפי פרויקט: Genesis (הלוגו של Genesis בגדול, השם שלך בקטן) או הסטודיו שלך.
 * הלוגו של Genesis מועלה פעם אחת מהמערכת ונשמר בתיקיית הנתונים — לא בריפו.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GateError, type Ctx } from '../context.js';

export interface BrandImage {
  data: Buffer;
  type: 'png' | 'jpg';
  width: number;
  height: number;
}

const dir = (ctx: Ctx) => path.join(ctx.config.dataDir, 'brand');
const file = (ctx: Ctx, type: 'png' | 'jpg') => path.join(dir(ctx), `genesis-logo.${type}`);

/** מידות תמונה מתוך הכותרת (PNG / JPEG) — כדי לשמור על יחס הלוגו בקובץ ה-Word */
export function imageSize(buf: Buffer): { type: 'png' | 'jpg'; width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let p = 2;
    while (p + 9 < buf.length) {
      if (buf[p] !== 0xff) return null;
      const marker = buf[p + 1];
      const len = buf.readUInt16BE(p + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpg', height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7) };
      }
      p += 2 + len;
    }
  }
  return null;
}

export function genesisLogo(ctx: Ctx): BrandImage | null {
  for (const type of ['png', 'jpg'] as const) {
    const p = file(ctx, type);
    if (!fs.existsSync(p)) continue;
    const data = fs.readFileSync(p);
    const size = imageSize(data);
    if (size) return { data, ...size };
  }
  return null;
}

export function saveGenesisLogo(ctx: Ctx, data: Buffer) {
  const size = imageSize(data);
  if (!size || !size.width || !size.height) throw new GateError('אפשר להעלות לוגו בפורמט PNG או JPG', 400);
  fs.mkdirSync(dir(ctx), { recursive: true });
  for (const t of ['png', 'jpg'] as const) fs.rmSync(file(ctx, t), { force: true });
  fs.writeFileSync(file(ctx, size.type), data);
  return brandStatus(ctx);
}

export function removeGenesisLogo(ctx: Ctx) {
  for (const t of ['png', 'jpg'] as const) fs.rmSync(file(ctx, t), { force: true });
  return brandStatus(ctx);
}

export function brandStatus(ctx: Ctx) {
  const logo = genesisLogo(ctx);
  return { genesisLogo: logo ? { type: logo.type, width: logo.width, height: logo.height } : null };
}
