import { IMAGE_MODELS, KIE_USD_PER_CREDIT, VIDEO_MODELS, VOICES, type ProjectSettings } from '@apos/shared';
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

  const claudeEngine = health?.engine === 'claude';
  const k = health?.keys;
  const need = s.textProvider === 'collab' ? ['openai', 'anthropic'] : s.textProvider === 'openai' ? ['openai'] : s.textProvider === 'claude' ? ['anthropic'] : [];
  const missingKeys = k ? need.filter((x) => !k[x as 'openai'].configured).map((x) => (x === 'openai' ? 'ChatGPT' : 'Claude')) : [];

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
        <h2>מנוע כתיבה (תסריט וסטורי בורד)</h2>
        {claudeEngine ? (
          <Field label="ספק" hint="בגרסת claude.ai התסריטים נכתבים ב-Claude דרך החשבון שלך — בלי מפתח. demo = תוכן תבניתי לבדיקת הזרימה בלבד.">
            <select value={s.textProvider === 'demo' ? 'demo' : 'collab'} onChange={(e) => setS({ ...s, textProvider: e.target.value as ProjectSettings['textProvider'] })}>
              <option value="collab">Claude (מובנה)</option>
              <option value="demo">הדגמה (ללא AI)</option>
            </select>
          </Field>
        ) : (
          <>
            <div className="grid-2">
              <Field label="מי כותב" hint="שיתוף: מודל אחד כותב טיוטה והשני עובר עליה כבמאי, משפר ומסביר מה שינה.">
                <select value={s.textProvider} onChange={(e) => setS({ ...s, textProvider: e.target.value as ProjectSettings['textProvider'] })}>
                  <option value="collab">ChatGPT + Claude בשיתוף (מומלץ)</option>
                  <option value="openai">ChatGPT בלבד</option>
                  <option value="claude">Claude בלבד</option>
                  <option value="demo">הדגמה (ללא AI)</option>
                </select>
              </Field>
              {s.textProvider === 'collab' ? (
                <Field label="סדר העבודה">
                  <select value={s.collabWriter} onChange={(e) => setS({ ...s, collabWriter: e.target.value as ProjectSettings['collabWriter'] })}>
                    <option value="openai">ChatGPT כותב → Claude מבקר ומשפר</option>
                    <option value="claude">Claude כותב → ChatGPT מבקר ומשפר</option>
                  </select>
                </Field>
              ) : s.textProvider !== 'demo' ? (
                <Field label="מודל" hint="ריק = ברירת המחדל שבחיבור">
                  <input dir="ltr" value={s.textModel} onChange={(e) => setS({ ...s, textModel: e.target.value })} />
                </Field>
              ) : null}
            </div>
            {missingKeys.length > 0 && s.textProvider !== 'demo' && (
              <div className="notice warn">לא מחובר: {missingKeys.join(', ')} — לחץ על "מפתחות" בסרגל העליון. עד אז משימות הכתיבה ייחסמו עם הסבר.</div>
            )}
          </>
        )}
        <Field label="היקף השימוש ב-AI בפרויקט" group>
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
        <h2>הפקה (05–09)</h2>
        <Field label="מי מייצר תמונות וקליפים" hint="Higgsfield: Claude מריץ בשבילך (Unlimited בדפדפן, או קרדיטים דרך MCP — רק באישורך) או שאתה מעלה ידנית. KIE: אוטומטי לגמרי, בתשלום לפי שימוש.">
          <select value={s.generator} onChange={(e) => setS({ ...s, generator: e.target.value as ProjectSettings['generator'] })}>
            <option value="higgsfield">Higgsfield (דרך Claude / העלאה ידנית)</option>
            <option value="kie">KIE (אוטומטי)</option>
          </select>
        </Field>
        <div className="grid-2">
          <Field label="מודל תמונות">
            <select value={s.imageModel} onChange={(e) => setS({ ...s, imageModel: e.target.value })}>
              {IMAGE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · ~${(m.credits * KIE_USD_PER_CREDIT).toFixed(2)} לתמונה
                </option>
              ))}
            </select>
          </Field>
          <Field label="מודל הנפשה (ברירת מחדל)" hint="שוט שהסטורי בורד המליץ לו על מודל אחר — ייווצר במודל שהומלץ.">
            <select value={s.videoModel} onChange={(e) => setS({ ...s, videoModel: e.target.value, defaultAnimationModel: VIDEO_MODELS.find((v) => v.id === e.target.value)?.label.split(' · ')[0] ?? s.defaultAnimationModel })}>
              {VIDEO_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · ~${(m.creditsPerSec * m.durations[0] * KIE_USD_PER_CREDIT).toFixed(2)} לקליפ של {m.durations[0]} ש׳
                </option>
              ))}
            </select>
          </Field>
          <Field label="קול הקריינות" hint="קריינות בעברית נוצרת ב-ElevenLabs v3.">
            <select value={s.voiceId} onChange={(e) => setS({ ...s, voiceId: e.target.value })}>
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} — {v.vibe}
                </option>
              ))}
            </select>
          </Field>
          <Field label="תקרת עלות לפרויקט ($)" hint="יצירה שתעבור את התקרה נחסמת עם הסבר — אפשר להגדיל כאן.">
            <input type="number" min={0} step={1} value={s.budgetUsd} onChange={(e) => setS({ ...s, budgetUsd: Number(e.target.value) || 0 })} />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.music} onChange={(e) => setS({ ...s, music: e.target.checked })} />
          מוזיקת רקע (Suno, ~$0.05)
        </label>
        <label className="check">
          <input type="checkbox" checked={s.autoAdvance} onChange={(e) => setS({ ...s, autoAdvance: e.target.checked })} />
          אישור שלב מפעיל מיד את השלב הבא (העלות מוצגת על כפתור האישור)
        </label>
        <p className="small muted">הקריינות והעריכה נלקחות מהתסריט המאושר. אם בבריף סומן שאין קריינות — נוצרת רק מוזיקה.</p>
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
