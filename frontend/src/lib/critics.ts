import {
  CRITIC_ROLES,
  CRITIC_ROLE_LABELS,
  CRITIC_ROLE_QUESTIONS,
  CRITIQUE_SEVERITIES,
  CRITIQUE_STATUSES,
  type CriticRole,
  type Critique,
  type CritiqueResponseStatus,
  type CritiqueSet,
  type CritiqueSeverity,
  type CritiqueStatus,
  type CritiquesView,
} from '../../../shared/critique';

/** How a severity reads, in words, so that colour is never the only cue. */
export const SEVERITY_VIEW: Record<CritiqueSeverity, { label: string; meaning: string }> = {
  blocking: {
    label: 'Blocking',
    meaning: 'Settle this before the result is used: it could undo the conclusion.',
  },
  major: { label: 'Major', meaning: 'Could change the conclusion.' },
  minor: { label: 'Minor', meaning: 'Worth checking; unlikely to change the conclusion alone.' },
  note: { label: 'Note', meaning: 'For the record.' },
};

export const STATUS_VIEW: Record<CritiqueStatus, { label: string; meaning: string }> = {
  open: { label: 'Open', meaning: 'Nobody has answered this yet.' },
  responded: {
    label: 'Responded',
    meaning: 'Answered, but not settled: the objection and its impact stay in view.',
  },
  accepted: {
    label: 'Accepted',
    meaning: 'The objection stands, so its impact applies to the conclusion.',
  },
  disputed: {
    label: 'Disputed',
    meaning: 'The objection is disputed, and the disagreement stays in view.',
  },
};

export const ORIGIN_VIEW: Record<Critique['origin'], { label: string; meaning: string }> = {
  rules: {
    label: 'Rules check',
    meaning: 'A fixed rule applied to the data: the same input always gives the same criticism.',
  },
  model: {
    label: 'Model review',
    meaning:
      'A model’s reading of a digest of the analysis. Checked against the ids it was given, but still a model’s opinion.',
  },
};

/** What each answer means. Only a person can give one. */
export const RESPONSE_ACTIONS: {
  status: CritiqueResponseStatus;
  label: string;
}[] = [
  { status: 'responded', label: 'Respond' },
  { status: 'accepted', label: 'Accept the objection' },
  { status: 'disputed', label: 'Dispute it' },
];

export interface ReviewSummary {
  total: number;
  bySeverity: Record<CritiqueSeverity, number>;
  byStatus: Record<CritiqueStatus, number>;
}

export function summarise(critiques: readonly Critique[]): ReviewSummary {
  const bySeverity = Object.fromEntries(CRITIQUE_SEVERITIES.map((s) => [s, 0])) as Record<
    CritiqueSeverity,
    number
  >;
  const byStatus = Object.fromEntries(CRITIQUE_STATUSES.map((s) => [s, 0])) as Record<
    CritiqueStatus,
    number
  >;
  for (const critique of critiques) {
    bySeverity[critique.severity] += 1;
    byStatus[critique.status] += 1;
  }
  return { total: critiques.length, bySeverity, byStatus };
}

export interface RoleGroup {
  role: CriticRole;
  label: string;
  /** The question this critic asks, which is what the group is headed with. */
  question: string;
  critiques: Critique[];
}

/** The critiques by role, in the order of the roles, each in the order the server gave them. */
export function groupByRole(critiques: readonly Critique[]): RoleGroup[] {
  return CRITIC_ROLES.flatMap((role) => {
    const own = critiques.filter((critique) => critique.role === role);
    return own.length === 0
      ? []
      : [
          {
            role,
            label: CRITIC_ROLE_LABELS[role],
            question: CRITIC_ROLE_QUESTIONS[role],
            critiques: own,
          },
        ];
  });
}

export function targetLabel(target: Critique['target']): string {
  switch (target.kind) {
    case 'analysis':
      return 'The analysis as a whole';
    case 'brief':
      return 'The decision brief';
    case 'finding':
      return `Finding ${target.id}`;
    case 'stakeholder':
      return `Stakeholder ${target.id}`;
    case 'assumption':
      return `Assumption ${target.id}`;
    case 'recommendation':
      return `Recommendation ${target.id}`;
    case 'statement':
      return `Statement ${target.id}`;
  }
}

/** What the impact heading says, which depends on what the person has done with the objection. */
export function impactHeading(status: CritiqueStatus): string {
  switch (status) {
    case 'accepted':
      return 'Accepted: this applies to the conclusion';
    case 'disputed':
      return 'Disputed: this is what is contested';
    default:
      return 'Effect on the conclusion, if it stands';
  }
}

/** The day, from an ISO time, so that it reads the same in every time zone. */
export const day = (iso: string): string => iso.slice(0, 10);

/** The review was made for an analysis other than the newest finished one. */
export function isOutOfDate(view: CritiquesView): boolean {
  return (
    view.critiques !== null &&
    view.analysis !== null &&
    view.critiques.analysisId !== view.analysis.id
  );
}

export function modeText(mode: CritiqueSet['mode']): string {
  return mode === 'rules'
    ? 'Deterministic checks only'
    : mode === 'model'
      ? 'Model review only'
      : 'Deterministic checks and a model review';
}
