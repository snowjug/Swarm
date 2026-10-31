import { Download, ExternalLink, FileJson, Info, RefreshCw } from 'lucide-react';
import {
  BRIEF_SECTION_IDS,
  STATEMENT_ORIGINS,
  type BriefSection,
  type BriefView,
  type DecisionBrief,
} from '../../../../shared/brief';
import { briefApi } from '../../api/brief';
import {
  RELIANCE_LABELS,
  RELIANCE_MEANINGS,
  ORIGIN_MEANINGS,
  sectionAnchor,
  type Reliance,
} from '../../lib/brief';
import { dateTime } from '../../lib/format';
import { Notice, Spinner } from '../ui';
import { RecommendationsTable, ValidationTable } from './BriefTables';
import { SectionVisuals } from './BriefVisuals';
import { BriefStatementList, OriginBadge, RelianceBadge } from './BriefStatements';

const RELIANCE_LEVELS: Reliance[] = ['high', 'moderate', 'low'];

function ExecutiveCard({
  brief,
  section,
  visuals,
}: {
  brief: DecisionBrief;
  section: BriefSection;
  visuals: BriefView['visuals'];
}) {
  const [answer] = section.statements;
  const notTold = section.statements.at(-1);
  return (
    <section
      className="brief-answer"
      id={sectionAnchor('executive-answer')}
      aria-labelledby="brief-answer-title"
      tabIndex={-1}
    >
      <span className="eyebrow">1 / EXECUTIVE ANSWER</span>
      <h4 id="brief-answer-title">Executive answer</h4>
      <p className="brief-headline">{brief.headline}</p>
      <p className="brief-badges">
        {answer ? <OriginBadge origin={answer.origin} /> : null}
        {answer?.reliance ? <RelianceBadge reliance={answer.reliance} /> : null}
        <span className="brief-chip">Produced by: {brief.fidelity.label}</span>
        <span className="brief-chip">
          {brief.openCritiques} open {brief.openCritiques === 1 ? 'critique' : 'critiques'}
        </span>
      </p>
      {notTold && notTold !== answer ? (
        <p className="brief-not-told">
          <Info size={15} aria-hidden="true" /> <span>{notTold.text}</span>
        </p>
      ) : null}
      <details className="brief-answer-detail">
        <summary>How this answer is made</summary>
        <BriefStatementList statements={section.statements} visuals={visuals} />
      </details>
    </section>
  );
}

function Legend() {
  return (
    <details className="brief-legend-box">
      <summary>How to read the labels</summary>
      <p className="field-help">
        Every statement names where it comes from, and a statement about the simulation also says
        how far it can be relied on.
      </p>
      <ul className="brief-plain-list">
        {STATEMENT_ORIGINS.map((origin) => (
          <li key={origin}>
            <OriginBadge origin={origin} /> {ORIGIN_MEANINGS[origin]}
          </li>
        ))}
        {RELIANCE_LEVELS.map((level) => (
          <li key={level}>
            <RelianceBadge reliance={level} /> {RELIANCE_MEANINGS[level]}
          </li>
        ))}
      </ul>
      <p className="field-help">
        {RELIANCE_LABELS.high}, {RELIANCE_LABELS.moderate.toLowerCase()} and{' '}
        {RELIANCE_LABELS.low.toLowerCase()} follow from how often a finding held across seeded runs
        and whether a cited passage supports the actors it is about. They are not probabilities.
      </p>
    </details>
  );
}

function Section({
  index,
  section,
  brief,
  visuals,
}: {
  index: number;
  section: BriefSection;
  brief: DecisionBrief;
  visuals: BriefView['visuals'];
}) {
  const id = sectionAnchor(section.id);
  const statements = section.statements.filter(
    (statement) =>
      !(section.id === 'recommendations' && statement.id.startsWith('rec-')) &&
      !(section.id === 'validation-plan' && statement.id.startsWith('val-')),
  );
  return (
    <section className="brief-section" id={id} aria-labelledby={`${id}-title`} tabIndex={-1}>
      <h4 id={`${id}-title`}>
        <span className="mono">{index + 1}.</span> {section.title}
      </h4>
      <SectionVisuals kinds={section.visuals} visuals={visuals} />
      <BriefStatementList statements={statements} visuals={visuals} />
      {section.id === 'recommendations' ? (
        <RecommendationsTable
          recommendations={brief.recommendations}
          statements={section.statements}
          visuals={visuals}
        />
      ) : null}
      {section.id === 'validation-plan' ? <ValidationTable plan={brief.validationPlan} /> : null}
    </section>
  );
}

