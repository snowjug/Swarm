import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { REPOSITORY_ROOT } from './paths.js';
import type { Prices } from './measure-usage.js';
import type { Rate } from './measure-stats.js';

export const MODES = ['rules', 'fake-foundry', 'live'] as const;
export type Mode = (typeof MODES)[number];

const mode = z.enum(MODES);

const metricSchema = z
  .object({
    plan: z.string(),
    min: z.number().optional(),
    max: z.number().optional(),
    minDomains: z.number().optional(),
    maxDomainShare: z.number().optional(),
    maxTokensFrom: z.string().optional(),
    appliesIn: z.array(mode),
    definition: z.string(),
  })
  .strict();

const claimSchema = z
  .object({
    from: z.string(),
    max: z.number(),
    appliesIn: z.array(mode),
    definition: z.string(),
  })
  .strict();

/** A metric of the planner, run and decision suites: the plan table has no row for these stages, so each says where it comes from and why its number is what it is. */
const suiteMetricSchema = z
  .object({
    label: z.string(),
    from: z.string(),
    why: z.string(),
    min: z.number().optional(),
    max: z.number().optional(),
    minDomains: z.number().optional(),
    maxDomainShare: z.number().optional(),
    appliesIn: z.array(mode),
    definition: z.string(),
  })
  .strict();

const suiteSchema = z
  .object({
    registered: z.string(),
    rule: z.string(),
    source: z.string(),
    metrics: z.record(z.string(), suiteMetricSchema),
  })
  .strict();

const productionSchema = z
  .object({
    registered: z.string(),
    rule: z.string(),
    source: z.string(),
    modes: z.record(z.string(), z.string()),
    perProjectTokenCap: z.object({ tokens: z.number(), source: z.string() }).strict(),
    listPrices: z
      .object({
        deployment: z.string(),
        inputPerMillionUsd: z.number(),
        outputPerMillionUsd: z.number(),
        source: z.string(),
      })
      .strict(),
    metrics: z.record(z.string(), metricSchema),
    claims: z.record(z.string(), claimSchema),
    suites: suiteSchema,
    decisionSuite: suiteSchema,
  })
  .strict();

export type MetricSpec = z.infer<typeof metricSchema> & {
  id: string;
  kind: 'plan' | 'claim' | 'suite';
  from?: string;
  why?: string;
};

/** What the two claims of the workstream brief and the README are called in a table. */
const CLAIM_LABELS: Record<string, string> = {
  hostileHostGovernmentHigh: 'Hostile hosts classified as government with high authority',
  injectionLinesUnlabelled: 'Injected lines kept in a document without the flag label before them',
};

export interface Registered {
  registered: string;
  rule: string;
  modes: Record<string, string>;
  tokenCap: number;
  prices: Prices & { deployment: string };
  specs: Record<string, MetricSpec>;
  /** The suites that were registered later than the first table, each with the date and the rule it was registered under. */
  suites: { name: string; registered: string; rule: string; ids: string[] }[];
}

