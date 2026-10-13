/**
 * לקוח KIE (kie.ai) — מפתח אחד לתמונות, וידאו, קריינות (ElevenLabs) ומוזיקה (Suno).
 * תהליך: יצירת משימה → מזהה משימה → בדיקה חוזרת עד הצלחה/כישלון → הורדת התוצר.
 * הקרדיטים הם כסף אמיתי: קריאת יצירה מתבצעת רק ממשימה שהמשתמש אישר, ומזהה המשימה נשמר
 * מיד כדי שניסיון חוזר ימשיך לחכות לאותה משימה ולא ישלם שוב.
 */
import { ProviderError } from './types.js';

export interface KieConfig {
  apiKey: string;
  baseUrl: string;
  uploadUrl: string;
  pollMs: number;
  timeoutMinutes: number;
}

type FetchFn = typeof fetch;

export interface TaskResult {
  urls: string[];
  creditsConsumed: number | null;
}

export interface SunoTrack {
  audioUrl: string;
  duration: number | null;
  title: string;
}

const RETRYABLE = new Set([429, 433, 455, 500, 502, 503, 504]);
const FATAL_HINT = /required|invalid|allowed options|not within the range/i;

export class KieClient {
  readonly id = 'kie';
  readonly label = 'KIE (תמונה · וידאו · קול · מוזיקה)';

