import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  DECISION_STATUSES,
  HIGH_STAKES_DOMAINS,
  LENS_IDS,
  STATUS_RULE_IDS,
} from '../../shared/decision.js';
import { RESEARCH_STOP_REASONS } from '../../shared/research.js';
import { SPLITS } from './datasets.js';
import { DATASET_DIRECTORY } from './paths.js';

const split = z.enum(SPLITS);
const text = z.string().min(1);

// ---------------------------------------------------------------------------------------------
// The research planner
// ---------------------------------------------------------------------------------------------

/** A label's content words, each slot with the alternative words that meet it. */
const slotsSchema = z.array(z.array(text).min(1)).min(1);

const entitySchema = z
  .object({
    name: text,
    kind: z.enum([
      'organization',
      'product',
      'role',
      'place',
      'regulation',
      'technology',
      'concept',
      'other',
    ]),
    named: z.boolean(),
    aliases: z.array(text),
  })
  .strict();

const topicSchema = z.object({ id: text, slots: slotsSchema }).strict();
const claimSchema = z.object({ id: text, statement: text, slots: slotsSchema }).strict();

const planCaseSchema = z
  .object({
    id: text,
    split,
    scenario: text.optional(),
    question: text.optional(),
    intake: z
      .object({
        guidance: text.optional(),
        horizon: text.optional(),
        geography: text.optional(),
      })
      .strict()
      .optional(),
    entities: z.array(entitySchema),
    topics: z.array(topicSchema).min(1),
    claims: z.array(claimSchema).min(1),
    why: text,
  })
  .strict();
export type PlanCase = z.infer<typeof planCaseSchema>;
export type GoldEntity = PlanCase['entities'][number];
export type GoldTopic = PlanCase['topics'][number];
export type GoldPlanClaim = PlanCase['claims'][number];

const injectionCaseSchema = z
  .object({
    id: text,
    split,
    question: text,
    guidance: text.optional(),
    markers: z.array(text),
    bait: text.nullable(),
    why: text,
  })
  .strict();
export type PlanInjection = z.infer<typeof injectionCaseSchema>;

const corruptionSchema = z
  .object({
    id: text,
    expect: z.enum(['accepted', 'rejected', 'informational']),
    why: text,
    onlyWithMarkers: z.boolean().optional(),
    onlyWithBait: z.boolean().optional(),
  })
  .strict();
export type PlanCorruption = z.infer<typeof corruptionSchema>;

const plansFileSchema = z
  .object({
    version: z.literal(1),
    labelsFrozenOn: text,
    note: text,
    cases: z.array(planCaseSchema).min(1),
    injections: z.array(injectionCaseSchema).min(1),
    corruptions: z.array(corruptionSchema).min(1),
    providerArms: z
      .array(z.object({ id: text, expect: z.enum(['rules', 'surfaced']), why: text }).strict())
      .min(1),
  })
  .strict();
export type PlansFile = z.infer<typeof plansFileSchema>;

// ---------------------------------------------------------------------------------------------
// The decision status
// ---------------------------------------------------------------------------------------------

const share = z.number().min(0).max(1);
const perActor = z.union([share, z.record(z.string(), share)]);

const optionSchema = z
  .object({
    id: text,
    kind: z.enum(['baseline', 'alternative']),
    label: text,
    adverse: perActor,
    favourable: perActor.optional(),
  })
  .strict();
export type DecisionOption = z.infer<typeof optionSchema>;

const constraintItemSchema = z
  .object({
    id: text,
    category: text,
    hardness: z.enum(['hard', 'soft']),
    validation: z.enum(['confirmed', 'unvalidated', 'assumed', 'unknown']),
    statement: text,
    rulesOut: z.array(text).optional(),
  })
  .strict();
export type DecisionConstraint = z.infer<typeof constraintItemSchema>;

