import {
  SUPPORT_VERDICTS,
  SUPPORT_VERDICT_LABELS,
  emptyVerdictCounts,
  type ClaimChecks,
  type GroundedClaim,
  type SupportVerdict,
} from '../../../../shared/grounding';
import type { OperationTrace } from '../../../../shared/guided';
import type { ProjectDetail, RoundSnapshot, SimulationReport } from '../../../../shared/types';
import { canExecute, isBusy, isGuided, stepStatus } from '../../lib/console';

// ---- Which state the detailed report is in --------------------------------------------------------

/**
 * `complete` the report is written and can be read and exported; `writing` the engine is writing it now
 * (whatever has been written is already in the project); `stopped` it ended before it was finished;
 * `ready` there is none and it can be started; `blocked` it cannot be started yet; `none` this record
 * has none and cannot make one.
 */
export type ReportView =
  | { kind: 'complete' }
  | { kind: 'writing' }
  | { kind: 'stopped'; reason: 'failed' | 'cancelled' | 'incomplete' }
  | { kind: 'ready' }
  | { kind: 'blocked'; running: boolean }
  | { kind: 'none' };

export function resolveReport(project: ProjectDetail): ReportView {
  const step = stepStatus(project, 'report');
  const active = project.status === 'queued' || project.status === 'running';
  const failed = project.status === 'failed' || step === 'failed';
  const cancelled = project.status === 'cancelled' || step === 'cancelled';

  if (project.report) {
    if (project.status === 'completed') return { kind: 'complete' };
    if (step === 'running' || step === 'queued' || active) return { kind: 'writing' };
    return { kind: 'stopped', reason: failed ? 'failed' : cancelled ? 'cancelled' : 'incomplete' };
  }
  if (step === 'running' || step === 'queued') return { kind: 'writing' };
  if (failed) return { kind: 'stopped', reason: 'failed' };
  if (cancelled) return { kind: 'stopped', reason: 'cancelled' };
  if (!isGuided(project) || step === 'ready') return { kind: 'none' };
  if (canExecute(project, 'report')) return { kind: 'ready' };
  return { kind: 'blocked', running: isBusy(project) };
}

/** Whether the report can be started (or started again after it stopped) from this scene. */
export const canWrite = (project: ProjectDetail): boolean =>
  isGuided(project) && !isBusy(project) && canExecute(project, 'report');

/** What writing the report does, in words, and what it costs: the report page and the studio say the same. */
export function writingNote(model: boolean): { lead: string; caption: string } {
  return model
    ? {
        lead: 'A model writes the chapters from the recorded run and its sources. Then every statement is checked against the passage it cites.',
        caption: 'Uses the model; its calls count against this project’s budget.',
      }
    : {
        lead: 'The chapters are assembled from the recorded run: the figures, the platforms compared and the sources it cites. No model is used.',
        caption: 'Simulated figures from fictional actors. Not a forecast.',
      };
}

// ---- Writing --------------------------------------------------------------------------------------

export interface ChapterProgress {
  title: string;
  state: 'done' | 'writing' | 'waiting';
  words: number | null;
}

export interface WritingView {
  title: string | null;
  chapters: ChapterProgress[];
  done: number;
  total: number;
  /** The engine's own progress for the project, 0 to 100. */
  percent: number;
  /** What it is doing now, in plain words; null while nothing is recorded yet. */
  activity: string | null;
  /** The operation as the engine names it, for Advanced. */
  operation: string | null;
}

export const wordCount = (text: string): number => text.split(/\s+/u).filter(Boolean).length;

/** What an engine operation is, said plainly. Anything not known is shown under the engine's own name. */
export function activityText(trace: Pick<OperationTrace, 'name' | 'kind'>): string {
  const { name, kind } = trace;
  if (name === 'Simulation integrity review') return 'Checking the recorded run';
  if (name === 'Rules-based report synthesis')
    return 'Writing the report from the recorded figures';
  if (name === 'Report outline and tool plan') return 'Planning the chapters';
  if (name === 'Local source and memory search') return 'Searching the sources';
  if (name === 'Recorded timeline reconstruction') return 'Reading the recorded timeline';
  if (name === 'Executive summary') return 'Writing the summary';
  if (name === 'Grounding review') return 'Checking every statement against its sources';
  if (name.startsWith('Write chapter: '))
    return `Writing “${name.slice('Write chapter: '.length)}”`;
  if (kind === 'interview') return 'Interviewing a fictional actor';
  return name;
}

