import type { Media } from '@apos/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ConfirmButton, ErrorBox, Field, InlineError, Loading, Tag } from '../components/ui';
import { api, useAction, useApi } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import type { TabProps } from './ProjectPage';

interface VoiceoverView {
  connected: boolean;
  voiceId: string;
  model: string;
  voiceoverNeeded: boolean;
  narration: { scriptId: string; version: number; label: string; source: 'client' | 'internal' | 'draft'; text: string; chars: number; words: number; estSec: number } | null;
  takes: Media[];
}

const SOURCE: Record<'client' | 'internal' | 'draft', [string, string]> = {
  client: ['ok', 'אושר ע"י הלקוח'],
  internal: ['warn', 'אושר פנימית — עוד לא ע"י הלקוח'],
  draft: ['warn', 'טיוטה — התסריט עוד לא אושר'],
};
const STATUS: Record<Media['status'], [string, string]> = {
  generating: ['info', 'נוצר…'],
  ready: ['warn', 'ממתין לאישור'],
  approved: ['ok', 'מאושר ✓'],
  rejected: ['neutral', 'טייק קודם'],
  failed: ['danger', 'נכשל'],
};
const MODELS = [
  { id: 'eleven_v3', label: 'Eleven v3 — עברית, הכי טבעי' },
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2 — יציב (בלי עברית)' },
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5 — מהיר וזול' },
];

