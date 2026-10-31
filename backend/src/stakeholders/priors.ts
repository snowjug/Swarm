import type { StakeholderCategory, UnsignedTraitKey } from '../../../shared/stakeholders.js';

/**
 * The category tables behind both halves of this feature. They are lenses, written once and in
 * general terms: nothing in them names a market, a product or an organisation, and every number in
 * them is a modelling assumption that a person can change, never a measurement.
 */

/** How a category usually stands to a change: directly in its path, or by way of others. */
export const CATEGORY_DIRECTNESS: Readonly<Record<StakeholderCategory, 'direct' | 'indirect'>> = {
  'decision-maker': 'direct',
  'end-user': 'direct',
  'cost-bearer': 'direct',
  'risk-bearer': 'direct',
  beneficiary: 'direct',
  influencer: 'indirect',
  competitor: 'indirect',
  substitute: 'indirect',
  partner: 'direct',
  channel: 'direct',
  regulator: 'indirect',
  governance: 'indirect',
  operations: 'direct',
  other: 'indirect',
};

/** The direction a category implies for a change. Only two categories imply one; the rest are unclear. */
export const CATEGORY_IMPACT: Readonly<
  Record<StakeholderCategory, 'harmed' | 'benefited' | 'unclear'>
> = {
  'decision-maker': 'unclear',
  'end-user': 'unclear',
  'cost-bearer': 'harmed',
  'risk-bearer': 'unclear',
  beneficiary: 'benefited',
  influencer: 'unclear',
  competitor: 'unclear',
  substitute: 'unclear',
  partner: 'unclear',
  channel: 'unclear',
  regulator: 'unclear',
  governance: 'unclear',
  operations: 'unclear',
  other: 'unclear',
};

/** What an impact direction becomes as a number on the -1 to 1 scale. */
export const IMPACT_VALUE = { harmed: -0.6, benefited: 0.6, mixed: -0.1, unclear: 0 } as const;

/** Why a stakeholder of this category matters to a change, in general terms. */
export const CATEGORY_RELEVANCE: Readonly<Record<StakeholderCategory, string>> = {
  'decision-maker': 'Can decide whether and how the change goes ahead.',
  'end-user': 'Uses or experiences what the change alters.',
  'cost-bearer': 'Pays or absorbs costs that the change creates or moves.',
  'risk-bearer': 'Is exposed to what could go wrong with the change.',
  beneficiary: 'Stands to gain from the change.',
  influencer: 'Can change how others see and respond to the change.',
  competitor: 'Can respond to the change in its own interest.',
  substitute: 'Offers an alternative that others may turn to.',
  partner: 'Depends on, or is relied on by, the party making the change.',
  channel: 'Stands between the party making the change and those it affects.',
  regulator: 'Sets or enforces rules that the change has to meet.',
  governance: 'Checks, approves or audits the change.',
  operations: 'Carries out or supports the change day to day.',
  other: 'Is named in the evidence; how it relates to the change has not been analysed.',
};

/** What an actor of this category is assumed to want, in general terms. */
export const CATEGORY_PURPOSE: Readonly<Record<StakeholderCategory, string>> = {
  'decision-maker': 'Decide whether and how the change goes ahead.',
  'end-user': 'Keep what they rely on working at a cost and effort they accept.',
  'cost-bearer': 'Limit the cost they bear.',
  'risk-bearer': 'Limit their exposure to harm or disruption.',
  beneficiary: 'Gain from the change.',
  influencer: 'Shape how others see the change.',
  competitor: 'Protect or win position against the party making the change.',
  substitute: 'Offer another way to meet the same need.',
  partner: 'Keep the working relationship worthwhile.',
  channel: 'Keep their own reach and terms workable.',
  regulator: 'Uphold the rules and protect those they oversee.',
  governance: 'Check that the change is lawful, safe and accountable.',
  operations: 'Keep the service running and the workload manageable.',
  other: 'Pursue their own interests.',
};

export interface CategoryPrior {
  traits: Readonly<Record<UnsignedTraitKey, number>>;
  /** Why the numbers are what they are, finishing the sentence "Category prior for <category>:". */
  rationale: string;
}

