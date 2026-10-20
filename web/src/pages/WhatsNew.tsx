/** "מה חדש": מה השתנה בכל גרסה של המערכת */
import { RELEASES } from '@apos/shared';
import { fmtDate } from '../lib/format';

export function WhatsNew() {
  return (
    <div className="page whats-new">
      {RELEASES.map((r) => (
        <article key={r.version} className="wn-release">
          <header className="wn-head">
            <span className="wn-version">AP {r.version}</span>
            <span className="small muted">{fmtDate(r.date)}</span>
          </header>
          <h1 className="wn-headline">{r.headline}</h1>
          <div className="wn-groups">
            {r.groups.map((g) => (
              <section key={g.title} className="card wn-group">
                <h2>{g.title}</h2>
                <ul>
                  {g.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
