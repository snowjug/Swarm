import {
  RESPONSE_CATEGORIES,
  RESPONSE_LABELS,
  type Finding,
  type SimEvent,
} from '../../../shared/analysis.js';
import type { BriefSection } from '../../../shared/brief.js';
import {
  EXTERNAL_RESPONDER_CATEGORIES,
  STAKEHOLDER_CATEGORY_LABELS,
  type Actor,
} from '../../../shared/stakeholders.js';
import { MATERIAL_SHIFT, ROBUST_SHIFT } from '../analysis/sensitivity.js';
import type { Facts } from './facts.js';
import { aboutAdverseShare, actorMeasure, findingsFor, pairShares } from './measures.js';
import { readingNote } from './signal.js';
import { impactOwner, sensitivityContext } from './assumptions.js';
import {
  RESOLUTION_NOTE,
  approx,
  decimals,
  embed,
  groupOutcome,
  listed,
  perHundred,
  plural,
  signed,
  signedPerHundred,
} from './text.js';
import { classWords, intervalWords } from './sections-answer.js';
import { sectionWriter, type Tally } from './writer.js';

const stabilityText = (finding: Finding): string =>
  `It held in ${finding.holdsIn} of ${finding.of} seeded simulated runs (${intervalWords(finding)}; ${classWords(finding.classification)})`;

