/**
 * "🎯 כיוון קריאייטיב": הבנת המוצר (עובדות / הנחות / שאלות) ← 3 כיוונים שונים מהותית ← דירוג ובחירה של ChatGPT.
 * הבחירה נשמרת באפיון (brief.concept) והתסריט נכתב סביבה; אוהד יכול להחליף כיוון או לכתוב אחד בעצמו.
 */
import { CONCEPT_CRITERIA, CONCEPT_MIN_AVG, conceptAvg, conceptText, type Brief, type Concept, type ConceptCriterion } from '@apos/shared';
import { useState } from 'react';
import { api, useAction } from '../lib/api';
import { InlineError } from './ui';

export function ConceptPicker({
  projectId,
  brief,
  onChange,
  beforeRun,
  reload,
}: {
  projectId: string;
  brief: Brief;
  onChange: (concept: string) => Promise<void> | void;
  beforeRun: () => Promise<unknown>;
  reload: () => Promise<void> | void;
}) {
  const act = useAction();
  const [showIntel, setShowIntel] = useState(false);
  const options = brief.conceptOptions ?? [];
  const value = brief.concept ?? '';
  const intel = brief.intel;

  const propose = async () => {
    await beforeRun();
    const r = await act.run(() => api.post(`/api/projects/${projectId}/concepts`));
    if (r) await reload();
  };

  return (
    <section className="card stack concept-picker">
      <div className="row between wrap gap-s">
        <div>
          <h2>🎯 כיוון קריאייטיב</h2>
          <div className="small muted">
            קודם הבנת המוצר, אחר כך 3 כיוונים שונים מהותית. ChatGPT מדרג ובוחר את החזק (רף: {CONCEPT_MIN_AVG}/10), ואתה יכול להחליף. התסריט נכתב רק אחרי שיש כיוון.
          </div>
        </div>
        <button className="btn" disabled={act.busy} onClick={propose}>
          {act.busy ? 'ChatGPT חושב… (עד דקה)' : options.length ? '3 כיוונים חדשים' : '🎯 הצע 3 כיוונים'}
        </button>
      </div>

      {intel && (
        <div className="intel">
          <button className="btn-link small" onClick={() => setShowIntel((x) => !x)}>
            🔎 הבנת המוצר · {intel.facts.length} עובדות · {intel.assumptions.length} הנחות · {intel.openQuestions.length} שאלות פתוחות {showIntel ? '▴' : '▾'}
          </button>
          {showIntel && (
            <div className="intel-body small">
              {[
                ['קהל', intel.audience],
                ['הבעיה', intel.problem],
                ['הרצון', intel.desire],
                ['מה המוצר עושה', intel.whatItDoes],
                ['היתרון האמיתי', intel.advantage],
                ['ההצעה', intel.offer],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <strong>{k}:</strong> {v}
                  </div>
                ))}
              <IntelList title="✅ עובדות מאומתות" items={intel.facts} />
              <IntelList title="🟡 הנחות (לא נאמרות כעובדה)" items={intel.assumptions} />
              <IntelList title="❓ שאלות פתוחות" items={intel.openQuestions} />
            </div>
          )}
        </div>
      )}

      {options.length > 0 && (
        <div className="concept-grid">
          {options.map((c) => (
            <ConceptCard key={c.title + c.idea} c={c} chosen={value.trim() === conceptText(c)} onChoose={() => onChange(conceptText(c))} />
          ))}
        </div>
      )}

      <label className="field">
        <span className="field-label small">הכיוון שנבחר {value.trim() ? '' : '(ריק: נבחר אוטומטית לפני הכתיבה)'}</span>
        <textarea rows={value.trim() ? 4 : 2} defaultValue={value} key={value} onBlur={(e) => e.target.value !== value && onChange(e.target.value)} placeholder="אפשר גם לכתוב כיוון בעצמך: הרעיון במשפט אחד + ההוק" />
      </label>
      <InlineError error={act.error} onClose={act.clearError} />
    </section>
  );
}

function IntelList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <strong>{title}</strong>
      <ul>
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function ConceptCard({ c, chosen, onChoose }: { c: Concept; chosen: boolean; onChoose: () => void }) {
  const avg = conceptAvg(c);
  const scored = Object.keys(c.scores ?? {}).length > 0;
  return (
    <div className={`concept-card ${chosen ? 'chosen' : ''} ${c.rejected ? 'rejected' : ''}`}>
      <div className="row between gap-s">
        <strong>{c.title}</strong>
        {scored && <span className={`concept-score ${avg >= CONCEPT_MIN_AVG ? 'ok' : 'low'}`}>{avg.toFixed(1)}/10</span>}
      </div>
      <div className="concept-idea">{c.idea}</div>
      {c.hook && (
        <div className="small">
          <span className="muted">הוק: </span>„{c.hook}”
        </div>
      )}
      {c.insight && <div className="small muted">תובנה: {c.insight}</div>}
      {c.tension && <div className="small muted">המתח: {c.tension}</div>}
      {c.productRole && <div className="small muted">המוצר בסיפור: {c.productRole}</div>}
      {c.standout && <div className="small muted">למה יבלוט: {c.standout}</div>}
      {scored && (
        <div className="concept-crit small muted">
          {(Object.keys(CONCEPT_CRITERIA) as ConceptCriterion[]).map((k) => (
            <span key={k}>
              {CONCEPT_CRITERIA[k]} {c.scores[k] ?? '–'}
            </span>
          ))}
        </div>
      )}
      {c.verdict && <div className="small">⚖️ {c.verdict}</div>}
      {c.rejected && <div className="small warn-text">נפסל ב-QA</div>}
      <button className={`btn btn-sm ${chosen ? '' : 'btn-primary'}`} disabled={chosen} onClick={onChoose}>
        {chosen ? '✓ נבחר' : 'בחר בכיוון הזה'}
      </button>
    </div>
  );
}
