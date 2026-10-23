/**
 * "שלח ללקוח": קישור פרטי לתסריט + הודעת וואטסאפ מוכנה בסגנון של אוהד + מעקב אם הלקוח פתח.
 */
import type { ScriptVersion } from '@apos/shared';
import { useEffect, useState } from 'react';
import { api, useAction, useApi } from '../lib/api';
import { fmtDateTime, fmtRelative } from '../lib/format';
import { InlineError, Modal, Tag } from './ui';
import { Icon } from './Icon';

interface Link {
  token: string;
  url: string;
  label: string;
  lang: 'he' | 'en' | null;
  createdAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
}

function message(title: string, label: string, url: string) {
  return [`היי, מה שלומך?`, `מצרף את התסריט לסרטון${title ? ` (${title})` : ''}, גרסה v${label}:`, url, `אשמח לשמוע מה דעתך, בזמנך :)`].join('\n');
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ShareDialog({ version, lang, onClose }: { version: ScriptVersion; lang: 'he' | 'en' | null; onClose: () => void }) {
  const act = useAction();
  const links = useApi<{ links: Link[] }>(`/api/scripts/${version.id}/shares`, { pollMs: 10000 });
  const [link, setLink] = useState<Link | null>(null);
  const [text, setText] = useState('');
  const [copied, setCopied] = useState<'link' | 'msg' | null>(null);

  // פתיחת החלון יוצרת (או מחזירה) את הקישור הפעיל לגרסה הזו
  useEffect(() => {
    void act.run(() => api.post<Link>(`/api/scripts/${version.id}/share`, { lang })).then((l) => {
      if (!l) return;
      setLink(l);
      setText(message(version.content.title, version.label, l.url));
      void links.reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version.id, lang]);

  const live = (links.data?.links ?? []).find((l) => l.token === link?.token) ?? link;
  const flash = (k: 'link' | 'msg') => {
    setCopied(k);
    window.setTimeout(() => setCopied(null), 1800);
  };
  const revoke = async () => {
    if (!link) return;
    const r = await act.run(() => api.del(`/api/share/${link.token}`));
    if (r) onClose();
  };

  return (
    <Modal title={`שלח ללקוח · v${version.label}`} onClose={onClose}>
      {!live ? (
        <div className="muted">{act.busy ? 'יוצר קישור…' : ''}</div>
      ) : (
        <div className="stack share-dialog">
          <div className="small muted">
            קישור פרטי: הלקוח פותח בכל מחשב או טלפון, בלי התחברות ובלי Word, ויכול לשמור כ-PDF. רק הדף ללקוח, בלי הערות פנימיות.
            {lang ? ` · נשלח התרגום (${lang === 'he' ? 'עברית' : 'English'})` : ''}
          </div>
          <div className="row gap-s">
            <input className="grow" dir="ltr" readOnly value={live.url} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn btn-sm" onClick={async () => (await copy(live.url)) && flash('link')}>
              {copied === 'link' ? 'הועתק ✓' : 'העתק קישור'}
            </button>
          </div>
          <label className="small muted">ההודעה לוואטסאפ (אפשר לערוך)</label>
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row gap-s wrap">
            <a className="btn btn-primary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
              פתח בוואטסאפ
            </a>
            <button className="btn" onClick={async () => (await copy(text)) && flash('msg')}>
              {copied === 'msg' ? 'הועתק ✓' : 'העתק הודעה'}
            </button>
            <a className="btn btn-ghost" href={live.url} target="_blank" rel="noopener noreferrer">
              תצוגה כמו אצל הלקוח
            </a>
          </div>
          <div className="share-status">
            {live.viewCount > 0 ? (
              <Tag tone="ok">
                <Icon n="eye" /> הלקוח פתח {live.viewCount === 1 ? 'פעם אחת' : `${live.viewCount} פעמים`} · לאחרונה {fmtRelative(live.lastViewedAt)}
              </Tag>
            ) : (
              <Tag tone="warn">עוד לא נפתח</Tag>
            )}
            <span className="small muted">נוצר {fmtDateTime(live.createdAt)}</span>
            <button className="btn-link small danger-text" onClick={revoke} disabled={act.busy} title="הקישור יפסיק לעבוד מיד">
              בטל קישור
            </button>
          </div>
        </div>
      )}
      <InlineError error={act.error} onClose={act.clearError} />
    </Modal>
  );
}
