import { Button, Chip } from '../../../design/ui';
import { type ParticipantIssue } from '../../../../../shared/stakeholders';
import { FIX_LABELS, fixName } from './logic';

export interface IssueRowProps {
  issue: ParticipantIssue;
  /** The participant it is about, when the row stands apart from that participant's own card. */
  who?: string;
  editable: boolean;
  onFix: (issue: ParticipantIssue) => void;
  /** Takes the person to the participant's card, for a row that stands apart from it. */
  onShow?: (id: string) => void;
}

/**
 * One thing a check found, in the person's words: what is wrong, what to do about it, and a button that does it.
 * Whether it stops the list being used is said in words, not only by its colour.
 */
export function IssueRow({ issue, who, editable, onFix, onShow }: IssueRowProps) {
  const blocking = issue.severity === 'blocking';
  const name = fixName(issue, who);
  return (
    <li className="sw-prv__issue" data-severity={issue.severity}>
      <Chip size="sm" tone={blocking ? 'critical' : 'neutral'} dot>
        {blocking ? 'Fix first' : 'Suggestion'}
      </Chip>
      <div className="sw-prv__issue-text">
        <p className="sw-prv__issue-msg">{issue.message}</p>
        <p className="sw-caption">{issue.fix}</p>
      </div>
      <div className="sw-prv__issue-acts">
        {who && issue.participantId !== null && onShow && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Show ${who}`}
            onClick={() => onShow(issue.participantId!)}
          >
            Show
          </Button>
        )}
        {editable && issue.fixAction && (
          <Button size="sm" variant="glass" aria-label={name} onClick={() => onFix(issue)}>
            {FIX_LABELS[issue.fixAction]}
          </Button>
        )}
      </div>
    </li>
  );
}
