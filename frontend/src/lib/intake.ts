import {
  SCENARIO_DOCUMENTS_MAX,
  SCENARIO_EXCERPT_MAX,
  SCENARIO_QUESTION_MAX,
  canonicalField,
  type ScenarioAssumption,
  type ScenarioDocument,
  type ScenarioFrame,
  type ScenarioVariable,
} from '../../../shared/scenario';

/** The shortest question the entry form accepts, so the shortest worth reading. */
export const MIN_QUESTION = 10;

/** The size of every field of a frame, as the server states them, for the inputs' limits. */
export const LIMITS = {
  decision: 400,
  system: 300,
  geography: 200,
  horizon: 200,
  baseline: 600,
  requestedDecision: 400,
  desiredOutput: 300,
  variableName: 120,
  variableValue: 200,
  variableNote: 400,
  label: 120,
  description: 600,
  assumption: 400,
  missing: 200,
  stakeholder: 120,
  question: 300,
  changes: 10,
  alternatives: 6,
  assumptions: 15,
  missingEvidence: 12,
  stakeholders: 20,
} as const;

const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/u;

export function canRead(question: string): boolean {
  const length = question.trim().length;
  return length >= MIN_QUESTION && length <= SCENARIO_QUESTION_MAX;
}

/** What to tell the server about the attached documents: names and sizes, and the start of each text. */
export function documentSummaries(
  documents: readonly { name: string; content: string }[],
): ScenarioDocument[] {
  return documents.slice(0, SCENARIO_DOCUMENTS_MAX).map(({ name, content }) => ({
    name: name.trim().slice(0, 120) || 'document',
    characters: Math.min(content.length, 1_000_000),
    excerpt: content.slice(0, SCENARIO_EXCERPT_MAX),
  }));
}

export const blankChange = (): ScenarioVariable => ({ name: '', from: null, to: null, note: '' });

/** The first `prefix-n` that is not taken: how a row added by hand gets an id of its own. */
export function newId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = used.size + 1; ; n += 1) {
    const id = `${prefix}-${n}`;
    if (!used.has(id)) return id;
  }
}

/** A frame after a person has changed it: marked as theirs, since they own it from then on. */
export const edited = (frame: ScenarioFrame, change: Partial<ScenarioFrame>): ScenarioFrame => ({
  ...frame,
  ...change,
  origin: 'user',
});

const text = (value: string, max: number): string => value.trim().slice(0, max);
const optional = (value: string | null, max: number): string | null =>
  text(value ?? '', max) || null;

function tidyChanges(rows: readonly ScenarioVariable[]): ScenarioVariable[] {
  return rows
    .map((row) => ({
      name: text(row.name, LIMITS.variableName),
      from: optional(row.from, LIMITS.variableValue),
      to: optional(row.to, LIMITS.variableValue),
      note: text(row.note, LIMITS.variableNote),
    }))
    .filter((row) => row.name !== '')
    .slice(0, LIMITS.changes);
}

function uniqueIds<T extends { id: string }>(rows: readonly T[], prefix: string): T[] {
  const taken = new Set<string>();
  return rows.map((row) => {
    const id = SLUG.test(row.id) && !taken.has(row.id) ? row.id : newId(prefix, taken);
    taken.add(id);
    return { ...row, id };
  });
}

const tidyList = (rows: readonly string[], max: number, limit: number): string[] =>
  [...new Set(rows.map((row) => text(row, max)).filter(Boolean))].slice(0, limit);

/**
 * The frame as it will be used: blank rows gone, text trimmed and within the limits, ids that are
 * valid and unique. What the person wrote is kept; only what could not be saved is removed.
 */
export function tidyFrame(frame: ScenarioFrame): ScenarioFrame {
  return {
    ...frame,
    decision: text(frame.decision, LIMITS.decision),
    system: text(frame.system, LIMITS.system),
    geography: optional(frame.geography, LIMITS.geography),
    horizon: optional(frame.horizon, LIMITS.horizon),
    changes: tidyChanges(frame.changes),
    baseline: text(frame.baseline, LIMITS.baseline),
    alternatives: uniqueIds(
      frame.alternatives
        .map((alternative) => ({
          ...alternative,
          label: text(alternative.label, LIMITS.label),
          description: text(alternative.description, LIMITS.description),
          changes: tidyChanges(alternative.changes),
        }))
        .filter((alternative) => alternative.label !== '')
        .slice(0, LIMITS.alternatives),
      'option',
    ),
    requestedDecision: optional(frame.requestedDecision, LIMITS.requestedDecision),
    desiredOutput: optional(frame.desiredOutput, LIMITS.desiredOutput),
    evidenceMissing: tidyList(frame.evidenceMissing, LIMITS.missing, LIMITS.missingEvidence),
    assumptions: uniqueIds(
      frame.assumptions
        .map((assumption) => ({ ...assumption, text: text(assumption.text, LIMITS.assumption) }))
        .filter((assumption) => assumption.text !== '')
        .slice(0, LIMITS.assumptions),
      'assumption',
    ),
    likelyStakeholders: tidyList(frame.likelyStakeholders, LIMITS.stakeholder, LIMITS.stakeholders),
  };
}