export function reactionPatterns(facts: Facts, tally: Tally): BriefSection {
  const writer = sectionWriter('reaction-patterns', tally);
  const { analysis, baseline, headline } = facts;
  const { state } = facts.signal;
  const note = readingNote(facts.signal);
  if (note) writer.add(note);
  if (facts.measures.length === 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'The analysis recorded no simulated runs, so there are no reaction patterns to report.',
    });
  }
  for (const measure of facts.measures) {
    const parts = RESPONSE_CATEGORIES.map(
      (category) =>
        `${RESPONSE_LABELS[category].toLowerCase()} ${perHundred(measure.shares[category].mean)}`,
    );
    // The distribution is a mean over the runs; the one finding that bears on it is the comparison of the variant with the baseline.
    const related = findingsFor(analysis, {
      variantId: measure.variant.id,
      actorId: null,
      kind: 'direction-vs-baseline',
    });
    const range =
      measure.share.min === null || measure.share.max === null
        ? ''
        : ` The share looking for an alternative or resisting ranged from ${perHundred(measure.share.min)} to ${perHundred(measure.share.max)} in 100 across runs.`;
    let counted: string;
    if (measure.members === null || measure.adverseCount === null) {
      counted =
        ' No count of sampled members is stated: the stored analysis kept no per-actor results to add up.';
    } else {
      const spread =
        measure.adverseCount.min === null || measure.adverseCount.max === null
          ? ' (a mean; the per-run results were not stored, so no range across runs is stated)'
          : ` (from ${approx(measure.adverseCount.min)} to ${approx(measure.adverseCount.max)} across runs)`;
      counted = ` Counted as sampled members that is about ${approx(measure.adverseCount.mean)} of ${measure.members} simulated members in a run${spread}; ${RESOLUTION_NOTE}.`;
    }
    writer.add({
      origin: 'simulation-aggregation',
      text: `Under ${embed(measure.variant.label, 80)}, counting each simulated actor equally, the mean simulated outcome across ${measure.runs.length} seeded runs was, in every 100 simulated members: ${parts.join(', ')}.${range}${counted}`,
      refs: { findingIds: related.map((finding) => finding.id), variantIds: [measure.variant.id] },
      reliance: related.length > 0 ? facts.relianceOf(related) : null,
    });
  }
  if (headline) {
    const { variant } = headline;
    const runs = variant.runs.length;
    const ranked = analysis.actors
      .flatMap((actor) => {
        const measure = actorMeasure(variant, actor.id);
        return measure && measure.adverseShare > 0 ? [{ actor, measure }] : [];
      })
      .sort(
        (a, b) =>
          b.measure.adverseShare - a.measure.adverseShare || (a.actor.id < b.actor.id ? -1 : 1),
      )
      .slice(0, 6);
    if (variant.detail === 'none') {
      // An absent list is not a group that did nothing: nothing is said of any group.
      writer.add({
        origin: 'unresolved-uncertainty',
        text: `The outcome of each group is not stated for ${embed(variant.variant.label, 80)}: the stored analysis kept no per-actor results, so no group’s own share can be worked out.`,
        refs: { variantIds: [variant.variant.id] },
      });
    } else if (ranked.length === 0) {
      writer.add({
        origin: 'simulation-aggregation',
        text: `No simulated member ended up looking for an alternative or resisting under ${embed(variant.variant.label, 80)} in any seeded run.`,
        refs: { variantIds: [variant.variant.id] },
      });
    }
    for (const { actor, measure } of ranked) {
      // What the group's own share rests on is the finding that its largest response was the adverse one, if there is one.
      const own = findingsFor(analysis, {
        variantId: variant.variant.id,
        actorId: actor.id,
      }).filter(aboutAdverseShare);
      const base = baseline ? actorMeasure(baseline, actor.id) : null;
      const against =
        base && baseline && state === 'clear'
          ? `, against ${measure.members === 1 ? `${Math.round(base.adverseShare * runs)} of ${runs} runs` : `about ${approx(base.adverse)}`} under ${embed(baseline.variant.label, 60)}`
          : '';
      writer.add({
        origin: 'actor-behavior',
        text: `Simulated ${embed(actor.name, 60)} (${STAKEHOLDER_CATEGORY_LABELS[actor.category]}, ${measure.members} simulated ${plural(measure.members, 'member')}): under ${embed(variant.variant.label, 60)} ${groupOutcome(measure, runs)}${against}; mean final stance ${signed(measure.stance)}.`,
        refs: {
          stakeholderIds: [actor.stakeholderId],
          findingIds: own.map((finding) => finding.id),
          variantIds: [variant.variant.id],
        },
        reliance: own.length > 0 ? facts.relianceOf(own) : null,
      });
    }
    for (const finding of findingsFor(analysis, {
      variantId: variant.variant.id,
      kind: 'majority-response',
    }).slice(0, 4)) {
      writer.add({
        origin: 'simulation-aggregation',
        text: `Finding: ${embed(finding.statement, 300)} ${stabilityText(finding)}.`,
        refs: { findingIds: [finding.id], variantIds: [finding.variantId] },
        reliance: facts.relianceOf([finding]),
      });
    }
  }
  writer.add({
    origin: 'system-assumption',
    text: `Counts of simulated members in this brief depend on how many members were sampled for each group, which is a numerical resolution set when the actors were made, not a population. Options are compared by the share of each actor’s own members, with every actor counting equally, and are never ranked by member counts.`,
    refs: { assumptions: ['Sampled member counts are a numerical resolution, not a population.'] },
  });
  writer.add({
    origin: 'system-assumption',
    text: 'The responses (go along, accept with conditions, wait and see, adapt, look for an alternative, resist) are readings of where each simulated member ends, from its final stance and how costly it is to switch. They are not observed behaviour.',
    refs: { assumptions: ['Response categories are readings of final simulated stance.'] },
  });
  return writer.build(['outcome-distribution']);
}

