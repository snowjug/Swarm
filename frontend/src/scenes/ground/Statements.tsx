import { ChevronRight, ListFilter } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  PUBLICATION_STATUSES,
  PUBLICATION_STATUS_LABELS,
  REVIEW_RESULT_LABELS,
  STATEMENT_TYPE_LABELS,
  SUPPORT_CLASS_LABELS,
  type PublicationStatus,
} from '../../../../shared/evidence';
import {
  Button,
  Chip,
  ChipButton,
  Disclosure,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Switch,
} from '../../design/ui';
import {
  NO_FILTER,
  SUFFICIENCY_HEADLINE,
  SUFFICIENCY_TONE,
  SUPPORT_TONE,
  assumptionDependents,
  filterClaims,
  isFilterActive,
  publicationCounts,
  supportCounts,
  type LedgerFilter,
} from '../../lib/ledger';
import { useGroundActions, useGroundData } from './context';
import { plural } from './model';
import { SectionHead } from './SectionHead';
import { CHIP_TONE, TONE_ICON } from './tones';
import './statements.css';

const SUFFICIENCY_SHORT = {
  sufficient: 'Supports a recommendation',
  limited: 'Limited: treat as tentative',
  insufficient: 'Not enough yet',
} as const;

const PAGE = 10;

/**
 * Every statement a report makes, with how well the sources back it. The bar is the whole ledger in one
 * glance and doubles as its filter; a row opens the statement with everything behind it.
 */
