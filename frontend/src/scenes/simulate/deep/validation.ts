import { branchInputSchema, environmentUpdateSchema } from '../../../../../shared/guided';
import type { BranchInput, EnvironmentUpdate } from '../../../../../shared/guided';
import type { Intervention, ProjectDetail } from '../../../../../shared/types';
import { maxBranchRound, validateBranch, validateIntervention } from '../../../lib/whatIf';
import { maxRoundsFor } from './model';

/**
 * Field by field checks for the forms of the deep dive, so that a mistake is said where it is made and
 * as it is made. The server's own schemas (`shared/guided`) and the old workspace's rules (`lib/whatIf`)
 * stay the authority: they are run last, and a form is only sent when they accept it.
 */

interface Issue {
  code: string;
  path: PropertyKey[];
  message: string;
  origin?: string;
}

interface Rule {
  min: number;
  max: number;
  /** A count of characters, not a number. */
  text?: true;
  whole?: true;
}

const RULES: Record<string, Rule> = {
  rounds: { min: 3, max: 24, whole: true },
  minutesPerRound: { min: 5, max: 180, whole: true },
  'initialPosts.*.text': { min: 10, max: 500, text: true },
  'initialPosts.*.stance': { min: -1, max: 1 },
  'initialPosts.*.strength': { min: 0, max: 1 },
  'agents.*.name': { min: 3, max: 100, text: true },
  'agents.*.role': { min: 3, max: 100, text: true },
  'agents.*.persona': { min: 30, max: 700, text: true },
  'agents.*.initialOpinion': { min: -1, max: 1 },
  'agents.*.influence': { min: 0.1, max: 2 },
  'agents.*.openness': { min: 0, max: 1 },
};

const MINUS = '\u2212';
const num = (value: number): string => (value < 0 ? `${MINUS}${Math.abs(value)}` : String(value));

export function rangeText(rule: Rule): string {
  return rule.text
    ? `Use ${rule.min} to ${rule.max} characters.`
    : `Use ${rule.whole ? 'a whole number' : 'a number'} from ${num(rule.min)} to ${num(rule.max)}.`;
}

const shape = (path: readonly PropertyKey[]): string =>
  path.map((part) => (typeof part === 'number' ? '*' : String(part))).join('.');
const keyOf = (path: readonly PropertyKey[]): string => path.map(String).join('.');

function say(issue: Issue): string {
  const rule = RULES[shape(issue.path)];
  if (issue.code === 'invalid_type') return 'Enter a number.';
  if (
    rule &&
    (issue.code === 'too_small' || issue.code === 'too_big' || issue.code === 'not_multiple_of')
  )
    return rangeText(rule);
  if (issue.code === 'invalid_type' || issue.code === 'invalid_value') return 'Check this value.';
  return issue.message;
}

export interface Check<Keys extends string = string> {
  ok: boolean;
  /** What is wrong, by the field it is wrong in. */
  fields: Partial<Record<Keys | 'form', string>>;
}

// ---- The environment --------------------------------------------------------------------------------------

export interface EnvironmentCheck extends Check {
  data: EnvironmentUpdate | null;
}

/** Fields are keyed like their path in the update: `rounds`, `initialPosts.0.text`, `agents.2.persona`. */
export function checkEnvironment(
  draft: EnvironmentUpdate,
  project: Pick<ProjectDetail, 'mode'>,
): EnvironmentCheck {
  const fields: EnvironmentCheck['fields'] = {};
  const parsed = environmentUpdateSchema.safeParse(draft);
  if (!parsed.success) {
    for (const issue of parsed.error.issues as unknown as Issue[]) {
      const key = keyOf(issue.path);
      if (key in fields) continue;
      if (key === 'platforms') {
        fields.platforms =
          issue.code === 'too_small'
            ? 'Run at least one platform.'
            : 'Select each platform only once.';
      } else if (key === 'agents' || key === '') {
        fields.form = issue.message;
      } else {
        fields[key] = say(issue);
      }
    }
  }
  const limit = maxRoundsFor(project);
  if (!fields.rounds && draft.rounds > limit)
    fields.rounds = `This mode supports at most ${limit} rounds.`;
  const ok = Object.keys(fields).length === 0;
  return { ok, fields, data: ok && parsed.success ? parsed.data : null };
}

