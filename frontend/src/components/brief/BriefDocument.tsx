import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ArrowUp,
  ChevronRight,
  Download,
  ExternalLink,
  FileJson,
  Info,
  RefreshCw,
} from 'lucide-react';
import {
  BRIEF_SECTION_IDS,
  BRIEF_SIGNAL_NOTICES,
  STATEMENT_ORIGINS,
  type BriefSection,
  type BriefSectionId,
  type BriefView,
  type DecisionBrief,
} from '../../../../shared/brief';
import type { ConsoleStep } from '../../../../shared/guided';
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
import { BriefFreshness } from './BriefFreshness';
import { RecommendationsTable, ValidationTable } from './BriefTables';
import { SectionVisuals } from './BriefVisuals';
import { BriefStatementList, OriginBadge, RelianceBadge } from './BriefStatements';
import {
  BRIEF_CONTENTS_ID,
  REPORT_BRIEF_ID,
  isPlainClick,
  openByDefault,
  scrollToPlace,
  sectionFromHash,
} from './reportNavigation';

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
      <h3 id="brief-answer-title">Executive answer</h3>
      <p className="brief-headline">{brief.headline}</p>
      <p className="brief-badges">
        {answer ? <OriginBadge origin={answer.origin} /> : null}
        {answer?.reliance ? <RelianceBadge reliance={answer.reliance} /> : null}
        <span className="brief-chip">Produced by: {brief.fidelity.label}</span>
        <span className="brief-chip">
          {brief.openCritiques} {brief.openCritiques === 1 ? 'critique' : 'critiques'} not yet
          closed
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

const statementCount = (n: number): string => `${n} ${n === 1 ? 'statement' : 'statements'}`;

/**
 * One section of the brief. Its heading is the control that opens and closes it, so that the outline of
 * the page is the same open or closed; what is inside stays in the page either way, so that a search of
 * the page finds it and it prints in full.
 */
function Section({
  index,
  section,
  brief,
  visuals,
  open,
  onToggle,
  onBack,
}: {
  index: number;
  section: BriefSection;
  brief: DecisionBrief;
  visuals: BriefView['visuals'];
  open: boolean;
  onToggle: (id: BriefSectionId, open: boolean) => void;
  onBack: () => void;
}) {
  const id = sectionAnchor(section.id);
  const statements = section.statements.filter(
    (statement) =>
      !(section.id === 'recommendations' && statement.id.startsWith('rec-')) &&
      !(section.id === 'validation-plan' && statement.id.startsWith('val-')),
  );
  return (
    <section className="brief-section" id={id} aria-labelledby={`${id}-title`} tabIndex={-1}>
      <details
        className="brief-collapse"
        open={open}
        onToggle={(event) => onToggle(section.id, event.currentTarget.open)}
      >
        <summary className="brief-section-toggle">
          <ChevronRight className="brief-chevron" size={16} aria-hidden="true" />
          <h3 id={`${id}-title`}>
            <span className="mono">{index + 1}.</span> {section.title}
          </h3>
          <span className="brief-section-meta">{statementCount(section.statements.length)}</span>
        </summary>
        <div className="brief-section-body">
          <a
            className="brief-back"
            href={`#${BRIEF_CONTENTS_ID}`}
            onClick={(event) => {
              if (!isPlainClick(event)) return;
              event.preventDefault();
              onBack();
            }}
          >
            <ArrowUp size={13} aria-hidden="true" /> Back to contents
          </a>
          <SectionVisuals kinds={section.visuals} visuals={visuals} signal={brief.signal} />
          <BriefStatementList statements={statements} visuals={visuals} />
          {section.id === 'recommendations' ? (
            <RecommendationsTable
              recommendations={brief.recommendations}
              statements={section.statements}
              visuals={visuals}
            />
          ) : null}
          {section.id === 'validation-plan' ? (
            <ValidationTable plan={brief.validationPlan} />
          ) : null}
        </div>
      </details>
    </section>
  );
}

/** A hash in the address is for the page as it was loaded, not for every later visit to the report. */
let hashTaken = false;
function takeHash(present: readonly BriefSectionId[]): BriefSectionId | null {
  if (hashTaken || typeof window === 'undefined') return null;
  hashTaken = true;
  return sectionFromHash(window.location.hash, present);
}

