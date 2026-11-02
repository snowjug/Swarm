import { useMemo, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { Analysis } from '../../../../shared/analysis';
import type { AnalysisSummary } from '../../../../shared/analysis-plan';
import { directionNotice } from '../../../../shared/signal';
import { useReducedMotion } from '../../design/motion';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { cannotMoveAnyone } from '../../lib/analysis';
import { answersOf } from './answers';
import { Bar } from './Bar';
import { Chain } from './Chain';
import { Findings } from './Findings';
import { Futures } from './Futures';
import { jumpTo, useInView } from './hooks';
import { Hero } from './Hero';
import { MethodSheet } from './MethodSheet';
import { Movers } from './Movers';
import { moversOf } from './movement';
import { validPair, type Pair } from './pair';
import { PairHint, type PairControl } from './PairMenu';
import { Closing, Reliance } from './Reliance';
import { directionFindingOf, gapOf, scenariosOf } from './scenarios';
import { Tornado } from './Tornado';
import { Trajectory } from './Trajectory';
import './compare.css';

export interface DocumentProps {
  analysis: Analysis;
  summaries: readonly AnalysisSummary[];
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** Asks for another saved comparison; `pending` while it is being read. */
  onSelect: (id: string) => void;
  pending: boolean;
  onRun: () => void;
  onDecide: () => void;
  onReview: () => void;
  /** The way to read two recorded runs against each other, when the project has two. */
  onRuns: (() => void) | null;
  /** Where this comparison stands against the project as it is now, when that is worth saying. */
  fresh?: ReactNode;
}

/** A finished comparison, as a document to read from the top: the answer first, and under it everything it rests on. */
export function CompareDocument({
  analysis,
  summaries,
  headingRef,
  onSelect,
  pending,
  onRun,
  onDecide,
  onReview,
  onRuns,
  fresh,
}: DocumentProps) {
  const reduced = useReducedMotion();
  const compact = useMediaQuery('(max-width: 40rem)');
  const [chosen, setChosen] = useState<Pair | null>(null);
  const [method, setMethod] = useState(false);
  const [closing, atEnd] = useInView<HTMLDivElement>('0px 0px -20% 0px', true);

  const scenarios = useMemo(() => scenariosOf(analysis), [analysis]);
  const pair = useMemo(() => validPair(chosen, scenarios), [chosen, scenarios]);
  const a = scenarios.find((scenario) => scenario.id === pair.a) ?? null;
  const b = scenarios.find((scenario) => scenario.id === pair.b) ?? null;
  const gap = useMemo(() => (a && b ? gapOf(analysis, a, b) : null), [analysis, a, b]);
  const movement = useMemo(
    () => (b ? moversOf(analysis, pair.a, b.id) : { movers: [], source: 'none' as const }),
    [analysis, pair.a, b],
  );
  const finding = a && b ? directionFindingOf(analysis.findings, a, b) : null;
  const answers = useMemo(
    () => answersOf({ analysis, scenarios, pair, gap, movers: movement.movers }),
    [analysis, scenarios, pair, gap, movement.movers],
  );
  const noEffect = cannotMoveAnyone(analysis);
  // With one scenario there is no change to speak of, so nothing is said about whether it can move anyone.
  const notice = b ? directionNotice(analysis.actors, analysis.config.variants) : null;
  const control: PairControl = { scenarios, pair, onPair: setChosen };
  const labels = useMemo(
    () => new Map(scenarios.map((scenario) => [scenario.id, scenario.label])),
    [scenarios],
  );
  const onJump = (id: string): void => jumpTo(id, reduced);

  return (
    <article className="sw-cmp" aria-labelledby="compare-title" data-pending={pending || undefined}>
      <PairHint />
      <Hero
        analysis={analysis}
        control={control}
        gap={gap}
        finding={finding}
        answers={answers}
        notice={notice}
        noEffect={noEffect}
        headingRef={headingRef}
        onJump={onJump}
        onReview={onReview}
        fresh={fresh}
      />
      <Futures analysis={analysis} scenarios={scenarios} control={control} />
      <Movers
        analysis={analysis}
        pair={pair}
        scenarios={scenarios}
        movers={movement.movers}
        source={movement.source}
      />
      <Trajectory analysis={analysis} scenarios={scenarios} pair={pair} />
      <Findings analysis={analysis} pair={pair} labels={labels} />
      <Tornado analysis={analysis} noEffect={noEffect} onSimulate={onRun} />
      <Chain analysis={analysis} scenarios={scenarios} />
      <Reliance analysis={analysis} />
      <div ref={closing}>
        <Closing onDecide={onDecide} onRun={onRun} onRuns={onRuns} />
      </div>
      <Bar
        control={control}
        summaries={summaries}
        currentId={analysis.id}
        compact={compact}
        onSelect={onSelect}
        onJump={onJump}
        onMethod={() => setMethod(true)}
        onRun={onRun}
        onDecide={onDecide}
        onRuns={onRuns}
        pending={pending}
        away={atEnd}
      />
      <MethodSheet open={method} onOpenChange={setMethod} analysis={analysis} />
    </article>
  );
}
