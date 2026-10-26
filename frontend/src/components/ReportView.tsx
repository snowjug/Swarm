import { FileCheck2, FileText, ShieldAlert } from 'lucide-react';
import type { SimulationReport } from '../../../shared/types';
import { count, percent, signed } from '../lib/format';
import { EmptyPanel, SourceLinks } from './ui';

export function ReportView({
  report,
  onSource,
}: {
  report: SimulationReport | null;
  onSource: (id: string) => void;
}) {
  if (!report) {
    return (
      <EmptyPanel
        title="The report is not ready yet"
        icon={<FileText size={27} aria-hidden="true" />}
      >
        A source-grounded report is assembled after the rounds finish. If the run fails, the
        recorded partial data remains available in the other views.
      </EmptyPanel>
    );
  }
  return (
    <div className="report-layout">
      <article className="card report-document">
        <div className="report-kicker">
          <FileCheck2 size={17} aria-hidden="true" />
          <span>SCENARIO RESEARCH NOTE</span>
          <span className="method-tag">
            {report.generatedBy === 'local' ? 'RULES-BASED · NOT AI' : 'MODEL-ASSISTED'}
          </span>
        </div>
        <h2>{report.title}</h2>
        <p className="report-disclaimer">
          A record of simulated behaviour under chosen assumptions. Not a scientifically validated
          forecast or a statement about real people.
        </p>
        <section className="report-summary">
          <span className="eyebrow">EXECUTIVE SUMMARY</span>
          <p className="plain-text">{report.executiveSummary}</p>
        </section>
        {report.sections.map((section, index) => (
          <section className="report-section" key={`${section.title}-${index}`}>
            <div className="report-section-title">
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{section.title}</h3>
            </div>
            <p className="plain-text">{section.body}</p>
            <SourceLinks ids={section.sourceIds} onOpen={onSource} />
          </section>
        ))}
        <section className="report-limitations">
          <h3>
            <ShieldAlert size={20} aria-hidden="true" /> Read the limitations
          </h3>
          {report.limitations.length ? (
            <ul>
              {report.limitations.map((limitation, index) => (
                <li className="plain-text" key={index}>
                  {limitation}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No additional limitations were supplied by the engine. Simulation assumptions, source
              quality, and fictional personas still constrain interpretation.
            </p>
          )}
        </section>
      </article>
      <aside className="report-aside" aria-label="Report simulation metrics">
        <div className="card report-metrics">
          <span className="eyebrow">SIMULATED, NOT PREDICTED</span>
          <h3>The recorded outcome</h3>
          <dl>
            <div>
              <dt>Initial mean stance</dt>
              <dd>{signed(report.metrics.initialMean)}</dd>
            </div>
            <div>
              <dt>Final mean stance</dt>
              <dd>{signed(report.metrics.finalMean)}</dd>
            </div>
            <div>
              <dt>Final support share</dt>
              <dd className="text-teal">{percent(report.metrics.finalSupport)}</dd>
            </div>
            <div>
              <dt>Final opposition share</dt>
              <dd>{percent(report.metrics.finalOpposition)}</dd>
            </div>
            <div>
              <dt>Polarization</dt>
              <dd className="text-violet">{report.metrics.polarization.toFixed(3)}</dd>
            </div>
            <div>
              <dt>Total interactions</dt>
              <dd>{count(report.metrics.totalInteractions)}</dd>
            </div>
          </dl>
          <p>
            Shares are fractions of simulated agents, not probabilities. Stance is on a −1 to +1
            scale. Polarization is an engine-computed dispersion measure.
          </p>
        </div>
        <div className="report-aside-note">
          <FileText size={20} aria-hidden="true" />
          <h4>Keep a trail of context.</h4>
          <p>
            Open source chips to inspect the excerpts behind a section. Export from the experiment
            header to keep a local copy.
          </p>
        </div>
      </aside>
    </div>
  );
}
