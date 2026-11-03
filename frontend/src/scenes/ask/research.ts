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
  const direct = validateEntry(input);
  if (direct.data || !options.withoutSources || input.documents.length > 0) return direct;
  const probed = validateEntry({ ...input, documents: [STAND_IN] });
  return probed.data ? { data: { ...probed.data, documents: [] } } : probed;
}
