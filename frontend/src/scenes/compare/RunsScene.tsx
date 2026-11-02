import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, GitFork } from 'lucide-react';
import type { ComparedRun } from '../../../../shared/guided';
import { useWorkspace } from '../../app/context';
import { Button, Chip, EmptyState, Notice, Skeleton } from '../../design/ui';
import { describeChange } from '../../lib/whatIf';
import { metricLabels } from '../../lib/metrics';
import { vars } from './css';
import { useCompare } from './context';
import { Divergence } from './Divergence';
import { countText } from './format';
import { Section } from './parts';
import { RunHint, RunName } from './RunMenu';
import {
  RELATION_WORDS,
  lineageParts,
  metricText,
  partedRound,
  runChoices,
  sharedRounds,
  validRunPair,
  firstMoved,
  type Metric,
  type RunChoice,
  type RunPair,
} from './runs';
import { useRunComparison } from './useRunComparison';
import './runs.css';

const SECTIONS = {
  diverge: {
    id: 'diverge',
    no: '01',
    nav: 'Divergence',
    title: 'How they come apart',
    lede: 'One metric, round by round, for the two runs.',
  },
  changes: {
    id: 'changes',
    no: '02',
    nav: 'What changed',
    title: 'What was declared changed',
    lede: 'The assumptions that differ between the two, as recorded.',
  },
  runs: {
    id: 'runs',
    no: '03',
    nav: 'The runs',
    title: 'The two runs',
    lede: 'What each one is, as recorded.',
  },
} as const;

function Figure({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="sw-cmp-rfig" data-solo={note ? undefined : true}>
      <p className="sw-cmp-rfig__num sw-numeral">{value}</p>
      <p className="sw-cmp-rfig__cap">{label}</p>
      {note && <p className="sw-cmp-rfig__note">{note}</p>}
    </div>
  );
}

function RunFacts({
  run,
  role,
  advanced,
  choice,
  onOpen,
}: {
  run: ComparedRun;
  role: 'Base' | 'Other';
  advanced: boolean;
  choice: RunChoice | undefined;
  onOpen: () => void;
}) {
  return (
    <article className="sw-cmp-rrun">
      <p className="sw-eyebrow">{role}</p>
      <h3 className="sw-cmp-rrun__name">{run.name}</h3>
      <p className="sw-cmp-rrun__chips">
        <Chip size="sm" tone={run.status === 'ready' ? 'favor' : 'neutral'}>
          {run.status}
        </Chip>
        {choice && <Chip size="sm">{RELATION_WORDS[choice.relation]}</Chip>}
      </p>
      <dl className="sw-cmp-rrun__facts">
        <div>
          <dt>Saved rounds</dt>
          <dd className="num">
            {run.completedRounds} of {run.totalRounds}
          </dd>
        </div>
        <div>
          <dt>Seed</dt>
          <dd className="num">{run.seed}</dd>
        </div>
        <div>
          <dt>Branched</dt>
          <dd>
            {run.branchFromRound === null
              ? 'It is not a branch'
              : run.branchFromRound === 0
                ? 'From the start, with no rounds copied'
                : `From round ${run.branchFromRound}`}
          </dd>
        </div>
        <div>
          <dt>Intervention</dt>
          <dd>
            {run.intervention
              ? `Round ${run.intervention.round}: “${run.intervention.label}”`
              : 'None scheduled'}
          </dd>
        </div>
        {advanced && (
          <div>
            <dt>Record</dt>
            <dd className="sw-mono">{run.id}</dd>
          </div>
        )}
      </dl>
      <Button
        variant="ghost"
        size="sm"
        iconEnd={<ArrowRight size={15} aria-hidden="true" />}
        onClick={onOpen}
      >
        Open this run
      </Button>
    </article>
  );
}

function Loading() {
  return (
    <div role="status" aria-busy="true" className="sw-cmp-rwait">
      <p className="sr-only">Reading the two recorded runs</p>
      <Skeleton width="85%" height="2.6rem" radius="0.6rem" />
      <Skeleton width="60%" height="2.6rem" radius="0.6rem" />
      <Skeleton width="100%" height="16rem" radius="0.8rem" />
    </div>
  );
}

