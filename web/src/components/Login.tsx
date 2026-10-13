import { useState } from 'react';
import { api, useAction } from '../lib/api';
import { BrandLockup } from './Brand';
import { InlineError } from './ui';

export function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const act = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await act.run(() => api.post('/api/auth/login', { password }));
    if (r) onDone();
  };
  return (
    <div className="login">
      <form className="card stack login-card" onSubmit={submit}>
        <BrandLockup />
        <h2>כניסה למערכת</h2>
        <input type="password" autoFocus autoComplete="current-password" placeholder="סיסמה" value={password} onChange={(e) => setPassword(e.target.value)} />
        <InlineError error={act.error} onClose={act.clearError} />
        <button className="btn btn-primary" disabled={act.busy || !password}>
          {act.busy ? 'נכנס…' : 'כניסה'}
        </button>
      </form>
    </div>
  );
}
