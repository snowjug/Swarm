import type { SensitivityRow } from '../../../shared/analysis.js';
import type { Critique } from '../../../shared/critique.js';
import { changeCanMoveAnyone } from '../../../shared/signal.js';
import { TRAIT_KEYS, type Actor, type TraitKey } from '../../../shared/stakeholders.js';
import { affectedBy, impactUnder } from './direction.js';
import { draft, fixed, level, names, plural, signed, stableId, whole, words } from './text.js';
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

interface DefaultedActor {
  actor: Actor;
  defaults: TraitKey[];
}

function untouchedDefaults(input: Resolved): Critique[] {
  const flagged = input.actors.actors.flatMap((actor): DefaultedActor[] => {
    if (actor.kind !== 'key' || actor.edited) return [];
    const defaults = TRAIT_KEYS.filter((key) => actor.traits[key].origin === 'system-assumption');
    return defaults.length === 0 ? [] : [{ actor, defaults }];
  });
  if (flagged.length === 0) return [];
  // Where the change cannot move anyone, the defaults of each actor would only bury that.
  if (!input.facts.changeCanMove) return [foldedDefaults(input, flagged)];
  return flagged.map(({ actor, defaults }) =>
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
  );
}

function foldedDefaults(input: Resolved, flagged: DefaultedActor[]): Critique {
  const keyTotal = input.actors.actors.filter((actor) => actor.kind === 'key').length;
  const many = flagged.length !== 1;
  return draft(input.now, {
    id: 'assumption-key-actor-defaults',
    role: ROLE,
    target: whole(input.analysis.id),
    severity: 'minor',
    objection: `${plural(flagged.length, 'key actor')} ${many ? 'have' : 'has'} traits that are system defaults, and nobody has edited ${many ? 'them' : 'it'}.`,
    basis: [
      `Key actors with traits still at their system default: ${flagged.length} of ${keyTotal}.`,
      `Traits at their default: ${names(
        flagged.map(
          ({ actor, defaults }) => `${actor.name} (${defaults.length} of ${TRAIT_KEYS.length})`,
        ),
        4,
      )}.`,
      'Edited by a person: none of them.',
    ],
    impact: `If this stands, how ${many ? 'these actors behave' : 'this actor behaves'} in the simulation reflects defaults rather than a considered view; review the traits that matter most.`,
  });
}

/** A "no difference" result means something only if the assumptions could have registered a difference. */
const ABOUT_THE_SAME = /\babout the same\b/iu;

function noRegisteredEffect(input: Resolved): Critique[] {
  const { analysis } = input;
  const intensityRows = analysis.sensitivity.filter((row) => row.target.kind === 'intensity');
  if (intensityRows.some((row) => row.classification === 'assumption-sensitive')) return [];
  const cast = input.actors.actors;
  const matches = analysis.findings.flatMap((finding) => {
    if (
      finding.kind !== 'direction-vs-baseline' ||
      !ABOUT_THE_SAME.test(finding.statement) ||
      (finding.classification !== 'repeatable' && finding.classification !== 'mostly-repeatable')
    ) {
      return [];
    }
    const variant = analysis.config.variants.find(
      (candidate) => candidate.id === finding.variantId,
    );
    return variant && changeCanMoveAnyone(cast, [variant]) ? [{ finding, variant }] : [];
  });
  const [first, ...others] = matches;
  if (!first) return [];
  const { finding, variant } = first;
  const affected = affectedBy(cast, variant);
  const strongest = Math.max(...affected.map((actor) => Math.abs(impactUnder(actor, variant))));
  const tested = intensityRows[0];
  return [
    draft(input.now, {
      id: 'assumption-no-registered-effect',
      role: ROLE,
      target: { kind: 'finding', id: finding.id },
      severity: 'major',
      objection: `The comparison found no repeatable difference from no change for ${names(matches.map((match) => match.variant.label))}, although some actors do have an expected direction of impact. A result of no difference says something about the change only if the assumptions were strong enough to register an effect, and here they may not be.`,
      basis: [
        `${finding.id}: ${finding.statement}`,
        `Holds in ${finding.holdsIn} of ${finding.of} runs; 95% interval ${fixed(finding.interval.lo)} to ${fixed(finding.interval.hi)}; ${finding.classification}.`,
        `Intensity of ${variant.label}: ${level(variant.intensity)} on a scale from 0 to 1; actors with an expected direction of impact: ${affected.length} of ${cast.length}, the strongest ${fixed(strongest)}.`,
        ...(others.length > 0
          ? [
              `Also about the same: ${names(
                others.map((match) => `${match.variant.label} (${match.finding.id})`),
                3,
              )}.`,
            ]
          : []),
        tested
          ? `Sensitivity on intensity, "${tested.label}": ${tested.classification}, shift ${signed(tested.shift)}.`
          : 'Sensitivity did not test the intensity of the change.',
      ],
      impact:
        'If this stands, “about the same” may only mean that the assumptions were too weak to register an effect, and it cannot be read as evidence that the change makes no difference.',
      action:
        'Raise the intensity of the change, or check the impact each actor is given, then compare again.',
    }),
  ];
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
  ...noRegisteredEffect(input),
  ...sensitiveAssumptions(input),
  ...untouchedDefaults(input),
  ...unconfirmedImpact(input),
];
