import { useState } from 'react';
import {
  RESPONSE_CATEGORIES,
  RESPONSE_LABELS,
  type Analysis,
  type ResponseCategory,
} from '../../../../shared/analysis';
import { Chip } from '../../design/ui';
import { adverseShare } from '../../lib/analysis';
import { useCompare } from './context';
import { vars } from './css';
import { sectionInfo, ADVERSE_WORDS } from './copy';
import { pointsPhrase, precisionOf, rangeText, shareText } from './format';
import { useArrival, useInView } from './hooks';
import { setAgainst } from './pair';
import type { PairControl } from './PairMenu';
import { DataTable, ResponseBar, ResponseKey, Section, type TableSpec } from './parts';
import type { Scenario } from './scenarios';
import './futures.css';

function Row({
  scenario,
  role,
  index,
  digits,
  reference,
  active,
  onSet,
}: {
  scenario: Scenario;
  role: 'a' | 'b' | 'other';
  index: number;
  digits: 0 | 1;
  reference: Scenario | null;
  active: ResponseCategory | null;
  onSet: () => void;
}) {
  const { advanced } = useCompare();
  const [ref, seen] = useInView<HTMLLIElement>('0px 0px -6% 0px');
  const shown = useArrival(scenario.adverse * 100, seen);
  const difference = reference && role !== 'a' ? scenario.adverse - reference.adverse : null;
  const meta =
    scenario.kind === 'baseline'
      ? 'Nothing changes'
      : `Lands in round ${scenario.round} · intensity ${scenario.intensity}`;
  return (
    <li
      ref={ref}
      className="sw-cmp-fut__row"
      data-role={role}
      data-seen={seen || undefined}
      style={vars({ '--row': index })}
    >
      <div className="sw-cmp-fut__who">
        <h3 className="sw-cmp-fut__name">
          {role === 'a' ? (
            scenario.label
          ) : (
            <button
              type="button"
              className="sw-cmp-fut__pick"
              aria-pressed={role === 'b'}
              onClick={onSet}
            >
              {scenario.label}
              <span className="sr-only">
                {role === 'b'
                  ? ': set against the reference'
                  : ': set against the reference instead'}
              </span>
            </button>
          )}
        </h3>
        <p className="sw-cmp-fut__meta">{meta}</p>
        {advanced && (
          <p className="sw-cmp-fut__engine sw-mono">
            {scenario.id} · {scenario.runs} runs
          </p>
        )}
        <p className="sw-cmp-fut__tag">
          {role === 'a' ? (
            <Chip size="sm">Reference</Chip>
          ) : role === 'b' ? (
            <Chip size="sm" tone="accent" dot>
              Set against
            </Chip>
          ) : (
            <span className="sw-cmp-fut__hint" aria-hidden="true">
              Set against
            </span>
          )}
        </p>
      </div>
      <div className="sw-cmp-fut__bar">
        <ResponseBar
          shares={scenario.shares}
          label={scenario.label}
          active={active}
          size="lg"
          labelled
        />
      </div>
      <div className="sw-cmp-fut__figure">
        <p className="sw-cmp-fut__num sw-numeral" aria-hidden="true">
          {shown.toFixed(digits)}
          <span>%</span>
        </p>
        <p className="sw-cmp-fut__sr sr-only">
          {shareText(scenario.adverse, digits)} of simulated members {ADVERSE_WORDS}.
        </p>
        <p className="sw-cmp-fut__cap">
          {rangeText(scenario.spread.p10, scenario.spread.p90, digits)} across runs
        </p>
        {difference !== null && (
          <p
            className="sw-cmp-fut__vs"
            data-tone={difference > 0.0005 ? 'against' : difference < -0.0005 ? 'favor' : 'neutral'}
          >
            {pointsPhrase(difference, digits)} from {reference?.label}
          </p>
        )}
      </div>
    </li>
  );
}

const tableOf = (scenarios: readonly Scenario[], digits: 0 | 1): TableSpec => ({
  caption:
    'Mean share of the simulated members in each final response over the seeded runs of each scenario, and how far the share looking for an alternative or resisting spread across the runs',
  columns: [
    'Scenario',
    'Runs',
    ...RESPONSE_CATEGORIES.map((category) => RESPONSE_LABELS[category]),
    'Alternative or resist, 10th to 90th percentile of runs',
  ],
  rows: scenarios.map((scenario) => [
    scenario.label,
    scenario.runs,
    ...RESPONSE_CATEGORIES.map((category) => shareText(scenario.shares[category], digits)),
    rangeText(scenario.spread.p10, scenario.spread.p90, digits),
  ]),
});

const perRunTable = (
  analysis: Analysis,
  scenarios: readonly Scenario[],
  digits: 0 | 1,
): TableSpec => {
  const seeds =
    analysis.variants
      .find((result) => result.variantId === scenarios[0]?.id)
      ?.runs.map((run) => run.seed) ?? [];
  const share = (id: string, seed: number): string => {
    const run = analysis.variants
      .find((result) => result.variantId === id)
      ?.runs.find((entry) => entry.seed === seed);
    return run ? shareText(adverseShare(run.responseShares), digits) : 'not run';
  };
  return {
    caption:
      'Share of the simulated members looking for an alternative or resisting in each seeded run, scenario by scenario, on the same seeds',
    columns: ['Seed', ...scenarios.map((scenario) => scenario.label)],
    rows: seeds.map((seed) => [seed, ...scenarios.map((scenario) => share(scenario.id, seed))]),
  };
};

/** Every scenario's outcome mix, one bar each: the futures side by side, with the pair that is compared marked. */
export function Futures({
  analysis,
  scenarios,
  control,
}: {
  analysis: Analysis;
  scenarios: readonly Scenario[];
  control: PairControl;
}) {
  const [active, setActive] = useState<ResponseCategory | null>(null);
  const digits = precisionOf(scenarios.map((scenario) => scenario.adverse));
  const reference = scenarios.find((scenario) => scenario.id === control.pair.a) ?? null;
  return (
    <Section info={sectionInfo('futures')}>
      <div className="sw-cmp-fut">
        <ResponseKey active={active} onActive={setActive} />
        <p className="sw-cmp-fut__read sw-caption" aria-live="polite">
          {active
            ? `${RESPONSE_LABELS[active]}: ${scenarios
                .map(
                  (scenario) => `${scenario.label} ${shareText(scenario.shares[active], digits)}`,
                )
                .join(' · ')}`
            : 'Press a response to bring it forward in every bar.'}
        </p>
        <ol className="sw-cmp-fut__list" aria-label="Scenarios">
          {scenarios.map((scenario, index) => (
            <Row
              key={scenario.id}
              scenario={scenario}
              role={
                scenario.id === control.pair.a
                  ? 'a'
                  : scenario.id === control.pair.b
                    ? 'b'
                    : 'other'
              }
              index={index}
              digits={digits}
              reference={reference}
              active={active}
              onSet={() => control.onPair(setAgainst(control.pair, control.scenarios, scenario.id))}
            />
          ))}
        </ol>
        <DataTable
          spec={tableOf(scenarios, digits)}
          more={[perRunTable(analysis, scenarios, digits)]}
        />
      </div>
    </Section>
  );
}
