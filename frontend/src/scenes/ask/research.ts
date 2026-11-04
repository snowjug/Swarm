import { canonicalField, type ScenarioFrame } from '../../../../shared/scenario';
import type { ResearchIntakeInput } from '../../../../shared/research';
import type { CreateProjectInput, ValidatedProjectInput } from '../../../../shared/types';
import { validateEntry } from '../../lib/entryValidation';
import { LIMITS, withContext } from '../../lib/intake';

// What a person says beside the question, and how it becomes the request for research and the scenario they
// confirm. Nothing here reads a page or decides what is true: the server validates every address and fetches.

/** How long the guidance for research may be, as the server states it (`shared/research.ts`). */
export const GUIDANCE_MAX = 600;
/** How long an address may be, as the server states it. */
export const ADDRESS_MAX = 2_048;

export const HORIZON_CHOICES = [
  'open',
  'quarter',
  'half-year',
  'year',
  'three-years',
  'custom',
] as const;
export type HorizonChoice = (typeof HORIZON_CHOICES)[number];

export const HORIZONS: readonly { value: HorizonChoice; label: string; text: string }[] = [
  { value: 'open', label: 'Not sure', text: '' },
  { value: 'quarter', label: 'Next quarter', text: 'Next quarter' },
  { value: 'half-year', label: '6 months', text: '6 months' },
  { value: 'year', label: '1 year', text: '1 year' },
  { value: 'three-years', label: '3 years', text: '3 years' },
  { value: 'custom', label: 'Custom', text: '' },
];

/** The time frame as words: a preset's own, or what the person typed. Empty when they have not said. */
export function horizonText(choice: HorizonChoice, custom: string): string {
  if (choice === 'custom') return custom.trim().slice(0, LIMITS.horizon);
  return HORIZONS.find((horizon) => horizon.value === choice)?.text ?? '';
}

/**
 * What the website field holds. `domain` is a site (no page named), `url` is one page. `unclear` is anything that
 * does not look like either; it is a hint for the person, and the server is the one that validates what is sent.
 */
export type Site =
  | { kind: 'none' }
  | { kind: 'domain'; domain: string }
  | { kind: 'url'; url: string; host: string }
  | { kind: 'unclear' };

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const TOP_LEVEL = /^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/u;

