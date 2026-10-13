import { STAGE_BY_KEY, STATUS_LABELS, type ProjectState, type StageKey } from '@apos/shared';

const ICON: Record<string, string> = {
  completed: '✓',
  blocked: '!',
  needs_revision: '↺',
  waiting_internal: '●',
  waiting_client: '●',
  in_progress: '…',
  not_started: '',
};

export function PipelineStepper({
  state,
  compact,
  onSelect,
}: {
  state: ProjectState;
  compact?: boolean;
  onSelect?: (key: StageKey) => void;
}) {
  return (
    <ol className={`stepper ${compact ? 'stepper-compact' : ''}`}>
      {state.stages.map((s) => {
        const def = STAGE_BY_KEY[s.key];
        const current = s.key === state.currentStage;
        return (
          <li
            key={s.key}
            className={`step st-${s.status} ${current ? 'step-current' : ''} ${s.availability === 'planned' ? 'step-planned' : ''}`}
            title={`${def.number} ${def.label} — ${STATUS_LABELS[s.status].he}\n${s.detail}`}
          >
            <button type="button" className="step-btn" onClick={() => onSelect?.(s.key)} disabled={!onSelect}>
              <span className="step-dot">{ICON[s.status] || def.number}</span>
              {!compact && (
                <span className="step-text">
                  <span className="step-name">{def.label}</span>
                  <span className="step-status">
                    {s.availability === 'planned' ? `Phase ${def.phase}` : STATUS_LABELS[s.status].he}
                  </span>
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
