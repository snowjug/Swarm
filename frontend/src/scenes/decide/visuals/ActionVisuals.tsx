import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { Recommendation, ValidationExperiment } from '../../../../../shared/brief';
import { useReducedMotion } from '../../../design/motion';
import { Chip, Disclosure } from '../../../design/ui';
import { clip, sentence } from '../model/format';
import { LEVELS, effortSteps, plotCells, plotSummary, type Level } from '../model/visual-model';
import { useDoc } from '../ui/context';
import { NoteStack } from '../ui/Notes';
import { OriginMark } from '../ui/Provenance';
import { Prose } from '../ui/Prose';
import { smooth } from '../ui/scroll';
import './actions.css';

const REVERSIBILITY = {
  easy: 'Easy to reverse',
  moderate: 'Reversible with effort',
  hard: 'Hard to reverse',
} as const;

/** Three dots, filled to a level, and the word: a shape and a word for what a colour would only hint at. */
function LevelMark({ label, level }: { label: string; level: Level }) {
  const filled = effortSteps(level);
  return (
    <span className="sw-decide-lv">
      <span className="sw-decide-lv__label">{label}</span>
      <span className="sw-decide-lv__dots" aria-hidden="true">
        {LEVELS.map((entry, index) => (
          <i key={entry} data-on={index < filled || undefined} />
        ))}
      </span>
      <span className="sw-decide-lv__word">{level}</span>
    </span>
  );
}

