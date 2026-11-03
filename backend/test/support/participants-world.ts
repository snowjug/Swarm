import type { z } from 'zod';
import { scenarioFrameSchema, type ScenarioFrame } from '../../../shared/scenario.js';
import type { ProposedParticipant, ProposedParticipants } from '../../../shared/stakeholders.js';
import type { EvidenceChunk } from '../../../shared/types.js';
import { AppError } from '../../src/errors.js';
import type { JsonOptions, ModelGateway } from '../../src/models/client.js';
import { chunkDocuments } from '../../src/knowledge/retrieval.js';
import { buildContext, type ProposalContext } from '../../src/stakeholders/participants/context.js';

/**
 * Synthetic material for the participant tests: one short document about a change that has nothing to
 * do with any market, a scenario frame for it, and a model that answers from a script. The model checks
 * each scripted answer the way the real client does, against the schema and then the server's own
 * validator, and moves to the next answer (the one correction) when it is refused. It is a double, and
 * says nothing about any real model.
 */

export const NOTES = [
  'Transit notes (synthetic, invented for the exercise). The transit office plans to move the night bus route to a new corridor next spring.',
  'Residents of the old corridor say the change would leave them without a late bus, and neighbourhood groups have asked for a public hearing.',
  'The city council must approve the new route before any change, and the safety inspectorate requires a review of every new stop.',
  'Bus drivers and depot mechanics would carry out the change, and the drivers union wants a say on schedules.',
  'A rival ride-hailing operator advertises late-night trips in the same area.',
].join(' ');

export const QUOTES = {
  council: 'The city council must approve the new route before any change',
  residents: 'Residents of the old corridor say the change would leave them without a late bus',
  inspectorate: 'the safety inspectorate requires a review of every new stop',
  drivers: 'Bus drivers and depot mechanics would carry out the change',
  rival: 'A rival ride-hailing operator advertises late-night trips in the same area',
} as const;

export const SCENARIO: ScenarioFrame = scenarioFrameSchema.parse({
  decision: 'Whether to move the night bus route to a new corridor next spring',
  system: 'Night bus network',
  geography: 'One city',
  horizon: 'Next spring',
  baseline: 'The night bus stays on the old corridor.',
  likelyStakeholders: ['transit office'],
  origin: 'user',
});

export const QUESTION = 'What could happen if the night bus route moves to a new corridor?';

export function passagesOf(content: string = NOTES): EvidenceChunk[] {
  return chunkDocuments([{ id: 'D1', name: 'notes.md', content }]);
}

export function contextOf(
  overrides: Partial<Parameters<typeof buildContext>[0]> = {},
): ProposalContext {
  return buildContext({
    question: QUESTION,
    scenario: SCENARIO,
    graph: null,
    passages: passagesOf(),
    ...overrides,
  });
}

export const passageWith = (passages: readonly EvidenceChunk[], quote: string): string => {
  const found = passages.find((passage) => passage.text.includes(quote));
  if (!found) throw new Error(`No passage holds: ${quote}`);
  return found.id;
};

/** A participant that passes every check, to be changed by the test that wants one that does not. */
export function participant(
  passages: readonly EvidenceChunk[],
  overrides: Partial<ProposedParticipant> = {},
): ProposedParticipant {
  return {
    id: 'city-council',
    name: 'City council approving the new route',
    role: 'approvers',
    whyTheyMatter: 'It has to approve the route before the change can go ahead.',
    description: 'The body that signs off on route changes.',
    objective: 'Check that the change is lawful and accountable before it goes ahead.',
    incentives: ['Keep the approval process defensible.'],
    pressures: ['Residents ask for a hearing.'],
    constraints: ['Cannot approve a route the inspectorate has not reviewed.'],
    concerns: ['A late bus is lost for one corridor.'],
    influence: 'high',
    decisionAuthority: 'approves',
    directness: 'indirect',
    impact: { direction: 'unclear', rationale: 'No direction is stated for the approver.' },
    informationAccess: ['Assumed to see the route proposal put before it.'],
    plausibleActions: ['Approve as put forward.', 'Ask for a hearing first.', 'Withhold approval.'],
    prohibitedClaims: ['What the real council has decided.'],
    evidence: [{ passageId: passageWith(passages, QUOTES.council), quote: QUOTES.council }],
    assumptions: [],
    uncertainty: { level: 'medium', reason: 'One passage names the approver.' },
    confidenceBasis: 'source-quote',
    priority: 'key',
    synthetic: true,
    ...overrides,
  };
}

