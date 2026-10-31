import { z } from 'zod';

/** How a document reached Swarm. */
export const SOURCE_KINDS = ['upload', 'paste', 'url', 'sample', 'historical'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * Where a piece of evidence came from. Only `kind` is always present: an upload has no address.
 * `fetchedByServer` is set by the server alone and is never trusted from a client, so "retrieved public
 * evidence" can only be claimed for a page this server fetched itself.
 */
export const sourceProvenanceSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  /** The address as given, with the values of secret-looking query parameters removed. */
  url: z.string().max(2_048).optional(),
  /** The address after redirects, with the same redaction. */
  finalUrl: z.string().max(2_048).optional(),
  retrievedAt: z.iso.datetime().optional(),
  contentType: z.string().max(120).optional(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .optional(),
  title: z.string().max(300).optional(),
  license: z.string().max(200).optional(),
  /** The date the information describes or was published. A backtest uses it to keep later facts out. */
  asOf: z.iso.date().optional(),
  fetchedByServer: z.boolean().optional(),
});
export type SourceProvenance = z.infer<typeof sourceProvenanceSchema>;

const line = (max: number) => z.string().trim().max(max);
const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,47}$/u, 'Use lower-case letters, digits and hyphens.');

/** One thing the proposed change alters: the variable, what it is now and what it becomes. */
export const scenarioVariableSchema = z.object({
  name: line(120).min(1),
  from: line(200).nullable().default(null),
  to: line(200).nullable().default(null),
  note: line(400).default(''),
});
export type ScenarioVariable = z.infer<typeof scenarioVariableSchema>;

/** A way the change could be made, compared with the baseline. */
export const scenarioAlternativeSchema = z.object({
  id: slug,
  label: line(120).min(1),
  description: line(600).default(''),
  changes: z.array(scenarioVariableSchema).max(10).default([]),
});
export type ScenarioAlternative = z.infer<typeof scenarioAlternativeSchema>;

export const scenarioAssumptionSchema = z.object({
  id: slug,
  text: line(400).min(1),
  /** `user` was written or accepted by a person; `system` was filled in by Swarm and is open to edit. */
  origin: z.enum(['user', 'system']),
});
export type ScenarioAssumption = z.infer<typeof scenarioAssumptionSchema>;

/** Something in the question that Swarm could not settle, and the one question that would settle it. */
export const scenarioAmbiguitySchema = z.object({
  field: line(60).min(1),
  message: line(400).min(1),
  question: line(300).nullable().default(null),
});
export type ScenarioAmbiguity = z.infer<typeof scenarioAmbiguitySchema>;

/**
 * The structure behind an ordinary-language what-if question. It is domain-neutral: nothing in it
 * names a market, a product or an industry. Every field is editable by the person, and `origin` says
 * how this version was first made (never that it was right).
 */
export const scenarioFrameSchema = z.object({
  /** The decision or event being evaluated. */
  decision: line(400),
  /** The affected market, organisation or system. */
  system: line(300),
  geography: line(200).nullable().default(null),
  /** Free text, such as "next two quarters". */
  horizon: line(200).nullable().default(null),
  changes: z.array(scenarioVariableSchema).max(10).default([]),
  /** What is expected to happen without the change. */
  baseline: line(600),
  alternatives: z.array(scenarioAlternativeSchema).max(6).default([]),
  requestedDecision: line(400).nullable().default(null),
  desiredOutput: line(300).nullable().default(null),
  evidenceAvailable: z.array(line(200)).max(12).default([]),
  evidenceMissing: z.array(line(200)).max(12).default([]),
  assumptions: z.array(scenarioAssumptionSchema).max(15).default([]),
  /** Roles or groups the question already names or implies. Seeds for stakeholder discovery only. */
  likelyStakeholders: z.array(line(120)).max(20).default([]),
  ambiguities: z.array(scenarioAmbiguitySchema).max(8).default([]),
  origin: z.enum(['rules', 'model', 'user']),
});
export type ScenarioFrame = z.infer<typeof scenarioFrameSchema>;

// ---------------------------------------------------------------------------------------------
// Scenario intake: reading a question into a frame, and storing what a person made of it
// ---------------------------------------------------------------------------------------------