export function loadRegistered(): Registered {
  const file = JSON.parse(
    readFileSync(join(REPOSITORY_ROOT, 'evaluation', 'thresholds.json'), 'utf8'),
  ) as { productionV1: unknown };
  const parsed = productionSchema.parse(file.productionV1);
  const specs: Record<string, MetricSpec> = {};
  for (const [id, spec] of Object.entries(parsed.metrics))
    specs[id] = { ...spec, id, kind: 'plan' };
  for (const [id, spec] of Object.entries(parsed.claims)) {
    specs[id] = {
      id,
      kind: 'claim',
      plan: CLAIM_LABELS[id] ?? id,
      max: spec.max,
      appliesIn: spec.appliesIn,
      definition: spec.definition,
    };
  }
  const suites: Registered['suites'] = [];
  for (const [name, suite] of [
    ['planner and research run', parsed.suites],
    ['decision status', parsed.decisionSuite],
  ] as const) {
    for (const [id, spec] of Object.entries(suite.metrics)) {
      const { label, ...rest } = spec;
      specs[id] = { ...rest, plan: label, id, kind: 'suite' };
    }
    suites.push({
      name,
      registered: suite.registered,
      rule: suite.rule,
      ids: Object.keys(suite.metrics),
    });
  }
  return {
    registered: parsed.registered,
    rule: parsed.rule,
    modes: parsed.modes,
    tokenCap: parsed.perProjectTokenCap.tokens,
    prices: {
      deployment: parsed.listPrices.deployment,
      inputPerMillionUsd: parsed.listPrices.inputPerMillionUsd,
      outputPerMillionUsd: parsed.listPrices.outputPerMillionUsd,
    },
    specs,
    suites,
  };
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

export type Status = 'met' | 'breached' | 'not-measured';

export interface MetricRow {
  id: string;
  mode: Mode;
  label: string;
  /** The registered threshold in words, e.g. `>= 90%`. */
  threshold: string;
  /** What was measured, with counts and an interval; `NOT MEASURED` when it was not. */
  value: string;
  status: Status;
  /** Why it was not measured, or what the number does and does not show. */
  note: string;
  /** The measured quantity for a test to read: a rate in 0..1, or a count. Null when not measured. */
  measured: number | null;
  /** How many cases the number rests on. */
  cases: number;
}

const percent = (value: number): string => `${Math.round(value * 1000) / 10}%`;

export function thresholdWords(spec: MetricSpec, tokenCap: number): string {
  if (spec.minDomains !== undefined && spec.maxDomainShare !== undefined)
    return `>= ${spec.minDomains} domains and no domain over ${percent(spec.maxDomainShare)}`;
  if (spec.min !== undefined) return `>= ${percent(spec.min)}`;
  if (spec.max !== undefined) return spec.max === 0 ? '0' : `<= ${percent(spec.max)}`;
  if (spec.maxTokensFrom) return `<= ${tokenCap.toLocaleString('en-GB')} tokens (per-project cap)`;
  return '';
}

export function describeRatePercent(rate: Rate): string {
  if (rate.rate === null || rate.low === null || rate.high === null) return 'no cases';
  return `${percent(rate.rate)} (${rate.successes}/${rate.total}; 95% CI ${percent(rate.low)} to ${percent(rate.high)})`;
}

export const NOT_MEASURED = 'NOT MEASURED';

const blank = (spec: MetricSpec, mode: Mode, tokenCap: number) => ({
  id: spec.id,
  mode,
  label: spec.plan,
  threshold: thresholdWords(spec, tokenCap),
});

export function notMeasured(
  spec: MetricSpec,
  mode: Mode,
  reason: string,
  tokenCap: number,
): MetricRow {
  return {
    ...blank(spec, mode, tokenCap),
    value: NOT_MEASURED,
    status: 'not-measured',
    note: reason,
    measured: null,
    cases: 0,
  };
}

/** A share compared with a registered floor or ceiling, on the point estimate; the interval is printed beside it. */
export function rateRow(
  spec: MetricSpec,
  mode: Mode,
  rate: Rate,
  tokenCap: number,
  note = '',
): MetricRow {
  if (rate.rate === null) return notMeasured(spec, mode, 'No case to measure it on.', tokenCap);
  const meets =
    spec.min !== undefined
      ? rate.rate >= spec.min
      : spec.max !== undefined
        ? rate.rate <= spec.max
        : true;
  // A threshold of exactly 0 or 100% is met or not; an interval that touches it says nothing more.
  const inside = (value: number | undefined): value is number =>
    value !== undefined && value > 0 && value < 1;
  const straddles =
    rate.low !== null &&
    rate.high !== null &&
    ((inside(spec.min) && rate.low < spec.min && rate.high >= spec.min) ||
      (inside(spec.max) && rate.high > spec.max && rate.low <= spec.max));
  return {
    ...blank(spec, mode, tokenCap),
    value: describeRatePercent(rate),
    status: meets ? 'met' : 'breached',
    note: [
      note,
      straddles ? 'The interval spans the threshold: too few cases to be sure either way.' : '',
    ]
      .filter(Boolean)
      .join(' '),
    measured: rate.rate,
    cases: rate.total,
  };
}

/** A count compared with a registered ceiling (0 for "must never happen"). */
export function countRow(
  spec: MetricSpec,
  mode: Mode,
  count: number,
  of: number,
  tokenCap: number,
  note = '',
): MetricRow {
  if (of === 0) return notMeasured(spec, mode, 'No case to measure it on.', tokenCap);
  const limit = spec.max ?? 0;
  return {
    ...blank(spec, mode, tokenCap),
    value: `${count} of ${of}`,
    status: count <= limit ? 'met' : 'breached',
    note,
    measured: count,
    cases: of,
  };
}