/** A proposal of several different participants over the notes, each quoting its own passage. */
export function proposal(
  passages: readonly EvidenceChunk[],
  overrides: Partial<ProposedParticipants> = {},
): ProposedParticipants {
  const quoted = (key: keyof typeof QUOTES) => [
    { passageId: passageWith(passages, QUOTES[key]), quote: QUOTES[key] },
  ];
  return {
    version: 1,
    participants: [
      participant(passages),
      participant(passages, {
        id: 'transit-office',
        name: 'Transit office planning the route move',
        role: 'decision-owner',
        whyTheyMatter: 'It decides whether and how the night bus moves.',
        objective: 'Decide whether and how the route move goes ahead.',
        incentives: ['Keep the night service running within its budget.'],
        pressures: ['Neighbourhood groups ask for a public hearing.'],
        constraints: ['Needs council approval before any change.'],
        concerns: ['Opposition could delay the move.'],
        influence: 'high',
        decisionAuthority: 'decides',
        directness: 'direct',
        plausibleActions: ['Go ahead as planned.', 'Phase the move.', 'Hold a hearing first.'],
        evidence: [],
        assumptions: ['Assumption: the question names the transit office; no passage quotes it.'],
        confidenceBasis: 'scenario-statement',
      }),
      participant(passages, {
        id: 'old-corridor-residents',
        name: 'Residents of the old corridor',
        role: 'directly-affected',
        whyTheyMatter: 'They would lose the late bus on their corridor.',
        objective: 'Keep a late bus that works for their evenings.',
        incentives: ['Keep late-night travel possible.'],
        pressures: ['Fewer options after the move.'],
        constraints: [],
        concerns: ['Being left without a late bus.'],
        influence: 'medium',
        decisionAuthority: 'none',
        directness: 'direct',
        impact: {
          direction: 'harmed',
          rationale: 'The passage says the change would leave them without a late bus.',
        },
        plausibleActions: ['Ask for a hearing.', 'Look for another way to travel.'],
        evidence: quoted('residents'),
        priority: 'standard',
        populationSize: 400,
      }),
      participant(passages, {
        id: 'drivers-and-mechanics',
        name: 'Bus drivers and depot mechanics',
        role: 'implementers',
        whyTheyMatter: 'They carry the change out.',
        objective: 'Carry out the move without breaking what works.',
        incentives: ['Keep schedules workable.'],
        pressures: ['A new schedule to learn.'],
        constraints: [],
        concerns: ['Short notice on schedules.'],
        influence: 'medium',
        decisionAuthority: 'none',
        directness: 'direct',
        plausibleActions: ['Carry the move out as specified.', 'Ask for time on schedules.'],
        evidence: quoted('drivers'),
        priority: 'standard',
        populationSize: 60,
      }),
      participant(passages, {
        id: 'safety-inspectorate',
        name: 'Safety inspectorate reviewing new stops',
        role: 'regulators-governance',
        whyTheyMatter: 'It reviews every new stop.',
        objective: 'Uphold the safety rules for new stops.',
        incentives: ['Keep new stops within the safety rules.'],
        pressures: [],
        constraints: ['Reviews each stop on its own.'],
        concerns: [],
        influence: 'high',
        decisionAuthority: 'can-block',
        directness: 'indirect',
        plausibleActions: ['Ask for changes to a stop.', 'Pass the review.'],
        evidence: quoted('inspectorate'),
      }),
      participant(passages, {
        id: 'ride-hailing-rival',
        name: 'Ride-hailing operator in the same area',
        role: 'competitors-alternatives',
        whyTheyMatter: 'It offers late-night trips that riders could turn to.',
        objective: 'Win riders who lose the late bus.',
        incentives: ['Win late-night riders.'],
        pressures: [],
        constraints: [],
        concerns: [],
        influence: 'low',
        decisionAuthority: 'none',
        directness: 'indirect',
        plausibleActions: ['Promote late-night trips.', 'Hold its position.'],
        evidence: quoted('rival'),
        priority: 'standard',
        populationSize: 1,
      }),
    ],
    relations: [
      {
        from: 'city-council',
        to: 'transit-office',
        type: 'regulates',
        strength: 0.6,
        rationale: 'The council oversees the transit office.',
      },
    ],
    gaps: [],
    ...overrides,
  };
}

/** A model that answers from a script, one answer per attempt, and checks each as the real client does. */
export class ScriptedGateway implements ModelGateway {
  readonly calls: { instructions: string; data: unknown; options: unknown }[] = [];
  /** What the server's own validator said about each answer it refused: it goes back to the model. */
  readonly refused: string[] = [];
  attempts = 0;
  constructor(private readonly replies: unknown[]) {}

  async json<T>(
    schema: z.ZodType<T>,
    instructions: string,
    data: unknown,
    _signal: AbortSignal,
    _maxTokens?: number,
    options?: JsonOptions<T>,
  ): Promise<T> {
    this.calls.push({ instructions, data, options });
    const allowed = 1 + (options?.repairs ?? 2);
    for (const reply of this.replies.slice(0, allowed)) {
      this.attempts += 1;
      if (reply instanceof Error) throw reply;
      const parsed = schema.safeParse(reply);
      if (!parsed.success) {
        this.refused.push(
          parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        );
        continue;
      }
      try {
        options?.validate?.(parsed.data);
      } catch (error) {
        if (error instanceof AppError && error.code === 'MODEL_OUTPUT_INVALID') {
          this.refused.push(error.message);
          continue;
        }
        throw error;
      }
      return parsed.data;
    }
    throw new AppError(
      502,
      'MODEL_OUTPUT_INVALID',
      'The model output failed validation after 1 bounded repair attempt (scripted).',
    );
  }
}
