import type { SensitivityRow } from '../../../shared/analysis.js';
import type { Critique } from '../../../shared/critique.js';
import { TRAIT_KEYS } from '../../../shared/stakeholders.js';
import { draft, fixed, names, signed, stableId, whole, words } from './text.js';
import type { Resolved, RoleCritic } from './types.js';

/** Which assumptions carry the result, and does anything support them? */
const ROLE = 'assumption' as const;

const ORIGIN_PHRASE: Record<SensitivityRow['assumptionOrigin'], string> = {
  'system-assumption': 'a system assumption with no evidence behind it',
  model: 'a value a model proposed, not tied to cited evidence',
  user: 'a value a person set, without cited evidence',
  scenario: 'a value taken from the scenario as written',
  evidence: 'a value taken from cited evidence',
};

function sensitiveAssumptions(input: Resolved): Critique[] {
  return input.analysis.sensitivity
    .filter(
      (row) => row.classification === 'assumption-sensitive' && row.assumptionOrigin !== 'evidence',
    )
    .map((row) => {
      const unsupported = row.assumptionOrigin === 'system-assumption';
      return draft(input.now, {
        id: stableId('assumption-sensitive', row.id),
        role: ROLE,
        target: { kind: 'assumption', id: row.id },
        severity: unsupported ? 'major' : 'minor',
        objection: unsupported
          ? `The result moves when "${row.label}" is changed, and nothing supports that assumption: it is a system assumption with no evidence.`
          : `The result moves when "${row.label}" is changed, and the value rests on ${ORIGIN_PHRASE[row.assumptionOrigin]}.`,
        basis: [
          `Tested: ${row.label} (change of ${signed(row.perturbation)}).`,
          `Headline measure: ${row.metric}; shift ${signed(row.shift)} with standard error ${fixed(row.standardError)}, from a base of ${fixed(row.baseMean)}.`,
          `Origin of the assumption: ${row.assumptionOrigin}.`,
        ],
        impact: unsupported
          ? 'If this stands, the headline result is only as good as one unevidenced number; present it as conditional on that number until it is checked.'
          : 'If this stands, the headline result depends on a value nobody has backed with evidence; say so wherever the result is used.',
      });
    });
}

function untouchedDefaults(input: Resolved): Critique[] {
  return input.actors.actors.flatMap((actor) => {
    if (actor.kind !== 'key' || actor.edited) return [];
    const defaults = TRAIT_KEYS.filter((key) => actor.traits[key].origin === 'system-assumption');
    if (defaults.length === 0) return [];
    return [
      draft(input.now, {
        id: stableId('assumption-defaults', actor.id),
        role: ROLE,
        target: { kind: 'stakeholder', id: actor.stakeholderId },
        severity: 'minor',
        objection: `${actor.name} is a key actor, and ${defaults.length} of its ${TRAIT_KEYS.length} traits are system defaults that nobody has edited.`,
        basis: [
          `Traits still at their system default: ${names(defaults.map(words), 6)}.`,
          'Edited by a person: no.',
        ],
        impact: `If this stands, how ${actor.name} behaves in the simulation reflects defaults rather than a considered view of them; review the traits that matter most.`,
      }),
    ];
  });
}

function unconfirmedImpact(input: Resolved): Critique[] {
  const actors = input.actors.actors;
  const unconfirmed = actors.filter((actor) => {
    const { origin, value } = actor.traits.impact;
    return (origin === 'system-assumption' || origin === 'model') && value !== 0;
  });
  if (unconfirmed.length === 0) return [];
  const key = unconfirmed.filter((actor) => actor.kind === 'key').length;
  const keyTotal = actors.filter((actor) => actor.kind === 'key').length;
  return [
    draft(input.now, {
      id: 'assumption-unconfirmed-impact',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: key > 0 ? 'major' : 'minor',
      objection: `${unconfirmed.length} of ${actors.length} actors have an impact direction, harmed or benefited, that no person confirmed and no evidence supports, and it decides which way each of them moves.`,
      basis: [
        `Direction not confirmed: ${names(unconfirmed.map((actor) => `${actor.name} (${actor.traits.impact.value < 0 ? 'harmed' : 'benefited'})`))}.`,
        `Key actors among them: ${key} of ${keyTotal}.`,
        'Confirmed means set by a person or taken from cited evidence.',
      ],
      impact:
        'If this stands, the direction of the results could reverse if one of these signs is wrong; confirm the signs before relying on the direction.',
    }),
  ];
}

export const assumptionCritic: RoleCritic = (input) => [
  ...sensitiveAssumptions(input),
  ...untouchedDefaults(input),
  ...unconfirmedImpact(input),
];
