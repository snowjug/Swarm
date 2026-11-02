import { useEffect, useMemo, useState } from 'react';
import { m } from 'motion/react';
import { Check, X } from 'lucide-react';
import type { Analysis } from '../../../../shared/analysis';
import { SPRING, useTween } from '../../design/motion';
import { Button, Notice } from '../../design/ui';
import { durationText } from '../../lib/analysis';
import { lanesOf, variantColours, type RunLanes } from './model';
import './running.css';

/**
 * One ring for each scenario, filling as its seeded runs finish, and an outer ring for the sensitivity runs after them. The
 * engine runs one seed at a time across every scenario, so the rings fill together; what each shows is the count the server
 * has saved, and nothing is drawn that has not happened.
 */
function Rings({
  lanes,
  sensitivityShare,
  finished,
}: {
  lanes: RunLanes;
  sensitivityShare: number | null;
  finished: boolean;
}) {
  const size = 300;
  const centre = size / 2;
  const colours = variantColours(lanes.lanes);
  const rings = [
    ...(sensitivityShare === null
      ? []
      : [
          {
            id: 'sensitivity',
            share: sensitivityShare,
            colour: 'var(--c-caution)',
            label: 'Sensitivity',
          },
        ]),
    ...lanes.lanes.map((lane, index) => ({
      id: lane.variantId,
      share: lane.of ? lane.done / lane.of : 0,
      colour: colours[index]!,
      label: lane.label,
    })),
  ];
  const gap = 15;
  const first = 134;
  return (
    <svg className="sw-rings" viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
      {rings.map((ring, index) => {
        const radius = first - index * gap;
        if (radius < 20) return null;
        const length = 2 * Math.PI * radius;
        return (
          <g key={ring.id} transform={`rotate(-90 ${centre} ${centre})`}>
            <circle className="sw-rings__track" cx={centre} cy={centre} r={radius} />
            <circle
              className="sw-rings__arc"
              cx={centre}
              cy={centre}
              r={radius}
              style={{ stroke: ring.colour }}
              strokeDasharray={length}
              strokeDashoffset={length * (1 - Math.min(1, Math.max(0, ring.share)))}
              data-finished={finished || undefined}
            />
          </g>
        );
      })}
    </svg>
  );
}

export interface RunningProps {
  analysis: Analysis;
  perturbations: number;
  cancelling: boolean;
  trouble: string | null;
  error: string | null;
  mayRun: boolean;
  onCancel: () => void;
}

/**
 * While a simulation runs. It is a plain account, drawn well: how many of the simulated runs are saved, in which step, for
 * which scenario, and how long it has been. Results are not shown until the run is done, because a stopped run would leave
 * the scenarios on different seeds; so this shows the work, not a preview of an answer.
 */
export function Running({
  analysis,
  perturbations,
  cancelling,
  trouble,
  error,
  mayRun,
  onCancel,
}: RunningProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const lanes = useMemo(() => lanesOf(analysis, perturbations), [analysis, perturbations]);
  const { completedRuns, totalRuns } = analysis.progress;
  const share = totalRuns > 0 ? Math.min(1, completedRuns / totalRuns) : 0;
  const shown = useTween(share * 100, { duration: 0.8 });
  const elapsed = Math.max(0, now - new Date(analysis.createdAt).getTime());
  const phase = cancelling
    ? 'Stopping after the run in progress'
    : lanes.phase === 'runs'
      ? 'Running the scenarios'
      : lanes.phase === 'sensitivity'
        ? 'Testing which assumptions it leans on'
        : 'Reading the results';
  const colours = variantColours(lanes.lanes);
  // Said to a screen reader in tenths, so that it is not read out every second.
  const tenths = Math.floor(share * 10) * 10;

  return (
    <section className="sw-run" aria-labelledby="run-title">
      <m.div
        className="sw-run__stage"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={SPRING.gentle}
      >
        <div
          className="sw-run__ringwrap"
          role="progressbar"
          aria-label="Simulation progress"
          aria-valuemin={0}
          aria-valuemax={Math.max(totalRuns, 1)}
          aria-valuenow={completedRuns}
          aria-valuetext={`${completedRuns.toLocaleString('en-GB')} of ${totalRuns.toLocaleString('en-GB')} simulated runs finished`}
        >
          <Rings
            lanes={lanes}
            sensitivityShare={
              lanes.sensitivityRuns > 0 ? lanes.sensitivityDone / lanes.sensitivityRuns : null
            }
            finished={lanes.phase === 'reading'}
          />
          <div className="sw-run__centre" aria-hidden="true">
            {lanes.phase === 'reading' && share >= 1 ? (
              <Check size={34} className="sw-run__check" />
            ) : (
              <>
                <span className="sw-run__pct sw-numeral">{Math.round(shown)}</span>
                <span className="sw-run__unit">%</span>
              </>
            )}
          </div>
        </div>
        <h1
          id="run-title"
          className="sw-title sw-run__title"
          tabIndex={-1}
          data-focus-key="run-title"
        >
          {phase}
        </h1>
        <p className="sw-run__count">
          {completedRuns.toLocaleString('en-GB')} of {totalRuns.toLocaleString('en-GB')} simulated
          runs
          <span aria-hidden="true"> · </span>
          {durationText(elapsed)}
        </p>
      </m.div>

      <ul className="sw-run__lanes" aria-label="Scenarios">
        {lanes.lanes.map((lane, index) => (
          <li key={lane.variantId}>
            <i style={{ background: colours[index] }} aria-hidden="true" />
            <span className="sw-run__lane">{lane.label}</span>
            <span className="sw-run__done">
              {lane.done}/{lane.of}
            </span>
          </li>
        ))}
        {lanes.sensitivityRuns > 0 && (
          <li>
            <i style={{ background: 'var(--c-caution)' }} aria-hidden="true" />
            <span className="sw-run__lane">Sensitivity</span>
            <span className="sw-run__done">
              {lanes.sensitivityDone}/{lanes.sensitivityRuns}
            </span>
          </li>
        )}
      </ul>

      <p className="sr-only" role="status">
        {cancelling
          ? 'Cancelling the simulation.'
          : `About ${tenths}% of the simulated runs are finished.`}
      </p>

      {trouble && (
        <Notice tone="caution" title="The progress cannot be read just now">
          {trouble} It tries again by itself. A simulation that is running goes on running on the
          server, and one that the server stopped is shown as interrupted once it can be read.
        </Notice>
      )}
      {error && (
        <Notice tone="error" title="That did not work">
          {error}
        </Notice>
      )}
      {mayRun && (
        <Button
          variant="glass"
          icon={<X size={16} aria-hidden="true" />}
          disabled={cancelling}
          onClick={onCancel}
        >
          {cancelling ? 'Cancelling' : 'Cancel'}
        </Button>
      )}
      <p className="sw-run__fine">
        Swarm explores scenarios. It does not guarantee or precisely predict real-world behavior.
      </p>
    </section>
  );
}
