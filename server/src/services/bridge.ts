/**
 * גשר למנוי ChatGPT: כשה-API של OpenAI לא זמין (אין קרדיט / אין מפתח), בקשות של ChatGPT עוברות לתור,
 * ועובד מקומי במחשב של אוהד מריץ אותן על חשבון ChatGPT: ~/.apos/chrome-bridge.cjs (הצ'אט הרגיל ב-Chrome)
 * או ~/.apos/codex-bridge.cjs (Codex). שם העובד נגמר ב-"-chrome" או "-codex".
 * עובד רק כשהמחשב דלוק והעובד רץ; בלעדיו — השגיאה המקורית של ה-API.
 * מצבים: off (רק API) · fallback (ברירת מחדל: API, ואם נכשל — המנוי) · always (רק המנוי).
 * שני מנועים, תור לכל אחד: chatgpt (העובד ב-Chrome / Codex) ו-claude (~/.apos/claude-bridge.cjs — Claude Code על מנוי Max).
 */
import { randomUUID } from 'node:crypto';
import type { Ctx } from '../context.js';
import { ProviderError } from '../providers/types.js';

export type BridgeMode = 'off' | 'fallback' | 'always';
export type BridgeEngine = 'chatgpt' | 'claude';
export const BRIDGE_ENGINES: BridgeEngine[] = ['chatgpt', 'claude'];
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
  constructor(readonly engine: BridgeEngine) {}
  mode: BridgeMode = 'fallback';
  /** ה-API החזיר "אין קרדיט" (לתצוגה בסרגל העליון). מתאפס כשה-API עובד שוב */
  apiQuotaError: string | null = null;
  lastSeen = 0;
  worker = '';
  private pending = new Map<string, Pending>();
  private waiters: Array<() => void> = [];

  /** איזה מנוע עונה עכשיו — לתיוג הגרסאות ולהודעות */
  label() {
    if (this.engine === 'claude') return 'Claude Code (מנוי)';
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
    if (result.error && /לא מחובר ל-ChatGPT|not logged in/i.test(result.error))
      // לא תקלה: מחכים שאוהד יתחבר בחלון הגשר (ראו failJob) — בלי לשרוף ניסיונות
      p.reject(new ProviderError("ChatGPT לא מחובר בחלון Chrome של הגשר — צריך להתחבר שם פעם אחת, והכתיבה תמשיך לבד.", true, 'bridge_login'));
    else if (result.error) p.reject(new ProviderError(`${this.label()} נכשל: ${result.error.slice(0, 300)}`, true, 'bridge_error'));
    else p.resolve(String(result.text ?? ''));
    return true;
  }

  status() {
    return { mode: this.mode, online: this.online(), worker: this.worker, engine: this.label(), kind: this.engine, lastSeen: this.lastSeen ? new Date(this.lastSeen).toISOString() : null, pending: this.pending.size };
  }
}

/** גשר לכל מנוע — יחיד לכל השרת. `bridge` = ChatGPT (השם הישן) */
export const bridges: Record<BridgeEngine, Bridge> = { chatgpt: new Bridge('chatgpt'), claude: new Bridge('claude') };
export const bridge = bridges.chatgpt;
export const claudeBridge = bridges.claude;

export const engineOf = (v: unknown): BridgeEngine => (v === 'claude' ? 'claude' : 'chatgpt');
const modeKey = (e: BridgeEngine) => (e === 'chatgpt' ? 'bridge_mode' : `bridge_mode_${e}`);

/** הגשר לא מחובר: המשימה מחכה בתור ולא נכשלת (ראו failJob) */
export function bridgeOffline(engine: BridgeEngine = 'chatgpt') {
  const who = engine === 'claude' ? 'Claude Code במחשב' : "ChatGPT בצ'אט (Chrome)";
  return new ProviderError(`ממתין ל-${who} — המחשב כבוי או שהגשר לא רץ. ימשיך לבד כשיחזור.`, true, 'bridge_offline');
}

export function loadBridgeMode(ctx: Ctx) {
  for (const e of BRIDGE_ENGINES) {
    const v = (ctx.db.prepare('SELECT value FROM meta WHERE key = ?').get(modeKey(e)) as { value: string } | undefined)?.value;
    if (v && (BRIDGE_MODES as string[]).includes(v)) bridges[e].mode = v as BridgeMode;
  }
}

export function setBridgeMode(ctx: Ctx, mode: string, engine: BridgeEngine = 'chatgpt') {
  if (!(BRIDGE_MODES as string[]).includes(mode)) throw new ProviderError('מצב גשר לא מוכר', false, 'bad_request');
  bridges[engine].mode = mode as BridgeMode;
  ctx.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(modeKey(engine), mode);
  return bridges[engine].status();
}