// ---- The scheduled intervention ---------------------------------------------------------------------------

export interface InterventionDraft {
  round: number;
  label: string;
  stance: number;
  strength: number;
}

export type InterventionField = keyof InterventionDraft;

const finite = (value: number): boolean => Number.isFinite(value);

export function checkIntervention(
  draft: InterventionDraft,
  bounds: { minRound: number; maxRound: number },
): Check<InterventionField> {
  const fields: Check<InterventionField>['fields'] = {};
  const { minRound, maxRound } = bounds;
  if (minRound > maxRound) fields.form = 'There is no round left to schedule it in.';
  else if (!Number.isInteger(draft.round) || draft.round < minRound || draft.round > maxRound)
    fields.round =
      minRound === maxRound
        ? `Only round ${minRound} is left.`
        : `Choose a round from ${minRound} to ${maxRound}.`;
  const label = draft.label.trim();
  if (label.length < 5 || label.length > 300)
    fields.label = 'Describe the event in 5 to 300 characters.';
  if (!finite(draft.stance) || draft.stance < -1 || draft.stance > 1)
    fields.stance = `Use a number from ${MINUS}1 to 1.`;
  if (!finite(draft.strength) || draft.strength < 0 || draft.strength > 1)
    fields.strength = 'Use a number from 0 to 1.';
  return { ok: Object.keys(fields).length === 0, fields };
}

export const interventionOf = (draft: InterventionDraft): Intervention => ({
  round: draft.round,
  label: draft.label.trim(),
  stance: draft.stance,
  strength: draft.strength,
});

/** The last gate before a schedule is sent: the field checks, then the old workspace's rule on the round. */
export function checkScheduled(
  draft: InterventionDraft,
  project: ProjectDetail,
): Check<InterventionField> & { data: Intervention | null } {
  const check = checkIntervention(draft, {
    minRound: project.currentRound + 1,
    maxRound: project.roundCount,
  });
  if (!check.ok) return { ...check, data: null };
  const result = validateIntervention(interventionOf(draft), project);
  if (result.error) return { ok: false, fields: { form: result.error }, data: null };
  return { ok: true, fields: {}, data: result.data ?? null };
}

export function startingIntervention(project: ProjectDetail): InterventionDraft {
  const existing = project.settings.intervention;
  return {
    round: Math.min(
      project.roundCount,
      Math.max(project.currentRound + 1, existing?.round ?? project.currentRound + 1),
    ),
    label: existing?.label ?? '',
    stance: existing?.stance ?? 0,
    strength: existing?.strength ?? 0.5,
  };
}

// ---- Branching --------------------------------------------------------------------------------------------

export type InterventionChoice = 'inherit' | 'remove' | 'replace';

export type ProxyEdit = NonNullable<BranchInput['agentEdits']>[number];
export type ProxyEditField = 'influence' | 'openness' | 'opinion';

export const PROXY_EDIT_RULES: Record<ProxyEditField, { label: string; min: number; max: number }> =
  {
    opinion: { label: 'Inclination', min: -1, max: 1 },
    influence: { label: 'Influence', min: 0.1, max: 2 },
    openness: { label: 'Openness', min: 0, max: 1 },
  };

export interface BranchDraft {
  fromRound: number;
  name: string;
  choice: InterventionChoice;
  intervention: InterventionDraft;
  edits: ProxyEdit[];
}

export function startingBranch(project: ProjectDetail, fromRound?: number): BranchDraft {
  const maximum = maxBranchRound(project);
  const from = Math.min(maximum, Math.max(0, fromRound ?? maximum));
  return {
    fromRound: from,
    name: '',
    choice: 'inherit',
    intervention: {
      round: Math.min(project.roundCount, from + 1),
      label: '',
      stance: 0,
      strength: 0.5,
    },
    edits: [],
  };
}

/** The request this draft would send. */
export function branchInput(draft: BranchDraft): BranchInput {
  const name = draft.name.trim();
  return {
    ...(name ? { name } : {}),
    fromRound: draft.fromRound,
    ...(draft.choice === 'remove'
      ? { intervention: null }
      : draft.choice === 'replace'
        ? { intervention: interventionOf(draft.intervention) }
        : {}),
    agentEdits: draft.edits,
  };
}

