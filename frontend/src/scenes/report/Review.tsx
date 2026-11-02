import { Fragment } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { TriangleAlert, X } from 'lucide-react';
import {
  CLAIM_KINDS,
  CLAIM_KIND_LABELS,
  CLAIM_KIND_MEANINGS,
  SUPPORT_VERDICTS,
  SUPPORT_VERDICT_LABELS,
  type SupportVerdict,
} from '../../../../shared/grounding';
import type { SimulationReport } from '../../../../shared/types';
import { SPRING } from '../../design/motion';
import { Button, ChipButton, Disclosure, Notice } from '../../design/ui';
import { dateTime } from '../../lib/format';
import {
  VERDICT_MEANINGS,
  chaptersWithoutStatements,
  groupBySection,
  methodLine,
  noReviewMessage,
  statementsText,
  totalStatements,
} from '../../lib/grounding';
import { VERDICT_ICONS, VERDICT_TONES } from '../studio/glyphs';
import { TallyBar, type Tally } from '../studio/TallyBar';
import { groupId, filterClaims, toggleVerdict, totalOf } from './model';
import { Statement } from './Statement';
import './Review.css';

const tallies = (counts: Record<SupportVerdict, number>): Tally[] =>
  SUPPORT_VERDICTS.map((verdict) => ({
    key: verdict,
    label: SUPPORT_VERDICT_LABELS[verdict],
    count: counts[verdict] ?? 0,
    tone: VERDICT_TONES[verdict],
    icon: VERDICT_ICONS[verdict],
  }));

