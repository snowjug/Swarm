import type { SimulationMemory, SurveyRecord, SurveyResponse } from '../../../../shared/guided';
import type {
  Agent,
  AppConfig,
  ChatGroundingStatus,
  ProjectDetail,
} from '../../../../shared/types';
import type { Tone } from '../../design/ui';
import { signed } from '../../lib/format';
import { CHAT_GROUNDING, type Tone as LedgerTone } from '../../lib/ledger';
import { realModelLabel } from '../../lib/provider';

export type AskTab = 'analyst' | 'actors' | 'survey';

/** The conversation target the server knows the report by. */
export const ANALYST_TARGET = 'report';

/** The most surveys one project keeps, and the most an exchange count a conversation is allowed (both are the server's). */
export const SURVEY_LIMIT = 5;
export const QUESTION_MIN = 3;
export const QUESTION_MAX = 1_000;
export const SURVEY_QUESTION_MIN = 5;

export interface Availability {
  /** The report is written, so there is something to ask about. */
  ready: boolean;
  /** Why not, in words, when it is not. */
  waiting: string | null;
  local: boolean;
  /** A real model can answer: the project is model-assisted and the server has a provider to call. */
  modelReady: boolean;
  /** New replies can be made. Rules can always; a real model only while a provider is configured. */
  canReply: boolean;
  /** Surveys can be started: the server offers them and the project is a guided one. */
  surveysOn: boolean;
}

export function availability(project: ProjectDetail, config: AppConfig | null): Availability {
  const ready = project.status === 'completed' && Boolean(project.report);
  const local = project.mode === 'local';
  const modelReady =
    !local && Boolean(config?.provider.configured && config.capabilities.modelAssisted);
  let waiting: string | null = null;
  if (!ready) {
    waiting =
      project.status === 'queued' || project.status === 'running'
        ? 'A run is under way. Ask opens when the report is written.'
        : project.status === 'failed' || project.status === 'cancelled'
          ? 'The last run stopped before the report was written.'
          : 'The analyst and the actors answer from the written report, and this exploration has none yet.';
  }
  return {
    ready,
    waiting,
    local,
    modelReady,
    canReply: local || modelReady,
    surveysOn: Boolean(project.console && config?.capabilities.surveys),
  };
}

/** Where to open: the analyst, an actor, or the surveys, from what a scene asked for. */
export function resolveSeed(
  project: Pick<ProjectDetail, 'agents'>,
  target: string | undefined,
): { tab: AskTab; actorId: string | null } {
  const first = project.agents[0]?.id ?? null;
  const wanted = target?.trim();
  if (!wanted || wanted === ANALYST_TARGET || wanted.toLowerCase() === 'analyst') {
    return { tab: 'analyst', actorId: first };
  }
  if (wanted === 'survey' || wanted === 'surveys') return { tab: 'survey', actorId: first };
  const byId = project.agents.find((agent) => agent.id === wanted);
  const found =
    byId ?? project.agents.find((agent) => agent.name.toLowerCase() === wanted.toLowerCase());
  return found ? { tab: 'actors', actorId: found.id } : { tab: 'analyst', actorId: first };
}

/** "Regulator: Sets or enforces rules." as the kind of actor and what it does. */
export function splitRole(role: string): { kind: string; what: string | null } {
  const at = role.indexOf(':');
  if (at < 0) return { kind: role.trim(), what: null };
  return { kind: role.slice(0, at).trim(), what: role.slice(at + 1).trim() || null };
}

export type Position = SurveyResponse['position'];

export interface StanceView {
  position: Position;
  label: string;
  tone: Tone;
  /** "+0.04": the number the engine holds, on its −1 to +1 scale. */
  signed: string;
}

const POSITION_LABEL: Record<Position, string> = {
  supportive: 'In favour',
  opposing: 'Against',
  undecided: 'Undecided',
};

const POSITION_TONE: Record<Position, Tone> = {
  supportive: 'favor',
  opposing: 'against',
  undecided: 'neutral',
};