const prior = (
  values: [number, number, number, number, number, number, number, number, number],
  rationale: string,
): CategoryPrior => {
  const [
    influence,
    openness,
    sensitivity,
    riskTolerance,
    switchingCost,
    trust,
    adoptionTendency,
    authority,
    reactivity,
  ] = values;
  return {
    traits: {
      influence,
      openness,
      sensitivity,
      riskTolerance,
      switchingCost,
      trust,
      adoptionTendency,
      authority,
      reactivity,
    },
    rationale,
  };
};

/**
 * The starting value of each 0 to 1 trait, by category: influence, openness, sensitivity, risk
 * tolerance, switching cost, trust, adoption tendency, authority, reactivity. They are chosen so
 * that categories differ in the directions a reader would expect (a regulator holds authority and
 * moves little; a competitor reacts fast and trusts little), and for no other reason. `priorStance`
 * is 0 for every category, and `impact` comes from the stakeholder's expected impact.
 */
export const CATEGORY_PRIORS: Readonly<Record<StakeholderCategory, CategoryPrior>> = {
  'decision-maker': prior(
    [0.8, 0.3, 0.6, 0.5, 0.5, 0.6, 0.6, 0.9, 0.5],
    'acts on its own mandate, so high authority and influence and little movement by what others do.',
  ),
  'end-user': prior(
    [0.3, 0.5, 0.7, 0.4, 0.5, 0.5, 0.5, 0.1, 0.5],
    'uses what changes and has little power to decide: low authority, moderate openness and sensitivity.',
  ),
  'cost-bearer': prior(
    [0.3, 0.4, 0.8, 0.3, 0.5, 0.4, 0.4, 0.1, 0.6],
    'bears the cost of the change: high sensitivity, low risk tolerance and little power to decide.',
  ),
  'risk-bearer': prior(
    [0.3, 0.4, 0.8, 0.2, 0.5, 0.4, 0.4, 0.1, 0.5],
    'is exposed to what could go wrong: high sensitivity, low risk tolerance and little power to decide.',
  ),
  beneficiary: prior(
    [0.3, 0.6, 0.5, 0.5, 0.4, 0.6, 0.6, 0.1, 0.5],
    'gains from the change: more open and trusting, with moderate sensitivity.',
  ),
  influencer: prior(
    [0.7, 0.5, 0.5, 0.5, 0.2, 0.5, 0.5, 0.2, 0.7],
    'shapes how others see the change: high influence and reactivity, little authority of its own.',
  ),
  competitor: prior(
    [0.5, 0.2, 0.6, 0.6, 0.1, 0.2, 0.5, 0.6, 0.8],
    'answers the change in its own interest: low trust and openness, high reactivity, cheap to switch.',
  ),
  substitute: prior(
    [0.3, 0.3, 0.5, 0.5, 0.2, 0.3, 0.5, 0.3, 0.6],
    'offers another way to meet the same need: moderate sensitivity and cheap to switch.',
  ),
  partner: prior(
    [0.5, 0.5, 0.6, 0.4, 0.6, 0.6, 0.5, 0.4, 0.5],
    'depends on, and is relied on by, the decision maker: trusting, and costly to switch.',
  ),
  channel: prior(
    [0.5, 0.4, 0.7, 0.4, 0.6, 0.5, 0.5, 0.3, 0.6],
    'stands between the decision maker and others: sensitive to terms and costly to switch.',
  ),
  regulator: prior(
    [0.7, 0.2, 0.4, 0.2, 0.2, 0.4, 0.3, 0.9, 0.3],
    'applies rules, not preferences: high authority, low openness and slow to react.',
  ),
  governance: prior(
    [0.5, 0.3, 0.4, 0.2, 0.3, 0.5, 0.3, 0.6, 0.3],
    'checks that the change is lawful, safe and accountable: can stop it, slow to react.',
  ),
  operations: prior(
    [0.4, 0.5, 0.6, 0.4, 0.6, 0.5, 0.5, 0.3, 0.6],
    'keeps things running: sensitive to workload, costly to switch, moderately open.',
  ),
  other: prior(
    [0.4, 0.4, 0.5, 0.4, 0.4, 0.5, 0.5, 0.3, 0.5],
    'no category cue was found, so every trait starts near the middle.',
  ),
};

/** How far members of a cohort differ from its value, as an assumption; a single actor has none. */
export const COHORT_SPREAD = 0.15;