const evidenceSchema = z
  .object({
    documents: z.enum(['attached', 'none']),
    cited: z.enum(['all', 'some', 'none']),
    ledger: z.enum(['abstains', 'limited']).nullable(),
  })
  .strict();

const constraintsSchema = z
  .object({ set: z.literal('reviewed'), items: z.array(constraintItemSchema) })
  .strict();

const counterfactualsSchema = z
  .object({
    current: z.boolean(),
    views: z.array(z.object({ id: text, delta: z.number() }).strict()),
  })
  .strict();

const criticsSchema = z
  .object({
    analysis: z.enum(['this', 'other']),
    objections: z.array(
      z
        .object({
          severity: z.enum(['blocking', 'major', 'minor', 'note']),
          status: z.enum(['open', 'resolved']),
        })
        .strict(),
    ),
  })
  .strict();

/** A lens whose leader is not named is a lens the document does not settle for the fixture: it is not scored. */
const leaderSchema = z.partialRecord(z.enum(LENS_IDS), text.nullable());

/**
 * What the scope check is expected to read of a fixture's question, from the document's own words: whether it
 * is a decision about one person, the matters it speaks of where the document's tables settle them (left out
 * where they do not), and the names a person's question holds, which the cues must never repeat.
 */
const scopeGoldSchema = z
  .object({
    individual: z.boolean(),
    domains: z.array(z.enum(HIGH_STAKES_DOMAINS)).optional(),
    names: z.array(text).optional(),
  })
  .strict();
export type ScopeGold = z.infer<typeof scopeGoldSchema>;

const goldSchema = z
  .object({
    status: z.enum(DECISION_STATUSES),
    rules: z.array(z.enum(STATUS_RULE_IDS)).min(1),
    preferred: text.nullable(),
    recommendation: z.enum([
      'proceed',
      'keep-no-change',
      'hold',
      'decide',
      'resolve-constraint',
      'gather-evidence',
    ]),
    leaders: leaderSchema,
    agreement: z.enum(['agree', 'disagree']).nullable(),
    /** The least number of conditions a conditional option lists; 0 for every other status. */
    conditions: z.number().int().min(0),
    /** Named only by the fixtures about the scope check (a question about one person, and the look-alikes of it). */
    scope: scopeGoldSchema.optional(),
    why: text,
  })
  .strict();
export type DecisionGold = z.infer<typeof goldSchema>;

const decisionCaseSchema = z
  .object({
    id: text,
    split,
    cast: z.enum(['scenario', 'lab', 'lab-no-authority']),
    scenario: text.optional(),
    /** The question of the project, which the scope check reads (and the frame's decision is set to it). Given only where the fixture is about it. */
    question: text.optional(),
    options: z.array(optionSchema).min(1).optional(),
    runs: z.number().int().min(1).optional(),
    direction: z.enum(['has', 'none']).optional(),
    evidence: evidenceSchema.optional(),
    constraints: constraintsSchema.nullable().optional(),
    comparisonRecord: z.enum(['clear', 'provisional', 'none']).optional(),
    counterfactuals: counterfactualsSchema.nullable().optional(),
    sensitivity: z.array(z.object({ id: text, shift: z.number() }).strict()).optional(),
    critics: criticsSchema.nullable().optional(),
    inputs: z.enum(['current', 'stale', 'unrecorded']).optional(),
    gold: goldSchema,
  })
  .strict();
export type DecisionCase = z.infer<typeof decisionCaseSchema>;

const decisionFileSchema = z
  .object({
    version: z.literal(1),
    labelsFrozenOn: text,
    note: text,
    defaults: z
      .object({
        runs: z.number().int(),
        direction: z.enum(['has', 'none']),
        evidence: evidenceSchema,
        constraints: constraintsSchema,
        comparisonRecord: z.enum(['clear', 'provisional', 'none']),
        counterfactuals: counterfactualsSchema,
        sensitivity: z.array(z.object({ id: text, shift: z.number() }).strict()),
        critics: criticsSchema,
        inputs: z.enum(['current', 'stale', 'unrecorded']),
      })
      .strict(),
    clearOptions: z.array(optionSchema).min(2),
    cases: z.array(decisionCaseSchema).min(1),
  })
  .strict();
