/**
 * ממשק כלי ה-AI: דיאלוג Generative Fill, וסרגל צף מתחת לקנבס (כמו ה-Contextual Task Bar של פוטושופ):
 * פעולות לפי ההקשר (בחירה → Generative Fill; שכבה → הסרת רקע / בחירת נושא), התקדמות, ג'ובים ומעבר בין וריאציות.
 */
import { useEffect, useState } from 'react';
import type { Editor } from '../editor';
import { ai, cancelJob, dismissJob, engines, generativeFill, genGroupOf, showVariant, variantIndex, type FillEngine, type FillJob } from '../ai';
import { Modal } from './dialogs';
import { Seg, useEditor } from './widgets';

type Engines = Awaited<ReturnType<typeof engines>>;

export function GenFillDialog({ ed }: { ed: Editor }) {
  const [info, setInfo] = useState<Engines | null>(null);
  const [err, setErr] = useState('');
  const [engine, setEngine] = useState<FillEngine>('openai');
  const [prompt, setPrompt] = useState('');
  const [n, setN] = useState(1);
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('medium');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    engines().then((e) => { setInfo(e); if (!e.openai.ready) setEngine('higgsfield'); }).catch((e) => setErr(`לא הצלחתי לבדוק את המנועים: ${e.message}`));
  }, []);
  const eng = info?.[engine];
  // העלות הכוללת לכל הווריאציות
  const cost = !info ? '' : engine === 'openai'
    ? `כ-$${((info.openai.usd[quality] ?? 0) * n).toFixed(2)}`
    : `${info.higgsfield.credits * n} קרדיטים ($${(info.higgsfield.credits * n * info.higgsfield.usdPerCredit).toFixed(2)})`;
  const go = async () => {
    setSending(true);
    setErr('');
    try {
      await generativeFill(ed, { engine, prompt, n, quality });
      ed.closeDialog();
      ed.toast(engine === 'openai' ? 'Generative Fill נשלח · התוצאה תיכנס כשכבה חדשה' : 'נשלח לעובד של היגספילד · אפשר להמשיך לעבוד בינתיים', 'ok');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };
  const ready = engine === 'openai' ? !!info?.openai.ready : true;
  return (
    <Modal title="Generative Fill · מילוי גנרטיבי" onClose={() => ed.closeDialog()}
      footer={<>
        <button type="button" className="pe-btn" onClick={() => ed.closeDialog()}>ביטול</button>
        <button type="button" className="pe-btn primary" dir="rtl" disabled={!info || !ready || sending} onClick={() => void go()}>{sending ? 'שולח…' : `✨ צור${cost ? ` · ${cost}` : ''}`}</button>
      </>}>
      <div dir="rtl" className="pe-ai-dlg">
        <textarea className="pe-ai-prompt" dir="auto" rows={3} autoFocus value={prompt} placeholder="מה להוסיף באזור הנבחר? (ריק = להסיר את מה שיש שם ולהשלים מהרקע)"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ready && !sending) void go(); }} />
        <div className="pe-ai-row"><span>מנוע</span>
          <Seg value={engine} onChange={setEngine} options={[['openai', 'OpenAI · gpt-image'], ['higgsfield', 'היגספילד · Nano Banana Pro']]} />
        </div>
        {eng && <p className={`pe-hint ${eng.ready ? '' : 'warn'}`}>{eng.model} · {eng.note}</p>}
        {engine === 'openai' && (
          <div className="pe-ai-row"><span>איכות</span>
            <Seg value={quality} onChange={setQuality} options={[['low', 'טיוטה'], ['medium', 'רגילה'], ['high', 'גבוהה']]} />
          </div>
        )}
        <div className="pe-ai-row"><span>וריאציות</span>
          <Seg value={String(n) as '1' | '2' | '3'} onChange={(v) => setN(Number(v))} options={[['1', '1'], ['2', '2'], ['3', '3']]} />
        </div>
        <p className="pe-hint">העלות מוצגת על הכפתור, והלחיצה היא האישור להרצה. התוצאה נכנסת כשכבה חדשה עם מסכה מהבחירה, והמקור לא משתנה.</p>
        {err && <p className="pe-hint warn">{err}</p>}
      </div>
    </Modal>
  );
}

const STATUS_HE: Record<FillJob['status'], string> = { queued: 'ממתין', running: 'מייצר', done: 'מוכן', failed: 'נכשל', canceled: 'בוטל' };

export function AiBar({ ed }: { ed: Editor }) {
  useEditor(ed);
  const d = ed.doc, a = ed.active;
  const g = genGroupOf(ed);
  const busy = ai.busy;
  const jobs = ai.jobs.filter((j) => ed.docs.includes(j.st));
  // פעולות לפי ההקשר — רק כשאין כלי/דיאלוג שתופס את המסך
  const quiet = !d || !!ed.dialog || !!ed.live.freeTransform || !!ed.st?.qmask;
  const canBg = !!a && a.type !== 'adjust' && a.type !== 'group';
  if (!d || (quiet && !busy && !jobs.length && !g)) return null;
  return (
    <div className="pe-aibar" dir="rtl" onPointerDown={(e) => e.stopPropagation()}>
      {busy && (
        <span className="pe-ai-busy"><i className="pe-spin" />{busy.label}{busy.pct != null && ` ${busy.pct}%`}</span>
      )}
      {jobs.map((j) => (
        <span key={j.id} className={`pe-ai-job ${j.status}`}>
          {j.status !== 'failed' && <i className="pe-spin" />}
          ✨ {j.prompt.trim() ? `"${j.prompt.trim().slice(0, 24)}"` : 'הסרה ומילוי'} · {STATUS_HE[j.status]}
          {j.engine === 'higgsfield' && j.status === 'queued' && ' לעובד במחשב '}
          {j.status === 'queued' && <button type="button" onClick={() => void cancelJob(ed, j)}>ביטול</button>}
          {j.status === 'failed' && <button type="button" title={j.error} onClick={() => dismissJob(ed, j)}>×</button>}
        </span>
      ))}
      {g && (
        <span className="pe-ai-var">
          <button type="button" aria-label="הקודמת" onClick={() => showVariant(ed, g, variantIndex(g) - 1)}>›</button>
          וריאציה {variantIndex(g) + 1}/{g.children.length}
          <button type="button" aria-label="הבאה" onClick={() => showVariant(ed, g, variantIndex(g) + 1)}>‹</button>
        </span>
      )}
      {!quiet && !busy && (
        d.selection ? (
          <>
            <button type="button" className="pe-ai-act primary" onClick={() => ed.run('edit.generativeFill')}>✨ Generative Fill</button>
            <button type="button" className="pe-ai-act" onClick={() => ed.run('select.inverse')}>היפוך בחירה</button>
          </>
        ) : (
          <>
            <button type="button" className="pe-ai-act" onClick={() => ed.run('select.subject')}>✨ בחירת נושא</button>
            {canBg && <button type="button" className="pe-ai-act" onClick={() => ed.run('layer.removeBg')}>✨ הסרת רקע</button>}
          </>
        )
      )}
    </div>
  );
}