/**
 * Two recorded deep-dive runs set against each other. It is the older of the two comparisons, and kept as it was: what
 * the server recorded of each run, the round they part, what was declared changed, and the notes it must be read with.
 * It never claims one run caused the other's difference unless the record of branching says one came from the other.
 */
export function RunsScene() {
  const { project, projects, go, openProject } = useWorkspace();
  const { advanced } = useCompare();
  const choices = useMemo(() => runChoices(project, projects), [project, projects]);
  const [chosen, setChosen] = useState<RunPair | null>(null);
  const pair = useMemo(() => validRunPair(chosen, choices), [chosen, choices]);
  const [metric, setMetric] = useState<Metric>('meanOpinion');
  const [picked, setPicked] = useState(false);
  const state = useRunComparison(pair?.base ?? null, pair?.other ?? null);
  const heading = useRef<HTMLHeadingElement>(null);
  const comparison = state.comparison;

  // The metric that moved most is where to look first, until the person chooses one.
  useEffect(() => {
    if (!comparison || picked) return;
    setMetric(firstMoved(comparison) ?? 'meanOpinion');
  }, [comparison, picked]);

  const back = (
    <Button
      variant="ghost"
      size="sm"
      icon={<ArrowLeft size={15} aria-hidden="true" />}
      onClick={() => go('compare', { view: null })}
    >
      The comparison of scenarios
    </Button>
  );

  if (choices.length < 2 || !pair) {
    return (
      <div className="sw-cmp sw-cmp-state">
        <div className="sw-cmp-runs__back">{back}</div>
        <h1 className="sr-only">Compare two recorded runs</h1>
        <EmptyState
          level={2}
          icon={<GitFork size={22} aria-hidden="true" />}
          title="There are not two recorded runs yet"
          action={
            <Button variant="primary" onClick={() => go('simulate', { view: 'deep' })}>
              Run a deep dive
            </Button>
          }
        >
          Comparing two recorded runs needs two that have at least one saved round. Run a deep dive,
          then branch it from a checkpoint to see where the two part.
        </EmptyState>
      </div>
    );
  }

  const nameOf = (side: 'base' | 'other'): string =>
    (side === 'base' ? comparison?.base.name : comparison?.other.name) ??
    choices.find((choice) => choice.id === pair[side])?.name ??
    '';
  const parted = comparison ? partedRound(comparison) : null;
  const info = SECTIONS;
  const chart = comparison && comparison.rounds.length > 0;
  const bothRounds = comparison ? sharedRounds(comparison) : [];
  const lastBoth = bothRounds.at(-1) ?? null;
  const delta =
    comparison?.rounds.find((round) => round.round === lastBoth)?.delta?.[metric] ?? null;

  return (
    <div className="sw-cmp sw-cmp-runs">
      <div className="sw-cmp-runs__back">{back}</div>
      <RunHint />
      <header className="sw-cmp-runs__hero" aria-labelledby="runs-title">
        <div className="sw-cmp-runs__lead">
          <p className="sw-cmp-runs__kicker sw-rise">
            <span className="sw-eyebrow">Compare</span>
            <span className="sw-cmp-hero__meta">Two recorded runs</span>
          </p>
          <h1
            id="runs-title"
            ref={heading}
            tabIndex={-1}
            className="sw-cmp-hero__title sw-cmp-runs__title sw-rise"
            style={vars({ '--i': 1 })}
          >
            {comparison ? (
              lineageParts(comparison.lineage).map((part, index) =>
                typeof part === 'string' ? (
                  <span key={index}>{part}</span>
                ) : (
                  <RunName
                    key={index}
                    name={nameOf(part.run)}
                    side={part.run}
                    choices={choices}
                    pair={pair}
                    onPair={(next) => {
                      setChosen(next);
                      setPicked(false);
                    }}
                  />
                ),
              )
            ) : (
              <>
                <RunName
                  name={nameOf('base')}
                  side="base"
                  choices={choices}
                  pair={pair}
                  onPair={setChosen}
                />{' '}
                and{' '}
                <RunName
                  name={nameOf('other')}
                  side="other"
                  choices={choices}
                  pair={pair}
                  onPair={setChosen}
                />
              </>
            )}
          </h1>
          <p
            className="sw-cmp-hero__truth sw-caption sw-cmp-runs__truth sw-rise"
            style={vars({ '--i': 2 })}
          >
            Recorded values of two simulations under their stated assumptions. Not a forecast, and
            not a cause.
          </p>
        </div>
        {comparison && (
          <div className="sw-cmp-runs__figs sw-rise" style={vars({ '--i': 3 })}>
            <Figure
              value={String(comparison.identicalThroughRound)}
              label="rounds the same"
              note={
                comparison.identicalThroughRound === 0
                  ? 'They differ from the first round'
                  : `Identical through round ${comparison.identicalThroughRound}`
              }
            />
            <Figure
              value={parted === null ? '—' : String(parted)}
              label="the round they part"
              note={parted === null ? 'Not parted in the rounds both recorded' : undefined}
            />
            <Figure
              value={countText(bothRounds.length)}
              label="rounds in both"
              note={
                comparison.base.completedRounds === comparison.other.completedRounds
                  ? undefined
                  : `${comparison.base.completedRounds} saved in the base, ${comparison.other.completedRounds} in the other`
              }
            />
          </div>
        )}
      </header>

      {state.loading && !comparison && <Loading />}
      {state.error && (
        <div className="sw-cmp-runs__notice">
          <Notice
            tone="error"
            title="This comparison is unavailable"
            action={
              <Button size="sm" variant="glass" onClick={state.retry}>
                Retry
              </Button>
            }
          >
            {state.error} The requested run may have been deleted. Choose another run or retry.
          </Notice>
        </div>
      )}

      {comparison && (
        <>
          <Section info={info.diverge}>
            {chart ? (
              <>
                <p className="sw-cmp-note">
                  {delta === null || lastBoth === null
                    ? 'The two runs recorded no round in common, so there is no difference to read.'
                    : `By round ${lastBoth}, ${metricLabels[metric].toLowerCase()} differs by ${metricText(delta, metric, true)}, other minus base.`}
                </p>
                <Divergence
                  comparison={comparison}
                  metric={metric}
                  onMetric={(next) => {
                    setMetric(next);
                    setPicked(true);
                  }}
                />
              </>
            ) : (
              <p className="sw-cmp-note">No recorded round comparisons were returned.</p>
            )}
          </Section>
          <Section info={info.changes}>
            {comparison.declaredChanges.length === 0 ? (
              <p className="sw-cmp-note">
                No declared assumption changes were returned for this comparison.
              </p>
            ) : (
              <ul className="sw-cmp-changes">
                {comparison.declaredChanges.map((change, index) => (
                  <li key={index}>{describeChange(change, project)}</li>
                ))}
              </ul>
            )}
          </Section>
          <Section info={info.runs}>
            <div className="sw-cmp-rruns">
              <RunFacts
                run={comparison.base}
                role="Base"
                advanced={advanced}
                choice={choices.find((choice) => choice.id === comparison.base.id)}
                onOpen={() => openProject(comparison.base.id, { scene: 'simulate', view: 'deep' })}
              />
              <RunFacts
                run={comparison.other}
                role="Other"
                advanced={advanced}
                choice={choices.find((choice) => choice.id === comparison.other.id)}
                onOpen={() => openProject(comparison.other.id, { scene: 'simulate', view: 'deep' })}
              />
            </div>
          </Section>
          <section className="sw-cmp-care" aria-label="How to read this">
            <h2 className="sw-eyebrow">Read with care</h2>
            {comparison.notes.length > 0 ? (
              comparison.notes.map((note, index) => <p key={index}>{note}</p>)
            ) : (
              <p>No comparison notes were returned by the server.</p>
            )}
            <p>
              Differences are the other run minus the base run. Missing values are shown as not
              recorded, and nothing is estimated to fill them.
            </p>
          </section>
          <div className="sw-cmp-runs__end">{back}</div>
        </>
      )}
    </div>
  );
}