/** Each recommendation as a numbered mark in the cell of its impact and effort: the best-ranked in the top left are the quick wins. */
function ImpactEffort({
  recommendations,
  active,
  onActive,
}: {
  recommendations: readonly Recommendation[];
  active: string | null;
  onActive: (id: string | null) => void;
}) {
  const reduced = useReducedMotion();
  const cells = plotCells(recommendations);
  const corner: Record<string, string> = {
    '0-0': 'Quick wins',
    '0-2': 'Big bets',
    '2-0': 'Fill-ins',
    '2-2': 'Rethink',
  };
  return (
    <figure className="sw-decide-ie">
      <figcaption className="sw-decide-ie__title">Impact against effort</figcaption>
      <div className="sw-decide-ie__frame">
        <span className="sw-decide-ie__y" aria-hidden="true">
          Impact
        </span>
        <div
          className="sw-decide-ie__grid"
          role="group"
          aria-label={`Impact against effort. ${plotSummary(recommendations)}`}
        >
          {cells.map((cell) => (
            <div
              key={`${cell.row}-${cell.column}`}
              className="sw-decide-ie__cell"
              data-quick={(cell.row === 0 && cell.column === 0) || undefined}
            >
              {corner[`${cell.row}-${cell.column}`] ? (
                <span className="sw-decide-ie__corner" aria-hidden="true">
                  {corner[`${cell.row}-${cell.column}`]}
                </span>
              ) : null}
              <span className="sw-decide-ie__marks">
                {cell.recommendations.map((recommendation) => (
                  <button
                    key={recommendation.id}
                    type="button"
                    className="sw-decide-ie__mark"
                    data-active={active === recommendation.id || undefined}
                    aria-label={`Recommendation ${recommendation.priority}: ${recommendation.impact} impact, ${recommendation.effort} effort`}
                    onMouseEnter={() => onActive(recommendation.id)}
                    onMouseLeave={() => onActive(null)}
                    onFocus={() => onActive(recommendation.id)}
                    onBlur={() => onActive(null)}
                    onClick={() => {
                      const item = document.getElementById(`rec-${recommendation.id}`);
                      item?.scrollIntoView({ block: 'center', behavior: smooth(reduced) });
                    }}
                  >
                    {recommendation.priority}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
        <span className="sw-decide-ie__x" aria-hidden="true">
          <span>Low</span>
          <span>Effort</span>
          <span>High</span>
        </span>
      </div>
    </figure>
  );
}

function RecommendationItem({
  recommendation,
  active,
  onActive,
}: {
  recommendation: Recommendation;
  active: boolean;
  onActive: (id: string | null) => void;
}) {
  const { statementById, visuals, anchors } = useDoc();
  const statement = statementById.get(recommendation.id);
  const notes = anchors.byStatement.get(recommendation.id) ?? [];
  const findings = recommendation.linkedFindingIds
    .map((id) => visuals?.lookups.findings.find((entry) => entry.id === id))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  return (
    <li
      id={`rec-${recommendation.id}`}
      className="sw-decide-rc__item"
      data-active={active || undefined}
      onMouseEnter={() => onActive(recommendation.id)}
      onMouseLeave={() => onActive(null)}
    >
      <span className="sw-decide-rc__rank sw-numeral num" aria-hidden="true">
        {recommendation.priority}
      </span>
      <div className="sw-decide-rc__body">
        <p className="sw-decide-rc__text">
          <span className="sr-only">Recommendation {recommendation.priority}: </span>
          <Prose text={recommendation.text} />
          {statement ? <OriginMark statement={statement} /> : null}
        </p>
        <p className="sw-decide-rc__chips">
          <LevelMark label="Impact" level={recommendation.impact} />
          <LevelMark label="Effort" level={recommendation.effort} />
          <Chip size="sm">{REVERSIBILITY[recommendation.reversibility]}</Chip>
          <Chip size="sm" wrap>
            {recommendation.horizon}
          </Chip>
          {recommendation.ownerFunction ? (
            <span className="sw-decide-rc__owner">{sentence(recommendation.ownerFunction)}</span>
          ) : null}
        </p>
        <NoteStack critiques={notes} />
        <Disclosure className="sw-decide-rc__more" summary="How to check it first">
          <dl className="sw-decide-dl">
            <div>
              <dt>Before committing</dt>
              <dd>{recommendation.validation}</dd>
            </div>
            {recommendation.leadingIndicators.length > 0 && (
              <div>
                <dt>Leading indicators</dt>
                <dd>
                  <ul role="list">
                    {recommendation.leadingIndicators.map((indicator) => (
                      <li key={indicator}>{indicator}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {recommendation.assumptions.length > 0 && (
              <div>
                <dt>It assumes</dt>
                <dd>
                  <ul role="list">
                    {recommendation.assumptions.map((assumption) => (
                      <li key={assumption}>{assumption}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {findings.length > 0 && (
              <div>
                <dt>It follows from</dt>
                <dd>
                  <ul role="list">
                    {findings.map((finding) => (
                      <li key={finding.id}>
                        {clip(finding.statement, 200)}{' '}
                        <span className="sw-decide-dl__meta num">
                          held in {finding.holdsIn} of {finding.of} runs
                        </span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
        </Disclosure>
      </div>
    </li>
  );
}

/** The recommendations, best first, with where each sits between impact and effort kept beside them. */
export function RecommendationsVisual({
  recommendations,
}: {
  recommendations: readonly Recommendation[];
}) {
  const [active, setActive] = useState<string | null>(null);
  if (recommendations.length === 0) return null;
  const ordered = [...recommendations].sort((a, b) => a.priority - b.priority);
  return (
    <div className="sw-decide-rc">
      <div className="sw-decide-rc__aside">
        <ImpactEffort recommendations={ordered} active={active} onActive={setActive} />
      </div>
      <ol className="sw-decide-rc__list" role="list" aria-label="Recommendations, best first">
        {ordered.map((recommendation) => (
          <RecommendationItem
            key={recommendation.id}
            recommendation={recommendation}
            active={active === recommendation.id}
            onActive={setActive}
          />
        ))}
      </ol>
    </div>
  );
}

/** The checks that would settle what the simulation could not, as a ladder: each says what to observe and what to compare it with. None has been run. */
export function ValidationVisual({ plan }: { plan: readonly ValidationExperiment[] }) {
  if (plan.length === 0) return null;
  return (
    <div className="sw-decide-vl-wrap">
      <p className="sw-decide-vl__note">
        Real-world checks for the premises the simulated answer rests on.{' '}
        <strong>None of them has been run.</strong>
      </p>
      <ol className="sw-decide-vl" role="list" aria-label="Validation plan">
        {plan.map((check, index) => (
          <li
            key={check.id}
            className="sw-decide-vl__step"
            style={{ '--i': Math.min(index, 8) } as CSSProperties}
          >
            <span className="sw-decide-vl__node num" aria-hidden="true">
              {index + 1}
            </span>
            <div className="sw-decide-vl__body">
              <h3 className="sw-decide-vl__q">{check.question}</h3>
              <p className="sw-decide-vl__chips">
                <LevelMark label="Effort" level={check.effort} />
                <Chip size="sm" wrap>
                  {check.duration}
                </Chip>
                {check.ownerFunction ? (
                  <span className="sw-decide-rc__owner">{sentence(check.ownerFunction)}</span>
                ) : null}
              </p>
              <Disclosure className="sw-decide-rc__more" summary="How to run it">
                <dl className="sw-decide-dl">
                  {check.measure && (
                    <div>
                      <dt>What to observe</dt>
                      <dd>{check.measure}</dd>
                    </div>
                  )}
                  {check.comparison && (
                    <div>
                      <dt>Compared with</dt>
                      <dd>{check.comparison}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Method</dt>
                    <dd>{check.method}</dd>
                  </div>
                  <div>
                    <dt>Decision rule</dt>
                    <dd>{check.successSignal}</dd>
                  </div>
                  <div>
                    <dt>It tests</dt>
                    <dd>
                      <ul role="list">
                        {check.targets.map((target) => (
                          <li key={target}>{target}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                </dl>
              </Disclosure>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