export function alternativeOutcomes(facts: Facts, tally: Tally): BriefSection {
  const writer = sectionWriter('alternative-outcomes', tally);
  const { analysis, baseline, measures } = facts;
  const { state } = facts.signal;
  const alternatives = measures.filter((measure) => measure.variant.kind === 'alternative');
  const note = readingNote(facts.signal);
  if (note) writer.add(note);
  if (!baseline) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'No baseline was run, so the alternatives cannot be compared with leaving things as they are.',
    });
  }
  for (const measure of alternatives) {
    if (!baseline) break;
    // With no one to move, a count that differs from the baseline's is noise, so none is put as a result.
    if (state === 'no-direction') continue;
    const pairing = pairShares(measure.runs, baseline.runs);
    const direction = findingsFor(analysis, {
      variantId: measure.variant.id,
      actorId: null,
      kind: 'direction-vs-baseline',
    });
    const refs = {
      findingIds: direction.map((finding) => finding.id),
      variantIds: [measure.variant.id, baseline.variant.id],
    };
    const reliance = direction.length > 0 ? facts.relianceOf(direction) : null;
    // Each scenario is read on its own findings: only one that came out about the same is worded so.
    if (state === 'no-difference' && facts.signal.sameAs.has(measure.variant.id)) {
      writer.add({
        origin: 'simulation-aggregation',
        text: `Against ${embed(baseline.variant.label, 60)}, ${embed(measure.variant.label, 60)} moved the mean final stance of simulated members by ${signed(pairing.stanceDelta)} on a scale from -1 to 1 (mean over ${pairing.pairs} paired seeds), which the comparison reads as about the same.`,
        refs,
        reliance,
      });
      continue;
    }
    const here = embed(measure.variant.label, 60);
    const there = embed(baseline.variant.label, 60);
    if (pairing.pairs === 0) {
      writer.add({
        origin: 'simulation-aggregation',
        text: `${here} could not be paired with ${there} on the same seeded simulated runs, so no paired difference is stated.`,
        refs,
        reliance,
      });
      continue;
    }
    const moved =
      Math.abs(pairing.delta) < 0.0005
        ? `left the mean share of simulated members looking for an alternative or resisting where it was`
        : `${pairing.delta > 0 ? 'raised' : 'lowered'} the mean share of simulated members looking for an alternative or resisting`;
    const runsClause =
      pairing.delta >= 0
        ? `higher under the change in ${pairing.higher} of ${pairing.pairs} paired runs`
        : `lower under the change in ${pairing.lower} of ${pairing.pairs} paired runs`;
    // The same difference in sampled members, when the stored analysis can add them up.
    const countDelta =
      measure.adverseCount && baseline.adverseCount
        ? measure.adverseCount.mean - baseline.adverseCount.mean
        : null;
    const counted =
      countDelta === null || measure.members === null
        ? ''
        : ` Counted as sampled members that is ${Math.abs(countDelta) < 0.05 ? 'no difference' : `about ${approx(Math.abs(countDelta))} ${countDelta > 0 ? 'more' : 'fewer'}`} of ${measure.members} simulated members; ${RESOLUTION_NOTE}.`;
    writer.add({
      origin: 'simulation-aggregation',
      text: `Against ${there}, ${here} ${moved} (each simulated actor counted equally), from ${perHundred(pairing.baselineMean)} to ${perHundred(pairing.variantMean)} in every 100: a paired difference of ${signedPerHundred(pairing.delta)} in 100 (paired standard error ${perHundred(pairing.standardError)}), ${runsClause}. It moved the mean final stance by ${signed(pairing.stanceDelta)} on a scale from -1 to 1.${counted}`,
      refs,
      reliance,
    });
  }
  if (measures.length >= 2 && state === 'clear') {
    const ordered = [...measures].sort(
      (a, b) => a.share.mean - b.share.mean || (a.variant.id < b.variant.id ? -1 : 1),
    );
    const orderings = analysis.findings.filter((finding) => finding.kind === 'ordering');
    writer.add({
      origin: 'simulation-aggregation',
      text: `From the lowest to the highest mean share of simulated members looking for an alternative or resisting (each simulated actor counted equally, in every 100): ${listed(ordered.map((measure) => `${embed(measure.variant.label, 50)} (about ${perHundred(measure.share.mean)})`))}.`,
      refs: {
        findingIds: orderings.map((finding) => finding.id),
        variantIds: ordered.map((measure) => measure.variant.id),
      },
      reliance: orderings.length > 0 ? facts.relianceOf(orderings) : null,
    });
  }
  for (const finding of analysis.findings
    .filter(
      (candidate) =>
        candidate.kind === 'threshold-crossing' ||
        (candidate.kind === 'ordering' && state === 'clear'),
    )
    .slice(0, 4)) {
    writer.add({
      origin: 'simulation-aggregation',
      text: `Finding: ${embed(finding.statement, 300)} ${stabilityText(finding)}.`,
      refs: { findingIds: [finding.id], variantIds: [finding.variantId] },
      reliance: facts.relianceOf([finding]),
    });
  }
  const check = analysis.crossCheck;
  if (check) {
    const verdict =
      check.withinEnsembleRange === true
        ? ' The deeper run fell within the range of the seeded runs.'
        : check.withinEnsembleRange === false
          ? ' The deeper run fell outside the range of the seeded runs.'
          : '';
    writer.add({
      origin: 'simulation-aggregation',
      text: `Cross-check of the simulated result: ${embed(check.note, 240)}${verdict}`,
      refs: { variantIds: facts.headline ? [facts.headline.variant.variant.id] : [] },
    });
  }
  return writer.build(['scenario-comparison']);
}

