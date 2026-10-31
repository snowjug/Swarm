import {
  PUBLICATION_STATUS_LABELS,
  REVIEW_RESULT_LABELS,
  STATEMENT_TYPE_LABELS,
  SUPPORT_CLASS_LABELS,
  SUPPORT_CLASS_MEANINGS,
  type ClaimRecord,
  type EvidenceRef,
} from '../../../../shared/evidence';
import type { StudioSectionView, StudioView } from '../../../../shared/studio';
import { PUBLICATION_TONE, SUPPORT_TONE, locationText, splitAtQuote } from '../../lib/ledger';
import { ToneChip } from '../console/LedgerParts';

type Evidence = Pick<StudioView, 'passages' | 'memories' | 'assumptions'>;

function Passage({ reference, evidence }: { reference: EvidenceRef; evidence: Evidence }) {
  const passage = evidence.passages.find((candidate) => candidate.id === reference.passageId);
  const split = passage ? splitAtQuote(passage.text, reference.quote) : null;
  return (
    <li className={`evidence evidence-${reference.role}`}>
      <p className="evidence-location">
        <strong>
          {reference.role === 'supports' ? 'Supporting passage' : 'Contradicting passage'}
        </strong>
        <span className="mono muted">{locationText(reference)}</span>
      </p>
      {passage ? (
        <blockquote className="preserve-text">
          {split ? (
            <>
              {split.before}
              <mark>{split.quote}</mark>
              {split.after}
            </>
          ) : (
            passage.text
          )}
        </blockquote>
      ) : (
        <p className="field-help">The passage text is no longer available.</p>
      )}
      <p className="field-help">
        {split
          ? 'The highlighted words were found exactly as written in this passage.'
          : reference.quote
            ? 'The quoted words are not in the passage as it is stored now, so nothing is highlighted. Read the whole passage.'
            : 'No exact quotation was matched; the whole passage was cited.'}
      </p>
    </li>
  );
}

/** One statement of a section, with what a person needs to judge it and the evidence behind it. */
export function StatementCard({ claim, evidence }: { claim: ClaimRecord; evidence: Evidence }) {
  const assumptions = claim.assumptionIds.flatMap((id) =>
    evidence.assumptions.filter((assumption) => assumption.id === id),
  );
  const events = claim.simulationEvents.map((event) => ({
    event,
    memory: evidence.memories.find((memory) => memory.id === event.memoryId),
  }));
  const evidenceCount = claim.supporting.length + claim.contradicting.length;
  return (
    <li className="studio-statement">
      <p className="studio-statement-text preserve-text">
        <span className="mono muted">{claim.id}</span> {claim.text}
      </p>
      <div className="chip-row">
        <ToneChip tone="neutral" label={STATEMENT_TYPE_LABELS[claim.statementType]} />
        <ToneChip
          tone={SUPPORT_TONE[claim.supportClass]}
          label={SUPPORT_CLASS_LABELS[claim.supportClass]}
          title={SUPPORT_CLASS_MEANINGS[claim.supportClass]}
        />
        <ToneChip
          tone={PUBLICATION_TONE[claim.publication.status]}
          label={PUBLICATION_STATUS_LABELS[claim.publication.status]}
        />
        {claim.review.result !== 'pending' && (
          <ToneChip tone="info" label={REVIEW_RESULT_LABELS[claim.review.result]} />
        )}
      </div>
      {claim.publication.qualification && (
        <p className="qualification">
          <strong>Must be read with:</strong> {claim.publication.qualification}
        </p>
      )}
      {claim.review.note && (
        <p className="field-help preserve-text">Reviewer note: {claim.review.note}</p>
      )}
      <details className="record-details">
        <summary>
          Evidence: {claim.supporting.length} supporting, {claim.contradicting.length} contradicting
          {assumptions.length > 0 ? `, ${assumptions.length} assumptions` : ''}
          {events.length > 0 ? `, ${events.length} simulated events` : ''}
        </summary>
        {evidenceCount > 0 && (
          <ul className="evidence-list">
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
        )}
        {evidenceCount === 0 && (
          <p className="field-help">No source passage is cited for this statement.</p>
        )}
        {events.length > 0 && (
          <div>
            <h5>Simulated activity (fictional proxies, not observations)</h5>
            <ul>
              {events.map(({ event, memory }) => (
                <li key={event.memoryId} className="preserve-text">
                  {event.platform}, round {event.round}:{' '}
                  {memory ? memory.text : 'the recorded memory is no longer available.'}
                </li>
              ))}
            </ul>
          </div>
        )}
        {assumptions.length > 0 && (
          <div>
            <h5>Assumptions this statement rests on</h5>
            <ul>
              {assumptions.map((assumption) => (
                <li key={assumption.id} className="preserve-text">
                  <span className="mono muted">{assumption.id}</span> {assumption.statement}
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>
    </li>
  );
}

/**
 * The statements of a chapter, as the server checked them. Statements that describe an earlier text
 * of the section are kept apart and said not to describe this one: after a person has changed the
 * words, nothing below is a check of them.
 */
export function StatementList({
  section,
  evidence,
}: {
  section: Pick<StudioSectionView, 'kind' | 'statements' | 'statementsCurrent' | 'origin'>;
  evidence: Evidence;
}) {
  if (section.kind !== 'chapter') {
    return (
      <p className="field-help">
        The summary and the limitations are not listed statement by statement. Figures in them are
        not checked here.
      </p>
    );
  }
  if (section.statements.length === 0) {
    return (
      <p className="field-help">
        No statement of this text was checked: a report computed from recorded results has none to
        check, and text a person wrote has not been checked statement by statement.
      </p>
    );
  }
  if (!section.statementsCurrent) {
    return (
      <div className="notice notice-warning" role="status">
        <div className="notice-copy">
          <strong>These statements describe an earlier text of this section</strong>
          <div>
            The text above was changed after they were checked, so nothing below is a check of it.
            They are kept so that you can see what was checked.
          </div>
          <details className="record-details">
            <summary>Show the {section.statements.length} statements of the earlier text</summary>
            <ul className="studio-statements">
              {section.statements.map((claim) => (
                <StatementCard key={claim.id} claim={claim} evidence={evidence} />
              ))}
            </ul>
          </details>
        </div>
      </div>
    );
  }
  return (
    <ul className="studio-statements">
      {section.statements.map((claim) => (
        <StatementCard key={claim.id} claim={claim} evidence={evidence} />
      ))}
    </ul>
  );
}