/** The decision brief itself: the answer first, then the sections in the order they are read. */
export function BriefDocument({
  projectId,
  view,
  generating,
  onGenerate,
  onNavigate,
}: {
  projectId: string;
  view: BriefView & { brief: DecisionBrief };
  generating: boolean;
  onGenerate: () => void;
  /** Moves to another stage, so that a brief that needs a new comparison can send the person to run one. */
  onNavigate?: (step: ConsoleStep) => void;
}) {
  const { brief, visuals } = view;
  const ordered = useMemo(
    () =>
      BRIEF_SECTION_IDS.flatMap((id) => {
        const section = brief.sections.find((entry) => entry.id === id);
        return section ? [section] : [];
      }),
    [brief.sections],
  );
  const executive = ordered[0];
  const present = useMemo(() => ordered.map((section) => section.id), [ordered]);
  const [open, setOpen] = useState<ReadonlySet<BriefSectionId>>(
    () => new Set(present.filter(openByDefault)),
  );
  // Where the person is sent: a section, once it is open, or the contents.
  const [landing, setLanding] = useState<{ id: string } | null>(null);
  const [told, setTold] = useState('');

  const reveal = useCallback((id: BriefSectionId) => {
    setOpen((old) => (old.has(id) ? old : new Set(old).add(id)));
    setLanding({ id: sectionAnchor(id) });
  }, []);
  const toggle = (id: BriefSectionId, isOpen: boolean) =>
    setOpen((old) => {
      if (old.has(id) === isOpen) return old;
      const next = new Set(old);
      if (isOpen) next.add(id);
      else next.delete(id);
      return next;
    });
  const expandAll = () => {
    setOpen(new Set(present));
    setTold(`All ${present.length - 1} sections are open.`);
  };
  const collapseAll = () => {
    setOpen(new Set());
    setTold('All sections are closed. The executive answer stays in view.');
  };

  // A section is open before the page scrolls to it, so that what the person came for is there.
  useLayoutEffect(() => {
    if (landing) scrollToPlace(landing.id);
  }, [landing]);
  useLayoutEffect(() => {
    const named = takeHash(present);
    if (named) reveal(named);
  }, [present, reveal]);
  useEffect(() => {
    const onHashChange = () => {
      const named = sectionFromHash(window.location.hash, present);
      if (named) reveal(named);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [present, reveal]);

  return (
    <article className="brief" id={REPORT_BRIEF_ID} aria-labelledby="brief-title" tabIndex={-1}>
      <header className="brief-head">
        <div>
          <span className="eyebrow">DECISION BRIEF</span>
          <h2 id="brief-title">Decision brief</h2>
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
      {brief.signal !== 'clear' ? (
        <Notice
          tone={brief.signal === 'no-direction' ? 'warning' : 'info'}
          title={BRIEF_SIGNAL_NOTICES[brief.signal].title}
        >
          {BRIEF_SIGNAL_NOTICES[brief.signal].text}
        </Notice>
      ) : null}
      <BriefFreshness view={view} onNavigate={onNavigate} />
      {executive ? <ExecutiveCard brief={brief} section={executive} visuals={visuals} /> : null}
      <Legend />
      <nav
        className="brief-nav"
        aria-label="Sections of the decision brief"
        id={BRIEF_CONTENTS_ID}
        tabIndex={-1}
      >
        <div className="brief-nav-head">
          <span className="brief-nav-title" aria-hidden="true">
            Contents
          </span>
          <div className="brief-nav-controls" role="group" aria-label="Open or close the sections">
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={expandAll}
            >
              Expand all sections
            </button>
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={collapseAll}
            >
              Collapse all sections
            </button>
          </div>
        </div>
        <ol>
          {ordered.map((section, index) => (
            <li key={section.id}>
              <a
                href={`#${sectionAnchor(section.id)}`}
                onClick={(event) => {
                  if (!isPlainClick(event)) return;
                  event.preventDefault();
                  reveal(section.id);
                }}
              >
                <span className="mono">{index + 1}</span> {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <p className="sr-only" role="status">
        {told}
      </p>
      <div className="brief-sections">
        {ordered.slice(1).map((section, index) => (
          <Section
            key={section.id}
            index={index + 1}
            section={section}
            brief={brief}
            visuals={visuals}
            open={open.has(section.id)}
            onToggle={toggle}
            onBack={() => setLanding({ id: BRIEF_CONTENTS_ID })}
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
