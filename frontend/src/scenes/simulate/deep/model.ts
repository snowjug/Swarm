import { PLATFORMS } from '../../../../../shared/guided';
import type {
  EnvironmentUpdate,
  Platform,
  PlatformRun,
  SimulationMemory,
} from '../../../../../shared/guided';
import type {
  Agent,
  AgentAction,
  Intervention,
  ProjectDetail,
  RoundSnapshot,
} from '../../../../../shared/types';
import type { Tone } from '../../../design/ui';
import { canExecute, isBusy, isGuided, platformNames, stepStatus } from '../../../lib/console';
import { canBranch, canEditIntervention, canResume, hasCheckpoint } from '../../../lib/whatIf';
import { LEGACY_NOTE } from './copy';

// ---- Words and numbers ------------------------------------------------------------------------------------

const MINUS = '\u2212';

/** An inclination with its sign, to two places, with a true minus: −0.04, +0.12, 0.00. */
export function stanceText(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return 'not recorded';
  const fixed = Math.abs(value).toFixed(digits);
  if (Number(fixed) === 0) return (0).toFixed(digits);
  return `${value < 0 ? MINUS : '+'}${fixed}`;
}

/** A change between two inclinations: the same, with the sign always shown. */
export function changeText(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return 'not recorded';
  const fixed = Math.abs(value).toFixed(digits);
  if (Number(fixed) === 0) return `±${(0).toFixed(digits)}`;
  return `${value < 0 ? MINUS : '+'}${fixed}`;
}