/** The decision brief itself: the answer first, then the sections in the order they are read. */
export function BriefDocument({
  projectId,
  view,
  generating,
  onGenerate,
}: {
  projectId: string;
  view: BriefView & { brief: DecisionBrief };
  generating: boolean;
  onGenerate: () => void;
}) {
  const { brief, visuals } = view;
  const ordered = BRIEF_SECTION_IDS.flatMap((id) => {
    const section = brief.sections.find((entry) => entry.id === id);
    return section ? [section] : [];
  });
  const executive = ordered[0];
  return (
    <article className="brief" aria-labelledby="brief-title">
      <header className="brief-head">
        <div>
          <span className="eyebrow">DECISION BRIEF</span>
          <h3 id="brief-title">Decision brief</h3>
          <p className="field-help">
            Assembled by rules from this project’s analysis, stakeholders, scenario and sources on{' '}
            <time dateTime={brief.generatedAt}>{dateTime(brief.generatedAt)}</time>. It describes
            what happened in a simulation of synthetic actors under stated assumptions. It does not
            predict the future.
          </p>
        </div>
        <div className="brief-actions" role="group" aria-label="Make or export the brief">
          {view.may.generate ? (
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={onGenerate}
              disabled={generating}
            >
              {generating ? (
                <Spinner label="Generating the brief" />
              ) : (
                <RefreshCw size={13} aria-hidden="true" />
              )}{' '}
              Generate again
            </button>
          ) : null}
          {view.may.export ? (
            <>
              <a
                className="button button-secondary button-small"
                href={briefApi.exportUrl(projectId, 'md')}
                download
              >
                <Download size={13} aria-hidden="true" /> Markdown
              </a>
              <a
                className="button button-secondary button-small"
                href={briefApi.exportUrl(projectId, 'json')}
                download
              >
                <FileJson size={13} aria-hidden="true" /> JSON
              </a>
              <a
                className="button button-secondary button-small"
                href={briefApi.exportUrl(projectId, 'html')}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={13} aria-hidden="true" /> Printable
              </a>
            </>
          ) : null}
        </div>
      </header>
      {view.changedSince.length > 0 ? (
        <Notice tone="warning" title="This brief may be out of date">
          Since it was made, this has changed: {view.changedSince.join(', ')}.{' '}
          {view.may.generate
            ? 'Generate it again to bring it up to date.'
            : 'Ask someone who can edit the project to generate it again.'}
        </Notice>
      ) : null}
      {executive ? <ExecutiveCard brief={brief} section={executive} visuals={visuals} /> : null}
      <Legend />
      <nav className="brief-nav" aria-label="Sections of the decision brief">
        <ol>
          {ordered.map((section, index) => (
            <li key={section.id}>
              <a href={`#${sectionAnchor(section.id)}`}>
                <span className="mono">{index + 1}</span> {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="brief-sections">
        {ordered.slice(1).map((section, index) => (
          <Section
            key={section.id}
            index={index + 1}
            section={section}
            brief={brief}
            visuals={visuals}
          />
        ))}
      </div>
      <footer className="brief-foot">
        <p className="field-help">
          Analysis {brief.analysisId}; {brief.methodology.runsPerVariant} seeded runs for each of{' '}
          {brief.methodology.variants.length} variants over {brief.methodology.rounds} rounds, from
          base seed {brief.methodology.baseSeed}. Swarm explores possible scenarios. It does not
          predict the future.
        </p>
      </footer>
    </article>
  );
}