export function Statements() {
  const { ledger, openClaimId } = useGroundData();
  const actions = useGroundActions();
  const [filter, setFilter] = useState<LedgerFilter>(NO_FILTER);
  const [limit, setLimit] = useState(PAGE);
  const data = ledger.ledger;
  const claims = useMemo(() => (data ? filterClaims(data.claims, filter) : []), [data, filter]);
  const counts = useMemo(() => (data ? supportCounts(data.claims) : []), [data]);
  const publications = useMemo(() => (data ? publicationCounts(data.claims) : []), [data]);
  const dependents = useMemo(() => (data ? assumptionDependents(data) : []), [data]);
  if (!data) return null;

  const sufficiency = data.sufficiency;
  const tone = SUFFICIENCY_TONE[sufficiency.level];
  const ToneIcon = TONE_ICON[tone];
  const active = isFilterActive(filter);
  const extra =
    Number(filter.publication !== 'all') +
    Number(filter.assumption !== 'all') +
    Number(filter.unreviewedOnly);
  const total = data.claims.length;
  const reviewed = data.claims.filter((claim) => claim.review.result !== 'pending').length;
  const shown = claims.slice(0, limit);

  const pickSupport = (support: (typeof counts)[number]['support']) =>
    setFilter({ ...filter, support: filter.support === support ? 'all' : support });

  return (
    <section className="sw-ground__section" aria-labelledby="ground-statements-title">
      <SectionHead
        id="ground-statements"
        titleId="ground-statements-title"
        title="Statements"
        count={total}
        aside={
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="glass"
                size="sm"
                icon={<ToneIcon size={16} aria-hidden="true" />}
                className="sw-ground-suff"
                data-tone={tone}
              >
                {SUFFICIENCY_SHORT[sufficiency.level]}
              </Button>
            </PopoverTrigger>
            <PopoverContent width="24rem" align="end" aria-label="Is the evidence enough">
              <div className="sw-ground-method">
                <h3 className="sw-ground-method__title">
                  {SUFFICIENCY_HEADLINE[sufficiency.level]}
                </h3>
                {sufficiency.directlySupportedShare !== null && (
                  <p className="num">
                    {Math.round(sufficiency.directlySupportedShare * 100)}% of the statements that
                    rest on a source are directly supported by it.
                  </p>
                )}
                {sufficiency.reasons.length > 0 && (
                  <ul className="sw-ground-method__list" role="list">
                    {sufficiency.reasons.map((reason, index) => (
                      <li key={index}>{reason}</li>
                    ))}
                  </ul>
                )}
                <p className="sw-caption">Decided by a fixed rule, never by a model.</p>
              </div>
            </PopoverContent>
          </Popover>
        }
      />

      <p className="sw-ground-caption">
        How well the sources back each statement, not whether they are true.
      </p>
      <div
        className="sw-ground-dist"
        role="img"
        aria-label={`${plural(total, 'statement')}: ${counts
          .map((entry) => `${entry.count} ${SUPPORT_CLASS_LABELS[entry.support].toLowerCase()}`)
          .join(', ')}`}
      >
        {counts.map((entry) => (
          <div
            key={entry.support}
            className="sw-ground-dist__seg"
            data-tone={SUPPORT_TONE[entry.support]}
            data-on={filter.support === 'all' || filter.support === entry.support ? '' : undefined}
            style={{ flexGrow: entry.count }}
            onClick={() => pickSupport(entry.support)}
          />
        ))}
      </div>
      <ul className="sw-ground-dist__legend" role="list" aria-label="Filter by how well backed">
        {counts.map((entry) => {
          const Icon = TONE_ICON[SUPPORT_TONE[entry.support]];
          return (
            <li key={entry.support}>
              <ChipButton
                size="sm"
                tone={CHIP_TONE[SUPPORT_TONE[entry.support]]}
                icon={<Icon aria-hidden="true" />}
                pressed={filter.support === entry.support}
                onClick={() => pickSupport(entry.support)}
              >
                {SUPPORT_CLASS_LABELS[entry.support]}
                <span className="num sw-ground-legend__count">{entry.count}</span>
              </ChipButton>
            </li>
          );
        })}
        <li className="sw-ground-dist__more">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" icon={<ListFilter size={15} aria-hidden="true" />}>
                {extra > 0 ? `More filters · ${extra}` : 'More filters'}
              </Button>
            </PopoverTrigger>
            <PopoverContent width="22rem" align="end" aria-label="More filters">
              <div className="sw-ground-options">
                <label className="sw-ground-options__field">
                  <span className="sw-ground-options__label">Shown as</span>
                  <Select
                    value={filter.publication}
                    onChange={(event) =>
                      setFilter({
                        ...filter,
                        publication: event.target.value as PublicationStatus | 'all',
                      })
                    }
                  >
                    <option value="all">Anything</option>
                    {PUBLICATION_STATUSES.map((status) => (
                      <option
                        key={status}
                        value={status}
                        disabled={!publications.some((entry) => entry.status === status)}
                      >
                        {PUBLICATION_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </Select>
                </label>
                <Switch
                  label="Not yet reviewed"
                  checked={filter.unreviewedOnly}
                  onChange={(event) =>
                    setFilter({ ...filter, unreviewedOnly: event.target.checked })
                  }
                />
                {dependents.length > 0 && (
                  <div className="sw-ground-options__field">
                    <span className="sw-ground-options__label">Rests on an assumption</span>
                    <ul className="sw-ground-options__list" role="list">
                      {dependents.map(({ assumption, count }) => (
                        <li key={assumption.id}>
                          <ChipButton
                            size="sm"
                            pressed={filter.assumption === assumption.id}
                            disabled={count === 0}
                            title={assumption.statement}
                            onClick={() =>
                              setFilter({
                                ...filter,
                                assumption:
                                  filter.assumption === assumption.id ? 'all' : assumption.id,
                              })
                            }
                          >
                            {assumption.id}
                            <span className="num sw-ground-legend__count">{count}</span>
                          </ChipButton>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </li>
      </ul>

      <p className="sw-ground-list-meta sw-caption" role="status">
        {active ? `${claims.length} of ${total} shown` : `${reviewed} of ${total} reviewed`}
        {active && (
          <button
            type="button"
            className="sw-ground-search__clear"
            onClick={() => setFilter(NO_FILTER)}
          >
            Clear filters
          </button>
        )}
      </p>

      <ul className="sw-ground-claims" role="list">
        {shown.map((claim) => {
          const support = SUPPORT_TONE[claim.supportClass];
          const SupportIcon = TONE_ICON[support];
          const pressed = openClaimId === claim.id;
          return (
            <li key={claim.id}>
              <button
                type="button"
                id={`ground-claim-${claim.id}`}
                className="sw-ground-claim-row"
                aria-pressed={pressed}
                data-tone={support}
                onClick={() => actions.openClaim(claim.id)}
              >
                <span className="sw-ground-claim-row__mark" aria-hidden="true">
                  <SupportIcon size={17} />
                </span>
                <span className="sw-ground-claim-row__body">
                  <span className="sw-ground-claim-row__text">{claim.text}</span>
                  <span className="sw-ground-claim-row__meta">
                    {STATEMENT_TYPE_LABELS[claim.statementType]} ·{' '}
                    {SUPPORT_CLASS_LABELS[claim.supportClass]} ·{' '}
                    {PUBLICATION_STATUS_LABELS[claim.publication.status]}
                    <span className="sw-ground-claim-row__id num"> · {claim.id}</span>
                  </span>
                </span>
                {claim.review.result !== 'pending' && (
                  <Chip
                    size="sm"
                    tone={CHIP_TONE[claim.review.result === 'accepted' ? 'good' : 'caution']}
                    className="sw-ground-claim-row__review"
                  >
                    {REVIEW_RESULT_LABELS[claim.review.result]}
                  </Chip>
                )}
                <ChevronRight className="sw-ground-claim-row__go" size={18} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {claims.length === 0 && (
        <p className="sw-ground-quiet">No statement matches these filters.</p>
      )}
      {claims.length > shown.length && (
        <div className="sw-ground-more">
          <Button variant="ghost" onClick={() => setLimit((value) => value + PAGE * 2)}>
            Show {Math.min(PAGE * 2, claims.length - shown.length)} more
          </Button>
        </div>
      )}

      {dependents.length > 0 && (
        <Disclosure summary={`Assumptions · ${dependents.length}`}>
          <ul className="sw-ground-list" role="list">
            {dependents.map(({ assumption, count }) => (
              <li key={assumption.id}>
                <span className="sw-ground-list__id num">{assumption.id}</span>
                <span>
                  {assumption.statement}{' '}
                  <span className="sw-caption">
                    {count === 0
                      ? 'Nothing rests on it.'
                      : `${plural(count, 'statement')} rest${count === 1 ? 's' : ''} on it.`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}

/** A report that was checked and listed no statements says so, once and quietly. */
export function NoStatements() {
  return (
    <section
      className="sw-ground__section sw-ground__section--quiet"
      aria-labelledby="ground-statements-title"
    >
      <SectionHead
        id="ground-statements"
        titleId="ground-statements-title"
        title="Statements"
        count={0}
      />
      <p className="sw-ground-quiet">The check of the report listed no statements.</p>
    </section>
  );
}