export type DecisionFile = z.infer<typeof decisionFileSchema>;

/** A case with every default filled in: what the harness builds a comparison from. */
export interface ResolvedDecisionCase {
  id: string;
  split: DecisionCase['split'];
  cast: DecisionCase['cast'];
  scenario: string | null;
  /** What the scope check reads, when the fixture names a question of its own. */
  question: string | null;
  options: DecisionOption[];
  runs: number;
  direction: 'has' | 'none';
  evidence: z.infer<typeof evidenceSchema>;
  constraints: z.infer<typeof constraintsSchema> | null;
  comparisonRecord: 'clear' | 'provisional' | 'none';
  counterfactuals: z.infer<typeof counterfactualsSchema> | null;
  sensitivity: { id: string; shift: number }[];
  critics: z.infer<typeof criticsSchema> | null;
  inputs: 'current' | 'stale' | 'unrecorded';
  gold: DecisionGold;
}

// ---------------------------------------------------------------------------------------------
// Research runs
// ---------------------------------------------------------------------------------------------

const worldSchema = z
  .object({
    id: text,
    kind: z.enum(['fan', 'spread', 'pair', 'single']),
    host: text,
    title: text,
    intro: text,
    children: z.number().int().min(1).optional(),
    childHosts: z.array(text).optional(),
    neutral: z.number().int().min(1).optional(),
    anchor: text.optional(),
    words: z.number().int().min(1).optional(),
    bytes: z.number().int().min(1).optional(),
    seed: z.number().int(),
    say: text.optional(),
    shuffle: z.boolean().optional(),
    copies: z.boolean().optional(),
    broken: z.array(z.number().int().min(1)).optional(),
    a: z
      .object({ host: text, anchor: text, say: z.enum(['authority', 'operators']) })
      .strict()
      .optional(),
    b: z
      .object({ host: text, anchor: text, say: z.enum(['authority', 'operators']) })
      .strict()
      .optional(),
    why: text,
  })
  .strict();
export type RunWorld = z.infer<typeof worldSchema>;

const OUTCOME = /^(?:used|duplicate|blocked|(?:quarantined|failed):[a-z-]+)$/u;

const runGoldSchema = z
  .object({
    status: z.enum(['completed', 'blocked']),
    stop: z.enum(RESEARCH_STOP_REASONS).optional(),
    requests: z.number().int().optional(),
    documents: z.number().int().optional(),
    documentsAtMost: z.number().int().optional(),
    charsAtMost: z.number().int().optional(),
    setAside: z.number().int().optional(),
    setAsideForSizeAtLeast: z.number().int().optional(),
    pagesRead: z.number().int().optional(),
    pagesAtLeast: z.number().int().optional(),
    pagesAtMost: z.number().int().optional(),
    domainsAtMost: z.number().int().optional(),
    bytesAtMost: z.number().int().optional(),
    failedAtLeast: z.number().int().optional(),
    duplicatesAtLeast: z.number().int().optional(),
    plan: z.enum(['rules', 'model']).optional(),
    outcomes: z.record(z.string(), z.string().regex(OUTCOME)).optional(),
    notFetched: z.array(text).optional(),
    diversity: z.object({ minDomains: z.number().int() }).strict().optional(),
    opposing: z.array(z.tuple([text, text])).optional(),
    hostileNeverGovernmentHigh: z.array(text).optional(),
    injectionLinesLabelled: z.boolean().optional(),
    injectionObeyed: z.boolean().optional(),
    neverRequestedHosts: z.array(text).optional(),
    suggestionShown: text.optional(),
  })
  .strict();
