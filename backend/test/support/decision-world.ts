import type { Analysis } from '../../../shared/analysis.js';
import type { Constraint, ConstraintSet, CounterfactualSet } from '../../../shared/constraints.js';
import type { CritiqueSet } from '../../../shared/critique.js';
import type { ExampleScenario } from '../../../shared/example-scenarios.js';
import { FIXTURE_TIME } from '../../../shared/lab-fixtures.js';
import { runAnalysis } from '../../src/analysis/runset.js';
import type { BriefDocument } from '../../src/brief/evidence.js';
import type { BriefLedgerSummary } from '../../src/brief/facts.js';
import { gateWorldOf } from '../../src/constraints/plan.js';
import { refreshSet } from '../../src/constraints/refresh.js';
import type { DecisionInputs } from '../../src/decision/build.js';
import { simulateEachSpecOnce } from '../../src/simulation/simulate.js';
import { setOf } from './constraint-fixtures.js';
import { exampleWorld, type ExampleWorld } from './constraint-world.js';

/**
 * What the decision canvas is built from, made by the real rules path on a worked example: the question
 * is read, the stakeholders found and approved, the actors made, and the comparison run by the real
 * engine, so that a test of the canvas is about the pipeline and not about a hand-made document.
 */

const NOW = new Date('2026-03-01T09:00:00.000Z');
export const REVISIONS = { scenario: 1, stakeholders: 1, actors: 1, constraints: 1 } as const;

const worlds = new Map<string, Promise<ExampleWorld>>();
const analyses = new Map<string, Promise<Analysis>>();

export const worldOf = (pack: ExampleScenario): Promise<ExampleWorld> => {
  const found = worlds.get(pack.id) ?? exampleWorld(pack);
  worlds.set(pack.id, found);
  return found;
};

/** One comparison per example and run count, run once and shared by the tests of a file. */
export function analysisOf(pack: ExampleScenario, runs = 12): Promise<Analysis> {
  const key = `${pack.id}|${runs}`;
  const found =
    analyses.get(key) ??
    worldOf(pack).then((world) =>
      runAnalysis(
        {
          id: 'analysis-1',
          createdAt: FIXTURE_TIME,
          actors: world.actors.actors,
          relations: world.actors.relations,
          variants: world.variants,
          runsPerVariant: runs,
          baseSeed: 100,
          rounds: 8,
          sensitivity: true,
        },
        simulateEachSpecOnce(),
        { now: () => 0 },
      ),
    );
  analyses.set(key, found);
  return found;
}

export interface WorldOptions {
  runs?: number;
  constraints?: Constraint[] | null;
  constraintSet?: Partial<ConstraintSet>;
  counterfactuals?: CounterfactualSet | null;
  counterfactualsCurrent?: boolean;
  critiques?: CritiqueSet | null;
  ledger?: BriefLedgerSummary | null;
  analysis?: (analysis: Analysis) => Analysis;
  documents?: BriefDocument[];
  inputRevisions?: Record<string, number> | null;
  revisionsNow?: Record<string, number>;
}

export async function decisionInputs(
  pack: ExampleScenario,
  options: WorldOptions = {},
): Promise<DecisionInputs> {
  const world = await worldOf(pack);
  const base = await analysisOf(pack, options.runs);
  const withConstraints = options.constraints !== undefined && options.constraints !== null;
  const revisions: Record<string, number> = {
    scenario: 1,
    stakeholders: 1,
    actors: 1,
    constraints: withConstraints ? 1 : 0,
  };
  const analysis0: Analysis = {
    ...base,
    ...(options.inputRevisions === null
      ? {}
      : { inputRevisions: options.inputRevisions ?? { ...revisions } }),
  };
  const analysis = options.analysis ? options.analysis(analysis0) : analysis0;
  const records = {
    scenario: { data: world.scenario, revision: 1 },
    actors: { data: world.actors, revision: 1 },
  };
  const set = withConstraints
    ? refreshSet(
        setOf(options.constraints ?? [], options.constraintSet ?? {}),
        gateWorldOf({ scenarioRevision: 1, actorsRevision: 1 }, records, analysis.config.variants),
        NOW,
      )
    : null;
  return {
    project: { id: 'project-1', name: pack.title, question: pack.question },
    scenario: world.scenario,
    stakeholders: world.stakeholders,
    analysis,
    constraints: set,
    counterfactuals: options.counterfactuals
      ? { set: options.counterfactuals, current: options.counterfactualsCurrent ?? true }
      : null,
    critiques: options.critiques ?? null,
    documents:
      options.documents ??
      pack.documents.map((document, index) => ({
        id: `D${index + 1}`,
        name: document.name,
        provenance: document.provenance,
      })),
    ledger: options.ledger ?? null,
    research: null,
    revisionsNow: options.revisionsNow ?? { ...revisions },
    newerRunning: false,
  };
}
