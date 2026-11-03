import {
  PARTICIPANT_ROLES,
  PARTICIPANT_ROLE_LABELS,
  type DecisionAuthority,
  type InfluenceLevel,
  type ParticipantRole,
  type Stakeholder,
} from '../../../../shared/stakeholders.js';
import { distinctLines } from './language.js';

/**
 * What each role starts with when nothing in the sources says otherwise. These are defaults for a
 * kind of participant, written in general terms: every one is an assumption, is shown as one, and can
 * be changed by a person. Nothing here names a market, a product or an organisation, and nothing in it
 * says what any real party has done or intends.
 */

export interface RoleDefaults {
  influence: InfluenceLevel;
  decisionAuthority: DecisionAuthority;
  directness: Stakeholder['directness'];
  informationAccess: string[];
  plausibleActions: string[];
  /** Claims about this kind of participant that must never be made, beyond the standing ones. */
  prohibitedClaims: string[];
}

export const ROLE_DEFAULTS: Readonly<Record<ParticipantRole, RoleDefaults>> = {
  'decision-owner': {
    influence: 'high',
    decisionAuthority: 'decides',
    directness: 'direct',
    informationAccess: [
      'Assumed to see its own plans, limits and costs.',
      'Assumed to see what is said in public about the change.',
    ],
    plausibleActions: [
      'Go ahead as planned.',
      'Delay or phase the change.',
      'Change the scope or the terms of the change.',
      'Drop the change.',
    ],
    prohibitedClaims: ['What the real decision maker has decided or intends.'],
  },
  'directly-affected': {
    influence: 'medium',
    decisionAuthority: 'none',
    directness: 'direct',
    informationAccess: [
      'Assumed to see the change when it reaches them.',
      'Assumed to hear about it from the party making it or from others affected.',
    ],
    plausibleActions: [
      'Accept the change.',
      'Ask for different terms or support.',
      'Look for an alternative.',
      'Stop relying on what changed.',
    ],
    prohibitedClaims: ['How any real group has reacted or reacts.'],
  },
  'indirectly-affected': {
    influence: 'low',
    decisionAuthority: 'none',
    directness: 'indirect',
    informationAccess: ['Assumed to learn of the change through others.'],
    plausibleActions: [
      'Wait and watch.',
      'Adjust their own plans to what others do.',
      'Ask those directly affected what is changing.',
    ],
    prohibitedClaims: ['That they are affected unless a source or an assumption here says so.'],
  },
  implementers: {
    influence: 'medium',
    decisionAuthority: 'none',
    directness: 'direct',
    informationAccess: [
      'Assumed to see operating detail that others do not.',
      'Assumed to learn of decisions after they are made.',
    ],
    plausibleActions: [
      'Carry the change out as specified.',
      'Ask for more time or resources.',
      'Raise problems before the change goes live.',
      'Work around a step that does not fit.',
    ],
    prohibitedClaims: ['That the work can be done within a stated effort or time.'],
  },
  approvers: {
    influence: 'high',
    decisionAuthority: 'approves',
    directness: 'indirect',
    informationAccess: ['Assumed to see what is put forward for approval.'],
    plausibleActions: [
      'Approve as put forward.',
      'Approve with conditions.',
      'Ask for more evidence.',
      'Withhold approval.',
    ],
    prohibitedClaims: ['What any real approving body has decided or intends.'],
  },
  beneficiaries: {
    influence: 'low',
    decisionAuthority: 'none',
    directness: 'direct',
    informationAccess: ['Assumed to see the benefit when it reaches them.'],
    plausibleActions: [
      'Welcome and use the change.',
      'Ask for more of the benefit.',
      'Speak up for the change.',
    ],
    prohibitedClaims: ['That they gain, beyond what a cited passage says.'],
  },
  'opponents-resistors': {
    influence: 'medium',
    decisionAuthority: 'none',
    directness: 'direct',
    informationAccess: ['Assumed to hear about the change from those it affects.'],
    plausibleActions: [
      'Object formally.',
      'Slow their cooperation.',
      'Organise others who share the concern.',
      'Ask for an exception.',
    ],
    prohibitedClaims: ['That they act in bad faith.'],
  },
  'regulators-governance': {
    influence: 'high',
    decisionAuthority: 'can-block',
    directness: 'indirect',
    informationAccess: [
      'Assumed to see what must be reported to them.',
      'Assumed not to see internal detail unless they ask for it.',
    ],
    plausibleActions: [
      'Ask for notice or evidence of compliance.',
      'Issue guidance.',
      'Open a review.',
      'Take no action.',
    ],
    prohibitedClaims: ['What any real regulator has decided or intends.'],
  },
  'customers-users': {
    influence: 'medium',
    decisionAuthority: 'none',
    directness: 'direct',
    informationAccess: [
      'Assumed to see the change when it reaches them.',
      'Assumed to compare notes with others in the same position.',
    ],
    plausibleActions: [
      'Keep using it as it is.',
      'Ask for different terms or support.',
      'Change how much they use it.',
      'Switch to an alternative.',
    ],
    prohibitedClaims: ['A share of any real population that holds a view.'],
  },
  'partners-suppliers': {
    influence: 'medium',
    decisionAuthority: 'none',
    directness: 'direct',
    informationAccess: ['Assumed to see the terms of their own arrangement only.'],
    plausibleActions: [
      'Keep working as agreed.',
      'Renegotiate the terms.',
      'Ask for notice and support.',
      'Reduce their commitment.',
    ],
    prohibitedClaims: ['What any named partner or supplier has agreed or intends.'],
  },
  'competitors-alternatives': {
    influence: 'medium',
    decisionAuthority: 'none',
    directness: 'indirect',
    informationAccess: ['Assumed to see only what is public.'],
    plausibleActions: [
      'Hold their position.',
      'Adjust their own offer in response.',
      'Promote themselves as an alternative.',
    ],
    prohibitedClaims: ['What any named competitor intends to do.'],
  },
  'system-environment': {
    influence: 'low',
    decisionAuthority: 'none',
    directness: 'indirect',
    informationAccess: ['Not applicable: a condition acts without knowing anything.'],
    plausibleActions: ['Stay as it is.', 'Shift in a way that changes what others can do.'],
    prohibitedClaims: ['That it behaves like a person or has intentions.'],
  },
  'observers-influencers': {
    influence: 'medium',
    decisionAuthority: 'advises',
    directness: 'indirect',
    informationAccess: ['Assumed to see what is public and what others tell them.'],
    plausibleActions: ['Comment in public.', 'Advise those who decide.', 'Stay out of it.'],
    prohibitedClaims: ['What any named commentator has said or says.'],
  },
  'missing-voices': {
    influence: 'low',
    decisionAuthority: 'none',
    directness: 'indirect',
    informationAccess: ['Assumed not to be told about the change.'],
    plausibleActions: ['Raise the issue if given a way to.', 'Be affected without being heard.'],
    prohibitedClaims: ['That they have been consulted or have agreed.'],
  },
};

