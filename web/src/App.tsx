import { Link, Route, Routes } from 'react-router-dom';
import { BrandLockup } from './components/Brand';
import { NotificationBell } from './components/NotificationBell';
import { ThemeToggle } from './components/ThemeToggle';
import { TimerWidget } from './components/TimerWidget';
import { Tag } from './components/ui';
import { useApi } from './lib/api';
import { Dashboard } from './pages/Dashboard';
import { ProjectPage } from './pages/ProjectPage';

export interface Health {
  ok: boolean;
  owner: string;
  openai: { configured: boolean; defaultModel: string };
  providers: Array<{ id: string; label: string; configured: boolean; demo: boolean }>;
}

export function App() {
  const health = useApi<Health>('/api/health', { pollMs: 30000 });
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Production OS — לדשבורד">
          <BrandLockup />
        </Link>
        <div className="topbar-side">
          <TimerWidget />
          {health.error ? (
            <Tag tone="danger">השרת לא זמין</Tag>
          ) : health.data ? (
            health.data.openai.configured ? (
              <Tag tone="auto" title={`מודל ברירת מחדל: ${health.data.openai.defaultModel}`}>
                OpenAI מחובר
              </Tag>
            ) : (
              <Tag tone="warn" title="הגדר OPENAI_API_KEY בקובץ .env בשרת">
                OpenAI לא מוגדר
              </Tag>
            )
          ) : null}
          <ThemeToggle />
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
    </div>
  );
}