export function firstOrder(facts: Facts, tally: Tally): BriefSection {
  const writer = sectionWriter('first-order', tally);
  const { analysis, baseline, headline } = facts;
  writer.add({
    origin: 'system-assumption',
    text: 'First-order effects are the direct response of each simulated group to the change itself. Second-order effects, in the next section, follow from what others do in response.',
    refs: { assumptions: ['First-order effects are direct responses to the change.'] },
  });
  if (!headline) return writer.build();
  if (facts.signal.state === 'no-difference') {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'No first-order effect is singled out for the proposed change: under these assumptions the comparison found no measurable difference between it and no change.',
      refs: { findingIds: facts.signal.finding ? [facts.signal.finding.id] : [] },
    });
    return writer.build();
  }
  const { variant } = headline;
  if (variant.detail === 'none') {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'No first-order effect is stated for any group: the stored analysis kept no per-actor results to read them from.',
      refs: { variantIds: [variant.variant.id] },
    });
    return writer.build();
  }
  // What the runs used is the value the scenario sets for the actor (an override or an edit), else the actor's own.
  const impactIn = (actor: Actor): number => facts.impactIn(actor);
  const affected = analysis.actors
    .filter((actor) => facts.directionIn(actor) !== 'neutral')
    .sort((a, b) => Math.abs(impactIn(b)) - Math.abs(impactIn(a)) || (a.id < b.id ? -1 : 1))
    .slice(0, 6);
  if (affected.length === 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'No simulated actor is set as clearly harmed or benefited by the change, so no first-order effect is singled out; the impact settings are assumptions.',
    });
  }
  for (const actor of affected) {
    const measure = actorMeasure(variant, actor.id);
    if (!measure) continue;
    const base = baseline ? actorMeasure(baseline, actor.id) : null;
    const own = findingsFor(analysis, { variantId: variant.variant.id, actorId: actor.id });
    const owner = facts.impactSetByScenario(actor)
      ? 'set by the scenario that proposes the change'
      : impactOwner(actor, facts.evidence);
    writer.add({
      origin: 'actor-behavior',
      text: `Simulated ${embed(actor.name, 60)} (${STAKEHOLDER_CATEGORY_LABELS[actor.category]}) is set as ${facts.directionIn(actor)} by the change (impact ${signed(impactIn(actor))}, ${owner}). Under ${embed(variant.variant.label, 60)} its mean final stance was ${decimals(measure.stance)}${base && baseline ? `, against ${decimals(base.stance)} under ${embed(baseline.variant.label, 60)}` : ''}; ${groupOutcome(measure, variant.runs.length)}.`,
      refs: {
        stakeholderIds: [actor.stakeholderId],
        findingIds: own.map((finding) => finding.id),
        variantIds: [variant.variant.id],
      },
      reliance: own.length > 0 ? facts.relianceOf(own) : null,
    });
  }
  return writer.build();
}

