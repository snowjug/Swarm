import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { REPOSITORY_ROOT } from './paths.js';
import type { MetricRow, Mode, Registered, Status } from './ai-thresholds.js';

const ledgerSchema = z
  .object({
    recorded: z.string(),
    rule: z.string(),
    breaches: z.array(
      z
        .object({
          mode: z.enum(['rules', 'fake-foundry', 'live']),
          metric: z.string(),
          measuredWhenRecorded: z.string(),
          why: z.string().min(40),
        })
        .strict(),
    ),
  })
  .strict();

export type Ledger = z.infer<typeof ledgerSchema>;

export const loadLedger = (): Ledger =>
  ledgerSchema.parse(
    JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'evaluation', 'known-breaches.json'), 'utf8')),
  );

/**
 * What a row must come out as. A metric registered for a mode is measured there, and met unless the
 * ledger lists it as a known breach; a metric not registered for the mode is NOT MEASURED. With
 * `strict`, nothing is excused.
 */
export function expectedStatus(
  row: Pick<MetricRow, 'id' | 'mode'>,
  registered: Registered,
  ledger: Ledger,
  strict = false,
): Status {
  const applies = registered.specs[row.id]?.appliesIn.includes(row.mode) ?? false;
  if (!applies) return 'not-measured';
  const known = ledger.breaches.some((item) => item.mode === row.mode && item.metric === row.id);
  return known && !strict ? 'breached' : 'met';
}

export const isStrict = (): boolean => process.env.EVAL_STRICT === '1';

export const describeRow = (row: MetricRow, ledger: Ledger, strict = isStrict()): string => {
  const known = ledger.breaches.find((item) => item.mode === row.mode && item.metric === row.id);
  const base = `${row.mode} / ${row.label}: ${row.value} (threshold ${row.threshold})`;
  if (strict) return `${base}. EVAL_STRICT=1: a breach fails, listed or not.`;
  return known
    ? `${base}. It is recorded in known-breaches.json as a breach; if it now passes, take it out of that file.`
    : `${base}. If it breaches, that is a regression or a new breach: it is not in known-breaches.json.`;
};

export type { Mode };