/**
 * What must never be asserted about any participant, whoever proposed it. The server puts these on
 * every participant and a person cannot take them off: a participant is a synthetic role, and none of
 * these is something a source or a simulation can show.
 */
export const STANDING_PROHIBITED_CLAIMS: readonly string[] = [
  'That it is a real, identified person.',
  'Its private motives, beliefs or feelings.',
  'That its future conduct is certain.',
  'That its objectives or actions were found in a source, unless a passage is quoted.',
];

/** Words in the question, the scenario or the sources that make a role look material here. `null` means always. */
export const ROLE_CUES: Readonly<Record<ParticipantRole, RegExp | null>> = {
  'decision-owner': null,
  'directly-affected': null,
  'indirectly-affected':
    /\b(?:downstream|indirect(?:ly)?|knock-on|ripple|spill ?over|second-order|neighbouring|surrounding)\b/iu,
  implementers:
    /\b(?:implement|roll ?out|rollout|migrat|deploy|operations|engineer|install|administrat|maintain|support team)\w*/iu,
  approvers:
    /\b(?:approv|sign[- ]?off|authori[sz]|consent|clearance|permit|licen[cs]|committee|board|panel)\w*/iu,
  beneficiaries: /\b(?:benefit|saving|advantage|reward)\w*/iu,
  'opponents-resistors':
    /\b(?:oppos|object(?:ion|ed|s)?|resist|refus|reluctan|unwilling|push(?:es|ed)? back|protest|complain|veto)\w*/iu,
  'regulators-governance':
    /\b(?:regulat|compliance|complian|legal|legislat|audit|polic(?:y|ies)|oversight|ministry|government|watchdog|privacy|inspect|authorit|agenc|council|commission|tribunal)\w*/iu,
  'customers-users':
    /\b(?:customer|client|user|consumer|subscriber|buyer|resident|citizen|visitor|patient|student)\w*/iu,
  'partners-suppliers':
    /\b(?:partner|supplier|vendor|reseller|distributor|contractor|integrator|wholesale|third[- ]party)\w*/iu,
  'competitors-alternatives':
    /\b(?:competitor|competing|rival|alternative|substitut|switch(?:ing)?|incumbent)\w*/iu,
  'system-environment':
    /\b(?:market|platform|ecosystem|infrastructure|seasonal|economy|economic|supply chain)\w*/iu,
  'observers-influencers':
    /\b(?:analyst|journalist|press|media|commentator|influencer|advocacy|advocate|critic|investor|shareholder|association|union)\w*/iu,
  'missing-voices': null,
};

