import { useState } from 'react';
import {
  PUBLICATION_STATUSES,
  PUBLICATION_STATUS_LABELS,
  REVIEW_RESULT_LABELS,
  SUPPORT_CLASSES,
  SUPPORT_CLASS_LABELS,
  STATEMENT_TYPE_LABELS,
  type PublicationStatus,
  type SupportClass,
} from '../../../../shared/evidence';
import type { ProjectDetail } from '../../../../shared/types';
import { useLedger } from '../../hooks/useLedger';
import {
  NO_FILTER,
  PUBLICATION_TONE,
  SUPPORT_TONE,
  assumptionDependents,
  filterClaims,
  isFilterActive,
  summarise,
  type LedgerFilter,
} from '../../lib/ledger';
import { Notice, Spinner } from '../ui';
import { ClaimInspector } from './ClaimInspector';
import { ConflictCard } from './ConflictCard';
import { SufficiencyBanner, ToneChip } from './LedgerParts';
import type { Ledger } from '../../../../shared/evidence';

const TITLE_ID = 'evidence-ledger-title';

/**
 * Every material statement in the report with the evidence behind it, and the places where two
 * sources disagree. It is the audit trail behind the grounding review: a reader can open any
 * statement and see the exact words, the document and who has reviewed it.
 */
export function EvidenceLedger({ project }: { project: ProjectDetail }) {
  const enabled = Boolean(project.report);
  const { ledger, loading, error, reload } = useLedger(project.id, enabled, project.updatedAt);
  if (!enabled) return null;
  return (
    <section className="evidence-ledger view-stack" aria-labelledby={TITLE_ID} aria-busy={loading}>
      <div>
        <span className="eyebrow">EVIDENCE LEDGER / AUTOMATED CHECKS AND HUMAN REVIEW</span>
        <h2 id={TITLE_ID}>Evidence ledger</h2>
      </div>
      {loading && !ledger && (
        <p className="inline-pending" role="status">
          <Spinner /> Loading the evidence ledger…
        </p>
      )}
      {error && (
        <Notice tone="error">
          {error}{' '}
          <button className="text-button" type="button" onClick={reload}>
            Retry
          </button>
        </Notice>
      )}
      {ledger && <LedgerBody projectId={project.id} ledger={ledger} onChanged={reload} />}
    </section>
  );
}