export const positionLabel = (position: Position): string => POSITION_LABEL[position];
export const positionTone = (position: Position): Tone => POSITION_TONE[position];

/** The engine's own thresholds for a survey: from 0.2 either way is a side. */
export function positionOf(opinion: number): Position {
  return opinion >= 0.2 ? 'supportive' : opinion <= -0.2 ? 'opposing' : 'undecided';
}

export function stanceView(opinion: number): StanceView {
  const position = positionOf(opinion);
  return {
    position,
    label: POSITION_LABEL[position],
    tone: POSITION_TONE[position],
    signed: signed(opinion),
  };
}

/** Where a value on the −1 to +1 scale sits along a track, as a share of its width. */
export const along = (opinion: number): number => Math.min(1, Math.max(0, (opinion + 1) / 2));

/** What a conversation with the analyst or an actor is, said once, short, with the longer version beside it. */
export interface EngineNote {
  kind: 'lookup' | 'model' | 'unavailable';
  short: string;
  long: string;
}

export function engineNote(
  project: ProjectDetail,
  availabilityOf: Availability,
  forActor: boolean,
): EngineNote {
  if (availabilityOf.local) {
    return {
      kind: 'lookup',
      short: forActor ? 'Evidence lookup · no actor speaks' : 'Evidence lookup · rules',
      long: 'This retrieves stored evidence for the chosen context. It does not generate speech, impersonate an actor or infer real-person thoughts.',
    };
  }
  const label = realModelLabel(project.execution?.provider ?? 'none');
  if (!availabilityOf.modelReady) {
    return {
      kind: 'unavailable',
      short: `${label} · not available now`,
      long: 'A provider is not currently configured. Saved conversations remain readable; new model replies are unavailable.',
    };
  }
  return {
    kind: 'model',
    short: `${label} · ${forActor ? 'fictional role-play' : 'generated analysis'}`,
    long: 'Answers use bounded stored context and your real configured provider. Actor replies are fictional role-play, not testimony or forecasts. Analyst replies are generated analysis.',
  };
}

/** A few questions worth starting with, made from what this project's report and actors actually are. */
export function suggestions(project: ProjectDetail, target: string): string[] {
  if (target === ANALYST_TARGET) {
    const report = project.report;
    if (!report) return [];
    const titles = report.sections.map((section) => section.title).filter(Boolean);
    const picked = titles.slice(1, 3).length > 0 ? titles.slice(1, 3) : titles.slice(0, 2);
    return [
      ...picked.map((title) => `Explain “${title}”`),
      ...(report.limitations.length > 0 ? ['What are the limits of this report?'] : []),
    ].slice(0, 3);
  }
  const agent = project.agents.find((candidate) => candidate.id === target);
  if (!agent) return [];
  return [`What matters most to ${agent.name}?`, `How would ${agent.name} react to the change?`];
}

export type ReplyBlock =
  | { kind: 'note'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'passage'; id: string; label: string; text: string; memory: boolean };

const PASSAGE = /^\[([A-Za-z0-9_.:-]+)\][ \t]+([^\n]*)\n([\s\S]+)$/u;
const MEMORY = /^\[(M-[A-Za-z0-9_.:-]+)\][ \t]+([^:\n]*):[ \t]*([\s\S]+)$/u;
const LOOKUP_NOTE = /^Local evidence lookup\b/u;
const CONFIGURE_NOTE = /^Configure and explicitly select model-assisted mode\b/u;
const MEMORIES_HEADING = /^Recorded synthetic memories\b/u;

/**
 * Splits a reply into what it says and the passages it quotes. The local lookup writes its answer as
 * blank-line separated parts, each quoted passage opening with `[S3] document name` and each memory with
 * `[M-…] platform, round N: text`; a model's answer is paragraphs. Nothing is added or dropped: this is
 * only how the same text is laid out, and a part that does not match is shown as the text it is.
 */