  constructor(
    private readonly cfg: KieConfig,
    private readonly fetchFn: FetchFn = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  isConfigured() {
    return Boolean(this.cfg.apiKey);
  }

  private headers(apiKey = this.cfg.apiKey) {
    return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  }

  private ensureKey() {
    if (!this.cfg.apiKey) {
      throw new ProviderError('KIE לא מחובר. לחץ על "מפתחות" בסרגל העליון והדבק מפתח KIE.', false, 'missing_api_key');
    }
  }

  private async call<T = any>(method: 'GET' | 'POST', path: string, body?: unknown, apiKey?: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: this.headers(apiKey),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new ProviderError(`שגיאת רשת מול KIE: ${e instanceof Error ? e.message : String(e)}`, true, 'network');
    }
    const text = await res.text();
    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      throw new ProviderError(`KIE החזיר תשובה לא תקינה (${res.status}): ${text.slice(0, 200)}`, res.status >= 500, 'bad_response');
    }
    const code = typeof j?.code === 'number' ? j.code : res.status;
    if (res.ok && (j?.code === undefined || j.code === 200)) return j as T;
    const msg = String(j?.msg ?? j?.message ?? text.slice(0, 200));
    if (code === 401) throw new ProviderError('KIE דחה את המפתח (401)', false, 'auth');
    if (code === 402) throw new ProviderError('אין מספיק קרדיטים בחשבון KIE — טען קרדיט ב-kie.ai', false, 'insufficient_credits');
    const retryable = RETRYABLE.has(code) && !(code === 500 && FATAL_HINT.test(msg));
    throw new ProviderError(`KIE החזיר ${code}: ${msg}`, retryable, `kie_${code}`);
  }

  /** בדיקת חיבור והחזרת יתרת קרדיטים — לא עולה כסף. */
  async credits(apiKey = this.cfg.apiKey): Promise<number> {
    if (!apiKey) throw new ProviderError('לא הוזן מפתח', false, 'missing_api_key');
    const j = await this.call('GET', '/api/v1/chat/credit', undefined, apiKey);
    return Number(j?.data ?? 0);
  }

  async verify(apiKey = this.cfg.apiKey): Promise<{ ok: true; credits: number } | { ok: false; code: string; message: string }> {
    try {
      return { ok: true, credits: await this.credits(apiKey) };
    } catch (e) {
      const err = e as ProviderError;
      return { ok: false, code: err.code ?? 'error', message: err.message };
    }
  }

  /** יצירת משימה במנוע הכללי (תמונה / וידאו / קול). מחזיר taskId. */
  async createTask(model: string, input: Record<string, unknown>): Promise<string> {
    this.ensureKey();
    const j = await this.call('POST', '/api/v1/jobs/createTask', { model, input });
    const taskId = j?.data?.taskId ?? j?.taskId;
    if (!taskId) throw new ProviderError('KIE לא החזיר מזהה משימה', true, 'no_task_id');
    return String(taskId);
  }

  /** ממתין לסיום משימה כללית. */
  async waitTask(taskId: string, onTick?: () => void): Promise<TaskResult> {
    this.ensureKey();
    const deadline = Date.now() + this.cfg.timeoutMinutes * 60_000;
    while (Date.now() < deadline) {
      const j = await this.call('GET', `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
      const d = j?.data ?? j;
      if (d?.state === 'success') {
        const urls = extractUrls(d);
        if (!urls.length) throw new ProviderError('KIE סיים בלי קובץ תוצר', false, 'empty_output');
        return { urls, creditsConsumed: typeof d.creditsConsumed === 'number' ? d.creditsConsumed : null };
      }
      if (d?.state === 'fail') {
        throw new ProviderError(`היצירה ב-KIE נכשלה: ${d.failMsg || d.failCode || 'ללא פירוט'}`, false, 'generation_failed');
      }
      onTick?.();
      await this.sleep(this.cfg.pollMs);
    }
    throw new ProviderError(`KIE לא סיים תוך ${this.cfg.timeoutMinutes} דקות — ננסה להמשיך לחכות`, true, 'timeout');
  }

  /** מוזיקה (Suno). callBackUrl חובה ב-API — אנחנו בודקים סטטוס בעצמנו. */
  async createMusic(body: { prompt: string; instrumental: boolean; style?: string; title?: string; model?: string }): Promise<string> {
    this.ensureKey();
    const j = await this.call('POST', '/api/v1/generate', {
      callBackUrl: 'https://example.com/apos-no-callback',
      customMode: false,
      model: body.model ?? 'V5',
      ...body,
    });
    const taskId = j?.data?.taskId ?? j?.taskId;
    if (!taskId) throw new ProviderError('KIE לא החזיר מזהה משימה למוזיקה', true, 'no_task_id');
    return String(taskId);
  }

  async waitMusic(taskId: string, onTick?: () => void): Promise<SunoTrack[]> {
    this.ensureKey();
    const deadline = Date.now() + this.cfg.timeoutMinutes * 60_000;
    while (Date.now() < deadline) {
      const j = await this.call('GET', `/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`);
      const d = j?.data ?? j;
      const status = String(d?.status ?? '');
      if (status === 'SUCCESS' || status === 'FIRST_SUCCESS') {
        const tracks = (d?.response?.sunoData ?? d?.sunoData ?? []) as any[];
        const out = tracks
          .filter((t) => t?.audioUrl)
          .map((t) => ({ audioUrl: String(t.audioUrl), duration: Number(t.duration) || null, title: String(t.title ?? '') }));
        if (out.length) return out;
      }
      if (['CREATE_TASK_FAILED', 'GENERATE_AUDIO_FAILED', 'SENSITIVE_WORD_ERROR'].includes(status)) {
        throw new ProviderError(`יצירת המוזיקה נכשלה: ${d?.errorMessage || status}`, false, 'generation_failed');
      }
      onTick?.();
      await this.sleep(this.cfg.pollMs);
    }
    throw new ProviderError(`יצירת המוזיקה לא הסתיימה תוך ${this.cfg.timeoutMinutes} דקות`, true, 'timeout');
  }

  /** הורדת תוצר. KIE מחזיר לפעמים כתובת זמנית שצריך "לפתוח" דרך download-url. */
  async download(url: string): Promise<{ data: Buffer; mime: string }> {
    let real = url;
    try {
      const j = await this.call('POST', '/api/v1/common/download-url', { url });
      if (typeof j?.data === 'string' && j.data) real = j.data;
    } catch {
      /* לא כל כתובת דורשת זאת */
    }
    let res: Response;
    try {
      res = await this.fetchFn(real, { signal: AbortSignal.timeout(300_000) });
    } catch (e) {
      throw new ProviderError(`הורדת הקובץ נכשלה: ${e instanceof Error ? e.message : String(e)}`, true, 'download');
    }
    if (!res.ok) throw new ProviderError(`הורדת הקובץ נכשלה (${res.status})`, res.status >= 500, 'download');
    return { data: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' };
  }

  /** העלאת קובץ מקומי ל-KIE (חינם, זמני ~3 ימים) כדי להשתמש בו כתמונת מקור/ייחוס. */
  async upload(data: Buffer, fileName: string, mime: string): Promise<string> {
    this.ensureKey();
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(data)], { type: mime }), fileName);
    fd.append('uploadPath', 'apos');
    fd.append('fileName', fileName);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.cfg.uploadUrl}/api/file-stream-upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
        body: fd,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      throw new ProviderError(`העלאה ל-KIE נכשלה: ${e instanceof Error ? e.message : String(e)}`, true, 'network');
    }
    const j: any = await res.json().catch(() => null);
    const url = j?.data?.fileUrl ?? j?.data?.downloadUrl;
    if (!res.ok || !(j?.success || j?.code === 200) || !url) {
      throw new ProviderError(`העלאה ל-KIE נכשלה: ${j?.msg ?? res.status}`, res.status >= 500, 'upload');
    }
    return String(url);
  }
}

export function extractUrls(d: any): string[] {
  let p: any = d?.resultJson;
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p);
    } catch {
      p = null;
    }
  }
  const list = p?.resultUrls ?? p?.result_urls ?? (p?.resultObject?.url ? [p.resultObject.url] : null) ?? (p?.url ? [p.url] : null) ?? d?.resultUrls;
  return Array.isArray(list) ? list.map(String).filter(Boolean) : [];
}