/** What stops a frame from being used, in words, so that the person can put it right. */
export function frameIssues(frame: ScenarioFrame): string[] {
  const issues: string[] = [];
  if (!frame.decision.trim()) issues.push('Say what decision or event you want to explore.');
  if (!frame.baseline.trim()) issues.push('Say what is expected without the change.');
  if (frame.alternatives.some((alternative) => !alternative.label.trim())) {
    issues.push('Give every alternative a name, or remove it.');
  }
  if (frame.changes.some((change) => !change.name.trim())) {
    issues.push('Name every change, or remove it.');
  }
  return issues;
}

const items = (answer: string): string[] =>
  answer
    .split(/[,;\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);

function assumed(frame: ScenarioFrame, statement: string): ScenarioAssumption[] {
  const entry: ScenarioAssumption = {
    id: newId(
      'answer',
      frame.assumptions.map((assumption) => assumption.id),
    ),
    text: text(statement, LIMITS.assumption),
    origin: 'user',
  };
  return [...frame.assumptions, entry].slice(0, LIMITS.assumptions);
}

const SINGLE_FIELDS: Readonly<Record<string, { key: keyof ScenarioFrame; max: number }>> = {
  decision: { key: 'decision', max: LIMITS.decision },
  system: { key: 'system', max: LIMITS.system },
  geography: { key: 'geography', max: LIMITS.geography },
  horizon: { key: 'horizon', max: LIMITS.horizon },
  baseline: { key: 'baseline', max: LIMITS.baseline },
  requestedDecision: { key: 'requestedDecision', max: LIMITS.requestedDecision },
  desiredOutput: { key: 'desiredOutput', max: LIMITS.desiredOutput },
};

/**
 * Puts a person's answer to one of the questions where it belongs, and takes the question away. An
 * answer to a question about a field that has a place in the frame goes there; one about how success
 * is judged, or about anything else, is kept as an assumption of the person's own.
 */
export function applyAnswer(frame: ScenarioFrame, index: number, answer: string): ScenarioFrame {
  const ambiguity = frame.ambiguities[index];
  const given = answer.trim();
  if (!ambiguity || !given) return frame;
  const rest = frame.ambiguities.filter((_, position) => position !== index);
  // A model may name a field in its own words; the same few meanings are found under any name.
  const field = canonicalField(ambiguity.field);
  const single = SINGLE_FIELDS[field];
  if (single) {
    return edited(frame, { [single.key]: text(given, single.max), ambiguities: rest });
  }
  if (field === 'likelyStakeholders') {
    return edited(frame, {
      likelyStakeholders: tidyList(
        [...frame.likelyStakeholders, ...items(given)],
        LIMITS.stakeholder,
        LIMITS.stakeholders,
      ),
      ambiguities: rest,
    });
  }
  if (field === 'changes') {
    const open = frame.changes.findIndex((change) => change.to === null || change.to === '');
    if (frame.changes.length === 0) {
      return edited(frame, {
        changes: [{ ...blankChange(), name: text(given, LIMITS.variableName) }],
        ambiguities: rest,
      });
    }
    const target = open === -1 ? 0 : open;
    const changes = frame.changes.map((change, position) => {
      if (position !== target) return change;
      return open === -1
        ? { ...change, note: text(`${change.note} ${given}`, LIMITS.variableNote) }
        : { ...change, to: text(given, LIMITS.variableValue) };
    });
    return edited(frame, { changes, ambiguities: rest });
  }
  const statement =
    field === 'success'
      ? `Success is judged by: ${given}`
      : `In answer to "${ambiguity.question ?? ambiguity.message}": ${given}`;
  return edited(frame, { assumptions: assumed(frame, statement), ambiguities: rest });
}

/** Takes a question away without answering it. */
export const skipQuestion = (frame: ScenarioFrame, index: number): ScenarioFrame =>
  edited(frame, { ambiguities: frame.ambiguities.filter((_, position) => position !== index) });

/** How the frame came to be, in words: for the label above it. */
export function originLabel(frame: ScenarioFrame, mode: 'rules' | 'model' | null): string {
  if (frame.origin === 'user') return 'Edited by you';
  return (mode ?? frame.origin) === 'model' ? 'Read by a model' : 'Read by rules, not a model';
}
