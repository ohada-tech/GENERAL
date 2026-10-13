/**
 * ElevenLabs ישירות (מפתח של המשתמש): קריינות מכל קול בחשבון — כולל קולות משובטים ומעוצבים —
 * ומוזיקה (Eleven Music). התשובה היא קובץ האודיו עצמו (סינכרוני), אין משימה לחכות לה.
 */
import { ProviderError } from './types.js';

export interface ElevenConfig {
  apiKey: string;
  baseUrl: string;
}

export interface ElevenVoice {
  id: string;
  name: string;
  category: string;
  description: string;
}

type FetchFn = typeof fetch;

export class ElevenLabsClient {
  constructor(
    private readonly cfg: ElevenConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  isConfigured() {
    return Boolean(this.cfg.apiKey);
  }

  private async call(path: string, init: RequestInit & { apiKey?: string; timeoutMs?: number } = {}) {
    const key = init.apiKey ?? this.cfg.apiKey;
    if (!key) throw new ProviderError('ElevenLabs לא מחובר — הדבק מפתח ב"מפתחות" בסרגל העליון.', false, 'missing_api_key');
    let res: Response;
    try {
      res = await this.fetchFn(`${this.cfg.baseUrl}${path}`, {
        ...init,
        headers: { 'xi-api-key': key, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
      });
    } catch (e) {
      throw new ProviderError(`שגיאת רשת מול ElevenLabs: ${e instanceof Error ? e.message : String(e)}`, true, 'network');
    }
    if (res.ok) return res;
    let msg = '';
    try {
      const j: any = await res.json();
      msg = j?.detail?.message ?? j?.detail?.status ?? (typeof j?.detail === 'string' ? j.detail : JSON.stringify(j?.detail ?? j));
    } catch {
      /* ignore */
    }
    if (res.status === 401) throw new ProviderError(`ElevenLabs דחה את המפתח: ${msg}`, false, 'auth');
    if (res.status === 402 || /quota|credits|limit/i.test(msg)) throw new ProviderError(`נגמרה המכסה ב-ElevenLabs: ${msg}`, false, 'quota');
    if (res.status === 429) throw new ProviderError(`ElevenLabs הגביל בקשות: ${msg}`, true, 'rate_limit');
    if (res.status >= 500) throw new ProviderError(`שגיאת שרת ElevenLabs (${res.status}): ${msg}`, true, 'server');
    throw new ProviderError(`ElevenLabs החזיר ${res.status}: ${msg}`, false, 'bad_request');
  }

  /** בדיקת חיבור — לא עולה כסף. מחזירה כמה תווים נשארו במכסה. */
  async verify(apiKey = this.cfg.apiKey): Promise<{ ok: true; credits?: number } | { ok: false; code: string; message: string }> {
    try {
      const res = await this.call('/v1/user/subscription', { apiKey });
      const j: any = await res.json();
      const left = Number(j?.character_limit ?? 0) - Number(j?.character_count ?? 0);
      return { ok: true, credits: Number.isFinite(left) ? left : undefined };
    } catch (e) {
      const err = e as ProviderError;
      return { ok: false, code: err.code ?? 'error', message: err.message };
    }
  }

  async voices(): Promise<ElevenVoice[]> {
    const res = await this.call('/v1/voices');
    const j: any = await res.json();
    return ((j?.voices ?? []) as any[]).map((v) => ({
      id: String(v.voice_id),
      name: String(v.name ?? ''),
      category: String(v.category ?? ''),
      description: String(v.description ?? v.labels?.description ?? ''),
    }));
  }

  async tts(text: string, voiceId: string, modelId: string) {
    const res = await this.call(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      body: JSON.stringify({ text, model_id: modelId }),
      timeoutMs: 300_000,
    });
    return Buffer.from(await res.arrayBuffer());
  }

  async music(prompt: string, lengthMs: number) {
    const res = await this.call('/v1/music', {
      method: 'POST',
      body: JSON.stringify({ prompt, music_length_ms: Math.max(3000, Math.min(600_000, Math.round(lengthMs))) }),
      timeoutMs: 600_000,
    });
    return Buffer.from(await res.arrayBuffer());
  }
}