export function writingView(project: ProjectDetail, stopped = false): WritingView {
  const plan = project.console?.reportPlan ?? null;
  const written = project.report?.sections ?? [];
  const titles = plan?.sections.length ? plan.sections : written.map((section) => section.title);
  const chapters: ChapterProgress[] = titles.map((title, index) => {
    const section = written[index];
    if (section) return { title, state: 'done', words: wordCount(section.body) };
    return {
      title,
      state: index === written.length && !stopped ? 'writing' : 'waiting',
      words: null,
    };
  });
  const traces = (project.console?.traces ?? []).filter((trace) => trace.step === 'report');
  const current = [...traces].reverse().find((trace) => trace.status === 'running') ?? null;
  return {
    title: plan?.title ?? project.report?.title ?? null,
    chapters,
    done: chapters.filter((chapter) => chapter.state === 'done').length,
    total: chapters.length,
    percent: Math.min(100, Math.max(0, Math.round(project.progress))),
    activity: current
      ? activityText(current)
      : chapters.length === 0
        ? 'Planning the chapters'
        : null,
    operation: current?.name ?? null,
  };
}

// ---- The figures ---------------------------------------------------------------------------------

/** The engine calls an actor supportive at +0.2 or more and opposing at -0.2 or less; the report's own text says so. */
export const STANCE_THRESHOLD = 0.2;

export type ShiftWord = 'toward support' | 'toward opposition' | 'barely moved';

/** Below this the movement of the mean is within the noise of a small seeded run, and is said so. */
export const BARELY_MOVED = 0.05;

export function shiftWord(initial: number, final: number): ShiftWord {
  const change = final - initial;
  if (Math.abs(change) < BARELY_MOVED) return 'barely moved';
  return change > 0 ? 'toward support' : 'toward opposition';
}

export const signedNumber = (value: number, digits = 2): string => {
  const fixed = value.toFixed(digits);
  return value > 0 && Number(fixed) !== 0
    ? `+${fixed}`
    : Number(fixed) === 0
      ? (0).toFixed(digits)
      : fixed;
};

export const percentOf = (share: number): number =>
  Math.round(Math.min(1, Math.max(0, share)) * 100);

export interface Split {
  support: number;
  undecided: number;
  opposition: number;
}

/** The final cohort as shares that add to one: whatever is neither supportive nor opposing is undecided. */
export function finalSplit(
  metrics: Pick<SimulationReport['metrics'], 'finalSupport' | 'finalOpposition'>,
): Split {
  const support = Math.min(1, Math.max(0, metrics.finalSupport));
  const opposition = Math.min(1 - support, Math.max(0, metrics.finalOpposition));
  return { support, opposition, undecided: Math.max(0, 1 - support - opposition) };
}

export interface TrajectoryPoint {
  round: number;
  mean: number;
  support: number;
  opposition: number;
  undecided: number;
  polarization: number;
}

/** The recorded rounds in order. One round is not a trajectory, so there is none to draw. */
export function trajectory(rounds: readonly RoundSnapshot[]): TrajectoryPoint[] {
  if (rounds.length < 2) return [];
  return [...rounds]
    .sort((a, b) => a.round - b.round)
    .map((round) => ({
      round: round.round,
      mean: round.meanOpinion,
      support: round.supportShare,
      opposition: round.oppositionShare,
      undecided: round.undecidedShare,
      polarization: round.polarization,
    }));
}

/** The half-range of the vertical axis: at least a quarter either way, widening to the next step that holds every point. */
export function trajectoryDomain(points: readonly Pick<TrajectoryPoint, 'mean'>[]): number {
  const reach = points.reduce((most, point) => Math.max(most, Math.abs(point.mean)), 0);
  return [0.25, 0.5, 1].find((step) => reach <= step * 0.9) ?? 1;
}

export interface TrajectoryGeometry {
  line: string;
  xs: number[];
  ys: number[];
  zero: number;
}