/** What the kinds and verdicts mean, in the page, so that it prints and can be found. */
function Legend() {
  return (
    <Disclosure summary="What the kinds and verdicts mean">
      <div className="sw-rev__legend">
        <div>
          <p className="sw-eyebrow">Verdicts</p>
          <dl>
            {SUPPORT_VERDICTS.map((verdict) => {
              const Icon = VERDICT_ICONS[verdict];
              return (
                <Fragment key={verdict}>
                  <dt>
                    <Icon size={14} strokeWidth={2.2} aria-hidden="true" />{' '}
                    {SUPPORT_VERDICT_LABELS[verdict]}
                  </dt>
                  <dd>{VERDICT_MEANINGS[verdict]}</dd>
                </Fragment>
              );
            })}
          </dl>
        </div>
        <div>
          <p className="sw-eyebrow">Kinds of statement</p>
          <dl>
            {CLAIM_KINDS.map((kind) => (
              <Fragment key={kind}>
                <dt>{CLAIM_KIND_LABELS[kind]}</dt>
                <dd>{CLAIM_KIND_MEANINGS[kind]}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      </div>
      <p className="sw-caption sw-rev__legend-note">
        A verdict describes what the cited passage says about a statement. It does not show that the
        passage itself is true.
      </p>
    </Disclosure>
  );
}

/**
 * What the server checked in a model-written report, and what it could not. A bar says how the statements
 * divide; its words filter them; each chapter's statements follow, one line of verdict at a time. Verdicts
 * say whether a cited passage backs a statement; they never claim that the passage is true.
 */
export function Review({
  report,
  complete,
  active,
  onActive,
  onAsk,
}: {
  report: SimulationReport;
  complete: boolean;
  active: ReadonlySet<SupportVerdict>;
  onActive: (next: Set<SupportVerdict>) => void;
  onAsk: (message: string) => void;
}) {
  const review = report.grounding;
  if (!review) {
    return (
      <section
        id="checks"
        className="sw-rep__section sw-rev"
        tabIndex={-1}
        aria-labelledby="sw-rev-title"
      >
        <p className="sw-eyebrow">Statement checks</p>
        <h2 className="sw-title" id="sw-rev-title">
          {report.generatedBy === 'local' ? 'Nothing to check' : 'Not checked'}
        </h2>
        <p className="sw-rev__empty">{noReviewMessage(report.generatedBy, complete)}</p>
      </section>
    );
  }

  const chapters = report.sections.map((section) => section.title);
  const groups = groupBySection(review.claims, chapters);
  const shownGroups = groups
    .map((group) => ({ ...group, shown: filterClaims(group.claims, active) }))
    .filter((group) => group.shown.length > 0);
  const total = totalStatements(review.counts);
  const contradicted = Math.max(
    review.counts.contradicted ?? 0,
    review.claims.filter((claim) => claim.verdict === 'contradicted').length,
  );
  const listed = review.claims.some((claim) => claim.verdict === 'contradicted');
  const unchecked = chaptersWithoutStatements(chapters, review.claims);
  const counts = tallies(review.counts);
  const showing = filterClaims(review.claims, active).length;

  return (
    <section
      id="checks"
      className="sw-rep__section sw-rev"
      tabIndex={-1}
      aria-labelledby="sw-rev-title"
    >
      <header className="sw-rev__head">
        <div>
          <p className="sw-eyebrow">Statement checks · automated</p>
          <h2 className="sw-title" id="sw-rev-title">
            What was checked
          </h2>
        </div>
        <p className="sw-rev__total">
          <span className="sw-numeral num">{total}</span>
          <span>{total === 1 ? 'statement checked' : 'statements checked'}</span>
        </p>
      </header>

      <TallyBar
        tallies={counts}
        label={`${statementsText(total)} checked`}
        legend={false}
        className="sw-rev__bar"
      />

      <div className="sw-rev__filter" role="group" aria-label="Show statements by verdict">
        {SUPPORT_VERDICTS.map((verdict) => {
          const Icon = VERDICT_ICONS[verdict];
          const count = review.counts[verdict] ?? 0;
          return (
            <ChipButton
              key={verdict}
              tone={VERDICT_TONES[verdict]}
              pressed={active.has(verdict)}
              disabled={count === 0}
              icon={<Icon aria-hidden="true" />}
              onClick={() => onActive(toggleVerdict(active, verdict))}
            >
              <span className="num">{count}</span> {SUPPORT_VERDICT_LABELS[verdict]}
            </ChipButton>
          );
        })}
        <AnimatePresence initial={false}>
          {active.size > 0 && (
            <m.span
              key="clear"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={SPRING.snappy}
            >
              <Button
                size="sm"
                variant="ghost"
                icon={<X size={14} aria-hidden="true" />}
                onClick={() => onActive(new Set())}
              >
                Show all
              </Button>
            </m.span>
          )}
        </AnimatePresence>
      </div>

      <p className="sw-rev__method" data-limited={review.method === 'deterministic' || undefined}>
        {methodLine(review.method)}. Checked{' '}
        <time dateTime={review.checkedAt}>{dateTime(review.checkedAt)}</time>.
      </p>

      {contradicted > 0 && (
        <Notice
          tone="error"
          title={`Contradicted by the sources (${contradicted})`}
          action={
            listed && !(active.size === 1 && active.has('contradicted')) ? (
              <Button size="sm" variant="glass" onClick={() => onActive(new Set(['contradicted']))}>
                Show {contradicted === 1 ? 'it' : 'them'}
              </Button>
            ) : undefined
          }
        >
          {listed
            ? `The cited passage appears to say something that conflicts with ${contradicted === 1 ? 'this statement' : 'these statements'}. Read the passage before relying on ${contradicted === 1 ? 'it' : 'them'}.`
            : 'The review counts these statements, but their details were not recorded.'}
        </Notice>
      )}

      {active.size > 0 && (
        <p className="sw-rev__showing" role="status">
          Showing {showing} of {total}.
        </p>
      )}

      <div className="sw-rev__groups">
        <AnimatePresence initial={false} mode="popLayout">
          {shownGroups.map((group) => {
            const at = chapters.indexOf(group.section);
            const headingId = `sw-rev-group-${groups.findIndex((entry) => entry.section === group.section)}`;
            return (
              <m.section
                key={group.section}
                id={at >= 0 ? groupId(at) : undefined}
                className="sw-rev__group"
                tabIndex={-1}
                aria-labelledby={headingId}
                layout="position"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={SPRING.smooth}
              >
                <header className="sw-rev__grouphead">
                  <h3 id={headingId} className="sw-rev__groupname">
                    {at >= 0 && <span className="sw-rev__groupno num">{at + 1}</span>}
                    {group.section}
                  </h3>
                  <TallyBar
                    className="sw-rev__grouptally"
                    tallies={tallies(group.counts).filter((tally) => tally.count > 0)}
                    label={`${statementsText(totalOf(group.counts))} in this chapter`}
                  />
                </header>
                <ul className="sw-rev__list" role="list" aria-labelledby={headingId}>
                  <AnimatePresence initial={false}>
                    {group.shown.map((claim, position) => (
                      <m.li
                        key={`${position}-${claim.id}`}
                        layout="position"
                        className="sw-rev__item"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <Statement claim={claim} onAsk={onAsk} />
                      </m.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </m.section>
            );
          })}
        </AnimatePresence>
      </div>

      {review.claims.length === 0 ? (
        <p className="sw-rev__empty">
          No statements were listed for checking, so no chapter text was checked statement by
          statement.
        </p>
      ) : (
        unchecked.length > 0 && (
          <p className="sw-rev__empty">
            {`No statements were listed for ${unchecked.map((title) => `“${title}”`).join(', ')}, so nothing in ${unchecked.length === 1 ? 'that chapter was' : 'those chapters was'} checked statement by statement.`}
          </p>
        )
      )}

      {review.unverifiedFigures.length > 0 && (
        <div className="sw-rev__figures">
          <h3 className="sw-heading sw-rev__sub">
            <TriangleAlert size={18} aria-hidden="true" /> Figures with nothing behind them
          </h3>
          <p className="sw-rev__empty">
            These figures appear in chapter text but in neither the cited passages nor the recorded
            simulation, so they may be invented.
          </p>
          <ul role="list" className="sw-rev__figlist">
            {review.unverifiedFigures.map((entry, index) => (
              <li key={`${index}-${entry.section}`}>
                <strong>{entry.section}</strong>
                <span className="sw-rev__figs">
                  {entry.figures.map((figure) => (
                    <span key={figure} className="sw-rev__fig sw-mono">
                      {figure}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.notes.length > 0 && (
        <div className="sw-rev__notes">
          <h3 className="sw-heading sw-rev__sub">What was and was not checked</h3>
          <ul role="list">
            {review.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      <Legend />
    </section>
  );
}
