/**
 * "🎯 כיוון קריאייטיב": ChatGPT מציע 3 רעיונות שונים, אוהד בוחר אחד (או כותב בעצמו),
 * והתסריט נכתב סביבו. הבחירה נשמרת באפיון (brief.concept).
 */
import { useState } from 'react';
import { api, useAction } from '../lib/api';
import { InlineError } from './ui';

interface Concept {
  title: string;
  idea: string;
  hook: string;
  story: string;
  why: string;
}

const asText = (c: Concept) => [`${c.title}: ${c.idea}`, c.hook && `הוק: ${c.hook}`, c.story && `איך זה נבנה: ${c.story}`].filter(Boolean).join('\n');

export function ConceptPicker({ projectId, value, onChange, beforeRun }: { projectId: string; value: string; onChange: (v: string) => Promise<void> | void; beforeRun: () => Promise<unknown> }) {
  const act = useAction();
  const [options, setOptions] = useState<Concept[]>([]);

  const propose = async () => {
    await beforeRun();
    const r = await act.run(() => api.post<{ concepts: Concept[] }>(`/api/projects/${projectId}/concepts`));
    if (r) setOptions(r.concepts);
  };

  return (
    <section className="card stack concept-picker">
      <div className="row between wrap gap-s">
        <div>
          <h2>🎯 כיוון קריאייטיב</h2>
          <div className="small muted">רעיון אחד שהצופה זוכר. ChatGPT מציע 3 כיוונים שונים, אתה בוחר, והתסריט נכתב סביבו.</div>
        </div>
        <button className="btn" disabled={act.busy} onClick={propose}>
          {act.busy ? 'ChatGPT חושב…' : options.length ? '3 כיוונים חדשים' : '🎯 הצע 3 כיוונים'}
        </button>
      </div>

      {options.length > 0 && (
        <div className="concept-grid">
          {options.map((c) => {
            const chosen = value.trim() === asText(c);
            return (
              <div key={c.title + c.idea} className={`concept-card ${chosen ? 'chosen' : ''}`}>
                <strong>{c.title}</strong>
                <div className="concept-idea">{c.idea}</div>
                {c.hook && (
                  <div className="small">
                    <span className="muted">הוק: </span>„{c.hook}”
                  </div>
                )}
                {c.story && <div className="small muted">{c.story}</div>}
                {c.why && <div className="small muted">למה זה עובד: {c.why}</div>}
                <button className={`btn btn-sm ${chosen ? '' : 'btn-primary'}`} disabled={chosen} onClick={() => onChange(asText(c))}>
                  {chosen ? '✓ נבחר' : 'בחר בכיוון הזה'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <label className="field">
        <span className="field-label small">הכיוון שנבחר {value.trim() ? '' : '(ריק: ChatGPT יבחר רעיון בעצמו)'}</span>
        <textarea rows={value.trim() ? 3 : 2} defaultValue={value} key={value} onBlur={(e) => e.target.value !== value && onChange(e.target.value)} placeholder="אפשר גם לכתוב כיוון בעצמך: הרעיון במשפט אחד + ההוק" />
      </label>
      <InlineError error={act.error} onClose={act.clearError} />
    </section>
  );
}