export function shareText(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`;
}

/** Scenario minutes as people say them: 45 min, 8 h, 2 h 30 min. */
export function minutesText(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes - hours * 60);
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function engineLabel(project: Pick<ProjectDetail, 'mode'>): string {
  return project.mode === 'llm' ? 'Model-assisted' : 'Local rules';
}

export const nameOf = (agents: readonly Agent[], id: string | null | undefined): string =>
  agents.find((agent) => agent.id === id)?.name ?? id ?? 'Initial input';

// ---- Where the run stands ---------------------------------------------------------------------------------

export type DeepPhase =
  | 'legacy'
  | 'unavailable'
  | 'unprepared'
  | 'preparing'
  | 'prep-stopped'
  | 'ready'
  | 'queued'
  | 'running'
  | 'paused'
  | 'failed'
  | 'cancelled'
  | 'complete';

/** The deep dive's state, from the project's own record: the environment first, then the run. */
export function deepPhase(project: ProjectDetail): DeepPhase {
  if (project.workflow !== 'guided') return 'legacy';
  if (!project.console) return 'unavailable';
  const { steps } = project.console;
  switch (steps.simulation) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'paused':
      return 'paused';
    case 'ready':
      return 'complete';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      break;
  }
  switch (steps.environment) {
    case 'ready':
      return 'ready';
    case 'queued':
    case 'running':
      return 'preparing';
    case 'failed':
    case 'cancelled':
      return 'prep-stopped';
    default:
      return 'unprepared';
  }
}

export interface PhaseView {
  phase: DeepPhase;
  /** The state in a few words. */
  label: string;
  /** One sentence on where it stands. */
  detail: string;
  tone: Tone;
  /** The server is working on it now. */
  live: boolean;
}

export const savedRounds = (project: Pick<ProjectDetail, 'currentRound' | 'roundCount'>): number =>
  clampNumber(project.currentRound, 0, project.roundCount);

export function phaseView(project: ProjectDetail): PhaseView {
  const phase = deepPhase(project);
  const total = project.roundCount;
  const saved = savedRounds(project);
  const of = `${saved} of ${plural(total, 'round')} saved`;
  switch (phase) {
    case 'legacy':
      return { phase, label: 'Saved quick run', detail: LEGACY_NOTE, tone: 'neutral', live: false };
    case 'unavailable':
      return {
        phase,
        label: 'Record unavailable',
        detail:
          'The server did not return a staged record for this exploration. Reading it again may recover it.',
        tone: 'caution',
        live: false,
      };
    case 'unprepared':
      return {
        phase,
        label: 'Not prepared',
        detail: 'Nothing has been made yet: no cast, no platforms, no rounds.',
        tone: 'neutral',
        live: false,
      };
    case 'preparing':
      return {
        phase,
        label: 'Preparing',
        detail: 'Making the cast of proxies and the platforms they act on.',
        tone: 'accent',
        live: true,
      };
    case 'prep-stopped':
      return {
        phase,
        label: 'Preparation stopped',
        detail: 'The environment was not finished. It can be prepared again.',
        tone: 'caution',
        live: false,
      };
    case 'ready':
      return {
        phase,
        label: 'Ready to start',
        detail: `${plural(project.agents.length, 'proxy', 'proxies')}, ${plural(total, 'round')}. Nothing has run yet.`,
        tone: 'neutral',
        live: false,
      };
    case 'queued':
      return {
        phase,
        label: 'Waiting to start',
        detail: 'Accepted by the server; it begins as soon as a worker is free.',
        tone: 'accent',
        live: true,
      };
    case 'running':
      return { phase, label: 'Running', detail: of, tone: 'accent', live: true };
    case 'paused':
      return waitingBranch(project)
        ? {
            phase,
            label: 'Branch ready',
            detail: `Copied through round ${saved} of ${total}. It waits for you to resume.`,
            tone: 'accent',
            live: false,
          }
        : {
            phase,
            label: 'Paused',
            detail: `After round ${saved} of ${total}. Saved and resumable.`,
            tone: 'caution',
            live: false,
          };
    case 'failed':
      return {
        phase,
        label: 'Stopped',
        detail:
          saved > 0
            ? `After round ${saved} of ${total}. The saved rounds are kept.`
            : 'Before the first round was saved.',
        tone: 'critical',
        live: false,
      };
    case 'cancelled':
      return {
        phase,
        label: 'Cancelled',
        detail:
          saved > 0
            ? `After round ${saved} of ${total}. The saved rounds are kept.`
            : 'Before any round was saved.',
        tone: 'caution',
        live: false,
      };
    case 'complete':
      return {
        phase,
        label: 'Finished',
        detail: `${plural(total, 'round')} on ${plural(runningPlatforms(project).length || 1, 'platform')}.`,
        tone: 'favor',
        live: false,
      };
  }
}

/** How far the run is, 0 to 1, from the rounds the server has saved. Never estimated. */
export function progressShare(project: Pick<ProjectDetail, 'currentRound' | 'roundCount'>): number {
  return project.roundCount > 0 ? clampNumber(project.currentRound / project.roundCount, 0, 1) : 0;
}

/** One sentence about the rounds: how many are planned, saved, or being worked out. */
export function roundsSentence(project: ProjectDetail, phase: DeepPhase): string {
  const total = project.roundCount;
  const saved = savedRounds(project);
  const minutes = project.console?.environment?.minutesPerRound;
  const have = saved === 1 ? 'Round 1 is saved.' : `Rounds 1 to ${saved} are saved.`;
  switch (phase) {
    case 'ready':
      return `${plural(total, 'round')}${minutes ? ` of ${minutesText(minutes)} each` : ''} are planned. Nothing has run yet.`;
    case 'queued':
      return 'The run is waiting for a worker.';
    case 'running':
      return saved === 0
        ? 'Round 1 is being worked out.'
        : `${have} Round ${saved + 1} is being worked out.`;
    case 'paused':
      return `${have} Round ${saved + 1} has not started.`;
    case 'failed':
    case 'cancelled':
      return saved === 0 ? 'No round was saved.' : `${have} The run stopped there.`;
    case 'complete':
      return total === 1 ? 'The round is saved.' : `All ${total} rounds are saved.`;
    default:
      return '';
  }
}

export const PLATFORM_STATUS: Record<
  PlatformRun['status'],
  { label: string; tone: Tone; live: boolean }
> = {
  ready: { label: 'Ready', tone: 'neutral', live: false },
  running: { label: 'Running', tone: 'accent', live: true },
  paused: { label: 'Paused', tone: 'caution', live: false },
  completed: { label: 'Finished', tone: 'favor', live: false },
  failed: { label: 'Stopped', tone: 'critical', live: false },
  cancelled: { label: 'Cancelled', tone: 'caution', live: false },
};

// ---- What may be done -------------------------------------------------------------------------------------

export interface RunControls {
  prepare: boolean;
  start: boolean;
  /** The start button says Retry: the stage failed or was cancelled. */
  retry: boolean;
  cancel: boolean;
  pause: boolean;
  resume: boolean;
  /** A failed or cancelled run that kept saved rounds. */
  recovering: boolean;
  restart: boolean;
  branch: boolean;
  intervention: boolean;
  report: 'write' | 'open' | null;
}

/**
 * Which actions the record allows, by the same rules the old workspace used (`lib/console`, `lib/whatIf`):
 * the checkpoint actions need the server's what-if capability, the rest do not.
 */
export function runControls(project: ProjectDetail, whatIf: boolean): RunControls {
  const none: RunControls = {
    prepare: false,
    start: false,
    retry: false,
    cancel: false,
    pause: false,
    resume: false,
    recovering: false,
    restart: false,
    branch: false,
    intervention: false,
    report: null,
  };
  if (!isGuided(project)) return none;
  const status = stepStatus(project, 'simulation');
  const working = isBusy(project) && (status === 'queued' || status === 'running');
  const checkpoint = hasCheckpoint(project);
  const recovering = (status === 'failed' || status === 'cancelled') && checkpoint;
  const start = canExecute(project, 'simulation') && (!whatIf || !checkpoint);
  const report =
    status === 'ready'
      ? project.console?.steps.report === 'pending'
        ? canExecute(project, 'report')
          ? 'write'
          : null
        : 'open'
      : null;
  return {
    prepare: canExecute(project, 'environment'),
    start,
    retry: start && (status === 'failed' || status === 'cancelled'),
    cancel: working,
    pause: whatIf && working,
    resume: whatIf && canResume(project),
    recovering: whatIf && recovering,
    restart: whatIf && (status === 'paused' || recovering),
    branch: whatIf && canBranch(project),
    intervention: whatIf && canEditIntervention(project),
    report,
  };
}

/** The environment can be edited only before the simulation has started, and not while the server is busy. */
export function environmentEditable(project: ProjectDetail): boolean {
  return (
    isGuided(project) &&
    stepStatus(project, 'environment') === 'ready' &&
    stepStatus(project, 'simulation') === 'pending' &&
    !isBusy(project) &&
    project.status !== 'completed'
  );
}

// ---- Platforms --------------------------------------------------------------------------------------------

export interface PlatformView {
  id: Platform;
  name: string;
  network: PlatformRun['network'];
  /** The environment asks for it, or it has run. */
  planned: boolean;
  run: PlatformRun | null;
  rounds: RoundSnapshot[];
  saved: number;
  minutes: number;
  actions: number;
  latest: RoundSnapshot | null;
}

export function platformViews(project: ProjectDetail): PlatformView[] {
  const planned = project.console?.environment?.platforms ?? [];
  const runs = project.console?.platforms ?? [];
  return PLATFORMS.map((id) => {
    const run = runs.find((item) => item.platform === id) ?? null;
    const rounds = (run?.rounds ?? []).slice().sort((a, b) => a.round - b.round);
    return {
      id,
      name: platformNames[id],
      network: id === 'plaza' ? 'broadcast' : 'community',
      planned: planned.includes(id) || run !== null,
      run,
      rounds,
      saved: run?.currentRound ?? 0,
      minutes: run?.elapsedMinutes ?? 0,
      actions: rounds.reduce((sum, round) => sum + round.actions.length, 0),
      latest: rounds.at(-1) ?? null,
    };
  });
}

/** The platforms that have a run, in the engine's order. */
export function runningPlatforms(project: ProjectDetail): PlatformView[] {
  return platformViews(project).filter((view) => view.run !== null);
}

/** The platform to look at first: the first with saved rounds, then the first that ran, then the first planned. */
export function defaultPlatform(project: ProjectDetail): Platform {
  const views = platformViews(project);
  return (
    views.find((view) => view.rounds.length > 0)?.id ??
    views.find((view) => view.run)?.id ??
    views.find((view) => view.planned)?.id ??
    'plaza'
  );
}

// ---- Rounds -----------------------------------------------------------------------------------------------

export interface RoundPoint {
  round: number;
  mean: number;
  support: number;
  undecided: number;
  opposition: number;
  polarization: number;
  actions: number;
  interactions: number;
}

export function roundPoints(rounds: readonly RoundSnapshot[]): RoundPoint[] {
  return rounds
    .slice()
    .sort((a, b) => a.round - b.round)
    .map((round) => ({
      round: round.round,
      mean: round.meanOpinion,
      support: round.supportShare,
      undecided: round.undecidedShare,
      opposition: round.oppositionShare,
      polarization: round.polarization,
      actions: round.activityCount,
      interactions: round.interactions,
    }));
}

export interface ProxyLine {
  id: string;
  name: string;
  /** Round 0 is the initial inclination the environment gave the proxy. */
  points: { round: number; opinion: number }[];
}

export function proxyLines(
  rounds: readonly RoundSnapshot[],
  agents: readonly Agent[],
): ProxyLine[] {
  const ordered = rounds.slice().sort((a, b) => a.round - b.round);
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    points: [
      { round: 0, opinion: agent.initialOpinion },
      ...ordered.flatMap((round) => {
        const found = round.opinions.find((item) => item.agentId === agent.id);
        return found ? [{ round: round.round, opinion: found.opinion }] : [];
      }),
    ],
  }));
}

export interface ProxyStand {
  id: string;
  name: string;
  role: string;
  opinion: number;
  /** Where it stood in the round before. */
  before: number | null;
  change: number | null;
  action: AgentAction | null;
}

export interface RoundDetail {
  round: number;
  point: RoundPoint | null;
  previous: RoundPoint | null;
  /** Scenario minute at the end of the round, where the environment says how long a round is. */
  minute: number | null;
  intervention: Intervention | null;
  proxies: ProxyStand[];
  actions: AgentAction[];
}

/** One round of one platform as it was recorded. Round 0 is the start: the initial inclinations. */
export function roundDetail(
  rounds: readonly RoundSnapshot[],
  agents: readonly Agent[],
  round: number,
  minutesPerRound: number | null,
): RoundDetail {
  const points = roundPoints(rounds);
  const snapshot = rounds.find((item) => item.round === round) ?? null;
  const before = rounds.find((item) => item.round === round - 1) ?? null;
  // A round that was not saved has no positions to show; none are made up.
  const known = round === 0 || snapshot !== null;
  const proxies = known
    ? agents.map((agent): ProxyStand => {
        const opinion =
          round === 0
            ? agent.initialOpinion
            : (snapshot?.opinions.find((item) => item.agentId === agent.id)?.opinion ??
              agent.initialOpinion);
        const prior =
          round <= 0
            ? null
            : round === 1
              ? agent.initialOpinion
              : (before?.opinions.find((item) => item.agentId === agent.id)?.opinion ?? null);
        return {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          opinion,
          before: prior,
          change: prior === null ? null : opinion - prior,
          action: snapshot?.actions.find((action) => action.agentId === agent.id) ?? null,
        };
      })
    : [];
  return {
    round,
    point: points.find((item) => item.round === round) ?? null,
    previous: points.find((item) => item.round === round - 1) ?? null,
    minute: minutesPerRound === null ? null : round * minutesPerRound,
    intervention: snapshot?.intervention ?? null,
    proxies,
    actions: snapshot?.actions ?? [],
  };
}

/** The mean of the proxies' initial inclinations: where the mean line begins. */
export function startMean(agents: readonly Agent[]): number {
  return agents.length === 0
    ? 0
    : agents.reduce((sum, agent) => sum + agent.initialOpinion, 0) / agents.length;
}

/** Whether the inclinations stay so close to neutral that the chart reads better zoomed in. */
export function zoomSuggested(points: readonly RoundPoint[], lines: readonly ProxyLine[]): boolean {
  const widest = Math.max(
    0,
    ...points.map((point) => Math.abs(point.mean)),
    ...lines.flatMap((line) => line.points.map((item) => Math.abs(item.opinion))),
  );
  return widest <= 0.3;
}

/** What the chart says, in words, for a screen reader: the same figures the table holds. */
export function chartSummary(
  name: string,
  points: readonly RoundPoint[],
  start: number,
  total: number,
): string {
  const last = points.at(-1);
  if (!last) return `${name}: no round has been recorded yet.`;
  const means = [start, ...points.map((point) => point.mean)];
  const low = Math.min(...means);
  const high = Math.max(...means);
  return (
    `${name}: ${last.round} of ${total} rounds recorded. Mean inclination ${stanceText(start)} at the start and ` +
    `${stanceText(last.mean)} after round ${last.round}, between ${stanceText(low)} and ${stanceText(high)}. ` +
    `After round ${last.round}: ${shareText(last.opposition)} against, ${shareText(last.undecided)} undecided, ` +
    `${shareText(last.support)} in favour; polarization ${last.polarization.toFixed(2)}; ${plural(last.actions, 'action')}. ` +
    'The exact values are in the data table.'
  );
}

export interface InterventionMark extends Intervention {
  /** The round it applies to has been saved. */
  applied: boolean;
}

export function interventionMark(
  project: Pick<ProjectDetail, 'settings' | 'currentRound'>,
): InterventionMark | null {
  const value = project.settings.intervention;
  return value ? { ...value, applied: value.round <= project.currentRound } : null;
}

export function describeIntervention(value: Intervention | null): string {
  return value
    ? `Round ${value.round}: “${value.label}” (stance ${stanceText(value.stance)}, strength ${value.strength.toFixed(2)})`
    : 'None scheduled';
}

/** Rounds copied unchanged from a parent run, or 0 where this run did not come from a branch. */
export function copiedRounds(project: ProjectDetail): number {
  return project.console?.branch?.fromRound ?? 0;
}

/** A branch that has not run since it was made: it waits at the round it left its parent. */
export function waitingBranch(project: ProjectDetail): boolean {
  const branch = project.console?.branch;
  return (
    Boolean(branch) && deepPhase(project) === 'paused' && savedRounds(project) === branch!.fromRound
  );
}

// ---- Memory -----------------------------------------------------------------------------------------------

export type ActionType = SimulationMemory['actionType'];

export interface MemoryFilter {
  agentId: string | null;
  round: number | null;
  action: ActionType | null;
  query: string;
}

export const NO_FILTER: MemoryFilter = { agentId: null, round: null, action: null, query: '' };

export const filterActive = (filter: MemoryFilter): boolean =>
  filter.agentId !== null ||
  filter.round !== null ||
  filter.action !== null ||
  filter.query.trim() !== '';

export function memoriesOf(
  memories: readonly SimulationMemory[] | undefined,
  platform: Platform,
): SimulationMemory[] {
  return (memories ?? []).filter((memory) => memory.platform === platform);
}

/** The newest records first, by the engine's own order within a round. */
export function filterMemories(
  memories: readonly SimulationMemory[],
  filter: MemoryFilter,
): SimulationMemory[] {
  const query = filter.query.trim().toLowerCase();
  return memories
    .filter(
      (memory) =>
        (filter.agentId === null || memory.agentId === filter.agentId) &&
        (filter.round === null || memory.round === filter.round) &&
        (filter.action === null || memory.actionType === filter.action) &&
        (query === '' ||
          `${memory.id} ${memory.text} ${memory.agentId ?? ''}`.toLowerCase().includes(query)),
    )
    .reverse();
}

export interface MemoryFacets {
  rounds: number[];
  actions: ActionType[];
}

export function memoryFacets(memories: readonly SimulationMemory[]): MemoryFacets {
  const order: ActionType[] = ['seed', 'post', 'reply', 'update', 'observe'];
  const present = new Set(memories.map((memory) => memory.actionType));
  return {
    rounds: [...new Set(memories.map((memory) => memory.round))].sort((a, b) => a - b),
    actions: order.filter((type) => present.has(type)),
  };
}

// ---- The environment draft --------------------------------------------------------------------------------

/** The environment as the editor starts from it: only what the person may change. */
export function environmentInput(project: ProjectDetail): EnvironmentUpdate | null {
  const environment = project.console?.environment;
  if (!environment) return null;
  return {
    rounds: project.settings.rounds,
    minutesPerRound: environment.minutesPerRound,
    platforms: environment.platforms,
    initialPosts: environment.initialPosts,
    agents: project.agents.map(
      ({ id, name, role, persona, initialOpinion, influence, openness }) => ({
        id,
        name,
        role,
        persona,
        initialOpinion,
        influence,
        openness,
      }),
    ),
  };
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => same(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length && keys.every((key) => same(left[key], right[key]))
    );
  }
  return a === b;
}

export interface DraftChanges {
  timing: boolean;
  platforms: boolean;
  /** The seed inputs that differ, by id. */
  seeds: string[];
  /** The proxies that differ, by id. */
  proxies: string[];
  total: number;
}

export function draftChanges(initial: EnvironmentUpdate, draft: EnvironmentUpdate): DraftChanges {
  const timing =
    initial.rounds !== draft.rounds || initial.minutesPerRound !== draft.minutesPerRound;
  const platforms = !same(initial.platforms, draft.platforms);
  const seeds = draft.initialPosts
    .filter((post, index) => !same(post, initial.initialPosts[index]))
    .map((post) => post.id);
  const proxies = draft.agents
    .filter((agent, index) => !same(agent, initial.agents[index]))
    .map((agent) => agent.id);
  return {
    timing,
    platforms,
    seeds,
    proxies,
    total: Number(timing) + Number(platforms) + seeds.length + proxies.length,
  };
}

export const sameDraft = (a: EnvironmentUpdate, b: EnvironmentUpdate): boolean => same(a, b);

/** The rounds a platform cannot run: model runs are limited to ten. */
export const maxRoundsFor = (project: Pick<ProjectDetail, 'mode'>): number =>
  project.mode === 'llm' ? 10 : 24;
