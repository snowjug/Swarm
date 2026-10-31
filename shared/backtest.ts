import { z } from 'zod';

const line = (max: number) => z.string().trim().max(max);

/**
 * A historical case to replay. The project's documents are what was known before `cutoffDate`; the
 * outcome is kept apart, is never shown to any model or to the simulation, and is read only when the
 * result is compared. Whether the model itself remembers the event is a limit that cannot be removed
 * here, so `anonymised` and the stated limitation matter.
 */
export const OUTCOME_MEASURE_KINDS = ['direction', 'range', 'category'] as const;

export const historicalCaseSchema = z.object({
  title: line(200).min(1),
  /** What was decided or what happened, described as it looked before the cutoff. */
  event: line(1_000).min(1),
  /** Information dated after this day must not reach the simulation. */
  cutoffDate: z.iso.date(),
  anonymised: z.boolean().default(false),
  createdAt: z.iso.datetime(),
});
export type HistoricalCase = z.infer<typeof historicalCaseSchema>;

export const actualOutcomeSchema = z.object({
  summary: line(2_000).min(1),
  measures: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        label: line(200),
        kind: z.enum(OUTCOME_MEASURE_KINDS),
        /** What was observed, in words. */
        observed: line(300),
        /** Lower and upper bound when the measure is a range, otherwise null. */
        range: z.tuple([z.number(), z.number()]).nullable().default(null),
        /** `-1` worse, `0` no change, `1` better, as seen by the focal party; null for a category. */
        direction: z
          .union([z.literal(-1), z.literal(0), z.literal(1)])
          .nullable()
          .default(null),
        source: line(300),
      }),
    )
    .max(20),
  stakeholdersThatReacted: z
    .array(z.object({ name: line(120), response: line(300), source: line(300) }))
    .max(30),
  sources: z.array(line(300)).max(20),
  /** The date this outcome became known. Must be after the cutoff. */
  knownFrom: z.iso.date(),
});
export type ActualOutcome = z.infer<typeof actualOutcomeSchema>;

export const LEAKAGE_ISSUE_KINDS = [
  'dated-after-cutoff',
  'undated-document',
  'future-date-in-text',
  'outcome-overlap',
] as const;

export const leakageReportSchema = z.object({
  checkedAt: z.iso.datetime(),
  passed: z.boolean(),
  issues: z
    .array(
      z.object({
        kind: z.enum(LEAKAGE_ISSUE_KINDS),
        documentName: line(200),
        detail: line(400),
      }),
    )
    .max(60),
});
export type LeakageReport = z.infer<typeof leakageReportSchema>;

export const AGREEMENT_KINDS = [
  'within-range',
  'outside-range',
  'direction-match',
  'direction-mismatch',
  'not-comparable',
] as const;

export const backtestResultSchema = z.object({
  analysisId: z.string().max(60),
  comparedAt: z.iso.datetime(),
  stakeholders: z.object({
    found: z.array(line(120)).max(40),
    missed: z.array(line(120)).max(40),
    extra: z.array(line(120)).max(40),
  }),
  outcomes: z
    .array(
      z.object({
        measureId: z.string().max(60),
        observed: line(300),
        simulated: line(300),
        agreement: z.enum(AGREEMENT_KINDS),
      }),
    )
    .max(20),
  missedSignals: z.array(line(300)).max(20),
  falseAssumptions: z.array(line(300)).max(20),
  lessons: z.array(line(400)).max(20),
  limitations: z.array(line(400)).max(10),
});
export type BacktestResult = z.infer<typeof backtestResultSchema>;