export type RunGold = z.infer<typeof runGoldSchema>;

const budgetOverrides = z.record(z.string(), z.number());

const runCaseSchema = z
  .object({
    id: text,
    split,
    mode: z.enum(['rules', 'model']),
    question: text,
    guidance: text.optional(),
    start: text.nullable(),
    adds: z.array(text).optional(),
    budget: budgetOverrides.optional(),
    tuning: budgetOverrides.optional(),
    model: z
      .object({
        base: text,
        suggest: text.nullable(),
        corrupt: text.nullable(),
      })
      .strict()
      .optional(),
    budgetArms: z
      .array(
        z
          .object({
            id: text,
            budget: budgetOverrides,
            gold: z
              .object({
                modelCalls: z.number().int().optional(),
                plan: z.enum(['rules', 'model']).optional(),
                costWithinBudget: z.boolean().optional(),
              })
              .strict(),
          })
          .strict(),
      )
      .optional(),
    gold: runGoldSchema,
    why: text,
  })
  .strict();
export type RunCase = z.infer<typeof runCaseSchema>;

const runsFileSchema = z
  .object({
    version: z.literal(1),
    labelsFrozenOn: text,
    note: text,
    questions: z.record(z.string(), text),
    feeSentences: z.object({ authority: text, operators: text }).strict(),
    hosts: z.record(z.string(), z.object({ resolve: z.literal('server') }).strict()),
    worlds: z.array(worldSchema).min(1),
    cases: z.array(runCaseSchema).min(1),
  })
  .strict();
export type RunsFile = z.infer<typeof runsFileSchema>;

/** The ids of the pages a world makes: `W1-0` the start page, `W1-1` and on its notes, `W11-A` and `W11-B` the two sides of a disagreement. */
export function worldPageIds(world: RunWorld): string[] {
  const ids = [`${world.id}-0`];
  if (world.kind === 'single') return [`${world.id}-1`];
  if (world.kind === 'fan') {
    for (let n = 1; n <= (world.children ?? 0); n += 1) ids.push(`${world.id}-${n}`);
  }
  if (world.kind === 'spread') {
    for (let n = 1; n <= (world.childHosts?.length ?? 0); n += 1) ids.push(`${world.id}-${n}`);
  }
  if (world.kind === 'pair') {
    for (let n = 1; n <= (world.neutral ?? 0); n += 1) ids.push(`${world.id}-${n}`);
    ids.push(`${world.id}-A`, `${world.id}-B`);
  }
  return ids;
}

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(join(DATASET_DIRECTORY, name), 'utf8'));

export const loadPlans = (): PlansFile => plansFileSchema.parse(readJson('plans.json'));
export const loadRunsFile = (): RunsFile => runsFileSchema.parse(readJson('research-runs.json'));

export function loadDecisionCases(): { file: DecisionFile; cases: ResolvedDecisionCase[] } {
  const file = decisionFileSchema.parse(readJson('decision-status.json'));
  const { defaults } = file;
  const cases = file.cases.map((item): ResolvedDecisionCase => ({
    id: item.id,
    split: item.split,
    cast: item.cast,
    scenario: item.scenario ?? null,
    question: item.question ?? null,
    options: item.options ?? file.clearOptions,
    runs: item.runs ?? defaults.runs,
    direction: item.direction ?? defaults.direction,
    evidence: item.evidence ?? defaults.evidence,
    constraints: item.constraints === undefined ? defaults.constraints : item.constraints,
    comparisonRecord: item.comparisonRecord ?? defaults.comparisonRecord,
    counterfactuals:
      item.counterfactuals === undefined ? defaults.counterfactuals : item.counterfactuals,
    sensitivity: item.sensitivity ?? defaults.sensitivity,
    critics: item.critics === undefined ? defaults.critics : item.critics,
    inputs: item.inputs ?? defaults.inputs,
    gold: item.gold,
  }));
  return { file, cases };
}
