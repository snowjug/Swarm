import { Button, Notice } from '../../design/ui';
import { RULES_FALLBACK_LABEL } from '../../../../shared/model-failure';
import type { ModelStop } from '../../hooks/useStakeholders';
import './model-stop.css';

export interface ModelStopProps {
  stopped: ModelStop;
  /** What the participant is called, for a stop while one was proposed again. */
  participantName?: string | null;
  /** Whether a change is under way: the choices wait for it. */
  busy: boolean;
  may: { edit: boolean; run: boolean };
  /** Whether there is a list to edit; if not, editing starts one by hand. */
  hasList: boolean;
  onRetry: () => void;
  onEdit: () => void;
  onRules: () => void;
}

/**
 * What the page says when the model was asked for the participants and could not be used. It stops there:
 * nothing was kept, the list is as it was, and no list made some other way stands in for the model's. It says
 * what failed and gives the person the three ways on: ask the model again, edit the participants by hand, or
 * continue with rules, which labels what the rules make as the rules fallback wherever it is shown.
 */
export function ModelStopNotice({
  stopped,
  participantName,
  busy,
  may,
  hasList,
  onRetry,
  onEdit,
  onRules,
}: ModelStopProps) {
  const { stop } = stopped;
  const one = stopped.step === 'regenerate';
  return (
    <div className="sw-stop" data-stk-focus="model-stop" tabIndex={-1}>
      <Notice
        tone="error"
        title={
          one
            ? `The model could not propose ${participantName ?? 'this participant'} again`
            : 'The model could not propose the participants'
        }
      >
        <p className="sw-stop__what">{stop.detail}</p>
        <p className="sw-caption">
          {one
            ? 'Nothing was changed: the participant is as it was. '
            : hasList
              ? 'Nothing was changed: your list is as it was. '
              : 'Nothing was made: there are no participants yet. '}
          {stop.retryable
            ? 'Ask the model again, edit the participants yourself, or continue with rules.'
            : 'Asking again is unlikely to help until this is fixed. You can edit the participants yourself, or continue with rules.'}{' '}
          A list the rules make after the model failed is called “{RULES_FALLBACK_LABEL}” wherever
          it is shown, and is never presented as the model’s.
        </p>
        <div className="sw-stop__choices" role="group" aria-label="What to do next">
          <Button
            variant={stop.retryable ? 'accent' : 'glass'}
            size="sm"
            disabled={busy || !may.run}
            onClick={onRetry}
            data-stk-focus="model-stop-retry"
          >
            Retry with the model
          </Button>
          <Button variant="glass" size="sm" disabled={busy || !may.edit} onClick={onEdit}>
            Edit participants
          </Button>
          <Button variant="glass" size="sm" disabled={busy || !may.run} onClick={onRules}>
            Continue with rules
          </Button>
        </div>
      </Notice>
    </div>
  );
}