/** שלב הקריינות: בחירת קול, טייק מהתסריט ב-ElevenLabs, השוואה ואישור — מיד אחרי התסריט */
export function VoiceoverTab({ detail, reload }: TabProps) {
  const { project } = detail;
  const { data, error, loading, reload: reloadVo } = useApi<VoiceoverView>(`/api/projects/${project.id}/voiceover`, { pollMs: 4000 });
  const voices = useApi<{ connected: boolean; voices: Array<{ id: string; name: string; category: string; description: string }> }>('/api/elevenlabs/voices');
  const act = useAction();
  const [voiceId, setVoiceId] = useState('');
  const [model, setModel] = useState('');
  const [note, setNote] = useState('');
  const [showText, setShowText] = useState(false);
  useEffect(() => {
    if (data && !voiceId) setVoiceId(data.voiceId);
    if (data && !model) setModel(data.model);
  }, [data, voiceId, model]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reloadVo} />;
  const v = data!;
  const refresh = async () => {
    await Promise.all([reloadVo(), reload()]);
  };
  const run = async (fn: () => Promise<unknown>) => {
    const r = await act.run(fn);
    await refresh();
    return r;
  };
  const generating = v.takes.some((t) => t.status === 'generating');
  const list = voices.data?.voices ?? [];
  const n = v.narration;
  const canGenerate = v.connected && !!voiceId && !!n?.text && !generating && !act.busy;
  const generate = async () => {
    const r = await run(() => api.post(`/api/projects/${project.id}/voiceover/generate`, { voiceId, model, note }));
    if (r) setNote('');
  };
  const upload = (f: File) => run(() => api.upload(`/api/projects/${project.id}/media/upload?kind=voiceover&source=manual`, f));

  return (
    <div className="stack" dir="rtl">
      <section className="card">
        <div className="row between wrap gap-s">
          <div>
            <h2>🎙 קריינות</h2>
            <p className="small muted">
              הקריינות של התסריט בקול מ-ElevenLabs (החשבון שלך, כולל קולות משובטים). אפשר להפיק אותה מיד אחרי התסריט — היא בסיס התזמון לעריכה. הטייק המאושר נכנס לשלב הסאונד ולעריכה.
            </p>
          </div>
          <Link className="btn btn-sm btn-ghost" to={`/projects/${project.id}/production`}>
            מוזיקה ושלב הסאונד ←
          </Link>
        </div>
        {!v.voiceoverNeeded && <div className="notice warn">באפיון מסומן שאין קריינות בסרטון. אפשר עדיין להפיק — או לסמן "נדרשת קריינות" באפיון.</div>}
        {!v.connected && <div className="notice warn">ElevenLabs לא מחובר — לחץ על "מפתחות" בסרגל העליון והדבק את המפתח מ-elevenlabs.io.</div>}
        <InlineError error={act.error} onClose={act.clearError} />
      </section>

      <section className="card stack">
        <div className="row between wrap gap-s">
          <h3>הטקסט מהתסריט</h3>
          {n && (
            <span className="row gap-s wrap">
              <Tag tone={SOURCE[n.source][0]}>תסריט {n.label} · {SOURCE[n.source][1]}</Tag>
              <span className="small muted">
                {n.words} מילים · {n.chars} תווים · ~{n.estSec} שניות
              </span>
            </span>
          )}
        </div>
        {!n ? (
          <div className="muted">
            אין עדיין תסריט. <Link to={`/projects/${project.id}/script`}>לתסריט</Link>
          </div>
        ) : !n.text ? (
          <div className="muted">בתסריט אין שורות קריינות.</div>
        ) : (
          <>
            <button className="btn-link small" onClick={() => setShowText(!showText)}>
              {showText ? 'הסתר טקסט' : 'הצג את הטקסט שיוקרא'}
            </button>
            {showText && <pre className="prompt-box" dir="auto" style={{ whiteSpace: 'pre-wrap', textAlign: 'right' }}>{n.text}</pre>}
            <div className="small muted">הטקסט לא נערך כאן — תיקון בקריינות נעשה בתסריט (ChatGPT), ואז מפיקים טייק חדש.</div>
          </>
        )}
      </section>

      <section className="card stack">
        <h3>טייק חדש</h3>
        <div className="grid-2">
          <Field label="קול" hint={voices.data?.connected === false ? 'חבר ElevenLabs כדי לבחור קול' : 'הקולות מהחשבון שלך ב-ElevenLabs'}>
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
              <option value="">— בחר קול —</option>
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.category ? ` · ${x.category}` : ''}
                </option>
              ))}
              {voiceId && !list.some((x) => x.id === voiceId) && <option value={voiceId}>{voiceId}</option>}
            </select>
          </Field>
          <Field label="מודל" hint="לעברית: Eleven v3">
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {model && !MODELS.some((m) => m.id === model) && <option value={model}>{model}</option>}
            </select>
          </Field>
        </div>
        <Field label="הערה לטייק (לא חובה)" hint="נשמרת לטייק ונלמדת לפרויקטים הבאים">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="למשל: קול חם יותר, קצב איטי יותר" />
        </Field>
        <div className="row gap-s wrap">
          <ConfirmButton className="btn btn-primary" disabled={!canGenerate} onConfirm={generate} confirmLabel={`לחץ שוב — ${n?.chars ?? 0} תווים מהמכסה של ElevenLabs`}>
            <Icon n="mic" /> {v.takes.length ? 'צור טייק חדש' : 'צור קריינות'} ב-ElevenLabs
          </ConfirmButton>
          <label className="btn btn-ghost" title="קריינות שהוקלטה או נוצרה מחוץ למערכת">
            <Icon n="upload" /> העלה קובץ קריינות
            <input
              type="file"
              hidden
              accept="audio/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void upload(f);
              }}
            />
          </label>
          {generating && (
            <Tag tone="info">
              <Icon n="hourglass" /> ElevenLabs מקריא…
            </Tag>
          )}
        </div>
      </section>

      <section className="card stack">
        <h3>טייקים</h3>
        {v.takes.length === 0 ? (
          <div className="muted">עוד לא נוצרה קריינות.</div>
        ) : (
          <div className="media-grid kind-voiceover">
            {v.takes.map((t) => (
              <div key={t.id} className={`media-card st-${t.status}`}>
                <div className="row between gap-s">
                  <strong className="small">טייק {t.version}</strong>
                  <Tag tone={STATUS[t.status][0]}>{STATUS[t.status][1]}</Tag>
                </div>
                <div className="media-view">
                  {t.status === 'generating' ? (
                    <div className="media-wait">
                      <span className="spinner" /> נוצר…
                    </div>
                  ) : t.status === 'failed' ? (
                    <div className="media-wait error-text small">{t.error}</div>
                  ) : t.assetId ? (
                    <audio src={`/api/media/${t.id}/file`} controls preload="metadata" />
                  ) : (
                    <div className="media-wait small muted">אין קובץ</div>
                  )}
                </div>
                <div className="small muted">
                  {t.model || '—'}
                  {t.durationSec ? ` · ${t.durationSec.toFixed(1)} ש׳` : ''} · {fmtDateTime(t.createdAt)}
                  {voiceName(list, t)}
                </div>
                {t.note && <div className="small">הערה: {t.note}</div>}
                <div className="row gap-s wrap">
                  {t.status === 'ready' && (
                    <button className="btn btn-sm btn-primary" disabled={act.busy} onClick={() => run(() => api.post(`/api/media/${t.id}/approve`))}>
                      ✓ אשר
                    </button>
                  )}
                  {t.status === 'rejected' && t.assetId && (
                    <button className="btn btn-sm btn-ghost" disabled={act.busy} onClick={() => run(() => api.post(`/api/media/${t.id}/pick`))} title="הטייק הזה יאושר ויחליף את הנוכחי">
                      בחר את הטייק הזה
                    </button>
                  )}
                  {t.status === 'approved' && (
                    <button className="btn btn-sm btn-ghost" disabled={act.busy} onClick={() => run(() => api.post(`/api/media/${t.id}/unapprove`))}>
                      בטל אישור
                    </button>
                  )}
                  {t.assetId && t.status !== 'generating' && (
                    <a className="btn btn-sm btn-ghost" href={`/api/media/${t.id}/file?download=1`}>
                      <Icon n="download" /> הורד
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function voiceName(list: Array<{ id: string; name: string }>, t: Media) {
  const id = (t.params as { voiceId?: string }).voiceId;
  const name = id ? list.find((x) => x.id === id)?.name : '';
  return name ? ` · ${name}` : '';
}
