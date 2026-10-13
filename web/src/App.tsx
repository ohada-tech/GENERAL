import { Link, Route, Routes } from 'react-router-dom';
import { NotificationBell } from './components/NotificationBell';
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
        <Link to="/" className="brand">
          <span className="brand-mark">▶</span> AI Production OS
        </Link>
        <div className="topbar-side">
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
