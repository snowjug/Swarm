import { useMemo } from 'react';
import {
  ArrowUpRight,
  Calculator,
  MessageCircleQuestion,
  MoreHorizontal,
  PenLine,
  Sparkles,
} from 'lucide-react';
import type { SupportVerdict } from '../../../../shared/grounding';
import { SUPPORT_VERDICT_LABELS } from '../../../../shared/grounding';
import type { ProjectDetail, SimulationReport } from '../../../../shared/types';
import {
  Button,
  Chip,
  Disclosure,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '../../design/ui';
import { dateTime } from '../../lib/format';
import { statementsText } from '../../lib/grounding';
import type { UiMode } from '../../lib/mode';
import { VERDICT_ICONS, VERDICT_TONES } from '../studio/glyphs';
import { paragraphs } from '../studio/model';
import { TallyBar, type Tally } from '../studio/TallyBar';
import { Citations } from './Citations';
import { Contents, ContentsSwitcher } from './Contents';
import { ExportMenu } from './ExportMenu';
import { Figures } from './Figures';
import {
  attentionOf,
  chapterCounts,
  chapterId,
  contentsOf,
  groupId,
  totalOf,
  type ReportView,
  type VerdictCounts,
  type WritingView,
} from './model';
import { Review } from './Review';
import { useJump, useScrollSpy } from './useReading';
import type { ExportFormat } from './useReportExport';
import { Back, ChapterPlaceholder, StoppedNotice, WritingStrip } from './Writing';
import './Report.css';

const SUPPORT_ORDER: SupportVerdict[] = [
  'supported',
  'partial',
  'unsupported',
  'contradicted',
  'unchecked',
];

function checkTallies(counts: VerdictCounts): Tally[] {
  return SUPPORT_ORDER.map((verdict) => ({
    key: verdict,
    label: SUPPORT_VERDICT_LABELS[verdict],
    count: counts[verdict] ?? 0,
    tone: VERDICT_TONES[verdict],
    icon: VERDICT_ICONS[verdict],
  }));
}

/** How a chapter's statements were checked, in its margin, and the one press that goes to them. */
function ChapterChecks({ counts, onJump }: { counts: VerdictCounts; onJump: () => void }) {
  const total = totalOf(counts);
  const parts = [
    counts.contradicted > 0 ? `${counts.contradicted} contradicted` : null,
    counts.unsupported > 0 ? `${counts.unsupported} not supported` : null,
  ].filter(Boolean);
  return (
    <button
      type="button"
      className="sw-rep__checks"
      onClick={onJump}
      aria-label={`${statementsText(total)} checked${parts.length ? `: ${parts.join(', ')}` : ''}. Show them in the statement checks`}
    >
      <TallyBar tallies={checkTallies(counts)} legend={false} label="Statements of this chapter" />
      <span className="sw-rep__checkstext">
        <span className="num">{statementsText(total)}</span> checked
        {attentionOf(counts) > 0 && (
          <span className="sw-rep__checksflag"> · {parts.join(', ')}</span>
        )}
      </span>
    </button>
  );
}

function Chapter({
  index,
  title,
  body,
  citations,
  counts,
  onChecks,
}: {
  index: number;
  title: string;
  body: string;
  citations: {
    sourceIds: readonly string[];
    memoryIds: readonly string[];
    interviewIds: readonly string[];
  };
  counts: VerdictCounts | undefined;
  onChecks: () => void;
}) {
  const cited =
    citations.sourceIds.length + citations.memoryIds.length + citations.interviewIds.length > 0;
  const headingId = `sw-rep-ch-${index + 1}`;
  return (
    <section
      id={chapterId(index)}
      className="sw-rep__chapter"
      tabIndex={-1}
      aria-labelledby={headingId}
    >
      <header className="sw-rep__chhead">
        <span className="sw-rep__chno num" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </span>
        <h2 className="sw-title" id={headingId}>
          {title}
        </h2>
      </header>
      <div className="sw-rep__chbody sw-rep__prose">
        {paragraphs(body).map((paragraph, position) => (
          <p key={position}>{paragraph}</p>
        ))}
      </div>
      {(cited || counts) && (
        <aside className="sw-rep__margin" aria-label={`Sources and checks for ${title}`}>
          {cited && (
            <Citations
              sourceIds={citations.sourceIds}
              memoryIds={citations.memoryIds}
              interviewIds={citations.interviewIds}
            />
          )}
          {counts && <ChapterChecks counts={counts} onJump={onChecks} />}
        </aside>
      )}
    </section>
  );
}

/** For Advanced: every operation the engine recorded for the report, as it named it. */
function Operations({ project }: { project: ProjectDetail }) {
  const traces = (project.console?.traces ?? []).filter((trace) => trace.step === 'report');
  if (traces.length === 0) return null;
  return (
    <Disclosure summary={`Report operations (${traces.length})`} className="sw-rep__ops">
      <table className="sw-rep__optable">
        <caption className="sr-only">Operations recorded for the report</caption>
        <thead>
          <tr>
            <th scope="col">Operation</th>
            <th scope="col">Kind</th>
            <th scope="col">Status</th>
            <th scope="col">Took</th>
          </tr>
        </thead>
        <tbody>
          {traces.map((trace) => {
            const took =
              trace.completedAt === null
                ? null
                : (new Date(trace.completedAt).getTime() - new Date(trace.startedAt).getTime()) /
                  1000;
            return (
              <tr key={trace.id}>
                <th scope="row">{trace.name}</th>
                <td>{trace.kind}</td>
                <td>
                  {trace.status}
                  {trace.error ? `: ${trace.error}` : ''}
                </td>
                <td className="num">
                  {took === null || Number.isNaN(took) ? 'still running' : `${took.toFixed(1)} s`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Disclosure>
  );
}

/**
 * The detailed report as a document: the answer first, the run in figures, each chapter with the sources it
 * cites in its margin, how far the statements were checked, and what the figures cannot say. While the report
 * is being written it is the same page, filling in as chapters arrive.
 */
export function ReportDocument({
  project,
  report,
  state,
  writing,
  mode,
  busy,
  verdicts,
  onVerdicts,
  exporter,
  onBack,
  onStudio,
  onAsk,
  onWrite,
  onCancel,
}: {
  project: ProjectDetail;
  report: SimulationReport | null;
  state: Extract<ReportView, { kind: 'complete' | 'writing' | 'stopped' }>;
  writing: WritingView;
  mode: UiMode;
  busy: boolean;
  verdicts: ReadonlySet<SupportVerdict>;
  onVerdicts: (next: Set<SupportVerdict>) => void;
  exporter: { pending: ExportFormat | null; download: (format: ExportFormat) => Promise<void> };
  onBack: () => void;
  onStudio: () => void;
  onAsk: (message?: string) => void;
  onWrite: () => void;
  onCancel: () => void;
}) {
  const complete = state.kind === 'complete';
  const final = state.kind !== 'writing';
  const jump = useJump();
  const hasFigures = Boolean(report) && Boolean(report?.metrics);
  const entries = useMemo(
    () =>
      contentsOf(report, {
        figures: hasFigures,
        planned: writing.chapters.map((chapter) => chapter.title),
        final,
      }),
    [report, hasFigures, writing.chapters, final],
  );
  const activeId = useScrollSpy(entries.map((entry) => entry.id));
  const counts = useMemo(() => chapterCounts(report?.grounding?.claims ?? []), [report]);
  const title = report?.title ?? writing.title ?? project.name;
  const written = report?.sections ?? [];
  const waiting = writing.chapters.slice(written.length);
  const engine = (report?.generatedBy ?? project.mode) === 'llm' ? 'llm' : 'local';
  const chapterTitles = written.map((section) => section.title);

  const toChecks = (chapter: string) => {
    onVerdicts(new Set());
    const at = chapterTitles.indexOf(chapter);
    // The group is in the page once the filter is cleared; wait for it to be drawn.
    window.setTimeout(
      () => jump(at >= 0 && document.getElementById(groupId(at)) ? groupId(at) : 'checks'),
      60,
    );
  };

  return (
    <section className="sw-rep" aria-labelledby="sw-rep-title">
      <header className="sw-rep__head">
        <div className="sw-rep__nav">
          <Back onBack={onBack} />
          <div className="sw-rep__actions">
            {report && (
              <Button
                variant="ghost"
                size="sm"
                icon={<MessageCircleQuestion size={16} aria-hidden="true" />}
                onClick={() => onAsk()}
              >
                Ask about this
              </Button>
            )}
            {report && (
              <ExportMenu
                complete={complete}
                pending={exporter.pending}
                onExport={(f) => void exporter.download(f)}
              />
            )}
            {complete && (
              <Button
                variant="primary"
                size="sm"
                icon={<PenLine size={15} aria-hidden="true" />}
                iconEnd={<ArrowUpRight size={14} aria-hidden="true" />}
                onClick={onStudio}
              >
                Edit in the studio
              </Button>
            )}
          </div>
          {report && (
            <div className="sw-rep__more">
              <Menu>
                <MenuTrigger asChild>
                  <IconButton label="More" tone="glass">
                    <MoreHorizontal size={18} aria-hidden="true" />
                  </IconButton>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem icon={<MessageCircleQuestion size={16} />} onSelect={() => onAsk()}>
                    Ask about this
                  </MenuItem>
                  {complete && (
                    <MenuItem icon={<PenLine size={16} />} onSelect={onStudio}>
                      Edit in the studio
                    </MenuItem>
                  )}
                  <MenuSeparator />
                  <MenuLabel>Export</MenuLabel>
                  <MenuItem
                    disabled={!complete}
                    onSelect={() => void exporter.download('markdown')}
                  >
                    {complete ? 'Markdown' : 'Markdown, when complete'}
                  </MenuItem>
                  <MenuItem onSelect={() => void exporter.download('json')}>
                    Snapshot, as JSON
                  </MenuItem>
                  <MenuItem onSelect={() => window.print()}>Print this page</MenuItem>
                </MenuContent>
              </Menu>
            </div>
          )}
        </div>

        <div className="sw-rep__titles">
          <p className="sw-rep__chips">
            <span className="sw-eyebrow">Detailed report</span>
            <Chip
              size="sm"
              icon={
                engine === 'llm' ? (
                  <Sparkles aria-hidden="true" />
                ) : (
                  <Calculator aria-hidden="true" />
                )
              }
            >
              {engine === 'llm' ? 'Model-assisted' : 'Rules-based'}
            </Chip>
            {state.kind === 'writing' && (
              <Chip size="sm" tone="accent" dot>
                Writing
              </Chip>
            )}
            {state.kind === 'stopped' && (
              <Chip size="sm" tone="caution" dot>
                Not finished
              </Chip>
            )}
            <span className="sw-rep__date">{dateTime(project.updatedAt)}</span>
          </p>
          <h1 className="sw-rep__title sw-display" id="sw-rep-title">
            {title}
          </h1>
          <p className="sw-rep__question">{project.question}</p>
          <p className="sw-rep__caveat">
            Fictional actors under stated assumptions. A simulation, not a forecast.
          </p>
        </div>
      </header>

      {state.kind === 'writing' && (
        <WritingStrip
          writing={writing}
          cancelling={busy}
          advanced={mode === 'advanced'}
          onCancel={onCancel}
        />
      )}
      {state.kind === 'stopped' && (
        <div className="sw-rep__notice">
          <StoppedNotice project={project} reason={state.reason} busy={busy} onWrite={onWrite} />
        </div>
      )}

      <div className="sw-rep__wrap">
        <div className="sw-rep__switch">
          <ContentsSwitcher entries={entries} activeId={activeId} onSelect={jump} />
        </div>
        <div className="sw-rep__grid">
          <div className="sw-rep__side">
            <Contents entries={entries} activeId={activeId} onSelect={jump} />
          </div>

          <div className="sw-rep__doc">
            {report?.executiveSummary && (
              <section id="summary" className="sw-rep__summary" tabIndex={-1} aria-label="Summary">
                <p className="sw-rep__lead">{report.executiveSummary}</p>
              </section>
            )}
            {!report?.executiveSummary && state.kind === 'writing' && (
              <section
                id="summary"
                className="sw-rep__summary"
                aria-busy="true"
                aria-label="Summary"
              >
                <div className="sw-rep__leadghost">
                  <span className="sw-skeleton" style={{ width: '92%', height: '1.4rem' }} />
                  <span className="sw-skeleton" style={{ width: '78%', height: '1.4rem' }} />
                  <span className="sw-skeleton" style={{ width: '54%', height: '1.4rem' }} />
                </div>
              </section>
            )}

            {report?.metrics && (
              <section
                id="figures"
                className="sw-rep__figures"
                tabIndex={-1}
                aria-label="The run in figures"
              >
                <Figures
                  metrics={report.metrics}
                  rounds={project.rounds}
                  intervention={project.settings.intervention}
                />
              </section>
            )}

            {written.map((section, index) => (
              <Chapter
                key={`${index}-${section.title}`}
                index={index}
                title={section.title}
                body={section.body}
                citations={{
                  sourceIds: section.sourceIds,
                  memoryIds: section.memoryIds ?? [],
                  interviewIds: section.interviewIds ?? [],
                }}
                counts={counts.get(section.title)}
                onChecks={() => toChecks(section.title)}
              />
            ))}
            {state.kind !== 'complete' &&
              waiting.map((chapter, offset) => (
                <ChapterPlaceholder
                  key={chapter.title}
                  chapter={chapter}
                  index={written.length + offset}
                  stopped={state.kind === 'stopped'}
                />
              ))}

            {report && final && (
              <Review
                report={report}
                complete={complete}
                active={verdicts}
                onActive={onVerdicts}
                onAsk={(message) => onAsk(message)}
              />
            )}

            {report && final && report.limitations.length > 0 && (
              <section
                id="limits"
                className="sw-rep__section sw-rep__limits"
                tabIndex={-1}
                aria-labelledby="sw-rep-limits"
              >
                <p className="sw-eyebrow">Boundaries of this scenario</p>
                <h2 className="sw-title" id="sw-rep-limits">
                  Limitations
                </h2>
                <ul className="sw-rep__limitlist" role="list">
                  {report.limitations.map((limitation, index) => (
                    <li key={index}>{limitation}</li>
                  ))}
                </ul>
                <p className="sw-rep__fine">
                  All actors and simulated activity are fictional. These outputs are not calibrated
                  forecasts, verified public sentiment or real people’s views. Source citations,
                  simulated records and model interviews are different kinds of evidence.
                </p>
              </section>
            )}

            {mode === 'advanced' && <Operations project={project} />}

            {complete && (
              <footer className="sw-rep__end">
                <Button
                  variant="primary"
                  iconEnd={<ArrowUpRight size={16} aria-hidden="true" />}
                  onClick={onStudio}
                >
                  Edit and review in the studio
                </Button>
                <Button variant="ghost" onClick={onBack}>
                  Back to the brief
                </Button>
              </footer>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
