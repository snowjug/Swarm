import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios.js';
import { CONSTRAINT_CATEGORIES } from '../../shared/constraints.js';
import {
  AUTHORITY_ESTIMATES,
  FETCH_ERROR_CLASSES,
  QUARANTINE_REASONS,
  SOURCE_CATEGORIES,
} from '../../shared/research.js';
import { PARTICIPANT_ROLES } from '../../shared/stakeholders.js';
import { SPLITS } from './datasets.js';
import { DATASET_DIRECTORY, DEMO_DIRECTORY, PINNED_SOURCES } from './paths.js';

const split = z.enum(SPLITS);
const text = z.string().min(1);

// ---------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------

const quoteSchema = z.object({ document: text, text: z.string().min(12) }).strict();

const participantSchema = z
  .object({
    id: text,
    name: z.string().min(3),
    role: z.enum(PARTICIPANT_ROLES),
    voice: z.enum(['named', 'implied', 'missing']),
    aliases: z.array(z.string().min(2)).min(1),
    quote: quoteSchema.nullable(),
    rationale: text,
  })
  .strict();

const constraintSchema = z
  .object({
    id: text,
    category: z.enum(CONSTRAINT_CATEGORIES),
    hardness: z.enum(['hard', 'soft']),
    document: text,
    quote: z.string().min(12),
    rationale: text,
  })
  .strict();

const gapSchema = z
  .object({
    constraintId: text,
    removeText: z.string().min(12),
    document: text,
    category: z.enum(CONSTRAINT_CATEGORIES),
    accept: z.array(z.enum(CONSTRAINT_CATEGORIES)).min(1),
    rationale: text,
  })
  .strict();

const alternativeSchema = z
  .object({ id: text, cues: z.array(text).min(1), rationale: text })
  .strict();

export const SUPPORT_LABELS = ['supported', 'partial', 'unsupported'] as const;
const claimSchema = z
  .object({
    id: text,
    statement: z.string().min(12),
    gold: z.enum(SUPPORT_LABELS),
    documents: z.array(text).min(1),
    rationale: text,
  })
  .strict();

const conflictSchema = z
  .object({
    id: text,
    kind: z.enum(['deterministic', 'semantic']),
    a: z.object({ document: text, quote: z.string().min(12) }).strict(),
    b: z.object({ document: text, quote: z.string().min(12) }).strict(),
    mustContain: z.array(text).min(1),
    rationale: text,
  })
  .strict();

const revisionSchema = z
  .object({
    at: text,
    field: text,
    was: z.string(),
    now: z.string(),
    reason: text,
    afterSeeingResults: z.boolean(),
  })
  .strict();

const sourceSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('example'), id: text, pins: z.record(z.string(), z.string()) })
    .strict(),
  z.object({ kind: z.literal('larkholm') }).strict(),
  z
    .object({
      kind: z.literal('inline'),
      documents: z.array(z.object({ name: text, content: text }).strict()).min(1),
    })
    .strict(),
]);

export const scenarioSchema = z
  .object({
    id: text,
    split,
    kind: z.enum(['flagship', 'custom']),
    title: text,
    tags: z.array(text),
    question: z.string().min(12),
    source: sourceSchema,
    participants: z.array(participantSchema).min(2),
    constraints: z.array(constraintSchema).min(1),
    gap: gapSchema.nullable(),
    alternatives: z.array(alternativeSchema),
    claims: z.array(claimSchema),
    conflicts: z.array(conflictSchema),
    labelRevisions: z.array(revisionSchema),
  })
  .strict();
export type Scenario = z.infer<typeof scenarioSchema>;
export type GoldParticipant = Scenario['participants'][number];
export type GoldConstraint = Scenario['constraints'][number];
export type GoldClaim = Scenario['claims'][number];
export type GoldConflict = Scenario['conflicts'][number];
export type SupportLabel = (typeof SUPPORT_LABELS)[number];

export interface DocumentText {
  name: string;
  content: string;
}

const lf = (content: string): string => content.replaceAll('\r\n', '\n');

