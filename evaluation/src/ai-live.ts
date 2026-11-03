import { loadConfig, type ServerConfig } from '../../backend/src/config.js';
import { modelCritiques } from '../../backend/src/critics/model.js';
import { createModelFactory } from '../../backend/src/models/factory.js';
import { ProviderTelemetry } from '../../backend/src/models/telemetry.js';
import {
  askConstraints,
  askParticipants,
  constraintsOutcome,
  injectedProject,
  measured,
  participantsOutcome,
  productResponse,
  runOf,
  type FakeObservation,
  type FakeRun,
  type Harness,
  type SafetyRecord,
} from './ai-fake.js';
import { liveConstraints } from './ai-adapt.js';
import { prepare, prepareFrom } from './ai-corpus.js';
import { documentsOf, loadFlaws, loadSafety, loadScenarios, type Scenario } from './ai-datasets.js';
import { critiquesOf, plant, unflawedInput } from './ai-flaws.js';
import type { FlawRun } from './measure-critics.js';
import { raisedCategories, type GapReading } from './measure-constraints.js';
import type { ConstraintSet } from '../../shared/constraints.js';
import type { Split } from './datasets.js';

/** What is printed, word for word, wherever the live mode did not run. */
export const NOT_MEASURED_LIVE = 'NOT MEASURED: no Azure authorization on this machine';

/** Most tokens a live run may spend, from the budget of the pilot template: the evaluation never asks for more. */
export const DEFAULT_LIVE_TOKEN_BUDGET = 1_500_000;

export interface LiveRequest {
  /** `--live`: a person asked for it. */
  live: boolean;
  environment: Record<string, string | undefined>;
  /** Only for the test of this code against the in-process fake, which is on this machine: never set by the CLI. */
  allowLoopbackForTests?: boolean;
  tokenBudget?: number;
}

export type LiveDecision =
  | { run: true; config: ServerConfig; tokenBudget: number }
  | { run: false; message: string; reasons: string[] };

const isLoopback = (address: string | null): boolean => {
  if (!address) return false;
  try {
    const host = new URL(address).hostname;
    return host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.');
  } catch {
    return false;
  }
};

/**
 * Whether the live mode may run: only when it was asked for with `--live`, and Foundry is configured
 * in the environment, and the endpoint is not on this machine. Anything else is NOT MEASURED, with
 * the reasons, and nothing is sent anywhere. It reads no secret and prints none.
 */
export function decideLive(request: LiveRequest): LiveDecision {
  const reasons: string[] = [];
  if (!request.live) reasons.push('--live was not given.');
  let config: ServerConfig | null = null;
  try {
    config = loadConfig({ ...request.environment, LOG_LEVEL: 'silent' });
  } catch {
    reasons.push('The server configuration in the environment is not valid.');
  }
  if (config) {
    if (config.provider.name !== 'foundry') {
      reasons.push('AI_PROVIDER is not foundry.');
    } else if (!config.provider.configured) {
      reasons.push(`Foundry is not configured: ${config.provider.reason}`);
    } else if (isLoopback(config.provider.baseUrl) && !request.allowLoopbackForTests) {
      reasons.push('The Foundry endpoint is on this machine, so it is not a deployment.');
    }
  }
  if (reasons.length > 0 || !config) return { run: false, message: NOT_MEASURED_LIVE, reasons };
  return {
    run: true,
    config,
    tokenBudget: request.tokenBudget ?? DEFAULT_LIVE_TOKEN_BUDGET,
  };
}

export interface LiveObservation extends FakeObservation {
  /** Constraint sets read with the sentence of a labelled constraint taken out. */
  gaps: GapReading[];
  /** The model critic's critiques, with the rule critics', on each seeded flaw. */
  flaws: (FlawRun & { split: Split })[];
  controls: {
    id: string;
    split: Split;
    baseline: FlawRun['baseline'];
    changed: FlawRun['flawed'];
  }[];
  tokens: number;
}

export interface LiveOptions {
  harness: Harness;
  modelName: string;
  /** For a test of this code: the scenarios to read. */
  scenarios?: readonly Scenario[];
  flaws?: number;
}

/**
 * The same suites as the fake, with a real model answering: no reply is scripted, so what is measured
 * is the model's, behind the product's own client and checks. It is written against the same
 * `Harness` as the fake mode, which is how it is tested, and it has never been run against a real
 * deployment from here.
 */
