import { useEffect, useState } from 'react';
import { APP_VERSION } from '@apos/shared';
import { WhatsNew } from './pages/WhatsNew';
import { Link, Route, Routes } from 'react-router-dom';
import { BrandLockup } from './components/Brand';
import { KeysModal, KeysTag, type Keys, type KeyStatus } from './components/Keys';
import { Login } from './components/Login';
import { NotificationBell } from './components/NotificationBell';
import { UrgentInbox } from './components/UrgentInbox';
import { ThemeToggle } from './components/ThemeToggle';
import { TimerWidget } from './components/TimerWidget';
import { Loading, Tag } from './components/ui';
import { api, isCloud, useApi } from './lib/api';
import { Dashboard } from './pages/Dashboard';
import { LessonsPage } from './pages/LessonsPage';
import { InstallApp } from './components/InstallApp';
import { DevChat } from './components/DevChat';
import { ProjectPage } from './pages/ProjectPage';
import { Icon, IconDefs } from './components/Icon';

export interface Health {
  ok: boolean;
  owner: string;
  openai: KeyStatus & { defaultModel: string };
  keys?: Keys;
  /** מנוע ה-AI: openai (שרת, עם מפתחות) או claude (בגרסת הענן של claude.ai, מובנה) */
  engine?: 'openai' | 'claude';
  providers: Array<{ id: string; label: string; configured: boolean; demo: boolean }>;
}

/** שער התחברות: בשרת הענן נדרשת סיסמה; מקומית ובגרסת claude.ai — לא. */
export function App() {
  const me = useApi<{ authRequired: boolean; authenticated: boolean }>(isCloud() ? null : '/api/auth/me');
  useEffect(() => {
    const on = () => void me.reload();
    window.addEventListener('apos:unauthorized', on);
    return () => window.removeEventListener('apos:unauthorized', on);
  }, [me.reload]);
  if (!isCloud() && me.loading && !me.data) return <Loading />;
  if (me.data?.authRequired && !me.data.authenticated) return <Login onDone={me.reload} />;
  return <Shell canLogout={!!me.data?.authRequired} />;
}

function Shell({ canLogout }: { canLogout: boolean }) {
  const health = useApi<Health>('/api/health', { pollMs: 30000 });
  const [keysOpen, setKeysOpen] = useState(false);
  const logout = async () => {
    await api.post('/api/auth/logout');
    window.dispatchEvent(new Event('apos:unauthorized'));
  };
  return (
    <div className="app">
      <IconDefs />
      <header className="topbar">
        <Link to="/" className="brand" aria-label="AI Production AP — לדשבורד">
          <BrandLockup />
        </Link>
        <Link to="/whats-new" className="version-badge" title="מה חדש בגרסה">
          AP {APP_VERSION}
        </Link>
        <div className="topbar-side">
          {!isCloud() && <InstallApp />}
          <Link to="/learning" className="btn-link small" title="ספר הידע והכללים שהמערכת למדה">
            <Icon n="brain" holo /> המוח
          </Link>
          <TimerWidget />
          {health.error ? (
            <Tag tone="danger">השרת לא זמין</Tag>
          ) : health.data?.engine === 'claude' ? (
            health.data.openai.verified ? (
              <Tag tone="auto" title="כתיבת תסריטים וסטורי בורד רצה דרך Claude בחשבון claude.ai שלך — בלי מפתח ובלי הגדרות">
                AI מחובר ✓ · Claude
              </Tag>
            ) : (
              <Tag tone="warn" title={health.data.openai.lastError ?? undefined}>
                AI לא זמין כאן
              </Tag>
            )
          ) : (
            <KeysTag keys={health.data?.keys} onClick={() => setKeysOpen(true)} />
          )}
          {!isCloud() && <ThemeToggle />}
          <UrgentInbox />
          <NotificationBell />
          {canLogout && (
            <button className="btn-link small" onClick={logout} title="יציאה">
              יציאה
            </button>
          )}
        </div>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/learning" element={<LessonsPage />} />
          <Route path="/whats-new" element={<WhatsNew />} />
          <Route path="/projects/:id" element={<ProjectPage health={health.data} />} />
          <Route path="/projects/:id/:tab" element={<ProjectPage health={health.data} />} />
          <Route path="*" element={<div className="empty">העמוד לא נמצא. <Link to="/">לדשבורד</Link></div>} />
        </Routes>
      </main>
      {!isCloud() && <DevChat />}
      {keysOpen && health.data?.keys && <KeysModal keys={health.data.keys} onClose={() => setKeysOpen(false)} onChanged={health.reload} />}
    </div>
  );
}
