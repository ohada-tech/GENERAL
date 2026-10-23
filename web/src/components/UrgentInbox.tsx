/**
 * "⏳ מחכה לך": הודעות דחופות — סשן של Claude שנעצר ומחכה לך (אישור, Chrome, שאלה).
 * נפרד מהפעמון: כפתור אדום בסרגל העליון כל עוד יש משהו פתוח, והמספר על אייקון האפליקציה בשורת המשימות.
 */
import type { Notification } from '@apos/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useApi } from '../lib/api';
import { fmtRelative } from '../lib/format';
import { setBadge } from '../lib/push';
import { Icon } from './Icon';

export function UrgentInbox() {
  const { data, reload } = useApi<Notification[]>('/api/attention', { pollMs: 5000 });
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const pending = (data ?? []).filter((n) => !n.readAt);
  const done = (data ?? []).filter((n) => n.readAt).slice(0, 5);

  useEffect(() => setBadge(pending.length), [pending.length]);

  const go = (link: string) => {
    setOpen(false);
    if (/^https?:\/\//.test(link)) window.open(link, '_blank', 'noopener');
    else if (link && link !== '/') navigate(link);
  };
  const markDone = async (n: Notification) => {
    await api.post(`/api/attention/${n.id}/done`).catch(() => undefined);
    void reload();
  };

  if (!pending.length && !open) return null;

  return (
    <div className="urgent">
      <button className={`btn btn-sm urgent-btn ${pending.length ? 'urgent-live' : ''}`} onClick={() => setOpen((o) => !o)} aria-label="הודעות דחופות">
        <Icon n="hourglass" /> מחכה לך{pending.length ? ` · ${pending.length}` : ''}
      </button>
      {open && (
        <div className="bell-panel urgent-panel" onMouseLeave={() => setOpen(false)}>
          <div className="bell-head">
            <strong><Icon n="hourglass" /> מחכה לך</strong>
            <span className="muted small">עבודה שעומדת עד שתגיב</span>
          </div>
          {pending.length === 0 ? (
            <div className="muted pad">אין כרגע שום דבר שמחכה לך ✓</div>
          ) : (
            <ul className="bell-list">
              {pending.map((n) => (
                <li key={n.id} className="urgent-item">
                  <div className="bell-text">
                    <span className="bell-title">{n.title.replace(/^⏳\s*/, '')}</span>
                    <span className="urgent-body">{n.body}</span>
                    <span className="bell-time">{fmtRelative(n.createdAt)}</span>
                  </div>
                  <div className="row gap-s">
                    {n.link && n.link !== '/' && (
                      <button className="btn btn-sm btn-ghost" onClick={() => go(n.link)}>
                        פתח
                      </button>
                    )}
                    <button className="btn btn-sm" onClick={() => markDone(n)}>
                      ✓ טופל
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <div className="pad small muted">
              טופל לאחרונה:
              {done.map((n) => (
                <div key={n.id}>✓ {n.body.slice(0, 80)}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