export function secondOrder(facts: Facts, tally: Tally): BriefSection {
  const writer = sectionWriter('second-order', tally);
  const { analysis } = facts;
  const found = analysis.findings.filter((finding) => finding.kind === 'second-order-event');
  for (const finding of found.slice(0, 6)) {
    const actor = facts.actorById.get(finding.actorId ?? '');
    const outside = actor && EXTERNAL_RESPONDER_CATEGORIES.includes(actor.category);
    writer.add({
      origin: 'simulation-aggregation',
      text: `Across seeded simulated runs: ${embed(finding.statement, 280)} ${stabilityText(finding)}.${outside ? ` This is a response by an actor outside the organisation (${STAKEHOLDER_CATEGORY_LABELS[actor.category].toLowerCase()}).` : ''}`,
      refs: {
        findingIds: [finding.id],
        variantIds: [finding.variantId],
        stakeholderIds: actor ? [actor.stakeholderId] : [],
      },
      reliance: facts.relianceOf([finding]),
    });
  }
  const run = analysis.representativeRun;
  const events = run?.events ?? [];
  const byId = new Map(events.map((event) => [event.id, event]));
  // An earlier event is said to have been needed only in a run that was replayed without it; in any
  // other an earlier event only came first, and nothing shows that it mattered.
  const replayed = run?.explained === true;
  const earlier = (ids: readonly string[]): SimEvent[] =>
    ids.flatMap((id) => {
      const found = byId.get(id);
      return found ? [found] : [];
    });
  const before = (event: SimEvent): { needed: SimEvent[]; came: SimEvent[] } => {
    const named = earlier(event.causedBy);
    const followed = earlier(event.followed ?? []);
    return replayed
      ? { needed: named, came: followed }
      : { needed: [], came: [...named, ...followed] };
  };
  const chain = events
    .filter((event) => {
      const { needed, came } = before(event);
      return needed.length + came.length > 0;
    })
    .sort((a, b) => a.round - b.round || (a.id < b.id ? -1 : 1))
    .slice(0, 8);
  for (const event of chain) {
    const { needed, came } = before(event);
    const first = needed[0] ?? came[0];
    if (!first || !run) continue;
    const actor = facts.actorById.get(event.actorId ?? '');
    const others = (needed.length > 0 ? needed : came).length - 1;
    const also = others > 0 ? ` and ${others} other earlier ${plural(others, 'event')}` : '';
    const where = `In the representative simulated run (the seeded run nearest the median, one of ${analysis.config.runsPerVariant} under ${embed(facts.variantLabel(run.variantId), 60)})`;
    const them = came.length === 1 ? 'the earlier event' : 'the earlier events';
    writer.add({
      origin: actor ? 'actor-behavior' : 'simulation-aggregation',
      text:
        needed.length > 0
          ? `${where}, ${embed(event.description, 120)} in round ${event.round} could not have happened without ${embed(first.description, 120)} in round ${first.round}${also}: a replay of the same seed without that responder had no such event by then. This is a trace of the simulation and not an observation.`
          : `${where}, after ${embed(first.description, 120)} in round ${first.round}${also}, ${embed(event.description, 120)} followed in round ${event.round}. Nothing shows that ${them} mattered: ${replayed ? 'a replay of the same seed without the responder still had this event' : 'the run was not replayed without the responder'}, so this is the order of events in a simulation, not a cause and not an observation.`,
      refs: {
        stakeholderIds: actor ? [actor.stakeholderId] : [],
        variantIds: [run.variantId],
      },
    });
  }
  if (run && chain.length === 0 && events.length > 0) {
    for (const event of events.slice(0, 4)) {
      const actor = facts.actorById.get(event.actorId ?? '');
      const signals = event.causedBy.filter((cause) => !byId.has(cause));
      const signalWords = signals.slice(0, 3).map((signal) => embed(signal, 40));
      writer.add({
        origin: actor ? 'actor-behavior' : 'simulation-aggregation',
        text: `In the representative simulated run, ${embed(event.description, 160)} occurred in round ${event.round}${signals.length > 0 ? `, when the simulated ${listed(signalWords)} ${signals.length === 1 ? 'signal' : 'signals'} it watches reached its threshold` : ''}.`,
        refs: {
          stakeholderIds: actor ? [actor.stakeholderId] : [],
          variantIds: [run.variantId],
        },
      });
    }
  }
  if (found.length === 0 && events.length === 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'No second-order or competitor event was recorded in this analysis. The simulation may not have produced one, or the engine does not model them for this cast.',
    });
  }
  return writer.build();
}

