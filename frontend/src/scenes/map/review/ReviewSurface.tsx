import { useMemo, useState } from 'react';
import {
  CheckCheck,
  CircleCheck,
  GitMerge,
  OctagonAlert,
  RefreshCw,
  Undo2,
  UserPlus,
} from 'lucide-react';
import {
  PARTICIPANT_ROLE_LABELS,
  type ParticipantIssue,
  type ParticipantReview,
  type ParticipantRole,
  type StakeholderSet,
} from '../../../../../shared/stakeholders';
import { Button, Dialog, DialogContent, Disclosure, Notice } from '../../../design/ui';
import { RULES_FALLBACK_LABEL, withoutRulesUsed } from '../../../../../shared/model-failure';
import type { ParticipantActions } from '../../../hooks/useParticipants';
import type { RequestFocus } from '../../../hooks/useFocusRequest';
import { MAX_MERGED, liveStakeholders, mergedIntoMap } from '../../../lib/stakeholders/review';
import { AddMissingDialog } from './AddMissingDialog';
import { Coverage } from './Coverage';
import { IssueRow } from './Issues';
import { ParticipantCard, type CardHandlers } from './ParticipantCard';
import { ParticipantEditor } from './ParticipantEditor';
import {
  blockingOf,
  gateOf,
  groupByRole,
  indexIssues,
  mergeGroupOf,
  plural,
  proposedIds,
  selectionOf,
  sentencesOf,
  splitCoverage,
  toggled,
} from './logic';
import './review.css';

export interface ReviewSurfaceProps {
  set: StakeholderSet;
  /** What the server found when it checked the list; absent from a server that does not check. */
  review: ParticipantReview | null;
  may: { edit: boolean; run: boolean };
  modelAvailable: boolean;
  busy: boolean;
  /** Why the last change was refused, said inside the dialog that made it. */
  problem: string | null;
  actions: ParticipantActions;
  focus: RequestFocus;
  /** Starts the whole list again, which replaces what the person has reviewed and so asks first. */
  onProposeAgain: () => void;
}

/**
 * The review of the participants Swarm proposes: why this list, which roles it covers and which it does not,
 * every participant under the role it plays with what its place rests on, what the checks found, and what a
 * person can do about each. The list cannot be used while a check that matters is open. Everything here is a
 * synthetic role to explore, never a finding about a person.
 */
