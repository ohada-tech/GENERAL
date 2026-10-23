/**
 * דוח ה-QA הקריאייטיבי של גרסת תסריט (ChatGPT): ציון מתוך 100 עם ראיות, מה זוהה, בדיקות קוד ולאן חזרנו.
 * תסריט שלא עבר מסומן בבירור — הוא לא מוצג כאילו אושר.
 */
import { QA_DETECTORS, QA_PASS_EACH, QA_PASS_TOTAL, QA_RUBRIC, QA_STAGES, type QaCriterion, type QaDetector, type QaReport } from '@apos/shared';
import { Icon } from './Icon';
import { useState } from 'react';

export function QaPanel({ qa }: { qa: QaReport }) {
  const [open, setOpen] = useState(!qa.passed);
  const found = (Object.keys(QA_DETECTORS) as QaDetector[]).filter((k) => qa.detectors[k]?.found);
  return (
    <section className={`card stack qa-panel ${qa.passed ? 'qa-pass' : 'qa-fail'}`}>
      <button className="row between gap-s qa-head" onClick={() => setOpen((x) => !x)}>
        <strong>
          <Icon n={qa.passed ? 'checkCircle' : 'block'} /> QA קריאייטיבי: {qa.total}/100
        </strong>
        <span className="small muted">
          {qa.passed ? `עבר (רף ${QA_PASS_TOTAL})` : `לא עבר — ${QA_STAGES[qa.failStage as keyof typeof QA_STAGES] ?? qa.failStage}`} · {qa.rounds} סבבים · {qa.judge} {open ? '▴' : '▾'}
        </span>
      </button>
      {qa.needsOwner && <div className="notice warn small">עברו {qa.rounds} סבבים והתסריט עדיין לא עומד ברף. זו לא גרסה מאושרת — צריך החלטה שלך: כיוון אחר, כתיבה מחדש עם הנחיה, או לעבוד ממנה.</div>}
      {open && (
        <>
          <div className="qa-grid">
            {(Object.keys(QA_RUBRIC) as QaCriterion[]).map((k) => {
              const s = qa.scores[k]?.score ?? 0;
              const max = QA_RUBRIC[k].max;
              const ok = s >= max * QA_PASS_EACH;
              return (
                <div key={k} className="qa-row">
                  <div className="row between small">
                    <span>{QA_RUBRIC[k].label}</span>
                    <strong className={ok ? 'ok-text' : 'warn-text'}>
                      {s}/{max}
                    </strong>
                  </div>
                  <div className="qa-bar">
                    <span style={{ width: `${(s / max) * 100}%` }} className={ok ? 'ok' : 'low'} />
                  </div>
                  {qa.scores[k]?.evidence && <div className="small muted">{qa.scores[k].evidence}</div>}
                </div>
              );
            })}
          </div>
          {found.length > 0 && (
            <List title="מה זוהה" items={found.map((k) => `${QA_DETECTORS[k]} — ${qa.detectors[k]?.evidence ?? ''}`)} />
          )}
          <List title="כשלים קריטיים" items={qa.critical} />
          <List title="טענות לא מבוססות" items={qa.unsupportedClaims} />
          <List title="נמדד בקוד" items={qa.codeChecks} />
          {!qa.passed && <List title="מה לתקן (שורש הבעיה)" items={qa.fixes} />}
        </>
      )}
    </section>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="small">
      <strong>{title}</strong>
      <ul className="qa-list">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