export function classifySite(raw: string): Site {
  const text = raw.trim();
  if (text === '') return { kind: 'none' };
  if (text.length > ADDRESS_MAX || /[\s"'<>`\\]/u.test(text)) return { kind: 'unclear' };
  const schemed = /^[a-z][a-z0-9+.-]*:\/\//iu.test(text);
  let parsed: URL;
  try {
    parsed = new URL(schemed ? text : `https://${text}`);
  } catch {
    return { kind: 'unclear' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    return { kind: 'unclear' };
  }
  const labels = parsed.hostname.split('.');
  const numeric = labels.length === 4 && labels.every((label) => /^\d{1,3}$/u.test(label));
  const named = labels.length >= 2 && TOP_LEVEL.test(labels[labels.length - 1] ?? '');
  if (!labels.every((label) => LABEL.test(label)) || !(numeric || named)) {
    return { kind: 'unclear' };
  }
  const bare =
    (parsed.pathname === '/' || parsed.pathname === '') &&
    !parsed.search &&
    !parsed.hash &&
    !parsed.port;
  return bare
    ? { kind: 'domain', domain: parsed.hostname }
    : { kind: 'url', url: schemed ? text : `https://${text}`, host: parsed.hostname };
}

export interface IntakeFields {
  /** Automatic research is on. Off, only the sources the person attaches are used. */
  auto: boolean;
  site: Site;
  horizon: string;
  geography: string;
  guidance: string;
}

const clip = (value: string, max: number): string => value.trim().slice(0, max);

/**
 * What the person asked of research, as the server takes it. A site and guidance are for research and are sent only
 * when it is on; the time frame and the place are about the scenario and are sent either way.
 */
export function researchIntake(fields: IntakeFields): ResearchIntakeInput {
  const horizon = clip(fields.horizon, LIMITS.horizon);
  const geography = clip(fields.geography, LIMITS.geography);
  const guidance = clip(fields.guidance, GUIDANCE_MAX);
  return {
    auto: fields.auto,
    ...(fields.auto && fields.site.kind === 'url' ? { url: fields.site.url } : {}),
    ...(fields.auto && fields.site.kind === 'domain' ? { domain: fields.site.domain } : {}),
    ...(fields.auto && guidance ? { guidance } : {}),
    ...(horizon ? { horizon } : {}),
    ...(geography ? { geography } : {}),
  };
}

/**
 * What the switch for automatic research says it does, by what this server does. Where research is on it finds sources
 * from a question alone only if a search provider is behind it (`discovery`); without one it reads the website that is
 * named, and asks for a source when none is.
 */
export function researchSwitchNote(options: {
  available: boolean;
  on: boolean;
  discovery: boolean;
}): string {
  if (!options.available) return 'Off on this server. Attach your own sources.';
  if (!options.on) return 'Manual sources only: Swarm reads what you add.';
  return options.discovery
    ? 'Swarm finds and reads public sources for you.'
    : 'Reads the site you name, or asks for one.';
}

/** What research will do for the project that is about to be made: read what is named, look, or ask for a source. */
type ResearchPlan = { kind: 'reads'; named: string } | { kind: 'searches' } | { kind: 'asks' };

/**
 * What research will actually do, by what the person said and what this server can do. Nothing where research is off,
 * or where the project has sources of its own and no site was named: those sources are what is used. A site or a page
 * that was named is read, with what it links to. For a question alone it is what this server can do: look for public
 * sources where a search provider is behind it, and otherwise ask for a website or a source.
 */
function researchPlan(options: {
  runs: boolean;
  discovery: boolean;
  site: Site;
  documents: number;
}): ResearchPlan | null {
  if (!options.runs) return null;
  const { site } = options;
  if (site.kind === 'domain') return { kind: 'reads', named: site.domain };
  if (site.kind === 'url') return { kind: 'reads', named: `a page of ${site.host}` };
  if (options.documents > 0) return null;
  return { kind: options.discovery ? 'searches' : 'asks' };
}

/** What the review says about research before the person goes on, in the part of it that holds the evidence. */
export function researchNote(options: {
  runs: boolean;
  discovery: boolean;
  site: Site;
  documents: number;
}): string | null {
  const plan = researchPlan(options);
  if (!plan) return null;
  if (plan.kind === 'reads') {
    return `Automatic research is on. After you continue, Swarm reads ${plan.named} and the pages it links to, and lists every page it reads.`;
  }
  return plan.kind === 'searches'
    ? 'Automatic research is on. After you continue, Swarm looks for public sources, and lists every page it reads.'
    : 'This server cannot look for sources from a question alone. After you continue, Swarm asks you to name a website or add a source.';
}

/**
 * The same, short, for the bar at the foot of the review, where the person decides: it follows "Nothing runs until you
 * continue." and says what the press that goes on will do. It never says that a source is needed, because where
 * research runs none is.
 */
export function researchNext(options: {
  runs: boolean;
  discovery: boolean;
  site: Site;
  documents: number;
}): string | null {
  const plan = researchPlan(options);
  if (!plan) return null;
  if (plan.kind === 'reads') return `Then Swarm reads ${plan.named}.`;
  return plan.kind === 'searches'
    ? 'Then Swarm looks for public sources.'
    : 'Then Swarm asks you for a website or a source.';
}

/**
 * The scenario that was read from the question, with what the person said beside it put where it belongs: their time
 * frame and assumptions as `withContext` places them, and their place as the geography. Their own words answer the
 * questions the reading asked about them, so those questions go. Nothing is added that they did not say.
 */
export function withIntake(
  frame: ScenarioFrame,
  intake: { horizon: string; geography: string; assumptions: readonly string[] },
): ScenarioFrame {
  const base = withContext(frame, { horizon: intake.horizon, assumptions: intake.assumptions });
  const geography = clip(intake.geography, LIMITS.geography);
  if (!geography) return base;
  return {
    ...base,
    geography,
    ambiguities: base.ambiguities.filter(
      (ambiguity) => canonicalField(ambiguity.field) !== 'geography',
    ),
  };
}

/** What stands in for a source while everything else about a project with none is checked. It is never sent. */
const STAND_IN = { name: 'sources.md', content: 'x'.repeat(80) };

/**
 * The entry as the server will take it. A project with no source of its own is taken when automatic research is on
 * (`withoutSources`): it is then checked as any other would be, and made without documents.
 */
export function validateIntake(
  input: CreateProjectInput,
  options: { withoutSources: boolean },
): { data: ValidatedProjectInput; error?: never } | { error: string; data?: never } {
  // A server that does not do research still needs a source of its own, whatever the entry asks for.
  if (!options.withoutSources && input.documents.length === 0) {
    return validateEntry({ ...input, research: undefined });
  }
  const direct = validateEntry(input);
  if (direct.data || !options.withoutSources || input.documents.length > 0) return direct;
  const probed = validateEntry({ ...input, documents: [STAND_IN] });
  return probed.data ? { data: { ...probed.data, documents: [] } } : probed;
}