export function trajectoryGeometry(
  points: readonly Pick<TrajectoryPoint, 'mean'>[],
  size: { width: number; height: number },
  domain: number,
): TrajectoryGeometry {
  const last = Math.max(points.length - 1, 1);
  const xs = points.map((_, index) => (index / last) * size.width);
  const ys = points.map(
    (point) =>
      size.height / 2 -
      (Math.max(-domain, Math.min(domain, point.mean)) / domain) * (size.height / 2),
  );
  const line = points.length
    ? ys.reduce(
        (path, y, index) => `${path}${index ? ' L' : 'M'}${xs[index]!.toFixed(1)} ${y.toFixed(1)}`,
        '',
      )
    : '';
  return { line, xs, ys, zero: size.height / 2 };
}

/** The nearest round to a horizontal position, for the pointer and for the arrow keys. */
export function nearestIndex(position: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round((position / width) * (count - 1))));
}

export function describeTrajectory(points: readonly TrajectoryPoint[]): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return 'No rounds were recorded.';
  const means = points.map((point) => point.mean);
  return `Mean inclination by round, from ${signedNumber(first.mean, 3)} in round ${first.round} to ${signedNumber(last.mean, 3)} in round ${last.round}, between ${signedNumber(Math.min(...means), 3)} and ${signedNumber(Math.max(...means), 3)}.`;
}

// ---- The statement checks -------------------------------------------------------------------------

export type VerdictCounts = Record<SupportVerdict, number>;

/** How the checked statements of each chapter divide, by chapter title. */
export function chapterCounts(
  claims: readonly Pick<GroundedClaim, 'section' | 'verdict'>[],
): Map<string, VerdictCounts> {
  const result = new Map<string, VerdictCounts>();
  for (const claim of claims) {
    const counts = result.get(claim.section) ?? emptyVerdictCounts();
    counts[claim.verdict] += 1;
    result.set(claim.section, counts);
  }
  return result;
}

export const totalOf = (counts: VerdictCounts): number =>
  SUPPORT_VERDICTS.reduce((sum, verdict) => sum + counts[verdict], 0);

/** Statements whose cited passage gives a reader no reason to rely on them. */
export const attentionOf = (counts: VerdictCounts): number =>
  counts.unsupported + counts.contradicted;

/** The verdict toggles pressed now, with `verdict` pressed or released. An empty set means all are shown. */
export function toggleVerdict(
  active: ReadonlySet<SupportVerdict>,
  verdict: SupportVerdict,
): Set<SupportVerdict> {
  const next = new Set(active);
  if (next.has(verdict)) next.delete(verdict);
  else next.add(verdict);
  return next;
}

export function filterClaims<T extends Pick<GroundedClaim, 'verdict'>>(
  claims: readonly T[],
  active: ReadonlySet<SupportVerdict>,
): T[] {
  return active.size === 0 ? [...claims] : claims.filter((claim) => active.has(claim.verdict));
}

/** The question put to the analyst about one statement: it names the verdict and quotes the statement, within the message limit. */
export function askAbout(claim: Pick<GroundedClaim, 'text' | 'verdict'>): string {
  const text = claim.text.length > 400 ? `${claim.text.slice(0, 399).trimEnd()}…` : claim.text;
  return `Why is this statement of the report rated “${SUPPORT_VERDICT_LABELS[claim.verdict]}”? “${text}”`;
}

// ---- Contents and reading position -----------------------------------------------------------------

export interface ContentsEntry {
  id: string;
  label: string;
  /** A number for a chapter; the others are marked by a glyph. */
  index: number | null;
  kind: 'summary' | 'figures' | 'chapter' | 'checks' | 'limits';
  /** The chapter or the checks hold something that needs a look: a contradicted or unsupported statement. */
  flag: boolean;
}

export const chapterId = (index: number): string => `chapter-${index + 1}`;