export function parseReply(content: string): ReplyBlock[] {
  const parts = content
    .split(/\n{2,}/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const blocks: ReplyBlock[] = [];
  for (const part of parts) {
    const memory = MEMORY.exec(part);
    if (memory) {
      blocks.push({
        kind: 'passage',
        id: memory[1]!,
        label: memory[2]!.trim(),
        text: memory[3]!.trim(),
        memory: true,
      });
      continue;
    }
    const passage = PASSAGE.exec(part);
    if (passage && !part.startsWith('[M-')) {
      blocks.push({
        kind: 'passage',
        id: passage[1]!,
        label: passage[2]!.trim(),
        text: passage[3]!.trim(),
        memory: false,
      });
      continue;
    }
    if (LOOKUP_NOTE.test(part) || CONFIGURE_NOTE.test(part) || MEMORIES_HEADING.test(part)) {
      blocks.push({ kind: 'note', text: part });
      continue;
    }
    blocks.push({ kind: 'text', text: part });
  }
  return blocks;
}

export interface Word {
  text: string;
  /** The place of the word among the words, or null for the space between. */
  index: number | null;
}

/** The words of a text, with the spaces kept, so that each word can arrive on its own while the text is whole. */
export function words(text: string): Word[] {
  let count = 0;
  return text
    .split(/(\s+)/u)
    .filter((part) => part !== '')
    .map((part) =>
      /^\s+$/u.test(part) ? { text: part, index: null } : { text: part, index: count++ },
    );
}

/** Seconds between words so that however long a reply is, it has arrived in under a second. */
export function wordStep(total: number, longest = 0.9, step = 0.014): number {
  return total <= 0 ? step : Math.min(step, longest / total);
}

const LEDGER_TONES: Record<LedgerTone, Tone> = {
  good: 'favor',
  caution: 'caution',
  bad: 'critical',
  neutral: 'neutral',
  info: 'accent',
};

/** A tone of the ledger, as the design system names it. */
export const toneOf = (tone: LedgerTone): Tone => LEDGER_TONES[tone];

export interface GroundingView {
  status: ChatGroundingStatus;
  label: string;
  tone: Tone;
  meaning: string;
}

/** How well an answer rests on the project's evidence, in the words the project has always used for it. */
export function groundingView(status: ChatGroundingStatus): GroundingView {
  const view = CHAT_GROUNDING[status] ?? CHAT_GROUNDING.uncited;
  return { status, label: view.label, tone: toneOf(view.tone), meaning: view.meaning };
}

/** What a memory chip says: which platform and round it was made in, which is what a person can place. */
export function memoryLabel(memories: readonly SimulationMemory[], id: string): string {
  const memory = memories.find((item) => item.id === id);
  if (!memory) return id.length > 22 ? `${id.slice(0, 20)}…` : id;
  return `${memory.platform}, round ${memory.round}`;
}

export const isActive = (survey: SurveyRecord): boolean =>
  survey.status === 'queued' || survey.status === 'running';

export const newestSurveyFirst = (surveys: readonly SurveyRecord[]): SurveyRecord[] =>
  [...surveys].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** The actors a survey is still waiting on. */
export function awaiting(survey: SurveyRecord): string[] {
  const answered = new Set(survey.responses.map((response) => response.agentId));
  return survey.agentIds.filter((id) => !answered.has(id));
}

export function actorName(agents: readonly Agent[], id: string): string {
  return agents.find((agent) => agent.id === id)?.name ?? id;
}

/** The most actors one survey may ask: the smaller of the server's limit and the contract's own five. */
export const maxTargets = (config: AppConfig | null): number =>
  Math.min(5, config?.limits.maxSurveyTargets ?? 5);

export function canStartSurvey(args: {
  enabled: boolean;
  surveys: readonly SurveyRecord[];
  question: string;
  chosen: number;
  kind: 'state' | 'interview';
  modelReady: boolean;
}): boolean {
  return (
    args.enabled &&
    !args.surveys.some(isActive) &&
    args.surveys.length < SURVEY_LIMIT &&
    args.chosen > 0 &&
    args.question.trim().length >= SURVEY_QUESTION_MIN &&
    (args.kind === 'state' || args.modelReady)
  );
}
