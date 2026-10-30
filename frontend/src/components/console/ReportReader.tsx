import { BookOpen } from 'lucide-react';
import type { ProjectDetail } from '../../../../shared/types';
import { percent, signed } from '../../lib/format';
import type { Inspection } from '../../lib/graph';
import { EmptyPanel } from '../ui';
import { Citations } from './Citations';
import { EvidenceLedger } from './EvidenceLedger';
import { GroundingReview } from './GroundingReview';
import { ReportExport } from './ReportExport';

export function ReportReader({
  project,
  onInspect,
}: {
  project: ProjectDetail;
  onInspect: (selection: Inspection) => void;
}) {
  const report = project.report;
  const plan = project.console?.reportPlan;
  const completed = project.status === 'completed';
  return (
    <section className="report-panel" aria-label="Scenario report chapter reader">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            SCENARIO REPORT /{' '}
            {report ? (completed ? 'RECORDED' : 'PARTIAL OUTPUT') : 'NO CHAPTERS YET'}
          </span>
          <h2>Report reader</h2>
        </div>
        <BookOpen size={20} aria-hidden="true" />
      </div>
      <div className="report-reader">
        {!report ? (
          <EmptyPanel
            title={plan?.title ?? 'No report content recorded'}
            icon={<BookOpen size={30} />}
          >
            {plan
              ? 'The report plan is available. Chapters appear here only as the server persists actual report text.'
              : 'Complete simulation, then explicitly request Generate Report. There are no prerecorded conclusions.'}
          </EmptyPanel>
        ) : (
          <article>
            <header className="report-title">
              <span className="eyebrow">
                {report.generatedBy === 'local'
                  ? 'LOCAL RULES / EVIDENCE SUMMARY'
                  : 'MODEL-ASSISTED SCENARIO ANALYSIS'}
              </span>
              <h2>{report.title}</h2>
              <p className="report-question">{project.question}</p>
              {!completed && (
                <p className="partial-notice">
                  Partial report output. Chapters and conclusions may still be incomplete; export
                  and interaction remain locked.
                </p>
              )}
            </header>
            {!!report.sections.length && (
              <nav className="report-chapters" aria-label="Recorded report chapters">
                {report.sections.map((section, index) => (
                  <button
                    type="button"
                    key={`${index}-${section.title}`}
                    onClick={() => {
                      const chapter = document.getElementById(`report-chapter-${index}`);
                      chapter?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      chapter?.focus({ preventScroll: true });
                    }}
                  >
                    <span className="mono">{String(index + 1).padStart(2, '0')}</span>
                    {section.title}
                  </button>
                ))}
              </nav>
            )}
            {!!report.executiveSummary && (
              <section className="report-section">
                <span className="eyebrow">EXECUTIVE SUMMARY</span>
                <p className="report-prose preserve-text">{report.executiveSummary}</p>
              </section>
            )}
            {report.sections.map((section, index) => (
              <section
                className="report-section"
                id={`report-chapter-${index}`}
                tabIndex={-1}
                key={`${index}-${section.title}`}
              >
                <span className="eyebrow">CHAPTER {String(index + 1).padStart(2, '0')}</span>
                <h2>{section.title}</h2>
                <div className="report-prose preserve-text">{section.body}</div>
                <Citations
                  sourceIds={section.sourceIds}
                  memoryIds={section.memoryIds}
                  interviewIds={section.interviewIds}
                  onInspect={onInspect}
                />
              </section>
            ))}
            <GroundingReview report={report} complete={completed} onInspect={onInspect} />
            {completed && <EvidenceLedger project={project} />}
            <details className="report-metrics">
              <summary>Recorded scenario metrics â€” not a population forecast</summary>
              <dl className="record-grid">
                <dt>Initial mean position</dt>
                <dd>{signed(report.metrics.initialMean)}</dd>
                <dt>Final mean position</dt>
                <dd>{signed(report.metrics.finalMean)}</dd>
                <dt>Final support / opposition</dt>
                <dd>
                  {percent(report.metrics.finalSupport)} / {percent(report.metrics.finalOpposition)}
                </dd>
                <dt>Polarization</dt>
                <dd>{report.metrics.polarization.toFixed(2)}</dd>
                <dt>Interactions</dt>
                <dd>{report.metrics.totalInteractions.toLocaleString()}</dd>
              </dl>
            </details>
            {!!report.limitations.length && (
              <section className="report-section report-limitations">
                <span className="eyebrow">RECORDED LIMITATIONS</span>
                <h2>Boundaries of this scenario</h2>
                <ul>
                  {report.limitations.map((limitation, index) => (
                    <li key={index}>{limitation}</li>
                  ))}
                </ul>
              </section>
            )}
            <p className="report-disclaimer">
              All proxy perspectives and simulated activity are fictional. These outputs are not
              calibrated forecasts, verified public sentiment or real-person thoughts. Source
              citations, simulated memories and model interviews are different evidence classes.
            </p>
          </article>
        )}
        <ReportExport project={project} />
      </div>
    </section>
  );
}
