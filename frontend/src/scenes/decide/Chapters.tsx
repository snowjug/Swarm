import type { ReactNode } from 'react';
import type { BriefSection } from '../../../../shared/brief';
import { Disclosure } from '../../design/ui';
import { chapterStatements, type Chapter } from './model/brief-model';
import { plural } from './model/format';
import { useDoc } from './ui/context';
import { StatementList } from './ui/Statements';
import { ComparisonVisual } from './visuals/ComparisonVisual';
import { OutcomeVisual } from './visuals/OutcomeVisual';
import { RecommendationsVisual, ValidationVisual } from './visuals/ActionVisuals';
import { AssumptionVisual, EvidenceVisual, TraitVisual } from './visuals/ReferenceVisuals';
import { StakeholderVisual } from './visuals/StakeholderVisual';
import { SensitivityVisual, StabilityVisual } from './visuals/UncertaintyVisuals';

/** Said once where a chapter names charts that cannot be drawn. */
function NoCharts() {
  return (
    <p className="sw-decide-note-line">
      The charts for this chapter are not shown, because the analysis they are drawn from is no
      longer stored.
    </p>
  );
}

/** How the brief was made, in the brief’s own words: the method and what its fidelity cannot say. */
function MethodNotes() {
  const { brief } = useDoc();
  const { methodology, fidelity } = brief;
  return (
    <div className="sw-decide-method">
      <div>
        <h3 className="sw-eyebrow">How it was made</h3>
        <ul role="list">
          <li>
            {plural(methodology.runsPerVariant, 'seeded run')} for each of{' '}
            {plural(methodology.variants.length, 'scenario')} ({methodology.variants.join(', ')}),
            over {plural(methodology.rounds, 'round')}, from base seed {methodology.baseSeed}.
          </li>
          {methodology.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="sw-eyebrow">What its fidelity cannot say · {fidelity.label}</h3>
        <ul role="list">
          {fidelity.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
          {fidelity.caveats.length === 0 && <li>No further caveat was recorded.</li>}
        </ul>
      </div>
    </div>
  );
}

/**
 * What a chapter holds: the figures the brief names for it, drawn from the data it kept, and then its
 * statements, the first few open and the rest folded. A chapter whose figures cannot be drawn says so once.
 */
export function ChapterBody({ chapter, review }: { chapter: Chapter; review: ReactNode }) {
  const { brief, visuals } = useDoc();
  const { spec } = chapter;
  if (spec.id === 'review') return <>{review}</>;
  const section = chapter.section as BriefSection;
  const statements = chapterStatements(section);
  const names = (kind: BriefSection['visuals'][number]) => section.visuals.includes(kind);
  const list = (show: number, style: 'plain' | 'labelled' | 'risks' = 'plain') => (
    <StatementList statements={statements} show={show} style={style} label={chapter.title} />
  );
  const drawn = (
    kind: BriefSection['visuals'][number],
    draw: (data: NonNullable<typeof visuals>) => ReactNode,
  ): ReactNode => (names(kind) ? visuals ? draw(visuals) : <NoCharts /> : null);

  switch (spec.id) {
    case 'decision':
      return list(spec.show, 'labelled');
    case 'stakeholders':
      return (
        <>
          {drawn('stakeholder-map', (data) => (
            <StakeholderVisual visuals={data} />
          ))}
          {list(spec.show)}
        </>
      );
    case 'reaction-patterns':
      return (
        <>
          {drawn('outcome-distribution', (data) => (
            <OutcomeVisual visuals={data} />
          ))}
          {list(spec.show)}
        </>
      );
    case 'alternative-outcomes':
      return (
        <>
          {drawn('scenario-comparison', (data) => (
            <ComparisonVisual visuals={data} signal={brief.signal} />
          ))}
          {list(spec.show)}
        </>
      );
    case 'uncertainty':
      return (
        <>
          {drawn('sensitivity', (data) => (
            <SensitivityVisual visuals={data} />
          ))}
          {visuals && visuals.lookups.findings.length > 0 ? (
            <StabilityVisual visuals={visuals} />
          ) : null}
          {list(spec.show)}
        </>
      );
    case 'assumptions':
      return (
        <>
          {drawn('assumption-register', (data) => (
            <AssumptionVisual visuals={data} />
          ))}
          {list(spec.show)}
        </>
      );
    case 'risks-opportunities':
      return list(spec.show, 'risks');
    case 'recommendations':
      return (
        <>
          <RecommendationsVisual recommendations={brief.recommendations} />
          {statements.length > 0 && (
            <Disclosure heading={3} summary="How these are ranked">
              <StatementList
                statements={statements}
                show={statements.length}
                label="How the recommendations are ranked"
              />
            </Disclosure>
          )}
        </>
      );
    case 'validation-plan':
      return (
        <>
          <ValidationVisual plan={brief.validationPlan} />
          {statements.length > 0 && (
            <Disclosure heading={3} summary="How the checks were chosen">
              <StatementList
                statements={statements}
                show={statements.length}
                label="How the checks were chosen"
              />
            </Disclosure>
          )}
        </>
      );
    case 'evidence-base':
      return (
        <>
          {drawn('evidence-map', (data) => (
            <EvidenceVisual visuals={data} />
          ))}
          {list(spec.show, 'labelled')}
        </>
      );
    case 'technical-appendix':
      return (
        <>
          <MethodNotes />
          {visuals && visuals.traitTable.length > 0 ? <TraitVisual visuals={visuals} /> : null}
          {list(spec.show)}
        </>
      );
    case 'limitations':
      return list(spec.show);
    default:
      return list(spec.show);
  }
}