/** The words that count a role, singular then plural, for the sentence that says why the list is what it is. */
export const ROLE_COUNT_PHRASE: Readonly<Record<ParticipantRole, readonly [string, string]>> = {
  'decision-owner': ['decision owner', 'decision owners'],
  'directly-affected': ['group directly affected', 'groups directly affected'],
  'indirectly-affected': ['group indirectly affected', 'groups indirectly affected'],
  implementers: ['implementer', 'implementers'],
  approvers: ['approver', 'approvers'],
  beneficiaries: ['beneficiary', 'beneficiaries'],
  'opponents-resistors': ['possible resistor', 'possible resistors'],
  'regulators-governance': ['regulator or governance body', 'regulators or governance bodies'],
  'customers-users': ['customer or user group', 'customer or user groups'],
  'partners-suppliers': ['partner or supplier', 'partners or suppliers'],
  'competitors-alternatives': ['competitor or alternative', 'competitors or alternatives'],
  'system-environment': ['system or condition', 'systems or conditions'],
  'observers-influencers': ['observer or influencer', 'observers or influencers'],
  'missing-voices': ['voice that may be missing', 'voices that may be missing'],
};

/** Why a role that nobody holds may matter, said when a cue for it was found. */
export const roleGapReason = (role: ParticipantRole, cue: string | null): string => {
  const label = PARTICIPANT_ROLE_LABELS[role].toLowerCase();
  if (role === 'missing-voices') {
    return 'Nobody stands for people the change reaches without their having a say. Ask who is not at the table.';
  }
  if (role === 'decision-owner') {
    return 'A decision has someone who makes it. Name who decides, even if it is you.';
  }
  if (role === 'directly-affected') {
    return 'A change lands on someone. Name who feels it first.';
  }
  return cue
    ? `The question or the sources mention “${cue}”, but nobody holds the role of ${label}.`
    : `Nobody holds the role of ${label}.`;
};

/** The standing prohibitions, then those of the role, then the participant's own, as one bounded list. */
export const withStandingClaims = (role: ParticipantRole, own: readonly string[]): string[] =>
  distinctLines(
    [...STANDING_PROHIBITED_CLAIMS, ...ROLE_DEFAULTS[role].prohibitedClaims, ...own],
    10,
    200,
  );

export const ROLE_ORDER: readonly ParticipantRole[] = PARTICIPANT_ROLES;
