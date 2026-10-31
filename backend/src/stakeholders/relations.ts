import {
  STAKEHOLDER_CATEGORIES,
  type RelationType,
  type Stakeholder,
  type StakeholderCategory,
  type StakeholderRelation,
} from '../../../shared/stakeholders.js';

const MAX_RELATIONS = 160;

interface Rule {
  from: StakeholderCategory[];
  to: StakeholderCategory[];
  type: RelationType;
  strength: number;
  why: string;
}

const AFFECTED: StakeholderCategory[] = ['end-user', 'cost-bearer'];

const RULES: readonly Rule[] = [
  {
    from: ['competitor'],
    to: AFFECTED,
    type: 'competes-with',
    strength: 0.5,
    why: 'a competitor competes for the same end users',
  },
  {
    from: ['regulator'],
    to: ['decision-maker'],
    type: 'regulates',
    strength: 0.6,
    why: 'a regulator oversees the party making the change',
  },
  {
    from: ['partner'],
    to: ['decision-maker'],
    type: 'partners-with',
    strength: 0.5,
    why: 'a partner works with the party making the change',
  },
  {
    from: ['channel'],
    to: AFFECTED,
    type: 'supplies',
    strength: 0.5,
    why: 'a channel reaches end users on behalf of the party making the change',
  },
  {
    from: ['substitute'],
    to: ['decision-maker'],
    type: 'substitutes-for',
    strength: 0.4,
    why: 'a substitute offers an alternative to what the decision maker provides',
  },
  {
    from: ['influencer'],
    to: [...AFFECTED, 'decision-maker'],
    type: 'influences',
    strength: 0.3,
    why: 'an influencer shapes how others see the change',
  },
  {
    from: ['governance'],
    to: ['decision-maker'],
    type: 'influences',
    strength: 0.4,
    why: 'governance can hold up or shape the decision',
  },
  {
    from: AFFECTED,
    to: ['decision-maker'],
    type: 'depends-on',
    strength: 0.4,
    why: 'end users rely on what the decision maker provides',
  },
];

/**
 * The relations that follow from categories alone: a competitor competes for end users, a regulator
 * oversees the decision maker, and so on. They are assumptions, said to be so in each rationale, and
 * are not found in any source.
 */
export function deriveRelations(stakeholders: readonly Stakeholder[]): StakeholderRelation[] {
  const live = stakeholders.filter((stakeholder) => stakeholder.status !== 'removed');
  const relations: StakeholderRelation[] = [];
  const seen = new Set<string>();
  for (const rule of RULES) {
    for (const from of live.filter((item) => rule.from.includes(item.category))) {
      for (const to of live.filter((item) => rule.to.includes(item.category))) {
        const mark = `${from.id}|${to.id}|${rule.type}`;
        if (from.id === to.id || seen.has(mark)) continue;
        seen.add(mark);
        relations.push({
          from: from.id,
          to: to.id,
          type: rule.type,
          strength: rule.strength,
          rationale: `Assumed from categories, not found in the sources: ${rule.why}.`,
        });
      }
    }
  }
  return relations.slice(0, MAX_RELATIONS);
}

/** The categories (never "other") that no stakeholder, not removed, belongs to. */
export function categoryGaps(stakeholders: readonly Stakeholder[]): StakeholderCategory[] {
  const present = new Set(
    stakeholders
      .filter((stakeholder) => stakeholder.status !== 'removed')
      .map((stakeholder) => stakeholder.category),
  );
  return STAKEHOLDER_CATEGORIES.filter(
    (category) => category !== 'other' && !present.has(category),
  );
}

/** A gap that names a category, as opposed to a role in the model's or the person's own words. */
export function isCategoryGap(gap: string): gap is StakeholderCategory {
  return (STAKEHOLDER_CATEGORIES as readonly string[]).includes(gap);
}