/** The longest question intake reads: the same bound as the question of a project. */
export const SCENARIO_QUESTION_MAX = 2_000;
/** Intake never asks more than this many questions back: more would be a form, not an aid. */
export const SCENARIO_QUESTIONS_MAX = 3;
export const SCENARIO_DOCUMENTS_MAX = 10;
/** How much of the start of a document's text may be sent to be inspected for text aimed at an AI. */
export const SCENARIO_EXCERPT_MAX = 5_000;

/**
 * A document as intake sees it: its name and size, which become the evidence listed as available, and
 * the start of its text, which is only inspected in memory and is never stored, logged or sent to a model.
 */
export const scenarioDocumentSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    characters: z.int().min(0).max(1_000_000),
    excerpt: z.string().max(SCENARIO_EXCERPT_MAX).optional(),
  })
  .strict();
export type ScenarioDocument = z.infer<typeof scenarioDocumentSchema>;

export const scenarioParseRequestSchema = z
  .object({
    question: z.string().trim().min(3).max(SCENARIO_QUESTION_MAX),
    documents: z.array(scenarioDocumentSchema).max(SCENARIO_DOCUMENTS_MAX).default([]),
  })
  .strict();
export type ScenarioParseRequest = z.input<typeof scenarioParseRequestSchema>;

export type ScenarioReadMode = 'rules' | 'model';

/** The fields of a frame that a question back can be about, and `success`, which has no field of its own. */
export const SCENARIO_FIELDS = [
  'decision',
  'system',
  'geography',
  'horizon',
  'changes',
  'baseline',
  'requestedDecision',
  'desiredOutput',
  'likelyStakeholders',
  'success',
] as const;

const FIELD_HINTS: readonly (readonly [RegExp, string])[] = [
  [/stakeholder|affected|audience|\bwho\b|groups?|people/u, 'likelyStakeholders'],
  [/horizon|timing|time|period|duration|\bwhen\b/u, 'horizon'],
  [/geograph|region|location|\bplace\b|\bwhere\b/u, 'geography'],
  [/success|outcome|metric|measure|goal|objective/u, 'success'],
  [/baseline|status quo|counterfactual/u, 'baseline'],
  [/magnitude|size|amount|extent|scale|change|variable/u, 'changes'],
  [/system|scope|market|organi[sz]ation/u, 'system'],
  [/decision|event/u, 'decision'],
];

/**
 * The name of the field a question back is about, in the names this file uses. A model may call the
 * same thing "time horizon" or "magnitude of changes"; an unrecognised name is left as it is.
 */
export function canonicalField(field: string): string {
  if ((SCENARIO_FIELDS as readonly string[]).includes(field)) return field;
  const lower = field.toLowerCase();
  return FIELD_HINTS.find(([hint]) => hint.test(lower))?.[1] ?? field;
}

export interface ScenarioParseResult {
  frame: ScenarioFrame;
  /** What the person should know about how the question was read, in plain words. */
  notes: string[];
  mode: ScenarioReadMode;
  /** The model that read the question, when one did. */
  model: string | null;
}

function repeated(values: readonly string[]): number | null {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) return index;
    seen.add(value);
  }
  return null;
}

/**
 * A frame as a person or a client submits it, with the checks a stored scenario needs on top of its
 * shape: it names the decision or event, and later stages can tell its alternatives apart by id.
 */
export const scenarioInputSchema = scenarioFrameSchema.superRefine((frame, context) => {
  if (frame.decision.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['decision'],
      message: 'Say what decision or event is being explored.',
    });
  }
  for (const [path, ids] of [
    ['alternatives', frame.alternatives.map((alternative) => alternative.id)],
    ['assumptions', frame.assumptions.map((assumption) => assumption.id)],
  ] as const) {
    const index = repeated(ids);
    if (index !== null) {
      context.addIssue({
        code: 'custom',
        path: [path, index, 'id'],
        message: `Each entry in ${path} needs an id of its own.`,
      });
    }
  }
});

/** The body of a change to a stored scenario. `expectedRevision` makes a stale edit fail instead of overwriting. */
export const scenarioWriteSchema = z
  .object({
    scenario: scenarioInputSchema,
    expectedRevision: z.int().min(0).optional(),
  })
  .strict();
export type ScenarioWrite = z.input<typeof scenarioWriteSchema>;

/** The stored scenario of a project, or null when it has none, with the revision to edit against. */
export interface ScenarioView {
  scenario: ScenarioFrame | null;
  revision: number;
}
