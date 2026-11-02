import { useState } from 'react';
import { Info } from 'lucide-react';
import {
  PUBLICATION_STATUS_LABELS,
  REVIEW_RESULT_LABELS,
  STATEMENT_TYPE_LABELS,
  SUPPORT_CLASSES,
  SUPPORT_CLASS_LABELS,
  SUPPORT_CLASS_MEANINGS,
  type ClaimRecord,
  type EvidenceRef,
} from '../../../../shared/evidence';
import type { StudioSectionView, StudioView } from '../../../../shared/studio';
import {
  Chip,
  Disclosure,
  IconButton,
  Notice,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../design/ui';
import { locationText } from '../../lib/ledger';
import { SUPPORT_ICONS, publicationTone, supportTone } from './glyphs';
import { excerpt, plural, supportSegments } from './model';
import { TallyBar, type Tally } from './TallyBar';
import './Statements.css';

type Evidence = Pick<StudioView, 'passages' | 'memories' | 'assumptions'>;

/** The words a statement quotes, in the passage they were found in, with a little around them. */
function Passage({ reference, evidence }: { reference: EvidenceRef; evidence: Evidence }) {
  const [whole, setWhole] = useState(false);
  const passage = evidence.passages.find((candidate) => candidate.id === reference.passageId);
  const supports = reference.role === 'supports';
  const part = passage ? excerpt(passage.text, reference.quote) : null;
  return (
    <li className="sw-ev" data-role={reference.role}>
      <p className="sw-ev__where">
        <strong>{supports ? 'Backs it' : 'Conflicts with it'}</strong>
        <span className="sw-ev__loc">{locationText(reference)}</span>
      </p>
      {passage && part ? (
        <blockquote className="sw-ev__quote">
          {whole ? (
            passage.text
          ) : (
            <>
              {part.clippedStart && '… '}
              {part.before}
              {part.quote && <mark>{part.quote}</mark>}
              {part.after}
              {part.clippedEnd && ' …'}
            </>
          )}
        </blockquote>
      ) : (
        <p className="sw-ev__gone">The passage text is no longer available.</p>
      )}
      <div className="sw-ev__foot">
        <p className="sw-ev__note">
          {part?.quote
            ? 'The highlighted words were found exactly as written.'
            : reference.quote
              ? 'The quoted words are not in the passage as it is stored now.'
              : 'No exact quotation was matched; the whole passage was cited.'}
        </p>
        {passage && (part?.clippedStart || part?.clippedEnd || whole) && (
          <button
            type="button"
            className="sw-ev__more"
            aria-expanded={whole}
            onClick={() => setWhole((on) => !on)}
          >
            {whole ? 'Show less' : 'Read the whole passage'}
          </button>
        )}
      </div>
    </li>
  );
}

/** One statement of a chapter, with what a person needs to judge it and, one press away, the evidence behind it. */
export function StatementCard({ claim, evidence }: { claim: ClaimRecord; evidence: Evidence }) {
  const SupportIcon = SUPPORT_ICONS[claim.supportClass];
  const assumptions = claim.assumptionIds.flatMap((id) =>
    evidence.assumptions.filter((entry) => entry.id === id),
  );
  const events = claim.simulationEvents.map((event) => ({
    event,
    memory: evidence.memories.find((memory) => memory.id === event.memoryId),
  }));
  const references = claim.supporting.length + claim.contradicting.length;
  const parts = [
    `${claim.supporting.length} backing`,
    `${claim.contradicting.length} conflicting`,
    ...(assumptions.length ? [plural(assumptions.length, 'assumption')] : []),
    ...(events.length ? [plural(events.length, 'simulated event')] : []),
  ];
  return (
    <li className="sw-claim" data-support={claim.supportClass}>
      <p className="sw-claim__text">{claim.text}</p>
      <div className="sw-claim__chips">
        <Chip size="sm">{STATEMENT_TYPE_LABELS[claim.statementType]}</Chip>
        <Chip
          size="sm"
          tone={supportTone(claim.supportClass)}
          icon={<SupportIcon aria-hidden="true" />}
          title={SUPPORT_CLASS_MEANINGS[claim.supportClass]}
        >
          {SUPPORT_CLASS_LABELS[claim.supportClass]}
        </Chip>
        <Chip size="sm" tone={publicationTone(claim.publication.status)}>
          {PUBLICATION_STATUS_LABELS[claim.publication.status]}
        </Chip>
        {claim.review.result !== 'pending' && (
          <Chip size="sm" tone="accent">
            {REVIEW_RESULT_LABELS[claim.review.result]}
          </Chip>
        )}
        <span className="sw-claim__id sw-mono">{claim.id}</span>
      </div>
      {claim.publication.qualification && (
        <p className="sw-claim__qual">
          <strong>Read it with:</strong> {claim.publication.qualification}
        </p>
      )}
      {claim.review.note && <p className="sw-claim__note">Reviewer’s note: {claim.review.note}</p>}
      <Disclosure summary={`Evidence · ${parts.join(', ')}`} className="sw-claim__more">
        {references > 0 ? (
          <ul className="sw-ev__list" role="list">
            {claim.supporting.map((reference) => (
              <Passage
                key={`s-${reference.passageId}-${reference.start}`}
                reference={reference}
                evidence={evidence}
              />
            ))}
            {claim.contradicting.map((reference) => (
              <Passage
                key={`c-${reference.passageId}-${reference.start}-${reference.conflictId ?? ''}`}
                reference={reference}
                evidence={evidence}
              />
            ))}
          </ul>
        ) : (
          <p className="sw-ev__gone">No source passage is cited for this statement.</p>
        )}
        {events.length > 0 && (
          <div className="sw-claim__extra">
            <p className="sw-eyebrow">Simulated activity · fictional proxies, not observations</p>
            <ul role="list">
              {events.map(({ event, memory }) => (
                <li key={event.memoryId}>
                  <span className="sw-mono">
                    {event.platform}, round {event.round}
                  </span>{' '}
                  {memory ? memory.text : 'The recorded memory is no longer available.'}
                </li>
              ))}
            </ul>
          </div>
        )}
        {assumptions.length > 0 && (
          <div className="sw-claim__extra">
            <p className="sw-eyebrow">It rests on</p>
            <ul role="list">
              {assumptions.map((assumption) => (
                <li key={assumption.id}>
                  <span className="sw-mono">{assumption.id}</span> {assumption.statement}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Disclosure>
    </li>
  );
}

/** What each label on a statement means: a popover, never in the way, always one press off. */
function SupportLegend() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="What the labels mean" size="sm">
          <Info size={16} aria-hidden="true" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent width="22rem" align="end">
        <p className="sw-eyebrow">How well the sources back a statement</p>
        <dl className="sw-legend">
          {SUPPORT_CLASSES.map((support) => {
            const Icon = SUPPORT_ICONS[support];
            return (
              <div key={support} className="sw-legend__row">
                <dt>
                  <Icon size={14} strokeWidth={2.2} aria-hidden="true" />{' '}
                  {SUPPORT_CLASS_LABELS[support]}
                </dt>
                <dd>{SUPPORT_CLASS_MEANINGS[support]}</dd>
              </div>
            );
          })}
        </dl>
        <p className="sw-caption">
          A label says how well the cited passages back a statement. It does not show that the
          passages are true.
        </p>
      </PopoverContent>
    </Popover>
  );
}

const tallies = (statements: readonly ClaimRecord[]): Tally[] =>
  supportSegments(statements).map((segment) => ({
    key: segment.support,
    label: SUPPORT_CLASS_LABELS[segment.support],
    count: segment.count,
    tone: supportTone(segment.support),
    icon: SUPPORT_ICONS[segment.support],
  }));

/** A bare list of statements, as the server checked them. */
export function StatementList({
  statements,
  evidence,
}: {
  statements: readonly ClaimRecord[];
  evidence: Evidence;
}) {
  return (
    <ul className="sw-claims" role="list">
      {statements.map((claim) => (
        <StatementCard key={claim.id} claim={claim} evidence={evidence} />
      ))}
    </ul>
  );
}

/**
 * The statements of a chapter and how well the sources back them. Statements that describe an earlier text of
 * the section are kept apart and said not to describe this one: after a person has changed the words, none
 * of them is a check of the words.
 */
export function Statements({
  section,
  evidence,
}: {
  section: Pick<StudioSectionView, 'kind' | 'statements' | 'statementsCurrent' | 'origin'>;
  evidence: Evidence;
}) {
  if (section.kind !== 'chapter') {
    return (
      <p className="sw-tool__empty">
        The summary and the limitations are not listed statement by statement. Figures in them are
        not checked here.
      </p>
    );
  }
  if (section.statements.length === 0) {
    return (
      <p className="sw-tool__empty">
        Nothing here was checked statement by statement: a report computed from recorded results has
        no statements to check, and text a person wrote is not checked.
      </p>
    );
  }
  if (!section.statementsCurrent) {
    return (
      <div className="sw-tool__stack">
        <Notice tone="caution" title="These statements describe an earlier text">
          The words were changed after they were checked, so none of this is a check of the text as
          it is now. They are kept so that you can see what was checked.
        </Notice>
        <Disclosure
          summary={`Show the ${plural(section.statements.length, 'statement')} of the earlier text`}
        >
          <StatementList statements={section.statements} evidence={evidence} />
        </Disclosure>
      </div>
    );
  }
  return (
    <div className="sw-tool__stack">
      <div className="sw-tool__row">
        <TallyBar
          className="sw-tool__tally"
          tallies={tallies(section.statements)}
          label={`${plural(section.statements.length, 'statement')} by how well the sources back them`}
        />
        <SupportLegend />
      </div>
      <StatementList statements={section.statements} evidence={evidence} />
    </div>
  );
}