export function ReviewSurface({
  set,
  review,
  may,
  modelAvailable,
  busy,
  problem,
  actions,
  focus,
  onProposeAgain,
}: ReviewSurfaceProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<ParticipantRole | null>(null);
  const [replacing, setReplacing] = useState<{ id: string; mode: 'rules' | 'model' } | null>(null);

  const editable = may.edit && !busy;
  const live = useMemo(() => liveStakeholders(set.stakeholders), [set.stakeholders]);
  const groups = useMemo(() => groupByRole(set.stakeholders), [set.stakeholders]);
  const issues = useMemo(() => indexIssues(review?.issues ?? []), [review]);
  const chosen = useMemo(
    () => selectionOf(selected, set.stakeholders),
    [selected, set.stakeholders],
  );
  const waiting = useMemo(() => proposedIds(live), [live]);
  const removed = useMemo(
    () => set.stakeholders.filter((item) => item.status === 'removed'),
    [set.stakeholders],
  );
  const mergedInto = useMemo(() => mergedIntoMap(set.stakeholders), [set.stakeholders]);
  const coverage = useMemo(() => splitCoverage(review?.coverage ?? []), [review]);
  const gate = gateOf(review);
  const nameOf = (id: string | null): string | undefined =>
    id === null ? undefined : set.stakeholders.find((item) => item.id === id)?.name;
  const firstGap: ParticipantRole = coverage.missing[0]?.role ?? 'missing-voices';
  const duplicates = (review?.issues ?? []).some((issue) => issue.code === 'duplicate-participant');
  const editingTarget = editing
    ? (set.stakeholders.find((item) => item.id === editing) ?? null)
    : null;
  const replacingTarget = replacing
    ? (set.stakeholders.find((item) => item.id === replacing.id) ?? null)
    : null;

  const proposeOne = (id: string, mode: 'rules' | 'model'): void => {
    const target = set.stakeholders.find((item) => item.id === id);
    if (!target) return;
    // A participant the person changed is theirs: it is replaced only when they say so.
    if (target.status === 'edited') setReplacing({ id, mode });
    else void actions.regenerate(id, { mode, confirm: false });
  };
  const fix = (issue: ParticipantIssue): void => {
    const id = issue.participantId;
    switch (issue.fixAction) {
      case 'rename':
      case 'edit':
        if (id) setEditing(id);
        return;
      case 'remove':
        if (id) void actions.remove(id);
        return;
      case 'merge': {
        const group = mergeGroupOf(issue, set.stakeholders);
        if (group) void actions.mergeDuplicates([group]);
        else if (id) setEditing(id);
        return;
      }
      case 'add-missing':
        setAdding(issue.role ?? firstGap);
        return;
      case 'regenerate': {
        const target = set.stakeholders.find((item) => item.id === id);
        // A participant the person added has no sources to be proposed again from: it is changed by hand.
        if (!id || !target) return;
        if (target.origin === 'user' || !may.run) setEditing(id);
        else proposeOne(id, 'rules');
        return;
      }
      case null:
        return;
    }
  };
  const handlers: CardHandlers = {
    onSelect: (id) => setSelected((old) => toggled(old, id)),
    onAccept: (id) => void actions.accept([id]),
    onEdit: setEditing,
    onRemove: (id) => void actions.remove(id),
    onRegenerate: proposeOne,
    onMerge: (id, targetId) => void actions.mergeDuplicates([{ keep: targetId, merge: [id] }]),
    onFix: fix,
    load: actions.why,
  };
  const mergeTargetsOf = (id: string) =>
    live.filter((item) => item.id !== id && item.mergedFrom.length < MAX_MERGED);

  const sentences = sentencesOf(review?.summary ?? '');
  const proposal = set.proposal;
  const blockers = blockingOf(review?.issues ?? []);
  const canUse = may.edit && may.run;
  const openText = set.approvedAt
    ? 'The actors were made from this list. Changing a participant takes the approval away, and the actors made from it are then out of date.'
    : [
        gate.advisory > 0
          ? `${plural(gate.advisory, 'suggestion', 'suggestions')} below may improve the list.`
          : null,
        canUse ? 'When you are happy with the list, press Use these actors.' : null,
      ]
        .filter(Boolean)
        .join(' ') || 'No check found anything to fix.';
  const gaps = new Set(coverage.missing.map((item) => item.role));
  // What the roles list already says is not said twice.
  const suggestions = issues.general.filter(
    (issue) =>
      issue.severity === 'advisory' &&
      !(issue.fixAction === 'add-missing' && issue.role !== null && gaps.has(issue.role)) &&
      issue.code !== 'missing-role',
  );

  return (
    <section className="sw-prv" aria-labelledby="rv-title">
      <header className="sw-prv__summary">
        <p className="sw-eyebrow">Synthetic roles, not real people</p>
        <h2 id="rv-title" className="sw-prv__title" tabIndex={-1} data-stk-focus="rv:top">
          Review the proposed participants
        </h2>
        {sentences[0] && <p className="sw-prv__lede">{sentences[0]}</p>}
        {sentences.length > 1 && <p className="sw-prv__rest">{sentences.slice(1).join(' ')}</p>}
        {review && (
          <ul className="sw-prv__counts" aria-label="At a glance">
            <li>
              <span className="sw-numeral">{review.counts.participants}</span> participants
            </li>
            <li>
              <span className="sw-numeral">{review.counts.key}</span> key
            </li>
            <li>
              <span className="sw-numeral">{review.counts.sourced}</span> quoted
            </li>
            <li>
              <span className="sw-numeral">{review.counts.assumed}</span> assumed
            </li>
            {waiting.length > 0 && (
              <li className="sw-prv__counts-attn">
                <span className="sw-numeral">{waiting.length}</span> to review
              </li>
            )}
          </ul>
        )}
      </header>

      {proposal && proposal.flaggedPassages.length > 0 && (
        <Notice tone="caution" title="Some of your sources carry text addressed to an AI system">
          Swarm read it as text and did not follow it as an instruction. Passages:{' '}
          {proposal.flaggedPassages.join(', ')}.
        </Notice>
      )}

      {proposal && proposal.source === 'rules' && proposal.failure && (
        <Notice tone="caution" title={RULES_FALLBACK_LABEL}>
          {withoutRulesUsed(proposal.failure.detail)} Swarm read your text for roles instead, so no
          model proposed these participants: look at each name before you use them.
        </Notice>
      )}

      {review && (
        <section className="sw-prv__gate" data-open={gate.open} aria-labelledby="rv-gate">
          <div className="sw-prv__gate-head">
            {gate.open ? (
              <CircleCheck size={20} aria-hidden="true" />
            ) : (
              <OctagonAlert size={20} aria-hidden="true" />
            )}
            <h3 id="rv-gate" className="sw-prv__h">
              {!gate.open
                ? `Fix ${plural(gate.blocking, 'thing', 'things')} before these can be used`
                : set.approvedAt
                  ? 'Approved'
                  : 'Nothing blocks these participants'}
            </h3>
          </div>
          {gate.open ? (
            <p className="sw-caption">{openText}</p>
          ) : (
            <>
              <p className="sw-caption">
                Simulation starts only from a list that passes these checks, so that no actor is
                generic, unsupported or about a real person.
              </p>
              <ul className="sw-prv__issues" aria-label="Things to fix first">
                {blockers.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    who={nameOf(issue.participantId)}
                    editable={editable}
                    onFix={fix}
                    onShow={(id) => focus([`rv:${id}`])}
                  />
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {may.edit ? (
        <div className="sw-prv__bar" role="toolbar" aria-label="Review actions">
          <Button
            size="sm"
            variant="primary"
            icon={<CheckCheck size={15} aria-hidden="true" />}
            disabled={!editable || waiting.length === 0}
            onClick={() => void actions.accept()}
          >
            {`Accept all (${waiting.length})`}
          </Button>
          <Button
            size="sm"
            variant="glass"
            disabled={!editable || chosen.size === 0}
            onClick={() => {
              const ids = [...chosen];
              void actions.accept(ids).then((done) => done && setSelected(new Set()));
            }}
          >
            {`Accept selected (${chosen.size})`}
          </Button>
          <Button
            size="sm"
            variant="glass"
            icon={<GitMerge size={15} aria-hidden="true" />}
            disabled={!editable || !duplicates}
            onClick={() => void actions.mergeDuplicates()}
          >
            Merge duplicates
          </Button>
          <Button
            size="sm"
            variant="glass"
            icon={<UserPlus size={15} aria-hidden="true" />}
            disabled={!editable}
            onClick={() => setAdding(firstGap)}
          >
            Add a missing participant
          </Button>
          {may.run && (
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={15} aria-hidden="true" />}
              disabled={busy}
              onClick={onProposeAgain}
            >
              Propose the list again…
            </Button>
          )}
        </div>
      ) : (
        <Notice tone="info" title="You can read this list but not change it">
          Changing participants needs the right to edit this project.
        </Notice>
      )}

      {review && <Coverage coverage={review.coverage} editable={editable} onAdd={setAdding} />}

      {suggestions.length > 0 && (
        <Disclosure summary={`Suggestions (${suggestions.length})`}>
          <ul className="sw-prv__issues" aria-label="Suggestions for the whole list">
            {suggestions.map((issue) => (
              <IssueRow key={issue.id} issue={issue} editable={editable} onFix={fix} />
            ))}
          </ul>
        </Disclosure>
      )}

      <div className="sw-prv__groups">
        {groups.length === 0 && (
          <p className="sw-caption">Nobody is on the list. Add a participant to begin.</p>
        )}
        {groups.map((group) => (
          <section
            key={group.role}
            className="sw-prv__group"
            aria-labelledby={`rv-g-${group.role}`}
          >
            <div className="sw-prv__group-head">
              <h3 id={`rv-g-${group.role}`} className="sw-prv__h">
                {group.label} <span className="sw-prv__count">{group.members.length}</span>
              </h3>
              <p className="sw-caption">{group.meaning}</p>
            </div>
            <ul className="sw-prv__cards">
              {group.members.map((stakeholder) => (
                <ParticipantCard
                  key={stakeholder.id}
                  stakeholder={stakeholder}
                  issues={issues.byParticipant.get(stakeholder.id) ?? []}
                  editable={editable}
                  selected={chosen.has(stakeholder.id)}
                  mergeTargets={mergeTargetsOf(stakeholder.id)}
                  modelAvailable={modelAvailable}
                  canPropose={may.run && !busy}
                  handlers={handlers}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {removed.length > 0 && (
        <Disclosure summary={`Removed (${removed.length})`}>
          <ul className="sw-prv__removed">
            {removed.map((item) => {
              const into = mergedInto.get(item.id);
              return (
                <li key={item.id}>
                  <span>
                    {item.name}
                    <span className="sw-caption">
                      {into ? ` · merged into ${into.name}` : ' · removed'}
                    </span>
                  </span>
                  {editable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Undo2 size={15} aria-hidden="true" />}
                      aria-label={`${into ? 'Undo the merge of' : 'Restore'} ${item.name}`}
                      onClick={() => void actions.restore(item.id)}
                    >
                      {into ? 'Undo the merge' : 'Restore'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Disclosure>
      )}

      {proposal && proposal.dropped.length > 0 && (
        <Disclosure summary={`Left out (${proposal.dropped.length})`}>
          <p className="sw-caption sw-prv__optional-note">
            Swarm did not keep these, and says why, so that nothing disappears without a trace.
          </p>
          <ul className="sw-prv__removed">
            {proposal.dropped.map((item, index) => (
              <li key={`${index}-${item.name}`}>
                <span>
                  {item.name}
                  <span className="sw-caption"> · {item.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      {proposal && (
        <Disclosure summary="How this list was checked">
          <ul className="sw-prv__notes">
            <li className="sw-caption">
              {proposal.source === 'model'
                ? `Proposed by a model${proposal.model ? ` (${proposal.model})` : ''}, then checked by Swarm: every quotation is compared with its passage.`
                : proposal.failure
                  ? `${RULES_FALLBACK_LABEL}: ${withoutRulesUsed(proposal.failure.detail)} Read from your text for roles and checked by Swarm. No model proposed these participants.`
                  : 'Read from your text for roles and checked by Swarm. No model was used.'}
            </li>
            <li className="sw-caption">
              {`It read ${proposal.evidence.shown} of ${plural(proposal.evidence.of, 'passage', 'passages')}.`}
              {proposal.usedResearch ? ' Research sources were part of what it read.' : ''}
              {proposal.usedConstraints ? ' Your known constraints were part of what it read.' : ''}
            </li>
            {proposal.merged > 0 && (
              <li className="sw-caption">
                {`${plural(proposal.merged, 'name', 'names')} that are certainly one participant were folded into another.`}
              </li>
            )}
            {proposal.missingVoices.map((item) => (
              <li key={item.role} className="sw-caption">
                {`${PARTICIPANT_ROLE_LABELS[item.role]}: ${item.reason}`}
              </li>
            ))}
            {proposal.notes.map((note, index) => (
              <li key={`${index}-${note.length}`} className="sw-caption">
                {note}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      <ParticipantEditor
        stakeholder={editingTarget}
        busy={busy}
        problem={problem}
        onSubmit={async (id, changes) => {
          const saved = await actions.edit(id, changes);
          if (saved) setEditing(null);
          return saved;
        }}
        onClose={() => setEditing(null)}
      />
      <AddMissingDialog
        role={adding}
        busy={busy}
        problem={problem}
        onSubmit={async (input) => {
          const saved = await actions.addMissing(input);
          if (saved) setAdding(null);
          return saved;
        }}
        onClose={() => setAdding(null)}
      />
      <Dialog open={replacing !== null} onOpenChange={(open) => !open && setReplacing(null)}>
        <DialogContent
          tone="danger"
          title="Replace your changes?"
          description={`${replacingTarget?.name ?? 'This participant'} was changed by you. Proposing it again replaces what you changed with a fresh proposal from the sources.`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setReplacing(null)}>
                Keep my changes
              </Button>
              <Button
                variant="danger"
                busy={busy}
                onClick={() => {
                  if (!replacing) return;
                  void actions
                    .regenerate(replacing.id, { mode: replacing.mode, confirm: true })
                    .then(() => setReplacing(null));
                }}
              >
                Replace my changes
              </Button>
            </>
          }
        />
      </Dialog>
    </section>
  );
}
