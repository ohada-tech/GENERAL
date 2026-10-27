/**
 * גשר למנוי ChatGPT: כשה-API של OpenAI לא זמין (אין קרדיט / אין מפתח), בקשות של ChatGPT עוברות לתור,
 * ועובד מקומי במחשב של אוהד מריץ אותן על חשבון ChatGPT: ~/.apos/chrome-bridge.cjs (הצ'אט הרגיל ב-Chrome)
 * או ~/.apos/codex-bridge.cjs (Codex). שם העובד נגמר ב-"-chrome" או "-codex".
 * עובד רק כשהמחשב דלוק והעובד רץ; בלעדיו — השגיאה המקורית של ה-API.
 * מצבים: off (רק API) · fallback (ברירת מחדל: API, ואם נכשל — המנוי) · always (רק המנוי).
 */
import { randomUUID } from 'node:crypto';
import type { Ctx } from '../context.js';
import { ProviderError } from '../providers/types.js';

export type BridgeMode = 'off' | 'fallback' | 'always';
export const BRIDGE_MODES: BridgeMode[] = ['off', 'fallback', 'always'];

export interface BridgeRequest {
  id: string;
  name: string;
  system: string;
  user: string;
  /** null = טקסט חופשי */
  schema: object | null;
  createdAt: number;
}

interface Pending {
  req: BridgeRequest;
  takenAt: number | null;
  resolve: (text: string) => void;
  reject: (e: Error) => void;
}

/** עובד שלא נשמע ממנו זמן כזה — נחשב מנותק */
const ONLINE_MS = 90_000;
/** כמה זמן מחכים לתשובה אחת מהמנוי (Codex עם חשיבה מעמיקה יכול לקחת כמה דקות) */
const ANSWER_MS = 15 * 60_000;

class Bridge {
  mode: BridgeMode = 'fallback';
  lastSeen = 0;
  worker = '';
  private pending = new Map<string, Pending>();
  private waiters: Array<() => void> = [];

  /** איזה מנוע עונה עכשיו — לתיוג הגרסאות ולהודעות */
  label() {
    return this.worker.endsWith('-chrome') ? "ChatGPT בצ'אט (Chrome)" : 'ChatGPT מנוי (Codex)';
  }

  online(now = Date.now()) {
    return now - this.lastSeen < ONLINE_MS;
  }

  /** האם לנסות את המנוי: always — תמיד; fallback — רק אחרי כשל של ה-API */
  usable(afterApiFailure: boolean) {
    if (this.mode === 'off' || !this.online()) return false;
    return this.mode === 'always' || afterApiFailure;
  }

  call(name: string, system: string, user: string, schema: object | null): Promise<string> {
    const req: BridgeRequest = { id: randomUUID(), name, system, user, schema, createdAt: Date.now() };
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        reject(new ProviderError(`${this.label()} לא ענה בזמן — האם המחשב דלוק והגשר רץ?`, true, 'bridge_timeout'));
      }, ANSWER_MS);
      this.pending.set(req.id, {
        req,
        takenAt: null,
        resolve: (t) => {
          clearTimeout(timer);
          resolve(t);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.waiters.splice(0).forEach((w) => w());
    });
  }

  /** העובד מושך בקשה (long-poll). בקשה שנלקחה ולא נענתה תוך 10 דקות חוזרת לתור */
  async next(worker: string, waitMs: number): Promise<BridgeRequest | null> {
    this.lastSeen = Date.now();
    this.worker = worker.slice(0, 60);
    const take = () => {
      const now = Date.now();
      for (const p of this.pending.values()) {
        if (p.takenAt === null || now - p.takenAt > 10 * 60_000) {
          p.takenAt = now;
          return p.req;
        }
      }
      return null;
    };
    const got = take();
    if (got || waitMs <= 0) return got;
    await new Promise<void>((r) => {
      const t = setTimeout(r, waitMs);
      this.waiters.push(() => {
        clearTimeout(t);
        r();
      });
    });
    this.lastSeen = Date.now();
    return take();
  }

  answer(id: string, result: { text?: string; error?: string }) {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    if (result.error) p.reject(new ProviderError(`${this.label()} נכשל: ${result.error.slice(0, 300)}`, true, 'bridge_error'));
    else p.resolve(String(result.text ?? ''));
    return true;
  }

  status() {
    return { mode: this.mode, online: this.online(), worker: this.worker, engine: this.label(), lastSeen: this.lastSeen ? new Date(this.lastSeen).toISOString() : null, pending: this.pending.size };
  }
}

/** יחיד לכל השרת — הספק של OpenAI והנתיבים חולקים אותו */
export const bridge = new Bridge();

export function loadBridgeMode(ctx: Ctx) {
  const v = (ctx.db.prepare("SELECT value FROM meta WHERE key = 'bridge_mode'").get() as { value: string } | undefined)?.value;
  if (v && (BRIDGE_MODES as string[]).includes(v)) bridge.mode = v as BridgeMode;
}

export function setBridgeMode(ctx: Ctx, mode: string) {
  if (!(BRIDGE_MODES as string[]).includes(mode)) throw new ProviderError('מצב גשר לא מוכר', false, 'bad_request');
  bridge.mode = mode as BridgeMode;
  ctx.db.prepare("INSERT INTO meta (key, value) VALUES ('bridge_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(mode);
  return bridge.status();
}
