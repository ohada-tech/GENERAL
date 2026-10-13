import type { RunningTimer, StageKey } from '@apos/shared';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';

interface TimerCtx {
  running: RunningTimer | null;
  /** שניות שחלפו בטיימר הפעיל — מתעדכן כל שנייה */
  elapsed: number;
  busy: boolean;
  error: string | null;
  start: (projectId: string, stage?: StageKey, note?: string) => Promise<void>;
  stop: (note?: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** מונה שמשתנה בכל שינוי בטיימר — כדי שמסכים אחרים ירעננו */
  version: number;
}

const Ctx = createContext<TimerCtx | null>(null);

/** מצב טיימר משותף לכל האפליקציה (סרגל עליון, עמוד פרויקט, לשונית זמן). */
export function TimerProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState<RunningTimer | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const runningId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ running: RunningTimer | null }>('/api/time/running');
      const id = r.running?.id ?? null;
      if (id !== runningId.current) {
        runningId.current = id;
        setVersion((v) => v + 1);
      }
      setRunning(r.running);
    } catch {
      /* השרת לא זמין — הסרגל העליון כבר מציג זאת */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => document.visibilityState === 'visible' && void refresh(), 15000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const elapsed = running ? Math.max(0, Math.floor((now - new Date(running.startedAt).getTime()) / 1000)) : 0;

  return (
    <Ctx.Provider
      value={{
        running,
        elapsed,
        busy,
        error,
        version,
        refresh,
        start: (projectId, stage, note) => act(() => api.post(`/api/projects/${projectId}/time/start`, { stage, note })),
        stop: (note) => act(() => api.post('/api/time/stop', { note })),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useTimer() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTimer must be used inside TimerProvider');
  return c;
}
