import { useEffect, useState } from 'react';
import { canPromptInstall, isInstalledApp, onInstallChange, promptInstall } from '../lib/install';
import { Modal } from './ui';
import { Icon } from './Icon';

/** כפתור "התקן כאפליקציה" — נעלם כשהמערכת כבר פתוחה כאפליקציה */
export function InstallApp() {
  const [, force] = useState(0);
  const [help, setHelp] = useState(false);
  useEffect(() => onInstallChange(() => force((n) => n + 1)), []);
  if (isInstalledApp()) return null;
  const onClick = async () => {
    if (canPromptInstall()) await promptInstall();
    else setHelp(true);
  };
  return (
    <>
      <button className="btn-link small install-link" onClick={onClick} title="התקן את המערכת כאפליקציה במחשב — חלון נפרד, בלי הדפדפן">
        <Icon n="download" /> התקן אפליקציה
      </button>
      {help && (
        <Modal title="התקנת המערכת כאפליקציה במחשב" onClose={() => setHelp(false)}>
          <div className="stack">
            <p>
              <b>Chrome או Edge (Windows / Mac):</b> לחץ על סמל ההתקנה בצד שורת הכתובת (מסך עם חץ <Icon n="download" />), או בתפריט ⋮ ←{' '}
              <b>"שמירה ושיתוף" ← "התקנת הדף כאפליקציה"</b> (ב-Edge: <b>אפליקציות ← "התקן אתר זה כאפליקציה"</b>).
            </p>
            <p>
              <b>Safari ב-Mac:</b> תפריט <b>קובץ ← "הוסף ל-Dock"</b>.
            </p>
            <p className="muted small">
              אחרי ההתקנה המערכת נפתחת בחלון משלה עם אייקון בשולחן העבודה, בשורת המשימות או ב-Dock — בלי לשוניות ובלי שורת כתובת. ההתחברות נשמרת.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