/** The round in which a recorded run applied its one intervention, among the rounds it saved. */
export function appliedRound(project: Pick<ProjectDetail, 'rounds'>): number | null {
  return project.rounds.find((round) => round.intervention)?.round ?? null;
}

export type BranchField =
  | 'fromRound'
  | 'name'
  | 'choice'
  | `edit.${number}`
  | `edit.${number}.${ProxyEditField}`
  | `intervention.${InterventionField}`;

export interface BranchCheck extends Check<BranchField> {
  input: BranchInput | null;
}

export function checkBranch(draft: BranchDraft, project: ProjectDetail): BranchCheck {
  const fields: BranchCheck['fields'] = {};
  const maximum = maxBranchRound(project);
  if (!Number.isInteger(draft.fromRound) || draft.fromRound < 0 || draft.fromRound > maximum)
    fields.fromRound = `Choose a checkpoint from round 0 to ${maximum}.`;
  const name = draft.name.trim();
  if (name && (name.length < 3 || name.length > 100))
    fields.name = 'A name is 3 to 100 characters, or leave it blank.';

  if (draft.choice !== 'inherit') {
    const applied = appliedRound(project);
    if (applied !== null && applied <= draft.fromRound) {
      fields.choice = `Round ${applied} already applied this run’s event, and it is copied. Inherit it, or branch from round ${applied - 1} or earlier.`;
    }
  }
  if (draft.choice === 'replace') {
    const inner = checkIntervention(draft.intervention, {
      minRound: draft.fromRound + 1,
      maxRound: project.roundCount,
    });
    for (const [key, message] of Object.entries(inner.fields)) {
      if (key === 'form') fields.choice ??= message;
      else fields[`intervention.${key as InterventionField}`] = message;
    }
  }

  const seen = new Set<string>();
  draft.edits.forEach((edit, index) => {
    if (!project.agents.some((agent) => agent.id === edit.id))
      fields[`edit.${index}`] = 'Choose a proxy from this run.';
    else if (seen.has(edit.id)) fields[`edit.${index}`] = 'Each proxy can be edited once.';
    seen.add(edit.id);
    let changed = false;
    for (const field of Object.keys(PROXY_EDIT_RULES) as ProxyEditField[]) {
      const value = edit[field];
      if (value === undefined) continue;
      changed = true;
      const rule = PROXY_EDIT_RULES[field];
      if (!finite(value) || value < rule.min || value > rule.max)
        fields[`edit.${index}.${field}`] =
          `Use a number from ${num(rule.min)} to ${num(rule.max)}.`;
    }
    if (!changed && !fields[`edit.${index}`])
      fields[`edit.${index}`] = 'Change at least one of influence, openness or inclination.';
  });

  if (Object.keys(fields).length > 0) return { ok: false, fields, input: null };

  const input = branchInput(draft);
  const shaped = branchInputSchema.safeParse(input);
  if (!shaped.success)
    return {
      ok: false,
      fields: { form: shaped.error.issues.map((item) => item.message).join(' ') },
      input: null,
    };
  const result = validateBranch(input, project);
  if (result.error) return { ok: false, fields: { form: result.error }, input: null };
  return { ok: true, fields: {}, input: result.data ?? null };
}

/** What creating the branch would do, in a few plain lines, for the person to check before they do it. */
export function branchSummary(draft: BranchDraft, project: ProjectDetail): string[] {
  const lines = [
    draft.fromRound === 0
      ? 'Starts again from round 1. No rounds are copied.'
      : `Copies rounds 1 to ${draft.fromRound} unchanged.`,
  ];
  const own = project.settings.intervention;
  if (draft.choice === 'remove')
    lines.push(own ? 'Removes the scheduled event.' : 'There is no scheduled event to remove.');
  else if (draft.choice === 'replace')
    lines.push(`Schedules a new event before round ${draft.intervention.round}.`);
  else if (own) lines.push(`Keeps the scheduled event before round ${own.round}.`);
  if (draft.edits.length > 0)
    lines.push(
      `Changes ${draft.edits.length === 1 ? 'one proxy' : `${draft.edits.length} proxies`}.`,
    );
  return lines;
}
