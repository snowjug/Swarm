import { Check, GitMerge, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import {
  AUTHORITY_LABELS,
  CONFIDENCE_BASIS_LABELS,
  INFLUENCE_LABELS,
  participantOf,
  type ParticipantIssue,
  type ParticipantWhy,
  type Stakeholder,
} from '../../../../../shared/stakeholders';
import { cx } from '../../../design/cx';
import {
  Button,
  Chip,
  Disclosure,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuTrigger,
  type Tone,
} from '../../../design/ui';
import {
  DIRECTNESS_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  UNCERTAINTY_LABELS,
} from '../../../lib/stakeholders/labels';
import { IssueRow } from './Issues';
import { factsOf, reasonOf } from './logic';
import { Assumed, Quotes } from './Quotes';
import { WhyPopover } from './WhyPopover';

export interface CardHandlers {
  onSelect: (id: string) => void;
  onAccept: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onRegenerate: (id: string, mode: 'rules' | 'model') => void;
  onMerge: (id: string, targetId: string) => void;
  onFix: (issue: ParticipantIssue) => void;
  load: (id: string, signal?: AbortSignal) => Promise<ParticipantWhy>;
}

export interface ParticipantCardProps {
  stakeholder: Stakeholder;
  issues: readonly ParticipantIssue[];
  editable: boolean;
  selected: boolean;
  /** Where it could be merged: participants that are not removed, not itself, and that can take another. */
  mergeTargets: readonly Stakeholder[];
  modelAvailable: boolean;
  /** Proposing one again may ask a model, so it needs the right to run, which is not the right to edit. */
  canPropose: boolean;
  handlers: CardHandlers;
}

const STATUS_TONES: Record<Stakeholder['status'], Tone> = {
  proposed: 'caution',
  accepted: 'favor',
  edited: 'accent',
  added: 'accent',
  removed: 'neutral',
};

/**
 * One participant, as a person reviews it: who it is and why it is here, what its place rests on (a quoted
 * passage, or an assumption said to be one), what the checks found, and what can be done about it. It says on
 * its face that it is a synthetic role and not a person.
 */
export function ParticipantCard({
  stakeholder,
  issues,
  editable,
  selected,
  mergeTargets,
  modelAvailable,
  canPropose,
  handlers,
}: ParticipantCardProps) {
  const { id, name } = stakeholder;
  const view = participantOf(stakeholder);
  const sourced = stakeholder.evidence.length > 0;
  const facts = factsOf(stakeholder);
  const proposed = stakeholder.status === 'proposed';
  const blocking = issues.some((issue) => issue.severity === 'blocking');
  const mayProposeAgain = canPropose && stakeholder.origin !== 'user';
  return (
    <li className={cx('sw-prv__card', blocking && 'is-flagged')} data-status={stakeholder.status}>
      <div className="sw-prv__card-head">
        {editable && proposed ? (
          <label className="sw-prv__tick">
            <input
              type="checkbox"
              className="sw-prv__check"
              checked={selected}
              onChange={() => handlers.onSelect(id)}
              aria-label={`Select ${name}`}
            />
          </label>
        ) : (
          <span className="sw-prv__check-space" aria-hidden="true" />
        )}
        <div className="sw-prv__who">
          <h4 className="sw-prv__name" tabIndex={-1} data-stk-focus={`rv:${id}`}>
            {name}
          </h4>
          <p className="sw-prv__why-line">{reasonOf(stakeholder)}</p>
        </div>
        <span className="sw-prv__priority">{PRIORITY_LABELS[stakeholder.priority]}</span>
      </div>
      <p className="sw-prv__facts">
        {[
          AUTHORITY_LABELS[view.decisionAuthority],
          INFLUENCE_LABELS[view.influence],
          DIRECTNESS_LABELS[stakeholder.directness],
        ].join(' · ')}
      </p>
      <div className="sw-prv__chips">
        <Chip size="sm">Synthetic role, not a person</Chip>
        <Chip size="sm" tone={sourced ? 'favor' : 'caution'} dot>
          {sourced
            ? CONFIDENCE_BASIS_LABELS[view.confidenceBasis]
            : `Assumed: ${CONFIDENCE_BASIS_LABELS[view.confidenceBasis].toLowerCase()}`}
        </Chip>
        <Chip size="sm" tone={stakeholder.uncertainty.level === 'high' ? 'caution' : 'neutral'}>
          {UNCERTAINTY_LABELS[stakeholder.uncertainty.level]}
        </Chip>
        <Chip size="sm" tone={STATUS_TONES[stakeholder.status]}>
          {STATUS_LABELS[stakeholder.status]}
        </Chip>
      </div>
      {issues.length > 0 && (
        <ul className="sw-prv__issues" aria-label={`Checks for ${name}`}>
          {issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} editable={editable} onFix={handlers.onFix} />
          ))}
        </ul>
      )}
      <Disclosure summary="Details and evidence" className="sw-prv__more">
        <div className="sw-prv__detail">
          {facts.length > 0 ? (
            <dl className="sw-prv__dl">
              {facts.map((group) => (
                <div key={group.key}>
                  <dt>{group.label}</dt>
                  <dd>
                    {group.items.length === 1 ? (
                      group.items[0]
                    ) : (
                      <ul>
                        {group.items.map((item, index) => (
                          <li key={`${index}-${item.length}`}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="sw-caption">Nothing more is held for this participant yet.</p>
          )}
          {sourced ? (
            <Quotes
              items={stakeholder.evidence.map((ref) => ({
                passageId: ref.passageId,
                documentName: ref.documentName,
                quote: ref.quote,
              }))}
              label={`Passages cited for ${name}`}
            />
          ) : (
            <Assumed>
              {stakeholder.origin === 'user'
                ? 'You added this participant, so it cites no passage.'
                : 'No passage is cited for it, so it is held as an assumption to test.'}
            </Assumed>
          )}
          {stakeholder.assumptions.length > 0 && (
            <ul className="sw-prv__notes" aria-label={`Assumptions for ${name}`}>
              {stakeholder.assumptions.map((line, index) => (
                <li key={`${index}-${line.length}`} className="sw-caption">
                  {line}
                </li>
              ))}
            </ul>
          )}
          {stakeholder.uncertainty.reason && (
            <p className="sw-caption">
              Uncertainty {stakeholder.uncertainty.level}: {stakeholder.uncertainty.reason}
            </p>
          )}
        </div>
      </Disclosure>
      <div className="sw-prv__actions">
        {editable && proposed && (
          <Button
            size="sm"
            variant="primary"
            icon={<Check size={15} aria-hidden="true" />}
            aria-label={`Accept ${name}`}
            onClick={() => handlers.onAccept(id)}
          >
            Accept
          </Button>
        )}
        {editable && (
          <Button
            size="sm"
            variant="glass"
            icon={<Pencil size={15} aria-hidden="true" />}
            aria-label={`Edit ${name}`}
            onClick={() => handlers.onEdit(id)}
          >
            Edit
          </Button>
        )}
        <WhyPopover id={id} name={name} load={handlers.load} />
        {editable && mergeTargets.length > 0 && (
          <Menu>
            <MenuTrigger asChild>
              <IconButton label={`Merge ${name} into another`} size="sm" tone="glass">
                <GitMerge size={15} aria-hidden="true" />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end" side="top" className="sw-menu--tall">
              <MenuLabel>Merge into</MenuLabel>
              {mergeTargets.map((target) => (
                <MenuItem key={target.id} onSelect={() => handlers.onMerge(id, target.id)}>
                  {target.name}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        )}
        {editable &&
          mayProposeAgain &&
          (modelAvailable ? (
            <Menu>
              <MenuTrigger asChild>
                <IconButton label={`Propose ${name} again`} size="sm" tone="glass">
                  <RefreshCw size={15} aria-hidden="true" />
                </IconButton>
              </MenuTrigger>
              <MenuContent align="end" side="top">
                <MenuLabel>Propose again</MenuLabel>
                <MenuItem onSelect={() => handlers.onRegenerate(id, 'rules')}>
                  From the text
                </MenuItem>
                <MenuItem onSelect={() => handlers.onRegenerate(id, 'model')}>
                  With the model
                </MenuItem>
              </MenuContent>
            </Menu>
          ) : (
            <IconButton
              label={`Propose ${name} again`}
              size="sm"
              tone="glass"
              onClick={() => handlers.onRegenerate(id, 'rules')}
            >
              <RefreshCw size={15} aria-hidden="true" />
            </IconButton>
          ))}
        {editable && (
          <IconButton
            label={`Remove ${name}`}
            size="sm"
            tone="glass"
            className="sw-prv__remove"
            onClick={() => handlers.onRemove(id)}
          >
            <Trash2 size={15} aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </li>
  );
}
