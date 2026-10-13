import { useState } from 'react';
import { api, ApiError, useAction } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { ConfirmButton, Field, InlineError, Modal, Tag } from './ui';

export interface OpenAIStatus {
  configured: boolean;
  source: 'ui' | 'env' | null;
  last4: string | null;
  model: string;
  verified: boolean | null;
  verifiedAt: string | null;
  lastError: string | null;
}

/** תג מצב החיבור בסרגל העליון — לחיצה פותחת את חלון החיבור. */
export function OpenAITag({ status, onClick }: { status: OpenAIStatus | undefined; onClick: () => void }) {
  if (!status) return null;
  const [tone, text] = !status.configured
    ? ['warn', 'חבר OpenAI']
    : status.verified === true
      ? ['auto', 'OpenAI מחובר ✓']
      : status.verified === false
        ? ['danger', 'OpenAI: בעיה בחיבור']
        : ['info', 'OpenAI: בודק…'];
  return (
    <button className="tag-btn" onClick={onClick} title={status.lastError ?? `מודל: ${status.model}`}>
      <Tag tone={tone}>{text}</Tag>
    </button>
  );
}

/** חלון חיבור: המפתח נשלח לשרת המקומי, נבדק מול OpenAI ונשמר שם — הדפדפן לא שומר אותו. */
export function OpenAIConnectModal({
  status,
  onClose,
  onChanged,
}: {
  status: OpenAIStatus;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(status.model);
  const [done, setDone] = useState<string | null>(null);
  const act = useAction();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setDone(null);
    const r = await act.run(async () => {
      try {
        return await api.post<OpenAIStatus>('/api/settings/openai', { apiKey, model });
      } catch (err) {
        // 422 מחזיר הודעה מפורטת מהבדיקה מול OpenAI
        if (err instanceof ApiError) throw err;
        throw err;
      }
    });
    if (r) {
      setApiKey('');
      setDone(`החיבור נבדק מול OpenAI ונשמר · מודל ${r.model}`);
      await onChanged();
    }
  };

  const test = async () => {
    setDone(null);
    const r = await act.run(() => api.post<OpenAIStatus>('/api/settings/openai/test'));
    if (r) {
      setDone(r.verified ? 'החיבור תקין ✓' : null);
      await onChanged();
    }
  };

  const disconnect = async () => {
    await act.run(() => api.del('/api/settings/openai'));
    setDone(null);
    await onChanged();
  };

  return (
    <Modal title="חיבור OpenAI (ChatGPT API)" onClose={onClose}>
      <div className="stack">
        <div className="row gap-s wrap">
          {status.configured ? (
            <>
              <Tag tone={status.verified ? 'ok' : status.verified === false ? 'danger' : 'info'}>
                {status.verified ? 'מחובר ✓' : status.verified === false ? 'בעיה בחיבור' : 'לא נבדק'}
              </Tag>
              <span className="small muted">
                מפתח שמסתיים ב-<code>…{status.last4}</code> · מודל {status.model}
                {status.verifiedAt && ` · נבדק ${fmtDateTime(status.verifiedAt)}`}
              </span>
            </>
          ) : (
            <Tag tone="warn">לא מחובר</Tag>
          )}
        </div>
        {status.verified === false && status.lastError && <div className="error-box small">{status.lastError}</div>}

        <form className="stack" onSubmit={save}>
          <Field
            label={status.configured ? 'החלפת מפתח (אופציונלי)' : 'מפתח API'}
            hint="מ-platform.openai.com/api-keys. נשמר רק בשרת שבמחשב שלך — לא בדפדפן ולא ב-GitHub."
          >
            <input
              type="password"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-proj-…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>
          <Field label="מודל" hint="השם המדויק מ-platform.openai.com/docs/models. נבדק שהוא זמין לחשבון שלך.">
            <input dir="ltr" value={model} onChange={(e) => setModel(e.target.value)} />
          </Field>
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
            <button
              className="btn btn-primary"
              disabled={act.busy || (!apiKey.trim() && (!status.configured || model.trim() === status.model))}
            >
              {act.busy ? 'בודק מול OpenAI…' : 'שמור ובדוק חיבור'}
            </button>
          </div>
        </form>
        <p className="small muted">
          הבדיקה לא עולה כסף — היא רק מוודאת שהמפתח תקף ושהמודל זמין. מנוי ChatGPT אינו כולל API; נדרש קרדיט בחשבון ה-API.
        </p>
      </div>
    </Modal>
  );
}
