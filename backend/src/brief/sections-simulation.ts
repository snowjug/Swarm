import { RESPONSE_CATEGORIES, RESPONSE_LABELS, type Finding } from '../../../shared/analysis.js';
import type { BriefSection } from '../../../shared/brief.js';
import {
  EXTERNAL_RESPONDER_CATEGORIES,
  STAKEHOLDER_CATEGORY_LABELS,
} from '../../../shared/stakeholders.js';
import type { Facts } from './facts.js';
import { actorMeasure, findingsFor, pairRuns } from './measures.js';
import { directionOf } from './rules.js';
import { readingNote } from './signal.js';
import { sensitivityContext } from './assumptions.js';
import { approx, decimals, embed, listed, plural, signed } from './text.js';
import { classWords } from './sections-answer.js';
import { sectionWriter, type Tally } from './writer.js';

const stabilityText = (finding: Finding): string =>
  `It held in ${finding.holdsIn} of ${finding.of} seeded simulated runs (Wilson interval ${decimals(finding.interval.lo)} to ${decimals(finding.interval.hi)}; ${classWords(finding.classification)})`;

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
        `${RESPONSE_LABELS[category].toLowerCase()} ${approx(measure.responses[category].mean)}`,
    );
    const related = findingsFor(analysis, { variantId: measure.variant.id });
    writer.add({
      origin: 'simulation-aggregation',
      text: `Under ${embed(measure.variant.label, 80)}, the mean simulated outcome across ${measure.runs.length} seeded runs of ${measure.members} simulated members was: ${parts.join(', ')}. The number looking for an alternative or resisting ranged from ${approx(measure.adverse.min)} to ${approx(measure.adverse.max)} across runs.`,
      refs: { findingIds: related.map((finding) => finding.id), variantIds: [measure.variant.id] },
      reliance: related.length > 0 ? facts.relianceOf(related) : null,
    });
  }
  if (headline) {
    const { variant } = headline;
    const ranked = analysis.actors
      .flatMap((actor) => {
        const measure = actorMeasure(variant.runs, actor.id);
        return measure && measure.adverse > 0 ? [{ actor, measure }] : [];
      })
      .sort(
        (a, b) =>
          b.measure.adverse / b.measure.members - a.measure.adverse / a.measure.members ||
          (a.actor.id < b.actor.id ? -1 : 1),
      )
      .slice(0, 6);
    if (ranked.length === 0) {
      writer.add({
        origin: 'simulation-aggregation',
        text: `No simulated member ended up looking for an alternative or resisting under ${embed(variant.variant.label, 80)} in any seeded run.`,
        refs: { variantIds: [variant.variant.id] },
      });
    }
    for (const { actor, measure } of ranked) {
      const own = findingsFor(analysis, { variantId: variant.variant.id, actorId: actor.id });
      const base = baseline ? actorMeasure(baseline.runs, actor.id) : null;
      writer.add({
        origin: 'actor-behavior',
        text: `Simulated ${embed(actor.name, 60)} (${STAKEHOLDER_CATEGORY_LABELS[actor.category]}, ${measure.members} simulated ${plural(measure.members, 'member')}): under ${embed(variant.variant.label, 60)} about ${approx(measure.adverse)} ended up looking for an alternative or resisting${base && baseline && state === 'clear' ? `, against about ${approx(base.adverse)} under ${embed(baseline.variant.label, 60)}` : ''}; mean final stance ${signed(measure.stance)}.`,
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
        text: `Finding: ${embed(finding.statement, 240)} ${stabilityText(finding)}.`,
        refs: { findingIds: [finding.id], variantIds: [finding.variantId] },
        reliance: facts.relianceOf([finding]),
      });
    }
  }
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
    const pairing = pairRuns(measure.runs, baseline.runs);
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
    if (state === 'no-difference') {
      writer.add({
        origin: 'simulation-aggregation',
        text: `Against ${embed(baseline.variant.label, 60)}, ${embed(measure.variant.label, 60)} moved the mean final stance of simulated members by ${signed(pairing.stanceDelta)} on a scale from -1 to 1 (mean over ${pairing.pairs} paired seeds), which the comparison reads as about the same.`,
        refs,
        reliance,
      });
      continue;
    }
    const size = Math.abs(pairing.adverseDelta);
    const movement =
      pairing.adverseDelta === 0
        ? 'the same number of simulated members'
        : `about ${approx(size)} ${pairing.adverseDelta > 0 ? 'more' : 'fewer'} of ${measure.members} simulated members`;
    writer.add({
      origin: 'simulation-aggregation',
      text: `Against ${embed(baseline.variant.label, 60)}, ${embed(measure.variant.label, 60)} left ${movement} looking for an alternative or resisting (mean over ${pairing.pairs} paired seeds; ${pairing.adverseDelta >= 0 ? `more in ${pairing.worse}` : `fewer in ${pairing.better}`} of ${pairing.pairs} paired runs) and moved the mean final stance by ${signed(pairing.stanceDelta)} on a scale from -1 to 1.`,
      refs,
      reliance,
    });
  }
  if (measures.length >= 2 && state === 'clear') {
    const ordered = [...measures].sort(
      (a, b) => a.adverse.mean - b.adverse.mean || (a.variant.id < b.variant.id ? -1 : 1),
    );
    const orderings = analysis.findings.filter((finding) => finding.kind === 'ordering');
    writer.add({
      origin: 'simulation-aggregation',
      text: `From fewest to most simulated members looking for an alternative or resisting: ${listed(ordered.map((measure) => `${embed(measure.variant.label, 50)} (about ${approx(measure.adverse.mean)})`))}.`,
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
      text: `Finding: ${embed(finding.statement, 240)} ${stabilityText(finding)}.`,
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
      text: 'No first-order effect is singled out: under these assumptions the comparison found no measurable difference between the change and no change.',
      refs: { findingIds: facts.signal.finding ? [facts.signal.finding.id] : [] },
    });
    return writer.build();
  }
  const { variant } = headline;
  const affected = analysis.actors
    .filter((actor) => directionOf(actor) !== 'neutral')
    .sort(
      (a, b) =>
        Math.abs(b.traits.impact.value) - Math.abs(a.traits.impact.value) || (a.id < b.id ? -1 : 1),
    )
    .slice(0, 6);
  if (affected.length === 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'No simulated actor is set as clearly harmed or benefited by the change, so no first-order effect is singled out; the impact settings are assumptions.',
    });
  }
  for (const actor of affected) {
    const measure = actorMeasure(variant.runs, actor.id);
    if (!measure) continue;
    const base = baseline ? actorMeasure(baseline.runs, actor.id) : null;
    const own = findingsFor(analysis, { variantId: variant.variant.id, actorId: actor.id });
    const owner =
      actor.traits.impact.origin === 'user'
        ? 'set by a person'
        : actor.traits.impact.origin === 'evidence'
          ? 'labelled as resting on evidence'
          : 'an assumption';
    writer.add({
      origin: 'actor-behavior',
      text: `Simulated ${embed(actor.name, 60)} (${STAKEHOLDER_CATEGORY_LABELS[actor.category]}) is set as ${directionOf(actor)} by the change (impact ${signed(actor.traits.impact.value)}, ${owner}). Under ${embed(variant.variant.label, 60)} its mean final stance was ${decimals(measure.stance)}${base && baseline ? `, against ${decimals(base.stance)} under ${embed(baseline.variant.label, 60)}` : ''}; about ${approx(measure.adverse)} of ${measure.members} simulated ${plural(measure.members, 'member')} ended up looking for an alternative or resisting.`,
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
      text: `Across seeded simulated runs: ${embed(finding.statement, 220)} ${stabilityText(finding)}.${outside ? ` This is a response by an actor outside the organisation (${STAKEHOLDER_CATEGORY_LABELS[actor.category].toLowerCase()}).` : ''}`,
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
  const chain = events
    .filter((event) => event.causedBy.some((cause) => byId.has(cause)))
    .sort((a, b) => a.round - b.round || (a.id < b.id ? -1 : 1))
    .slice(0, 8);
  for (const event of chain) {
    const parents = event.causedBy.flatMap((cause) => {
      const parent = byId.get(cause);
      return parent ? [parent] : [];
    });
    const first = parents[0];
    if (!first || !run) continue;
    const actor = facts.actorById.get(event.actorId ?? '');
    const others = parents.length - 1;
    writer.add({
      origin: actor ? 'actor-behavior' : 'simulation-aggregation',
      text: `In the representative simulated run (the seeded run nearest the median, one of ${analysis.config.runsPerVariant} under ${embed(facts.variantLabel(run.variantId), 60)}), after ${embed(first.description, 120)} in round ${first.round}${others > 0 ? ` and ${others} other earlier ${plural(others, 'event')}` : ''}, ${embed(event.description, 120)} followed in round ${event.round}. The engine recorded it as following from the earlier ${plural(parents.length, 'event')}, which is a trace of the simulation and not an observation.`,
      refs: {
        stakeholderIds: actor ? [actor.stakeholderId] : [],
        variantIds: [run.variantId],
      },
    });
  }
  if (run && chain.length === 0 && events.length > 0) {
    for (const event of events.slice(0, 4)) {
      const actor = facts.actorById.get(event.actorId ?? '');
      writer.add({
        origin: actor ? 'actor-behavior' : 'simulation-aggregation',
        text: `In the representative simulated run, ${embed(event.description, 160)} occurred in round ${event.round}${event.causedBy.length > 0 ? `, following from ${listed(event.causedBy.slice(0, 3).map((cause) => embed(cause, 40)))}` : ''}.`,
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
      text: `${embed(row.label, 140)}: the simulated measure ${embed(row.metric, 80)} moved by ${signed(row.shift)} (standard error ${decimals(row.standardError)}) when the assumption moved by ${signed(row.perturbation)} on the same seeds, so the simulated result is sensitive to it. ${evidenced ? 'A cited passage backs the assumption.' : 'No cited passage backs the assumption.'}`,
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
    writer.add({
      origin: 'simulation-aggregation',
      text: `${robust.length} other perturbed ${plural(robust.length, 'assumption')} did not move the simulated outcome by more than its noise: ${listed(robust.slice(0, 4).map((row) => embed(row.label, 60)))}${robust.length > 4 ? ' and others' : ''}.`,
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
