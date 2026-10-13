import { useState } from 'react';
import { api, useAction } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { ConfirmButton, Field, InlineError, Modal, Tag } from './ui';

export type KeyService = 'openai' | 'anthropic' | 'kie';

export interface KeyStatus {
  service: KeyService;
  configured: boolean;
  source: 'ui' | 'env' | null;
  last4: string | null;
  model: string;
  verified: boolean | null;
  verifiedAt: string | null;
  lastError: string | null;
  credits?: number | null;
}

export type Keys = Record<KeyService, KeyStatus>;

const META: Record<KeyService, { name: string; role: string; where: string; placeholder: string; modelHint?: string }> = {
  openai: {
    name: 'ChatGPT',
    role: 'כותב את טיוטות התסריט והסטורי בורד',
    where: 'platform.openai.com/api-keys',
    placeholder: 'sk-proj-…',
    modelHint: 'השם המדויק מ-platform.openai.com/docs/models',
  },
  anthropic: {
    name: 'Claude',
    role: 'מבקר ומשפר כל טיוטה (ומשכתב פרומפטים כשמבקשים "צור מחדש")',
    where: 'platform.claude.com/settings/keys',
    placeholder: 'sk-ant-…',
    modelHint: 'ברירת מחדל: claude-opus-5-5',
  },
  kie: {
    name: 'KIE',
    role: 'מייצר תמונות, וידאו, קריינות ומוזיקה',
    where: 'kie.ai/api-key',
    placeholder: 'המפתח מ-kie.ai',
  },
};

const ORDER: KeyService[] = ['openai', 'anthropic', 'kie'];

const ok = (s?: KeyStatus) => !!s?.configured && s.verified !== false;

/** תג בסרגל העליון: מצב שלושת החיבורים במבט אחד */
export function KeysTag({ keys, onClick }: { keys: Keys | undefined; onClick: () => void }) {
  if (!keys) return null;
  const all = ORDER.every((k) => ok(keys[k]));
  const text = ORDER.map((k) => `${META[k].name} ${ok(keys[k]) ? '✓' : '✗'}`).join(' · ');
  return (
    <button className="tag-btn" onClick={onClick} title="מפתחות API — נשמרים בשרת בלבד">
      <Tag tone={all ? 'auto' : 'warn'}>{all ? `מחובר: ${text}` : `מפתחות: ${text}`}</Tag>
    </button>
  );
}

export function KeysModal({ keys, onClose, onChanged }: { keys: Keys; onClose: () => void; onChanged: () => Promise<void> }) {
  return (
    <Modal title="חיבורים ומפתחות API" onClose={onClose} wide>
      <div className="stack">
        <p className="small muted">
          כל מפתח נבדק מול הספק לפני שהוא נשמר, ונשמר רק בשרת — לא בדפדפן ולא ב-GitHub. הבדיקה לא עולה כסף.
        </p>
        {ORDER.map((s) => (
          <KeyRow key={s} status={keys[s]} onChanged={onChanged} />
        ))}
      </div>
    </Modal>
  );
}

function KeyRow({ status, onChanged }: { status: KeyStatus; onChanged: () => Promise<void> }) {
  const m = META[status.service];
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(status.model);
  const [done, setDone] = useState<string | null>(null);
  const act = useAction();
  const base = `/api/settings/keys/${status.service}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setDone(null);
    const r = await act.run(() => api.post<KeyStatus>(base, { apiKey, model }));
    if (r) {
      setApiKey('');
      setDone(`נבדק ונשמר${r.credits != null ? ` · יתרה: ${r.credits} קרדיטים` : ''}`);
      await onChanged();
    }
  };
  const test = async () => {
    setDone(null);
    const r = await act.run(() => api.post<KeyStatus>(`${base}/test`));
    if (r) {
      setDone(r.verified ? `החיבור תקין ✓${r.credits != null ? ` · יתרה: ${r.credits} קרדיטים` : ''}` : null);
      await onChanged();
    }
  };
  const disconnect = async () => {
    await act.run(() => api.del(base));
    setDone(null);
    await onChanged();
  };

  return (
    <form className="card stack key-row" onSubmit={save}>
      <div className="row between wrap gap-s">
        <div>
          <strong>{m.name}</strong> <span className="small muted">— {m.role}</span>
        </div>
        {status.configured ? (
          <Tag tone={status.verified ? 'ok' : status.verified === false ? 'danger' : 'info'}>
            {status.verified ? 'מחובר ✓' : status.verified === false ? 'בעיה בחיבור' : 'לא נבדק'}
          </Tag>
        ) : (
          <Tag tone="warn">לא מחובר</Tag>
        )}
      </div>
      {status.configured && (
        <div className="small muted">
          מפתח שמסתיים ב-<code>…{status.last4}</code>
          {status.model && ` · מודל ${status.model}`}
          {status.credits != null && ` · יתרה: ${status.credits} קרדיטים (~$${(status.credits * 0.005).toFixed(2)})`}
          {status.verifiedAt && ` · נבדק ${fmtDateTime(status.verifiedAt)}`}
          {status.source === 'env' && ' · מוגדר בשרת'}
        </div>
      )}
      {status.verified === false && status.lastError && <div className="error-box small">{status.lastError}</div>}
      <div className={m.modelHint ? 'grid-2' : ''}>
        <Field label={status.configured ? 'החלפת מפתח (אופציונלי)' : 'מפתח API'} hint={`מ-${m.where}`}>
          <input type="password" dir="ltr" autoComplete="off" spellCheck={false} placeholder={m.placeholder} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </Field>
        {m.modelHint && (
          <Field label="מודל" hint={m.modelHint}>
            <input dir="ltr" value={model} onChange={(e) => setModel(e.target.value)} />
          </Field>
        )}
      </div>
      <InlineError error={act.error} onClose={act.clearError} />
      {done && <div className="notice ok">{done}</div>}
      <div className="row between wrap gap-s">
        <div className="row gap-s">
          {status.configured && (
            <>
              <button type="button" className="btn btn-sm" onClick={test} disabled={act.busy}>
                בדוק חיבור
              </button>
              {status.source === 'ui' && (
                <ConfirmButton onConfirm={disconnect} disabled={act.busy}>
                  נתק
                </ConfirmButton>
              )}
            </>
          )}
        </div>
        <button className="btn btn-primary btn-sm" disabled={act.busy || (!apiKey.trim() && (!status.configured || model.trim() === status.model))}>
          {act.busy ? 'בודק…' : 'שמור ובדוק'}
        </button>
      </div>
    </form>
  );
}
