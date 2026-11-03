import { latencyOf, sum, type Latency } from './measure-stats.js';

export interface Prices {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export interface UsageRecord {
  scenario: string;
  task: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export const costUsd = (inputTokens: number, outputTokens: number, prices: Prices): number =>
  (inputTokens / 1_000_000) * prices.inputPerMillionUsd +
  (outputTokens / 1_000_000) * prices.outputPerMillionUsd;

export interface ScenarioUsage {
  scenario: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  costUsd: number;
}

export interface UsageSummary {
  perScenario: ScenarioUsage[];
  worst: ScenarioUsage | null;
  /** Tokens of the largest scenario, as a share of the per-project cap. */
  worstShareOfCap: number | null;
  byTask: Record<string, Latency & { tokens: number }>;
}

export function summariseUsage(
  records: readonly UsageRecord[],
  prices: Prices,
  tokenCap: number,
): UsageSummary {
  const scenarios = [...new Set(records.map((record) => record.scenario))].sort();
  const perScenario = scenarios.map((scenario): ScenarioUsage => {
    const own = records.filter((record) => record.scenario === scenario);
    const inputTokens = sum(own.map((record) => record.inputTokens));
    const outputTokens = sum(own.map((record) => record.outputTokens));
    return {
      scenario,
      calls: own.length,
      inputTokens,
      outputTokens,
      tokens: inputTokens + outputTokens,
      costUsd: costUsd(inputTokens, outputTokens, prices),
    };
  });
  const worst = perScenario.reduce<ScenarioUsage | null>(
    (best, item) => (best === null || item.tokens > best.tokens ? item : best),
    null,
  );
  const byTask: UsageSummary['byTask'] = {};
  for (const task of [...new Set(records.map((record) => record.task))].sort()) {
    const own = records.filter((record) => record.task === task);
    byTask[task] = {
      ...latencyOf(own.map((record) => record.latencyMs)),
      tokens: sum(own.map((record) => record.inputTokens + record.outputTokens)),
    };
  }
  return { perScenario, worst, worstShareOfCap: worst ? worst.tokens / tokenCap : null, byTask };
}
