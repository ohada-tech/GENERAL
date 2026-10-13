import { ANIMATION_MODEL_OPTIONS, IMAGE_MODEL_OPTIONS, type ProjectSettings } from '@apos/shared';
import { useEffect, useState } from 'react';
import { Field, InlineError, Tag } from '../components/ui';
import { api, useAction } from '../lib/api';
import type { TabProps } from './ProjectPage';

export function SettingsTab({ detail, reload, health }: TabProps) {
  const { project } = detail;
  const [name, setName] = useState(project.name);
  const [clientName, setClientName] = useState(project.clientName);
  const [s, setS] = useState<ProjectSettings>(project.settings);
  const [saved, setSaved] = useState(false);
  const act = useAction();
  useEffect(() => {
    setS(project.settings);
    setName(project.name);
    setClientName(project.clientName);
  }, [project.settings, project.name, project.clientName]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await act.run(() => api.patch(`/api/projects/${project.id}`, { name, clientName, settings: s }));
    if (r) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await reload();
    }
  };

  const openai = health?.providers.find((p) => p.id === 'openai');

  return (
    <form className="stack" onSubmit={save}>
      <section className="card">
        <h2>פרטי פרויקט</h2>
        <div className="grid-2">
          <Field label="שם הפרויקט" required>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="לקוח">
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>מנוע טקסט (ChatGPT)</h2>
        <div className="grid-2">
          <Field label="ספק" hint="demo מייצר תוכן תבניתי מסומן, לבדיקת הזרימה בלבד — לא תוצר AI.">
            <select value={s.textProvider} onChange={(e) => setS({ ...s, textProvider: e.target.value as ProjectSettings['textProvider'] })}>
              <option value="openai">OpenAI API {openai && !openai.configured ? '(לא מוגדר מפתח בשרת)' : ''}</option>
              <option value="demo">הדגמה (ללא AI)</option>
            </select>
          </Field>
          <Field label="מודל" hint={`ריק = ברירת המחדל של השרת (${health?.openai.defaultModel ?? '…'})`}>
            <input dir="ltr" value={s.textModel} onChange={(e) => setS({ ...s, textModel: e.target.value })} placeholder={health?.openai.defaultModel} />
          </Field>
        </div>
        {s.textProvider === 'openai' && openai && !openai.configured && (
          <div className="notice warn">
            לא הוגדר OPENAI_API_KEY בשרת. משימות AI ייכשלו ויסומנו כחסומות עד להגדרה. שים לב: מנוי ChatGPT אינו כולל גישה ל-API.
          </div>
        )}
        <Field label="היקף השימוש ב-ChatGPT בפרויקט" group>
          <div className="stack">
            <label className="check">
              <input type="radio" checked={s.chatgptScope === 'script_and_visual'} onChange={() => setS({ ...s, chatgptScope: 'script_and_visual' })} />
              תסריט + קונספט חזותי ופרומפטים לכל שוט
            </label>
            <label className="check">
              <input type="radio" checked={s.chatgptScope === 'script_only'} onChange={() => setS({ ...s, chatgptScope: 'script_only' })} />
              תסריט בלבד — שלד שוטים נבנה מהסצנות והפרומפטים נכתבים ידנית
            </label>
          </div>
        </Field>
      </section>

      <section className="card">
        <h2>אוטומציות</h2>
        <label className="check">
          <input type="checkbox" checked={s.autoGenerateScript} onChange={(e) => setS({ ...s, autoGenerateScript: e.target.checked })} />
          השלמת האפיון מפעילה אוטומטית כתיבת תסריט
        </label>
        <label className="check">
          <input type="checkbox" checked={s.autoGenerateStoryboard} onChange={(e) => setS({ ...s, autoGenerateStoryboard: e.target.checked })} />
          אישור לקוח על התסריט מפעיל אוטומטית יצירת סטורי בורד
        </label>
        <p className="small muted">אוטומציות פועלות רק אחרי נקודות האישור — אף שלב לא מתקדם בלי אישור.</p>
      </section>

      <section className="card">
        <h2>ברירות מחדל ליצירה</h2>
        <div className="grid-2">
          <Field label="מסלול תמונות" hint="ההמלצה נשמרת לכל שוט. החיבור בפועל ייבנה ב-Phase 3.">
            <select value={s.defaultImageModel} onChange={(e) => setS({ ...s, defaultImageModel: e.target.value })}>
              {IMAGE_MODEL_OPTIONS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </Field>
          <Field label="מסלול הנפשה" hint="Kling לשוטים פשוטים/מהירים, Seedance לריאליזם גבוה. ניתן לשנות לכל שוט.">
            <select value={s.defaultAnimationModel} onChange={(e) => setS({ ...s, defaultAnimationModel: e.target.value })}>
              {ANIMATION_MODEL_OPTIONS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <InlineError error={act.error} onClose={act.clearError} />
      <div className="row end gap-s">
        {saved && <Tag tone="ok">נשמר</Tag>}
        <button className="btn btn-primary" disabled={act.busy}>
          שמור הגדרות
        </button>
      </div>
    </form>
  );
}
