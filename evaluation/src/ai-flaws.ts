import type { Analysis } from '../../shared/analysis.js';
import type { AnalysisConstraints } from '../../shared/constraint-effects.js';
import type { DecisionBrief } from '../../shared/brief.js';
import type { CriticInput } from '../../backend/src/critics/types.js';
import { cleanInput, ref, withBrief } from '../../backend/test/support/critic-world.js';
import { runRuleCritics } from '../../backend/src/critics/rules.js';
import type { Critique } from '../../shared/critique.js';
import type { PlantOp } from './ai-datasets.js';

/** The unflawed analysis and brief every flaw is planted into. */
export const unflawedInput = (): CriticInput => withBrief(cleanInput());

type Fields = Record<string, unknown>;

function setById<T extends { id: string }>(
  items: T[],
  id: string,
  set: Fields,
  what: string,
): void {
  const found = items.find((item) => item.id === id);
  if (!found) throw new Error(`The flaw plants into ${what} ${id}, which the input does not have.`);
  Object.assign(found, set);
}

const briefOf = (input: CriticInput): DecisionBrief => {
  if (!input.brief) throw new Error('The flaw needs a brief, and the input has none.');
  return input.brief;
};

const EMPTY_RECORD: AnalysisConstraints = {
  revision: 1,
  status: 'clear',
  label: 'Clear: every constraint was confirmed.',
  reasons: [],
  applied: [],
  notApplied: [],
  impacts: [],
};

function plantOne(input: CriticInput, op: PlantOp): void {
  const fields = op as Fields;
  switch (op.op) {
    case 'recommendation':
      setById(
        briefOf(input).recommendations,
        fields.id as string,
        fields.set as Fields,
        'recommendation',
      );
      return;
    case 'finding':
      setById(input.analysis.findings, fields.id as string, fields.set as Fields, 'finding');
      return;
    case 'headline':
      briefOf(input).headline = fields.text as string;
      return;
    case 'statement': {
      const statements = briefOf(input).sections.flatMap((section) => section.statements);
      setById(statements, fields.id as string, fields.set as Fields, 'statement');
      return;
    }
    case 'sensitivity':
      setById(
        input.analysis.sensitivity,
        fields.id as string,
        fields.set as Fields,
        'sensitivity row',
      );
      return;
    case 'citations': {
      const mode = fields.mode as string;
      const people = input.stakeholders?.stakeholders ?? [];
      if (mode === 'all-one-document') {
        people.forEach((person, at) => {
          person.evidence = [ref('d1', at * 2 + 1), ref('d1', at * 2 + 2)];
        });
      } else if (mode === 'dominant-one-document') {
        people.forEach((person, at) => {
          person.evidence =
            at < people.length - 1
              ? [ref('d1', at * 2 + 1), ref('d1', at * 2 + 2)]
              : [ref('d2', 1), ref('d3', 1)];
        });
      } else if (mode === 'all-unfetched-url') {
        for (const document of input.evidenceSummary.documents) {
          document.provenance = { kind: 'url', fetchedByServer: false, asOf: '2026-01-10' };
        }
      } else {
        throw new Error(`Unknown citation mode ${mode}.`);
      }
      return;
    }
    case 'actors': {
      const mode = fields.mode as string;
      for (const actor of input.actors.actors) {
        if (mode === 'defaults') {
          for (const trait of Object.values(actor.traits)) trait.origin = 'system-assumption';
          actor.edited = false;
        } else if (mode === 'one-sided-priors') {
          actor.traits.priorStance.value = 0.4;
        } else if (mode === 'one-sided-impact') {
          actor.traits.impact.value = -0.5;
        } else {
          throw new Error(`Unknown actors mode ${mode}.`);
        }
      }
      return;
    }
    case 'constraints': {
      const analysis: Analysis = input.analysis;
      if (fields.remove === true) {
        delete analysis.constraints;
        return;
      }
      const record: AnalysisConstraints = analysis.constraints ?? structuredClone(EMPTY_RECORD);
      Object.assign(record, (fields.merge as Fields | undefined) ?? {});
      record.applied.push(
        ...((fields.addApplied as AnalysisConstraints['applied'] | undefined) ?? []),
      );
      record.notApplied.push(
        ...((fields.addNotApplied as AnalysisConstraints['notApplied'] | undefined) ?? []),
      );
      analysis.constraints = record;
      return;
    }
  }
}

/** A copy of the input with the planted operations applied, in order. */
export function plant(input: CriticInput, ops: readonly PlantOp[]): CriticInput {
  const copy = structuredClone(input);
  for (const op of ops) plantOne(copy, op);
  return copy;
}

export const critiquesOf = (input: CriticInput): Critique[] => runRuleCritics(input);