export function drivers(facts: Facts, tally: Tally): BriefSection {
  const writer = sectionWriter('drivers', tally);
  const { analysis } = facts;
  const headlineFinding = facts.headline?.finding;
  const sensitive = analysis.sensitivity
    .filter((row) => row.classification === 'assumption-sensitive')
    .sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift) || (a.id < b.id ? -1 : 1));
  for (const row of sensitive.slice(0, 8)) {
    const { refs, origin, evidenced } = sensitivityContext(row, analysis, facts.evidence);
    writer.add({
      origin,
      text: `${embed(row.label, 140)}: the simulated measure ${embed(row.metric, 80)} moved by ${signed(row.shift)} (standard error ${decimals(row.standardError)}) when the assumption moved by ${signed(row.perturbation)} on the same seeds, so the simulated result is sensitive to it: the shift is more than twice its standard error and at least the chosen materiality threshold of ${MATERIAL_SHIFT} on this measure. ${evidenced ? 'A cited passage backs the assumption.' : 'No cited passage backs the assumption.'}`,
      refs: {
        sensitivityIds: [row.id],
        assumptions: [row.label],
        evidence: evidenced ? refs : [],
        findingIds: headlineFinding ? [headlineFinding.id] : [],
      },
    });
  }
  const robust = analysis.sensitivity.filter((row) => row.classification === 'robust');
  if (robust.length > 0) {
    const largest = [...robust].sort(
      (a, b) => Math.abs(b.shift) - Math.abs(a.shift) || (a.id < b.id ? -1 : 1),
    )[0];
    writer.add({
      origin: 'simulation-aggregation',
      text: `${robust.length} other perturbed ${plural(robust.length, 'assumption')} moved the simulated outcome by less than the chosen materiality threshold of ${ROBUST_SHIFT} on this measure, with a small standard error${largest ? ` (the largest, ${embed(largest.label, 60)}, by ${signed(largest.shift)} with a standard error of ${decimals(largest.standardError)})` : ''}. That says each shift was too small to matter at that threshold, not that it lies within noise: a shift can be small and still many standard errors from zero. They are ${listed(robust.slice(0, 4).map((row) => embed(row.label, 60)))}${robust.length > 4 ? ' and others' : ''}.`,
      refs: { sensitivityIds: robust.map((row) => row.id) },
    });
  }
  const open = analysis.sensitivity.filter((row) => row.classification === 'inconclusive');
  if (open.length > 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: `For ${open.length} perturbed ${plural(open.length, 'assumption')} the runs could not settle whether the simulated outcome depends on ${plural(open.length, 'it', 'them')}: ${listed(open.slice(0, 4).map((row) => embed(row.label, 60)))}.`,
      refs: { sensitivityIds: open.map((row) => row.id) },
    });
  }
  if (analysis.sensitivity.length === 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: analysis.config.sensitivity
        ? 'The analysis recorded no sensitivity result, so which assumptions drive the simulated outcome is not stated.'
        : 'No assumption was perturbed in this analysis, so which assumptions drive the simulated outcome has not been tested.',
    });
  }
  return writer.build();
}
