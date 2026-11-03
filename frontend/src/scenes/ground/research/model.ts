import {
  RESEARCH_STAGES,
  RESEARCH_STAGE_LABELS,
  RESEARCH_STOP_LABELS,
  type DiscoveryStatus,
  type ResearchRun,
  type ResearchSource,
  type ResearchStage,
  type ResearchStatus,
  type ResearchView,
  type SourceCategory,
} from '../../../../../shared/research';
import { sourceLink } from '../../../lib/format';
import { isLive } from '../../../lib/research';
import { classifySite } from '../../ask/research';
import { elapsedText, plural } from '../model';
import { FAILURE_SENTENCE, OUTCOME_SENTENCE, QUARANTINE_SENTENCE, ROBOTS_SENTENCE } from './words';

// What the research surface shows, derived from what the server says and from nothing else. A stage is shown as
// reached only when the run has reached it, a count is a count the run holds, and where the run does not say, the
// page says nothing.

// ---- Where a run is -----------------------------------------------------------------------------------------

const stageIndex = (stage: ResearchStage): number => RESEARCH_STAGES.indexOf(stage);

export type StageState =
  'done' | 'active' | 'waiting' | 'paused' | 'blocked' | 'stopped' | 'failed';

export interface StageItem {
  id: ResearchStage;
  label: string;
  state: StageState;
  /** What the run holds for this stage, or null where it holds nothing yet. */
  detail: string | null;
  /** The stage is held for want of something a person can give, which is not a refusal: it is drawn calmly. */
  calm?: true;
}

const HELD_AT: Partial<Record<ResearchStatus, StageState>> = {
  paused: 'paused',
  blocked: 'blocked',
  cancelled: 'stopped',
  failed: 'failed',
};

const used = (run: ResearchRun): ResearchSource[] =>
  run.sources.filter((source) => source.outcome === 'used');

/** The passages of the pages that were read in full: what extracting evidence has produced. */
export function passageTotal(run: ResearchRun): number {
  return run.sources
    .filter((source) => source.outcome === 'used' || source.outcome === 'read')
    .reduce((sum, source) => sum + source.passageCount, 0);
}

/** Whether the run has got as far as comparing what it read. Before that, a count of conflicts is not known. */
export function conflictsKnown(run: ResearchRun): boolean {
  return run.status === 'completed' || stageIndex(run.stage) >= stageIndex('checking-conflicts');
}

function detailOf(run: ResearchRun, id: ResearchStage, state: StageState): string | null {
  const held = heldDetailOf(run, id, state);
  // A run that failed or was stopped says where, before what it held there: the count is not the error.
  if (state === 'failed' || state === 'stopped')
    return held ? `Stopped here · ${held}` : 'Stopped here';
  return held;
}

