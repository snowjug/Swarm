import { ArrowRight, RotateCcw } from 'lucide-react';
import type { Analysis } from '../../../../shared/analysis';
import { isSetByPerson } from '../../../../shared/analysis-plan';
import { Button, Chip } from '../../design/ui';
import { durationText } from '../../lib/analysis';
import { sectionInfo } from './copy';
import { useCompare } from './context';
import { countText, listText, seedsText, whenText } from './format';
import { Section } from './parts';
import './rely.css';

/**
 * How far to rely on all of this, said plainly: what drove the behaviour, what was not measured, what the comparison
 * cost, and where it came from, so that it can be checked and run again.
 */
export function Reliance({ analysis }: { analysis: Analysis }) {
  const { advanced } = useCompare();
  const { fidelity, cost, crossCheck, config } = analysis;
  const setByYou = config.variants.filter(
    (variant) => variant.kind !== 'baseline' && isSetByPerson(variant),
  );
  return (
    <Section info={sectionInfo('rely')}>
      <div className="sw-cmp-rely">
        <div className="sw-cmp-rely__lead">
          <p className="sw-cmp-rely__label">{fidelity.label}</p>
          <ul className="sw-cmp-rely__caveats">
            {fidelity.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
          {crossCheck && (
            <p className="sw-cmp-rely__cross">
              <Chip
                tone={crossCheck.withinEnsembleRange === false ? 'caution' : 'accent'}
                size="sm"
              >
                {crossCheck.withinEnsembleRange === null
                  ? 'Deep-dive run: no comparison'
                  : crossCheck.withinEnsembleRange
                    ? 'Deep-dive run inside the range'
                    : 'Deep-dive run outside the range'}
              </Chip>
              <span>{crossCheck.note}</span>
            </p>
          )}
        </div>
        <dl className="sw-cmp-rely__facts">
          <div>
            <dt>Finished</dt>
            <dd>{whenText(analysis.completedAt)}</dd>
          </div>
          <div>
            <dt>Scenarios</dt>
            <dd>
              {config.variants.length}, each of {config.runsPerVariant} seeded runs over{' '}
              {config.rounds} rounds
            </dd>
          </div>
          <div>
            <dt>Seeds</dt>
            <dd>
              {seedsText(config.baseSeed, config.runsPerVariant)}, the same for every scenario
            </dd>
          </div>
          <div>
            <dt>Cost</dt>
            <dd>
              {countText(cost.simulatedRuns)} simulated runs of {countText(cost.simulatedMembers)}{' '}
              simulated members in {durationText(cost.wallMs)}; {cost.modelCalls}{' '}
              {cost.modelCalls === 1 ? 'model call' : 'model calls'}
            </dd>
          </div>
          {advanced && (
            <div>
              <dt>Engine</dt>
              <dd className="sw-mono">
                {fidelity.engine} · key actors {fidelity.keyActors} · cohorts {fidelity.cohorts} ·{' '}
                {fidelity.repeatedRuns} repeated runs · {fidelity.modelRepeats} model repeats
              </dd>
            </div>
          )}
          {advanced && (
            <div>
              <dt>Record</dt>
              <dd className="sw-mono">
                {analysis.id}
                {analysis.inputRevisions
                  ? ` · made from ${Object.entries(analysis.inputRevisions)
                      .map(([name, revision]) => `${name} r${revision}`)
                      .join(', ')}`
                  : ' · what it was made from was not recorded'}
              </dd>
            </div>
          )}
          {advanced && (
            <div>
              <dt>Model use</dt>
              <dd className="num">
                {countText(cost.inputTokens)} input and {countText(cost.outputTokens)} output tokens
              </dd>
            </div>
          )}
          <div>
            <dt>How strongly each change lands</dt>
            <dd>
              {setByYou.length > 0
                ? `Set by you for ${listText(setByYou.map((variant) => variant.label))}; a system assumption for the rest.`
                : 'A system assumption, unless a scenario says it was set by you.'}
            </dd>
          </div>
        </dl>
      </div>
    </Section>
  );
}

/** The end of the page: the next step, and the way to read two recorded runs against each other when there are two. */
export function Closing({
  onDecide,
  onRun,
  onRuns,
}: {
  onDecide: () => void;
  onRun: () => void;
  onRuns: (() => void) | null;
}) {
  return (
    <section className="sw-cmp-close" aria-label="What next">
      <p className="sw-cmp-close__line">
        That is how the futures differ. <em>What to do about it</em> comes next.
      </p>
      <div className="sw-cmp-close__actions">
        <Button
          variant="primary"
          size="lg"
          iconEnd={<ArrowRight size={18} aria-hidden="true" />}
          onClick={onDecide}
        >
          Decide
        </Button>
        <Button variant="ghost" icon={<RotateCcw size={16} aria-hidden="true" />} onClick={onRun}>
          Simulate again
        </Button>
        {onRuns && (
          <Button
            variant="ghost"
            iconEnd={<ArrowRight size={16} aria-hidden="true" />}
            onClick={onRuns}
          >
            Compare two recorded runs
          </Button>
        )}
      </div>
    </section>
  );
}
