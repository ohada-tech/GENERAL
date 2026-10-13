import { useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { BrandLockup } from './components/Brand';
import { NotificationBell } from './components/NotificationBell';
import { OpenAIConnectModal, OpenAITag, type OpenAIStatus } from './components/OpenAIConnect';
import { ThemeToggle } from './components/ThemeToggle';
import { TimerWidget } from './components/TimerWidget';
import { Tag } from './components/ui';
import { isCloud, useApi } from './lib/api';
import { Dashboard } from './pages/Dashboard';
import { ProjectPage } from './pages/ProjectPage';

export interface Health {
  ok: boolean;
  owner: string;
  openai: OpenAIStatus & { defaultModel: string };
  /** מנוע ה-AI: openai (מקומי, עם מפתח) או claude (בגרסת הענן, מובנה) */
  engine?: 'openai' | 'claude';
  providers: Array<{ id: string; label: string; configured: boolean; demo: boolean }>;
}

export function App() {
  const health = useApi<Health>('/api/health', { pollMs: 30000 });
  const [connectOpen, setConnectOpen] = useState(false);
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="AI Production AP — לדשבורד">
          <BrandLockup />
        </Link>
        <div className="topbar-side">
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
            <OpenAITag status={health.data?.openai} onClick={() => setConnectOpen(true)} />
          )}
          {!isCloud() && <ThemeToggle />}
          <NotificationBell />
        </div>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects/:id" element={<ProjectPage health={health.data} />} />
          <Route path="/projects/:id/:tab" element={<ProjectPage health={health.data} />} />
          <Route path="*" element={<div className="empty">העמוד לא נמצא. <Link to="/">לדשבורד</Link></div>} />
        </Routes>
      </main>
      {connectOpen && health.data && health.data.engine !== 'claude' && (
        <OpenAIConnectModal status={health.data.openai} onClose={() => setConnectOpen(false)} onChanged={health.reload} />
      )}
    </div>
  );
}