function heldDetailOf(run: ResearchRun, id: ResearchStage, state: StageState): string | null {
  if (state === 'waiting')
    return id === 'planning' && run.status === 'queued' ? 'Waiting to start' : null;
  switch (id) {
    case 'planning': {
      const plan = run.plan;
      if (!plan) return state === 'active' ? 'Working out what to look for' : null;
      const parts = [
        plan.topics.length > 0 ? plural(plan.topics.length, 'topic') : null,
        plan.claimsToVerify.length > 0
          ? `${plural(plan.claimsToVerify.length, 'claim')} to check`
          : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(' · ') : 'A plan was made';
    }
    case 'finding-sources': {
      if (state === 'blocked' && run.stoppedBecause === 'discovery-unconfigured') {
        return 'Needs a search provider';
      }
      const pages = run.sources.length;
      if (pages === 0) return state === 'active' ? 'Looking for pages' : null;
      const sites = run.used.domains;
      return `${plural(pages, 'page')}${sites > 0 ? ` on ${plural(sites, 'site')}` : ''}`;
    }
    case 'reading':
      return state === 'active'
        ? `${run.used.pages.toLocaleString('en-GB')} read · up to ${run.budget.maxPages.toLocaleString('en-GB')}`
        : `${plural(run.used.pages, 'page')} read`;
    case 'extracting-evidence': {
      const passages = passageTotal(run);
      return passages > 0
        ? plural(passages, 'passage')
        : state === 'active'
          ? 'Working through the pages'
          : null;
    }
    case 'checking-conflicts':
      if (!conflictsKnown(run)) return state === 'active' ? 'Comparing the passages' : null;
      return run.conflictCount === 0 ? 'No conflicts found' : plural(run.conflictCount, 'conflict');
    case 'ready':
      return state === 'done' ? `${plural(used(run).length, 'source')} used` : null;
  }
}

/**
 * The six stages and where the run is among them. With no run they are all waiting, which is what a person who has not
 * started research is shown of what would happen.
 */
export function stageItems(run: ResearchRun | null): StageItem[] {
  const reached = run ? stageIndex(run.stage) : -1;
  return RESEARCH_STAGES.map((id, index) => {
    let state: StageState = 'waiting';
    if (run) {
      if (run.status === 'completed' || index < reached) state = 'done';
      else if (index === reached && run.status !== 'queued')
        state = HELD_AT[run.status] ?? 'active';
    }
    return {
      id,
      label: RESEARCH_STAGE_LABELS[id],
      state,
      detail: run ? detailOf(run, id, state) : null,
      ...(state === 'blocked' && run?.stoppedBecause === 'discovery-unconfigured'
        ? { calm: true as const }
        : {}),
    };
  });
}

/** What a person who cannot see the page is told of a stage. */
export const STAGE_STATE_WORDS: Record<StageState, string> = {
  done: 'done',
  active: 'in progress',
  waiting: 'waiting',
  paused: 'paused',
  blocked: 'blocked',
  stopped: 'stopped',
  failed: 'failed',
};

// ---- Counters -------------------------------------------------------------------------------------------------

export interface Counters {
  pagesRead: number;
  sourcesUsed: number;
  sites: number;
  /** Null until the run has compared what it read. */
  conflicts: number | null;
}

export function countersOf(run: ResearchRun | null): Counters {
  if (!run) return { pagesRead: 0, sourcesUsed: 0, sites: 0, conflicts: null };
  return {
    pagesRead: run.used.pages,
    sourcesUsed: used(run).length,
    sites: run.used.domains,
    conflicts: conflictsKnown(run) ? run.conflictCount : null,
  };
}

// ---- What the page shows ------------------------------------------------------------------------------------

/**
 * What the Ground page does about research. `off`: nothing to say (a project of sources a person attached, that has
 * no run). `loading` and `unavailable` only matter to a project that has no sources, since only research can
 * give it any. `empty`: research could be started. `run`: there is a run to show.
 */
export type Presence =
  | { kind: 'off' }
  | { kind: 'loading' }
  | { kind: 'unavailable'; error: string }
  | { kind: 'empty'; view: ResearchView }
  | { kind: 'run'; view: ResearchView; run: ResearchRun };

export function presenceOf({
  enabled,
  documents,
  view,
  loading,
  error,
}: {
  enabled: boolean;
  documents: number;
  view: ResearchView | null;
  loading: boolean;
  error: string | null;
}): Presence {
  if (!enabled) return { kind: 'off' };
  if (view === null) {
    if (documents > 0) return { kind: 'off' };
    if (error !== null) return { kind: 'unavailable', error };
    return loading ? { kind: 'loading' } : { kind: 'off' };
  }
  if (view.run) return { kind: 'run', view, run: view.run };
  return documents === 0 ? { kind: 'empty', view } : { kind: 'off' };
}

/**
 * Whether research is what the first screen is about: a run that is under way, or a project that has no sources and
 * only research can give it any. Then the figures, the status and the actions at the head of the page are the run's.
 */
export function takesOver(presence: Presence, documents: number): boolean {
  switch (presence.kind) {
    case 'off':
      return false;
    case 'run':
      return isLive(presence.run.status) || documents === 0;
    default:
      return true;
  }
}

export interface StatusWords {
  /** Distinct for each state, for the page and for tests to find. */
  key: string;
  label: string;
  tone: 'neutral' | 'accent' | 'favor' | 'caution' | 'critical';
  dot: boolean;
  icon: 'check' | 'pause' | 'alert' | 'stop' | 'cross' | null;
}

/** The status at the head of the page while research is what it is about, in the words of the stage the run is in. */
export function statusWords(presence: Presence): StatusWords | null {
  switch (presence.kind) {
    case 'off':
      return null;
    case 'loading':
      return { key: 'loading', label: 'Loading', tone: 'neutral', dot: true, icon: null };
    case 'unavailable':
      return { key: 'unavailable', label: 'Not read', tone: 'critical', dot: false, icon: 'cross' };
    case 'empty':
      return { key: 'empty', label: 'Not started', tone: 'neutral', dot: false, icon: null };
    case 'run': {
      const { run } = presence;
      switch (run.status) {
        case 'queued':
          return { key: 'queued', label: 'Queued', tone: 'accent', dot: true, icon: null };
        case 'running':
          return {
            key: run.stage,
            label: RESEARCH_STAGE_LABELS[run.stage],
            tone: 'accent',
            dot: true,
            icon: null,
          };
        case 'paused':
          return { key: 'paused', label: 'Paused', tone: 'caution', dot: false, icon: 'pause' };
        case 'blocked':
          // A question with nowhere to look is waiting for a source, which a person can give: it is not a refusal.
          return run.stoppedBecause === 'discovery-unconfigured'
            ? {
                key: 'needs-source',
                label: 'Needs a source',
                tone: 'neutral',
                dot: false,
                icon: null,
              }
            : { key: 'blocked', label: 'Blocked', tone: 'caution', dot: false, icon: 'alert' };
        case 'cancelled':
          return { key: 'cancelled', label: 'Stopped', tone: 'caution', dot: false, icon: 'stop' };
        case 'failed':
          return { key: 'failed', label: 'Failed', tone: 'critical', dot: false, icon: 'cross' };
        case 'completed':
          return {
            key: 'completed',
            label: 'Researched',
            tone: 'favor',
            dot: false,
            icon: 'check',
          };
      }
    }
  }
}

// ---- What a person may do ---------------------------------------------------------------------------------------

export interface Controls {
  pause: boolean;
  resume: boolean;
  finish: boolean;
  cancel: boolean;
  start: boolean;
  /** A site or a page may be named. */
  add: boolean;
}

/**
 * What the buttons offer. The server says what the person may do (`may`); what is offered is what makes sense of the
 * run's state, and never more than that. A person who may cancel or pause may also let a paused run go on.
 */
export function controlsOf(view: ResearchView | null): Controls {
  const none = {
    pause: false,
    resume: false,
    finish: false,
    cancel: false,
    start: false,
    add: false,
  };
  if (!view) return none;
  const { may, run } = view;
  const status = run?.status ?? null;
  const control = may.pause || may.cancel;
  const start = may.start && !isLive(status);
  return {
    pause: may.pause && status === 'running',
    resume: control && status === 'paused',
    finish: may.cancel && (status === 'running' || status === 'paused'),
    cancel: may.cancel && isLive(status),
    start,
    // A site or a page that is named is a run of its own, so it is offered where a run may start.
    add: start,
  };
}

// ---- Pages ---------------------------------------------------------------------------------------------------

export type SourceFilter = 'all' | 'used' | 'other';

export function filterSources(
  sources: readonly ResearchSource[],
  filter: SourceFilter,
): ResearchSource[] {
  if (filter === 'all') return [...sources];
  return sources.filter((source) => (source.outcome === 'used') === (filter === 'used'));
}

/** The address a page ended up at, which is what a person would open. */
export const addressOf = (source: ResearchSource): string =>
  (source.finalUrl || source.requestedUrl).trim();

function parsed(address: string): URL | null {
  try {
    return new URL(address);
  } catch {
    return null;
  }
}

/** The site of an address, without a leading `www.`; empty where the address is not one. */
export function siteOf(address: string): string {
  return parsed(address)?.hostname.replace(/^www\./u, '') ?? '';
}

/** An address as a person reads one: no scheme, no `www.`, and no longer than `max` characters. */
export function shortAddress(address: string, max = 72): string {
  const url = parsed(address);
  const text = url
    ? `${url.hostname.replace(/^www\./u, '')}${url.pathname === '/' ? '' : url.pathname}${url.search}`
    : address.trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The title the page gave itself, or else where it is: a page always has something to be called by. */
export function sourceTitle(source: ResearchSource): string {
  const title = source.title?.trim();
  if (title) return title;
  const place = shortAddress(addressOf(source));
  return place || 'Untitled page';
}

/** An address that may be opened: only a web address is ever a link. */
export const linkOf = (source: ResearchSource): string | null => sourceLink(addressOf(source));

export interface Reason {
  sentence: string;
  /** What the server said, a short line, shown as text. */
  detail: string | null;
}

/**
 * Why a page that was not used was not: in plain words, and in the server's own where it said any. While the run is
 * under way a page that was read has not been judged yet, and its reason is not given: it is not yet one.
 */
export function reasonOf(
  source: ResearchSource,
  status: ResearchStatus = 'completed',
): Reason | null {
  switch (source.outcome) {
    case 'used':
      return null;
    case 'read':
      if (isLive(status)) return null;
      return {
        sentence:
          status === 'completed' ? OUTCOME_SENTENCE.read : 'Read before the research stopped.',
        detail: null,
      };
    case 'quarantined':
      return {
        sentence: source.quarantine
          ? QUARANTINE_SENTENCE[source.quarantine.reason]
          : OUTCOME_SENTENCE.quarantined,
        detail: source.quarantine?.detail.trim() || null,
      };
    case 'blocked':
    case 'failed': {
      if (source.failure) {
        return {
          sentence: FAILURE_SENTENCE[source.failure.class],
          detail: source.failure.message.trim() || null,
        };
      }
      return {
        sentence:
          source.robots === 'disallowed'
            ? ROBOTS_SENTENCE.disallowed
            : OUTCOME_SENTENCE[source.outcome],
        detail: null,
      };
    }
    default:
      return { sentence: OUTCOME_SENTENCE[source.outcome], detail: null };
  }
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/** A date the page states, as a date: it has no time and no zone, and is not shifted by the reader's. */
export function formatDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? isoDate : DAY_FORMAT.format(date);
}

/** A moment, as the reader's clock reads it. */
export function formatMoment(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : TIME_FORMAT.format(date);
}

export interface PageDate {
  label: 'Published' | 'Updated';
  iso: string;
}

/** The dates a page states of itself. A page that states none has none: nothing is guessed. */
export function datesOf(source: ResearchSource): PageDate[] {
  return [
    ...(source.publishedAt ? [{ label: 'Published' as const, iso: source.publishedAt }] : []),
    ...(source.updatedAt ? [{ label: 'Updated' as const, iso: source.updatedAt }] : []),
  ];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export const formatSeconds = (ms: number): string => elapsedText(Math.round(ms / 1000));

// ---- Suggestions ------------------------------------------------------------------------------------------

export interface Suggestion {
  key: string;
  category: SourceCategory;
  description: string;
  /** The address that adding it sends, or null where the plan named none (or none that could be an address). */
  address: string | null;
  site: string | null;
  /** A page of this site was already read. */
  read: boolean;
}

/** Whether a site is the one named, or a part of it (`docs.example.org` is a part of `example.org`). */
export function sameSite(site: string, named: string): boolean {
  return site !== '' && (site === named || site.endsWith(`.${named}`));
}

/**
 * What the plan suggests, as places a person may add. A suggested site is only shown, and only ever read when the
 * person adds it; one that is not a site's name is not offered as one.
 */
export function suggestionsOf(run: ResearchRun): Suggestion[] {
  const plan = run.plan;
  if (!plan) return [];
  const read = new Set(run.sources.map((source) => siteOf(addressOf(source))));
  return plan.likelySources.map((entry, index) => {
    const named = classifySite(entry.suggestedDomain ?? '');
    const site = named.kind === 'domain' ? named.domain : named.kind === 'url' ? named.host : null;
    const address =
      named.kind === 'domain' ? `https://${named.domain}` : named.kind === 'url' ? named.url : null;
    return {
      key: `${index}:${site ?? entry.category}`,
      category: entry.category,
      description: entry.description,
      address,
      site,
      read: site !== null && [...read].some((host) => sameSite(host, site)),
    };
  });
}

/** What a person typed in the field that names a site or a page, as the address to send, or why not. */
export function addressFromInput(raw: string): { address: string } | { problem: string } {
  const site = classifySite(raw);
  switch (site.kind) {
    case 'none':
      return { problem: 'Type a site or a page to add.' };
    case 'unclear':
      return { problem: 'That does not look like a web address. Try a name such as example.org.' };
    case 'domain':
      return { address: `https://${site.domain}` };
    case 'url':
      return { address: site.url };
  }
}

// ---- Limits -----------------------------------------------------------------------------------------------

export interface BudgetLine {
  id: string;
  label: string;
  value: string;
  hint: string | null;
}

const dollars = (value: number): string => `$${value.toFixed(2)}`;
const of = (spent: string, allowed: string): string => `${spent} of ${allowed}`;

/** What the run may use, and what it has used, line by line. The ceilings are the server's: they are read here and not set. */
export function budgetLines(run: ResearchRun): BudgetLine[] {
  const { budget, used: spent } = run;
  const repeats = Number((budget.maxDuplicateRatio * 10).toFixed(1));
  return [
    {
      id: 'pages',
      label: 'Pages',
      value: of(String(spent.pages), String(budget.maxPages)),
      hint: null,
    },
    {
      id: 'sites',
      label: 'Sites',
      value: of(String(spent.domains), String(budget.maxDomains)),
      hint: null,
    },
    {
      id: 'depth',
      label: 'Links followed',
      value:
        budget.maxDepth === 0
          ? 'None: only the pages named'
          : `Up to ${budget.maxDepth} from the start`,
      hint: null,
    },
    {
      id: 'size',
      label: 'Size read',
      value: of(formatBytes(spent.bytes), formatBytes(budget.maxTotalBytes)),
      hint: `Up to ${formatBytes(budget.maxBytesPerPage)} for one page.`,
    },
    {
      id: 'time',
      label: 'Time',
      value: of(formatSeconds(spent.elapsedMs), formatSeconds(budget.maxElapsedMs)),
      hint: null,
    },
    {
      id: 'cost',
      label: 'Model cost, estimated',
      value: of(dollars(spent.estimatedCostUsd), dollars(budget.maxEstimatedCostUsd)),
      hint: 'An estimate, never a bill.',
    },
    {
      id: 'repeats',
      label: 'Repeated pages',
      value: `Stops above ${repeats} in 10 pages`,
      hint: 'Pages that repeat what was already read.',
    },
    {
      id: 'failures',
      label: 'Failed requests',
      value: of(String(spent.failures), String(budget.maxFailedRequests)),
      hint: null,
    },
    {
      id: 'pace',
      label: 'Pause between requests to one site',
      value: `${budget.perDomainDelayMs / 1000} s`,
      hint: null,
    },
    {
      id: 'redirects',
      label: 'Redirects followed',
      value: `Up to ${budget.maxRedirects} for a page`,
      hint: null,
    },
  ];
}

// ---- Notices ----------------------------------------------------------------------------------------------

export interface NoticeSpec {
  id: string;
  tone: 'info' | 'caution' | 'error';
  title: string;
  /** Our words. */
  body: string[];
  /** The server's, shown as text under ours. */
  quoted: string | null;
  /** What the notice offers to do about it, in the order shown. */
  offers: ('add' | 'again' | 'manual')[];
}

const lastTrouble = (run: ResearchRun): string | null =>
  [...run.events]
    .reverse()
    .find((event) => event.level !== 'info')
    ?.message.trim() || null;

/** What a run that did not complete has to say. A run that did, or is under way, has nothing to apologise for. */
export function runNotice(run: ResearchRun, discovery: DiscoveryStatus): NoticeSpec | null {
  switch (run.status) {
    case 'paused':
      return {
        id: 'paused',
        tone: 'info',
        title: 'Paused',
        body: [
          'Nothing is read while it is paused. Resume to carry on. A run that stays paused for long enough ends by itself.',
        ],
        quoted: null,
        offers: [],
      };
    case 'blocked':
      if (run.stoppedBecause === 'discovery-unconfigured') {
        return {
          id: 'discovery-unconfigured',
          tone: 'info',
          title: 'Swarm cannot find sources from a question alone',
          body: [
            RESEARCH_STOP_LABELS['discovery-unconfigured'],
            'Swarm does not search the web on its own and does not read the pages of a search engine. The plan below says what to look for, and you can name a site or a page, or use sources of your own.',
          ],
          quoted: discovery.message.trim() || run.discovery.message.trim() || null,
          offers: ['add', 'manual'],
        };
      }
      return {
        id: 'blocked',
        tone: 'caution',
        title: 'Nothing could be read',
        body: [
          run.stoppedBecause
            ? RESEARCH_STOP_LABELS[run.stoppedBecause]
            : 'Every address was refused or kept out.',
          run.sources.length > 0
            ? 'The reason for each page is listed below.'
            : 'No page was reached.',
        ],
        quoted: null,
        offers: ['add', 'manual'],
      };
    case 'cancelled':
      return {
        id: 'cancelled',
        tone: 'info',
        title: 'Research was stopped',
        body: [RESEARCH_STOP_LABELS.cancelled, 'The pages it had read are listed below.'],
        quoted: null,
        offers: ['again'],
      };
    case 'failed':
      return {
        id: 'failed',
        tone: 'error',
        title: 'Research could not finish',
        body: ['Something went wrong before it was done. You can try again.'],
        quoted: lastTrouble(run),
        offers: ['again'],
      };
    case 'completed':
      return used(run).length === 0
        ? {
            id: 'unused',
            tone: 'caution',
            title: 'No page was used as a source',
            body: ['The pages are listed below with the reason for each.'],
            quoted: null,
            offers: ['add', 'manual'],
          }
        : null;
    default:
      return null;
  }
}

const DAY = 24 * 60 * 60 * 1000;
/** How long research on a question that moves is held to stay current, by what the plan said of the question. */
const FRESH_FOR_MS: Record<'recent' | 'fast-moving', number> = {
  recent: 14 * DAY,
  'fast-moving': 2 * DAY,
};

export interface Age {
  days: number;
  sensitivity: 'recent' | 'fast-moving';
}

/** How old finished research is, when the question it answers was marked as one that moves and it is older than that allows. */
export function agedBy(run: ResearchRun, now: number): Age | null {
  const level = run.plan?.timeSensitivity.level;
  if (run.status !== 'completed' || !level || level === 'none') return null;
  const finished = Date.parse(run.finishedAt ?? run.updatedAt);
  if (Number.isNaN(finished) || now - finished < FRESH_FOR_MS[level]) return null;
  return { days: Math.max(1, Math.floor((now - finished) / DAY)), sensitivity: level };
}

/** Why a run that finished is not told as an error, and why it stopped when it stopped. */
export const stoppedWords = (run: ResearchRun): string | null =>
  run.status === 'completed' && run.stoppedBecause
    ? RESEARCH_STOP_LABELS[run.stoppedBecause]
    : null;