export async function observeLive(options: LiveOptions): Promise<LiveObservation> {
  const started = performance.now();
  const { harness } = options;
  const scenarios = options.scenarios ?? loadScenarios();
  const runs: FakeRun[] = [];
  const usage: FakeObservation['usage'] = [];
  const gaps: GapReading[] = [];
  for (const scenario of scenarios) {
    const prepared = prepare(scenario, 'full');
    const base = (stage: 'participants' | 'constraints') => ({
      scenario: scenario.id,
      split: scenario.split,
      stage,
      arm: 'clean' as const,
      case: null,
      records: prepared.records,
    });
    const participants = runOf(
      base('participants'),
      participantsOutcome(await measured(harness, {}, askParticipants(prepared))),
      null,
    );
    const constraints = runOf(
      base('constraints'),
      constraintsOutcome(await measured(harness, {}, askConstraints(prepared))),
      null,
    );
    runs.push(participants, constraints);
    for (const run of [participants, constraints]) {
      usage.push({
        scenario: scenario.id,
        split: scenario.split,
        flagship: scenario.kind === 'flagship',
        task: run.stage,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        latencyMs: run.ms,
      });
    }
    if (scenario.gap && constraints.output && 'constraints' in constraints.output) {
      const seeded = prepare(scenario, 'gap');
      const read = constraintsOutcome(await measured(harness, {}, askConstraints(seeded)));
      if (read.value) {
        const set = read.value.set as ConstraintSet;
        const reading = (source: ConstraintSet) => ({
          constraints: liveConstraints(source).map((item) => ({
            category: item.category,
            source: item.source,
          })),
          questions: source.clarifications.map((item) => ({
            category: item.category,
            status: item.status,
          })),
        });
        gaps.push({
          id: scenario.id,
          accept: scenario.gap.accept,
          ...reading(set),
          raisedWithoutGap: raisedCategories(reading(constraints.output)),
        });
      }
    }
  }

  const injected = injectedProject();
  for (const stage of ['participants', 'constraints'] as const) {
    const outcome =
      stage === 'participants'
        ? participantsOutcome(await measured(harness, {}, askParticipants(injected.prepared)))
        : constraintsOutcome(await measured(harness, {}, askConstraints(injected.prepared)));
    const run = runOf(
      {
        scenario: injected.id,
        split: injected.split,
        stage,
        arm: 'clean',
        case: 'echoed-injection',
        records: injected.prepared.records,
      },
      outcome,
      null,
    );
    const text = JSON.stringify(run.output ?? '').toLowerCase();
    runs.push({
      ...run,
      leaked: run.output
        ? injected.payloads.some((payload) => text.includes(payload.toLowerCase()))
        : null,
    });
  }

  const flawFile = loadFlaws();
  const baseInput = { ...unflawedInput(), now: '2026-11-03T09:00:00.000Z' };
  const baseRules = critiquesOf(baseInput);
  const baseModel = await measured(harness, { maxCalls: 3 }, (gateway) =>
    modelCritiques(gateway, baseInput, baseRules, new AbortController().signal),
  );
  const baseline = [...baseRules, ...(baseModel.value?.critiques ?? [])];
  const review = async (ops: Parameters<typeof plant>[1]) => {
    const input = { ...plant(unflawedInput(), ops), now: baseInput.now };
    const rules = critiquesOf(input);
    const model = await measured(harness, { maxCalls: 3 }, (gateway) =>
      modelCritiques(gateway, input, rules, new AbortController().signal),
    );
    return [...rules, ...(model.value?.critiques ?? [])];
  };
  const flaws: LiveObservation['flaws'] = [];
  for (const flaw of flawFile.flaws.slice(0, options.flaws ?? flawFile.flaws.length)) {
    flaws.push({
      id: flaw.id,
      split: flaw.split,
      class: flaw.class,
      roles: flaw.expect.roles,
      targetKinds: flaw.expect.targetKinds,
      baseline,
      flawed: await review(flaw.plant),
    });
  }
  const controls: LiveObservation['controls'] = [];
  for (const control of flawFile.controls.slice(0, options.flaws === undefined ? undefined : 1)) {
    controls.push({
      id: control.id,
      split: control.split,
      baseline,
      changed: await review(control.plant),
    });
  }

  const safety: SafetyRecord[] = [];
  const base = scenarios.find((scenario) => scenario.id === 'S07') ?? (scenarios[0] as Scenario);
  const documents = documentsOf(base);
  const items = options.flaws === undefined ? loadSafety().items : loadSafety().items.slice(0, 4);
  for (const item of items) {
    const prepared = prepareFrom(item.request, documents, 'full');
    const outcome = await measured(harness, {}, askParticipants(prepared));
    safety.push({
      id: item.id,
      split: item.split,
      class: item.class,
      gold: item.gold,
      // Whether the provider blocked is what the product reports: a refusal comes from the provider.
      provider: outcome.error === 'MODEL_REFUSED' ? 'block' : 'answer',
      mechanism: outcome.error === 'MODEL_REFUSED' ? 'provider' : 'none',
      product: productResponse(outcome),
    });
  }

  return {
    runs,
    safety,
    usage,
    problems: harness.problems,
    elapsedMs: performance.now() - started,
    gaps,
    flaws,
    controls,
    tokens: harness.spent ?? 0,
  };
}

/** The factory of the real client for a configuration that `decideLive` allowed. */
export function liveHarness(config: ServerConfig, tokenBudget: number): Harness {
  return {
    factory: createModelFactory(config, new ProviderTelemetry(config.provider)),
    config,
    problems: [],
    tokenBudget,
    spent: 0,
  };
}