/** The documents a scenario's labels were written against. */
export function documentsOf(scenario: Scenario): DocumentText[] {
  const { source } = scenario;
  if (source.kind === 'inline') {
    return source.documents.map(({ name, content }) => ({ name, content: lf(content) }));
  }
  if (source.kind === 'larkholm') {
    return Object.keys(PINNED_SOURCES).map((name) => ({
      name,
      content: lf(readFileSync(join(DEMO_DIRECTORY, name), 'utf8')),
    }));
  }
  const example = EXAMPLE_SCENARIOS.find((item) => item.id === source.id);
  if (!example)
    throw new Error(
      `Scenario ${scenario.id} names the example ${source.id}, which does not exist.`,
    );
  return example.documents.map(({ name, content }) => ({ name, content: lf(content) }));
}

/** The pinned hashes of a scenario's documents, when it reads them from somewhere else than the dataset. */
export function pinsOf(scenario: Scenario): Readonly<Record<string, string>> | null {
  if (scenario.source.kind === 'example') return scenario.source.pins;
  if (scenario.source.kind === 'larkholm') return PINNED_SOURCES;
  return null;
}

/** The same documents with the sentence of the seeded gap taken out, once. */
export function documentsWithGap(scenario: Scenario): DocumentText[] {
  const { gap } = scenario;
  if (!gap) return documentsOf(scenario);
  return documentsOf(scenario).map((document) => {
    if (document.name !== gap.document) return document;
    const at = document.content.indexOf(gap.removeText);
    if (at < 0) return document;
    return {
      name: document.name,
      content: document.content.slice(0, at) + document.content.slice(at + gap.removeText.length),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------------------------

const hostSchema = z
  .object({ resolve: z.enum(['server', 'nxdomain', 'closed-port']), robots: z.string().optional() })
  .strict();

const groupSchema = z
  .object({
    id: text,
    purpose: text,
    seeds: z.array(text).min(1),
    hints: z.object({ terms: z.array(text) }).strict(),
    budget: z.record(z.string(), z.number()),
    tuning: z.record(z.string(), z.number()),
    expect: z
      .object({
        diversity: z.boolean(),
        neverFetched: z.array(text),
        duplicateGroups: z.array(z.array(text).min(2)),
        conflicts: z.array(
          z
            .object({
              id: text,
              a: z.object({ page: text, quote: z.string().min(12) }).strict(),
              b: z.object({ page: text, quote: z.string().min(12) }).strict(),
              mustContain: z.array(text).min(1),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

const hostsFileSchema = z
  .object({
    version: z.literal(1),
    labelsFrozenOn: text,
    note: text,
    fragments: z.record(z.string(), z.string()),
    hosts: z.record(z.string(), hostSchema),
    groups: z.array(groupSchema).min(1),
  })
  .strict();

const injectionGoldSchema = z
  .object({
    lines: z.array(text).min(1),
    expected: z.enum(['labelled', 'absent', 'either']),
    flagged: z.boolean().nullable(),
  })
  .strict();

export const PAGE_OUTCOMES = [
  'used',
  'quarantined',
  'blocked',
  'failed',
  'duplicate-group',
  'not-used',
  'not-fetched',
  'hub',
  'target',
] as const;
export type PageOutcome = (typeof PAGE_OUTCOMES)[number];

const pageGoldSchema = z
  .object({
    outcome: z.enum(PAGE_OUTCOMES),
    quarantine: z.enum(QUARANTINE_REASONS).nullable(),
    failure: z.enum(FETCH_ERROR_CLASSES).nullable(),
    category: z.enum(SOURCE_CATEGORIES).nullable(),
    authority: z.enum(AUTHORITY_ESTIMATES).nullable(),
    hostile: z.boolean(),
    main: z.array(text),
    boilerplate: z.array(text),
    injection: injectionGoldSchema.nullable(),
    payloads: z.array(text),
    why: text,
  })
  .strict();

const pageResponseSchema = z
  .object({
    status: z.number().int().optional(),
    contentType: z.string().optional(),
    html: z.string().optional(),
    bodyBase64: z.string().optional(),
    location: z.string().optional(),
    behaviour: z.literal('hang').optional(),
    alias: z.string().optional(),
  })
  .strict()
  .nullable();

export const pageSchema = z
  .object({
    id: text,
    split,
    group: text,
    host: text,
    path: z.string().startsWith('/'),
    via: z.enum(['seed', 'link', 'target', 'bait']),
    response: pageResponseSchema,
    gold: pageGoldSchema,
  })
  .strict();
export type SitePage = z.infer<typeof pageSchema>;
export type CrawlGroup = z.infer<typeof groupSchema>;
export type HostEntry = z.infer<typeof hostSchema>;

export interface SiteSet {
  fragments: Record<string, string>;
  hosts: Record<string, HostEntry>;
  groups: CrawlGroup[];
  pages: SitePage[];
}

const pagesFileSchema = z
  .object({ version: z.literal(1), pages: z.array(pageSchema).min(1) })
  .strict();

// ---------------------------------------------------------------------------------------------
// Safety and critic flaws
// ---------------------------------------------------------------------------------------------

export const SAFETY_CLASSES = [
  'harmful-content',
  'secret-exfiltration',
  'jailbreak',
  'personal-data',
  'consequential-employment',
  'consequential-credit',
  'consequential-legal',
  'consequential-medical',
  'consequential-safety',
] as const;
export type SafetyClass = (typeof SAFETY_CLASSES)[number];

const safetyItemSchema = z
  .object({
    id: text,
    split,
    class: z.enum(SAFETY_CLASSES),
    gold: z.enum(['refuse', 'proceed']),
    request: z.string().min(20),
    rationale: text,
  })
  .strict();
export type SafetyItem = z.infer<typeof safetyItemSchema>;

const safetyFileSchema = z
  .object({
    version: z.literal(1),
    labelsFrozenOn: text,
    note: text,
    items: z.array(safetyItemSchema).min(1),
    labelRevisions: z.array(revisionSchema),
  })
  .strict();

export const FLAW_CLASSES = [
  'unsupported-recommendation',
  'missing-constraint',
  'hidden-assumption',
  'single-source-dependence',
  'overclaiming-wording',
] as const;
export type FlawClass = (typeof FLAW_CLASSES)[number];

export const CRITIC_ROLE_NAMES = [
  'evidence',
  'assumption',
  'methodology',
  'stakeholder-coverage',
  'bias',
  'recommendation',
  'adversarial',
] as const;

const plantSchema = z.array(
  z
    .object({
      op: z.enum([
        'recommendation',
        'finding',
        'headline',
        'statement',
        'citations',
        'sensitivity',
        'actors',
        'constraints',
      ]),
    })
    .passthrough(),
);
export type PlantOp = z.infer<typeof plantSchema>[number];

const flawSchema = z
  .object({
    id: text,
    split,
    class: z.enum(FLAW_CLASSES),
    description: text,
    plant: plantSchema.min(1),
    expect: z
      .object({
        roles: z.array(z.enum(CRITIC_ROLE_NAMES)).min(1),
        targetKinds: z.array(text).optional(),
      })
      .strict(),
    rationale: text,
  })
  .strict();
export type SeededFlaw = z.infer<typeof flawSchema>;

const controlSchema = z.object({ id: text, split, description: text, plant: plantSchema }).strict();
export type FlawControl = z.infer<typeof controlSchema>;

const flawsFileSchema = z
  .object({
    version: z.literal(1),
    labelsFrozenOn: text,
    note: text,
    ops: z.record(z.string(), z.string()),
    flaws: z.array(flawSchema).min(1),
    controls: z.array(controlSchema).min(1),
    labelRevisions: z.array(revisionSchema),
  })
  .strict();

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

const readJson = (...parts: string[]): unknown =>
  JSON.parse(readFileSync(join(DATASET_DIRECTORY, ...parts), 'utf8'));

export function loadScenarios(): Scenario[] {
  const files = readdirSync(join(DATASET_DIRECTORY, 'scenarios'))
    .filter((name) => name.endsWith('.json'))
    .sort();
  return files.map((name) => scenarioSchema.parse(readJson('scenarios', name)));
}

export function loadSites(): SiteSet {
  const hosts = hostsFileSchema.parse(readJson('sites', 'hosts.json'));
  const files = readdirSync(join(DATASET_DIRECTORY, 'sites'))
    .filter((name) => name.startsWith('pages-') && name.endsWith('.json'))
    .sort();
  const pages = files.flatMap((name) => pagesFileSchema.parse(readJson('sites', name)).pages);
  return { fragments: hosts.fragments, hosts: hosts.hosts, groups: hosts.groups, pages };
}

export const loadSafety = () => safetyFileSchema.parse(readJson('ai-safety.json'));
export const loadFlaws = () => flawsFileSchema.parse(readJson('ai-critic-flaws.json'));

// ---------------------------------------------------------------------------------------------
// Page templates
// ---------------------------------------------------------------------------------------------

const WORDS = {
  adjectives: [
    'old',
    'northern',
    'narrow',
    'quiet',
    'central',
    'handsome',
    'busy',
    'long',
    'shallow',
    'public',
    'eastern',
    'covered',
    'steep',
    'wide',
    'little',
    'plain',
  ],
  nouns: [
    'harbour',
    'tramline',
    'orchard',
    'bridge',
    'market',
    'clinic',
    'quarry',
    'viaduct',
    'reservoir',
    'tannery',
    'lighthouse',
    'depot',
    'granary',
    'foundry',
    'meadow',
    'pier',
    'brewery',
    'windmill',
    'causeway',
    'terrace',
  ],
  verbs: [
    'surveyed',
    'repaired',
    'measured',
    'recorded',
    'inspected',
    'rebuilt',
    'catalogued',
    'mapped',
    'restored',
    'cleared',
    'photographed',
    'described',
    'compared',
    'counted',
    'painted',
    'drained',
  ],
};

/** Deterministic filler prose, in paragraphs, of about the given number of characters. */
export function fillerHtml(chars: number): string {
  let state = 0x9e3779b9;
  const next = (): number => {
    state = Math.imul(state ^ (state >>> 15), 2246822519) >>> 0;
    state = Math.imul(state ^ (state >>> 13), 3266489917) >>> 0;
    return ((state ^ (state >>> 16)) >>> 0) / 2 ** 32;
  };
  const pick = (list: readonly string[]): string =>
    list[Math.floor(next() * list.length)] as string;
  const sentence = (): string =>
    `The ${pick(WORDS.adjectives)} ${pick(WORDS.nouns)} was ${pick(WORDS.verbs)} and the ${pick(WORDS.adjectives)} ${pick(WORDS.nouns)} was ${pick(WORDS.verbs)} near the ${pick(WORDS.nouns)}.`;
  let out = '';
  while (out.length < chars) out += `<p>${sentence()} ${sentence()} ${sentence()}</p>`;
  return out;
}

export interface ExpandContext {
  fragments: Readonly<Record<string, string>>;
  /** The address of a page of the set, by id. */
  urlOf(pageId: string): string;
}

/** Fills in `{{fragment}}`, `{{url:P01}}`, `{{fill:N}}` and `{{script:N}}`. */
export function expandHtml(template: string, context: ExpandContext): string {
  return template.replace(
    /\{\{([a-z]+)(?::([A-Za-z0-9]+))?\}\}/gu,
    (whole, name: string, argument?: string) => {
      if (name === 'url' && argument) return context.urlOf(argument);
      if (name === 'fill' && argument) return fillerHtml(Number(argument));
      if (name === 'script' && argument)
        return 'var a=function(b){return b+1};'.repeat(Number(argument));
      const fragment = context.fragments[name];
      if (fragment === undefined)
        throw new Error(`The template uses {{${name}}}, which is not a fragment.`);
      return fragment;
    },
  );
}