export function contentsOf(
  report: SimulationReport | null,
  options: {
    figures: boolean;
    /** The chapters the report was planned to have, so that those not yet written still have their place. */
    planned?: readonly string[];
    /** The report is no longer being written: its checks and limitations are in the page. */
    final?: boolean;
  },
): ContentsEntry[] {
  const final = options.final ?? true;
  const counts = chapterCounts(report?.grounding?.claims ?? []);
  const entries: ContentsEntry[] = [];
  if (report?.executiveSummary) {
    entries.push({ id: 'summary', label: 'Summary', index: null, kind: 'summary', flag: false });
  }
  if (options.figures) {
    entries.push({
      id: 'figures',
      label: 'The run in figures',
      index: null,
      kind: 'figures',
      flag: false,
    });
  }
  const titles = [...(report?.sections.map((section) => section.title) ?? [])];
  (options.planned ?? []).slice(titles.length).forEach((title) => titles.push(title));
  titles.forEach((title, index) => {
    const own = counts.get(title);
    entries.push({
      id: chapterId(index),
      label: title,
      index: index + 1,
      kind: 'chapter',
      flag: own ? attentionOf(own) > 0 : false,
    });
  });
  if (report && final && (report.grounding || report.generatedBy === 'llm')) {
    const total = report.grounding ? attentionOf(report.grounding.counts) : 0;
    entries.push({
      id: 'checks',
      label: 'Statement checks',
      index: null,
      kind: 'checks',
      flag: total > 0,
    });
  }
  if (report && final && report.limitations.length) {
    entries.push({ id: 'limits', label: 'Limitations', index: null, kind: 'limits', flag: false });
  }
  return entries;
}

/**
 * The section being read: the last one whose top has passed the reading line. Sections are given in
 * page order; before the first has reached the line, the first is the one in view.
 */
export function activeSection(
  tops: readonly { id: string; top: number }[],
  line: number,
): string | null {
  let active: string | null = tops[0]?.id ?? null;
  for (const entry of tops) {
    if (entry.top <= line) active = entry.id;
    else break;
  }
  return active;
}

// ---- What each check of a statement found ------------------------------------------------------------

export interface CheckLine {
  key: 'quote' | 'words' | 'figures' | 'independent';
  label: string;
  text: string;
  /** Whether this check went well, went badly, or says nothing either way: always said in the words too. */
  tone: 'good' | 'caution' | 'bad' | 'neutral';
}

/** The four checks the server runs on a statement, each in a sentence. A check that did not run says so. */
export function describeChecks(
  checks: Pick<ClaimChecks, 'quote' | 'overlap' | 'numbers' | 'entailment'>,
): CheckLine[] {
  const quote: CheckLine =
    checks.quote === 'found'
      ? {
          key: 'quote',
          label: 'Quotation',
          text: 'Found word for word in the cited passage.',
          tone: 'good',
        }
      : checks.quote === 'not-found'
        ? {
            key: 'quote',
            label: 'Quotation',
            text: 'Not found in the cited passages.',
            tone: 'bad',
          }
        : { key: 'quote', label: 'Quotation', text: 'None was supplied.', tone: 'neutral' };
  const words: CheckLine =
    checks.overlap === null
      ? { key: 'words', label: 'Wording', text: 'Not applicable.', tone: 'neutral' }
      : {
          key: 'words',
          label: 'Wording',
          text: `${percentOf(checks.overlap)}% of its words appear in the cited material.`,
          tone: checks.overlap >= 0.6 ? 'good' : checks.overlap >= 0.35 ? 'caution' : 'bad',
        };
  const figures: CheckLine =
    checks.numbers === 'match'
      ? {
          key: 'figures',
          label: 'Figures',
          text: 'Every figure matches the cited material.',
          tone: 'good',
        }
      : checks.numbers === 'mismatch'
        ? {
            key: 'figures',
            label: 'Figures',
            text: 'A figure does not match the cited material.',
            tone: 'bad',
          }
        : { key: 'figures', label: 'Figures', text: 'It holds none to check.', tone: 'neutral' };
  const independent: CheckLine =
    checks.entailment === 'supports'
      ? {
          key: 'independent',
          label: 'Independent check',
          text: 'The passage supports it.',
          tone: 'good',
        }
      : checks.entailment === 'partial'
        ? {
            key: 'independent',
            label: 'Independent check',
            text: 'The passage backs only part of it.',
            tone: 'caution',
          }
        : checks.entailment === 'contradicts'
          ? {
              key: 'independent',
              label: 'Independent check',
              text: 'The passage conflicts with it.',
              tone: 'bad',
            }
          : checks.entailment === 'not-supported'
            ? {
                key: 'independent',
                label: 'Independent check',
                text: 'Nothing in the passage backs it.',
                tone: 'bad',
              }
            : {
                key: 'independent',
                label: 'Independent check',
                text: 'It did not run.',
                tone: 'neutral',
              };
  return [quote, words, figures, independent];
}

/** The anchor of a chapter's statement group, so that the chapter can point at it. */
export const groupId = (index: number): string => `check-${index + 1}`;