export function LedgerBody({
  projectId,
  ledger,
  onChanged,
}: {
  projectId: string;
  ledger: Ledger;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<LedgerFilter>(NO_FILTER);
  const [selected, setSelected] = useState<string | null>(null);
  const claims = filterClaims(ledger.claims, filter);
  const summary = summarise(ledger);
  return (
    <>
      <SufficiencyBanner sufficiency={ledger.sufficiency} />
      <p className="ledger-summary">
        {`${summary.statements} statement${summary.statements === 1 ? '' : 's'}`}
        {` · ${summary.findings} shown as findings · ${summary.labelled} labelled as hypotheses, simulation or inputs · ${summary.withheld} withheld · ${summary.reviewed} reviewed`}
      </p>

      <div className="ledger-conflicts">
        <h3>
          {ledger.contradictions.length === 0
            ? 'No conflicts between sources detected'
            : `Conflicts between sources (${summary.openConflicts} open of ${ledger.contradictions.length})`}
        </h3>
        {ledger.contradictions.length === 0 ? (
          <p className="field-help">
            Sources are compared sentence by sentence for different figures and opposite statements.
            This catches conflicts stated in comparable words; it will miss a disagreement that
            needs interpretation, so absence of a conflict here is not proof that the sources agree.
          </p>
        ) : (
          <ul className="conflict-list" role="list">
            {ledger.contradictions.map((conflict) => (
              <ConflictCard
                key={conflict.id}
                projectId={projectId}
                conflict={conflict}
                onChanged={onChanged}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="ledger-assumptions">
        <h3>{`Assumptions behind the simulated results (${ledger.assumptions.length})`}</h3>
        <p className="field-help">
          These are inputs, not findings. Every simulated statement rests on them, so if one is
          wrong, the statements that depend on it are wrong with it.
        </p>
        <ul className="assumption-list" role="list">
          {assumptionDependents(ledger).map(({ assumption, count }) => (
            <li key={assumption.id} className="assumption">
              <span className="mono muted claim-id">{assumption.id}</span>
              <span className="assumption-text preserve-text">{assumption.statement}</span>
              <button
                className="text-button"
                type="button"
                disabled={count === 0}
                aria-pressed={filter.assumption === assumption.id}
                onClick={() =>
                  setFilter({
                    ...NO_FILTER,
                    assumption: filter.assumption === assumption.id ? 'all' : assumption.id,
                  })
                }
              >
                {count === 0
                  ? 'No statement depends on it'
                  : filter.assumption === assumption.id
                    ? `Showing ${count} dependent statement${count === 1 ? '' : 's'}`
                    : `Show ${count} dependent statement${count === 1 ? '' : 's'}`}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="ledger-statements">
        <h3>Statements</h3>
        {ledger.claims.length === 0 ? (
          <p className="field-help">
            {ledger.reviewedAt
              ? 'The grounding review listed no statements.'
              : 'No statement-level review exists for this report, so there is nothing to list. Statement checks run for model-written reports.'}
          </p>
        ) : (
          <>
            <div className="ledger-filters" role="group" aria-label="Filter statements">
              <label>
                Support
                <select
                  value={filter.support}
                  onChange={(event) =>
                    setFilter({
                      ...filter,
                      support: event.target.value as SupportClass | 'all',
                    })
                  }
                >
                  <option value="all">All</option>
                  {SUPPORT_CLASSES.map((support) => (
                    <option key={support} value={support}>
                      {SUPPORT_CLASS_LABELS[support]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Shown as
                <select
                  value={filter.publication}
                  onChange={(event) =>
                    setFilter({
                      ...filter,
                      publication: event.target.value as PublicationStatus | 'all',
                    })
                  }
                >
                  <option value="all">All</option>
                  {PUBLICATION_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {PUBLICATION_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ledger-check">
                <input
                  type="checkbox"
                  checked={filter.unreviewedOnly}
                  onChange={(event) =>
                    setFilter({ ...filter, unreviewedOnly: event.target.checked })
                  }
                />
                Not yet reviewed
              </label>
              {isFilterActive(filter) && (
                <button className="text-button" type="button" onClick={() => setFilter(NO_FILTER)}>
                  Clear filters
                </button>
              )}
            </div>
            <p className="field-help" role="status">
              {`Showing ${claims.length} of ${ledger.claims.length}`}
            </p>
            <ul className="ledger-claims" role="list">
              {claims.map((claim) => (
                <li key={claim.id}>
                  <button
                    id={`ledger-row-${claim.id}`}
                    className={`ledger-claim${selected === claim.id ? ' selected' : ''}`}
                    type="button"
                    aria-pressed={selected === claim.id}
                    onClick={() => setSelected(selected === claim.id ? null : claim.id)}
                  >
                    <span className="claim-meta">
                      <span className="claim-kind">
                        {STATEMENT_TYPE_LABELS[claim.statementType]}
                      </span>
                      <ToneChip
                        tone={SUPPORT_TONE[claim.supportClass]}
                        label={SUPPORT_CLASS_LABELS[claim.supportClass]}
                      />
                      <ToneChip
                        tone={PUBLICATION_TONE[claim.publication.status]}
                        label={PUBLICATION_STATUS_LABELS[claim.publication.status]}
                      />
                      {claim.review.result !== 'pending' && (
                        <ToneChip
                          tone={claim.review.result === 'accepted' ? 'good' : 'caution'}
                          label={REVIEW_RESULT_LABELS[claim.review.result]}
                        />
                      )}
                      <span className="mono muted claim-id">{claim.id}</span>
                    </span>
                    <span className="claim-text preserve-text">{claim.text}</span>
                  </button>
                </li>
              ))}
            </ul>
            {claims.length === 0 && (
              <p className="field-help">No statement matches these filters.</p>
            )}
          </>
        )}
      </div>
      {selected && (
        <ClaimInspector
          projectId={projectId}
          claimId={selected}
          onClose={() => {
            const closing = selected;
            setSelected(null);
            // Keyboard users must land back on the statement they were reading.
            requestAnimationFrame(() => document.getElementById(`ledger-row-${closing}`)?.focus());
          }}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
