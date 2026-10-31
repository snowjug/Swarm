import { CRITIC_ROLE_LABELS } from '../../../shared/critique.js';
import {
  BRIEF_SIGNAL_NOTICES,
  type BriefSection,
  type BriefSignal,
  type Recommendation,
  type StatementOrigin,
  type ValidationExperiment,
} from '../../../shared/brief.js';
import {
  EXTERNAL_RESPONDER_CATEGORIES,
  STAKEHOLDER_CATEGORY_LABELS,
  TRAIT_KEYS,
  type TraitOrigin,
} from '../../../shared/stakeholders.js';
import type { Facts } from './facts.js';
import { actorMeasure, findingsFor } from './measures.js';
import { LEAD_EXCEPTION, ORDERING_RULE, SAY_DIRECTION } from './recommend.js';
import { directionOf } from './rules.js';
import { approx, clip, decimals, embed, plural, traitLabel } from './text.js';
import { sectionWriter, type Tally } from './writer.js';

export function assumptionsSection(facts: Facts, tally: Tally): BriefSection {
  const writer = sectionWriter('assumptions', tally);
  for (const row of facts.assumptions) {
    writer.add({ origin: row.origin, text: row.text, refs: row.refs });
  }
  if (facts.assumptions.length === 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'No assumption was recorded for this analysis, which should not be read as there being none.',
    });
  }
  return writer.build(['assumption-register']);
}

export function uncertainty(facts: Facts, tally: Tally): BriefSection {
  const writer = sectionWriter('uncertainty', tally);
  const { analysis } = facts;
  const findings = analysis.findings;
  if (facts.signal.state === 'no-direction') {
    writer.add({
      origin: 'system-assumption',
      text: 'How often a finding held across seeded runs shows only that the simulation repeats itself: with no stakeholder given an expected direction of impact, no finding is about the change.',
      refs: { assumptions: ['No stakeholder has an expected direction of impact.'] },
    });
  }
  if (findings.length > 0) {
    const count = (name: string) =>
      findings.filter((finding) => finding.classification === name).length;
    writer.add({
      origin: 'simulation-aggregation',
      text: `Across ${findings.length} ${plural(findings.length, 'finding')}, ${count('repeatable')} were repeatable, ${count('mostly-repeatable')} mostly repeatable, ${count('unstable')} unstable and ${count('rare')} rare across seeded simulated runs. Each is the share of runs in which a statement held, with a Wilson interval; there is no confidence score.`,
      refs: { findingIds: findings.map((finding) => finding.id) },
    });
  } else {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'The analysis recorded no findings, so nothing is said about how often any simulated result held across seeded runs.',
    });
  }
  for (const finding of findings
    .filter((entry) => entry.classification === 'unstable' || entry.classification === 'rare')
    .slice(0, 6)) {
    writer.add({
      origin: 'simulation-aggregation',
      text: `${finding.classification === 'rare' ? 'Rare' : 'Unstable'} simulated result: ${embed(finding.statement, 200)} It held in ${finding.holdsIn} of ${finding.of} seeded runs (Wilson interval ${decimals(finding.interval.lo)} to ${decimals(finding.interval.hi)}); do not rely on it.`,
      refs: { findingIds: [finding.id], variantIds: [finding.variantId] },
      reliance: 'low',
    });
  }
  const rows = analysis.sensitivity;
  if (rows.length > 0) {
    const sensitive = rows.filter((row) => row.classification === 'assumption-sensitive');
    const unbacked = sensitive.filter((row) => row.assumptionOrigin !== 'evidence');
    writer.add({
      origin: 'simulation-aggregation',
      text: `${sensitive.length} of ${rows.length} perturbed ${plural(rows.length, 'assumption')} moved the simulated outcome by more than its noise${sensitive.length > 0 ? `; ${unbacked.length} of those ${plural(unbacked.length, 'has', 'have')} no cited passage behind ${plural(unbacked.length, 'it', 'them')}` : ''}.`,
      refs: {
        sensitivityIds:
          sensitive.length > 0 ? sensitive.map((row) => row.id) : rows.map((row) => row.id),
      },
    });
  }
  const unsupported = analysis.actors.filter((actor) => !facts.evidence.supports(actor));
  if (unsupported.length > 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: `${unsupported.length} of ${analysis.actors.length} simulated actors have no cited supporting passage, so how they respond in the simulation rests on declared assumptions alone.`,
      refs: { stakeholderIds: unsupported.map((actor) => actor.stakeholderId) },
    });
  }
  const { fidelity } = analysis;
  writer.add({
    origin: 'system-assumption',
    text: `Fidelity: ${embed(fidelity.label, 160)}. ${fidelity.engine === 'rules' ? 'Every actor follows declared rules, so the simulated outcome is a mechanical consequence of the assumptions and not an independent observation.' : 'Part of the simulation is driven by a model, whose output was checked against a schema but is still a model\u2019s reading.'}`,
    refs: { assumptions: [fidelity.label] },
  });
  for (const caveat of fidelity.caveats.slice(0, 5)) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: `Caveat about how the simulation was run: ${embed(caveat, 240)}`,
      refs: { assumptions: [caveat] },
    });
  }
  if (fidelity.keyActors === 'model' || fidelity.engine === 'hybrid') {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: `The model-driven part of the simulation was run ${fidelity.modelRepeats} ${plural(fidelity.modelRepeats, 'time')}; its run-to-run variation ${fidelity.modelRepeats <= 1 ? 'is not measured' : 'was measured'}.`,
    });
  }
  const unresolved = facts.critiques.filter((critique) => critique.status !== 'accepted');
  if (facts.critiques.length === 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text:
        facts.critiqueNote ??
        'No critique has been recorded for this analysis, so nothing has challenged it yet.',
    });
  } else {
    const serious = (severity: string) =>
      unresolved.filter((critique) => critique.severity === severity).length;
    writer.add({
      origin: 'unresolved-uncertainty',
      text: `${unresolved.length} of ${facts.critiques.length} ${plural(facts.critiques.length, 'critique')} ${plural(unresolved.length, 'is', 'are')} not yet closed (${serious('blocking')} blocking, ${serious('major')} major, ${serious('minor')} minor, ${serious('note')} notes).`,
      refs: { critiqueIds: unresolved.map((critique) => critique.id) },
    });
    for (const critique of unresolved.slice(0, 8)) {
      const target =
        critique.target.kind === 'finding' && facts.findingById.has(critique.target.id);
      writer.add({
        origin: 'unresolved-uncertainty',
        text: `Open critique from the ${CRITIC_ROLE_LABELS[critique.role].toLowerCase()} (${critique.severity}, ${critique.status}): ${embed(critique.objection, 260)}${critique.remainingDisagreement ? ` Still disputed: ${embed(critique.remainingDisagreement, 120)}` : ''}`,
        refs: { critiqueIds: [critique.id], findingIds: target ? [critique.target.id] : [] },
      });
    }
  }
  if (facts.actorsChanged) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'The actors were edited after this analysis ran, so this brief describes the analysis as it ran and not the actors as they are now. Run the analysis again to bring them together.',
    });
  }
  return writer.build(['sensitivity']);
}

export function risksOpportunities(facts: Facts, tally: Tally): BriefSection {
  const writer = sectionWriter('risks-opportunities', tally);
  const { analysis, baseline, headline } = facts;
  if (!headline) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'The analysis recorded no simulated runs, so no risk or opportunity is derived from it.',
    });
    return writer.build();
  }
  if (facts.signal.state !== 'clear') {
    writer.add({
      origin: 'unresolved-uncertainty',
      text:
        facts.signal.state === 'no-direction'
          ? 'No risk or opportunity is attributed to the change: it cannot move anyone in the simulation, so no difference between the variants is read as a risk or an opportunity.'
          : 'No risk or opportunity is attributed to the change: under these assumptions the comparison found no measurable difference between the change and no change.',
      refs: { findingIds: facts.signal.finding ? [facts.signal.finding.id] : [] },
    });
    return writer.build();
  }
  const { variant } = headline;
  const readings = analysis.actors.flatMap((actor) => {
    const measure = actorMeasure(variant.runs, actor.id);
    return measure
      ? [{ actor, measure, base: baseline ? actorMeasure(baseline.runs, actor.id) : null }]
      : [];
  });
  const risks = readings
    .filter((entry) => directionOf(entry.actor) === 'harmed' && entry.measure.adverse > 0)
    .sort(
      (a, b) =>
        b.measure.adverse - (b.base?.adverse ?? 0) - (a.measure.adverse - (a.base?.adverse ?? 0)) ||
        (a.actor.id < b.actor.id ? -1 : 1),
    )
    .slice(0, 4);
  for (const { actor, measure, base } of risks) {
    const own = findingsFor(analysis, { variantId: variant.variant.id, actorId: actor.id });
    writer.add({
      origin: 'actor-behavior',
      text: `Risk: simulated ${embed(actor.name, 60)} (${STAKEHOLDER_CATEGORY_LABELS[actor.category]}) is set as harmed by the change, and about ${approx(measure.adverse)} of its ${measure.members} simulated ${plural(measure.members, 'member')} ended up looking for an alternative or resisting under ${embed(variant.variant.label, 60)}${base && baseline ? `, against about ${approx(base.adverse)} under ${embed(baseline.variant.label, 60)}` : ''}.`,
      refs: {
        stakeholderIds: [actor.stakeholderId],
        findingIds: own.map((finding) => finding.id),
        variantIds: [variant.variant.id],
      },
      reliance: own.length > 0 ? facts.relianceOf(own) : null,
    });
  }
  const events = analysis.representativeRun?.events ?? [];
  const external = events
    .flatMap((event) => {
      const actor = facts.actorById.get(event.actorId ?? '');
      return actor && EXTERNAL_RESPONDER_CATEGORIES.includes(actor.category)
        ? [{ event, actor }]
        : [];
    })
    .slice(0, 2);
  for (const { event, actor } of external) {
    const own = findingsFor(analysis, { actorId: actor.id, kind: 'second-order-event' });
    writer.add({
      origin: 'actor-behavior',
      text: `Risk from outside the organisation: in the representative simulated run, ${embed(actor.name, 60)} (${STAKEHOLDER_CATEGORY_LABELS[actor.category].toLowerCase()}) acted in round ${event.round}: ${embed(event.description, 160)}.`,
      refs: {
        stakeholderIds: [actor.stakeholderId],
        findingIds: own.map((finding) => finding.id),
        variantIds: analysis.representativeRun ? [analysis.representativeRun.variantId] : [],
      },
      reliance: own.length > 0 ? facts.relianceOf(own) : null,
    });
  }
  if (risks.length === 0 && external.length === 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'No risk is listed: no simulated actor that is set as harmed ended up adverse in the runs, and no actor outside the organisation acted in the representative run. The impact settings are assumptions.',
    });
  }
  const opportunities = readings
    .filter((entry) => directionOf(entry.actor) === 'benefited' && entry.measure.favourable > 0)
    .sort(
      (a, b) => b.measure.favourable - a.measure.favourable || (a.actor.id < b.actor.id ? -1 : 1),
    )
    .slice(0, 3);
  for (const { actor, measure, base } of opportunities) {
    const own = findingsFor(analysis, { variantId: variant.variant.id, actorId: actor.id });
    writer.add({
      origin: 'actor-behavior',
      text: `Opportunity: simulated ${embed(actor.name, 60)} (${STAKEHOLDER_CATEGORY_LABELS[actor.category]}) is set as benefited by the change, and about ${approx(measure.favourable)} of its ${measure.members} simulated ${plural(measure.members, 'member')} ended up going along or accepting with conditions under ${embed(variant.variant.label, 60)}${base && baseline ? `, against about ${approx(base.favourable)} under ${embed(baseline.variant.label, 60)}` : ''}.`,
      refs: {
        stakeholderIds: [actor.stakeholderId],
        findingIds: own.map((finding) => finding.id),
        variantIds: [variant.variant.id],
      },
      reliance: own.length > 0 ? facts.relianceOf(own) : null,
    });
  }
  if (opportunities.length === 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'No opportunity is listed: no simulated actor that is set as benefited ended up going along in the runs.',
    });
  }
  return writer.build();
}

export function recommendationsSection(
  facts: Facts,
  recommendations: readonly Recommendation[],
  tally: Tally,
): BriefSection {
  const writer = sectionWriter('recommendations', tally);
  const leads = recommendations.some((recommendation) => recommendation.text === SAY_DIRECTION);
  writer.add({
    origin: 'system-assumption',
    text: leads ? `${ORDERING_RULE} ${LEAD_EXCEPTION}` : ORDERING_RULE,
    refs: {
      assumptions: ['Recommendations are ordered by impact times repeatability divided by effort.'],
    },
  });
  for (const recommendation of recommendations) {
    const linked = recommendation.linkedFindingIds.flatMap((id) => {
      const finding = facts.findingById.get(id);
      return finding ? [finding] : [];
    });
    // Saying who is helped or harmed rests on an assumption, not on what the runs showed.
    const advice = recommendation.text === SAY_DIRECTION;
    writer.add({
      id: recommendation.id,
      origin: advice ? 'system-assumption' : 'simulation-aggregation',
      text: recommendation.text,
      refs: {
        findingIds: recommendation.linkedFindingIds,
        assumptions: recommendation.assumptions,
      },
      reliance: advice ? null : facts.relianceOf(linked),
    });
  }
  if (recommendations.length === 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'The generic rules found nothing to recommend from the findings of this analysis. That is not a recommendation to go ahead.',
    });
  }
  return writer.build();
}

const TARGET = /^(sensitivity|finding|evidence gap) (\S+):/u;

export function validationSection(
  plan: readonly ValidationExperiment[],
  tally: Tally,
  state: BriefSignal = 'clear',
): BriefSection {
  const writer = sectionWriter('validation-plan', tally);
  writer.add({
    origin: 'system-assumption',
    text: `${state === 'no-direction' ? 'The first check below settles who is helped or harmed by the change, which the comparison needs before anything else. ' : ''}Each check below would test, against the real world, an assumption the simulated result is sensitive to, a result that was not stable across seeded runs, or an actor that nothing cited supports. None of them has been run.`,
    refs: { assumptions: ['The validation checks are proposals and have not been run.'] },
  });
  for (const experiment of plan) {
    const sensitivityIds: string[] = [];
    const findingIds: string[] = [];
    const stakeholderIds: string[] = [];
    for (const target of experiment.targets) {
      const match = TARGET.exec(target);
      if (!match) continue;
      if (match[1] === 'sensitivity') sensitivityIds.push(match[2] ?? '');
      else if (match[1] === 'finding') findingIds.push(match[2] ?? '');
      else stakeholderIds.push(match[2] ?? '');
    }
    writer.add({
      id: experiment.id,
      origin: 'unresolved-uncertainty',
      text: `${experiment.question} Method: ${experiment.method} Success signal: ${experiment.successSignal} (${experiment.effort} effort, ${experiment.duration}).`,
      refs: { sensitivityIds, findingIds, stakeholderIds },
    });
  }
  if (plan.length === 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'No check was generated: the analysis shows no sensitive assumption without a cited passage, no unstable result and no key actor without support. That does not mean the result has been validated.',
    });
  }
  return writer.build();
}

/** What the brief cannot tell you, each item with the origin it is stated under. */
export function limitationItems(facts: Facts): { text: string; origin: StatementOrigin }[] {
  const { analysis } = facts;
  const items: { text: string; origin: StatementOrigin }[] = [
    {
      text: 'Synthetic actors are not real people. They stand in for groups under declared assumptions, and what they do in the simulation is a consequence of those assumptions.',
      origin: 'system-assumption',
    },
    {
      text: 'Every count is a count of simulated members or of seeded runs. None is a rate, a share of a real population, a forecast or a measurement.',
      origin: 'system-assumption',
    },
    {
      text: 'Population sizes are assumptions used to weight each group. They were not measured.',
      origin: 'system-assumption',
    },
    { text: `Fidelity: ${embed(analysis.fidelity.label, 160)}.`, origin: 'system-assumption' },
    ...analysis.fidelity.caveats.slice(0, 3).map((caveat) => ({
      text: `Caveat about how the simulation ran: ${embed(caveat, 200)}.`,
      origin: 'unresolved-uncertainty' as const,
    })),
    {
      text: `The analysis ran on one machine with one configuration (${analysis.config.runsPerVariant} seeded runs of ${analysis.config.rounds} rounds for each variant, from base seed ${analysis.config.baseSeed}); a different configuration can give a different result.`,
      origin: 'system-assumption',
    },
    {
      text: 'No historical comparison was made: the simulation has not been tested against past outcomes.',
      origin: 'unresolved-uncertainty',
    },
    {
      text: 'The responses (go along, wait, look for an alternative, resist) are readings of the final simulated stance, not observed behaviour.',
      origin: 'system-assumption',
    },
    {
      text: 'A cited passage shows where a statement came from, not that its source is true. Sources are as supplied and have not been verified.',
      origin: 'unresolved-uncertainty',
    },
  ];
  if (analysis.actors.some((actor) => !facts.evidence.supports(actor))) {
    items.push({
      text: 'Some simulated actors rest on no cited passage; see the evidence base.',
      origin: 'unresolved-uncertainty',
    });
  }
  if (facts.critiques.some((critique) => critique.status !== 'accepted')) {
    items.push({
      text: 'Some critiques of this analysis are not yet closed; see the uncertainty section.',
      origin: 'unresolved-uncertainty',
    });
  }
  if (facts.actorsChanged) {
    items.push({
      text: 'The actors were edited after the analysis ran; this brief describes the analysis as it ran.',
      origin: 'unresolved-uncertainty',
    });
  }
  if (facts.critiqueNote)
    items.push({ text: facts.critiqueNote, origin: 'unresolved-uncertainty' });
  // What the comparison could not tell comes before everything else the brief cannot tell you.
  if (facts.signal.state !== 'clear') {
    items.unshift({
      text: BRIEF_SIGNAL_NOTICES[facts.signal.state].text,
      origin:
        facts.signal.state === 'no-direction' ? 'system-assumption' : 'unresolved-uncertainty',
    });
  }
  return items.slice(0, 20).map((item) => ({ ...item, text: clip(item.text, 500) }));
}

export function limitationsSection(
  items: readonly { text: string; origin: StatementOrigin }[],
  tally: Tally,
): BriefSection {
  const writer = sectionWriter('limitations', tally);
  for (const item of items) {
    writer.add({ origin: item.origin, text: item.text, refs: { assumptions: [item.text] } });
  }
  return writer.build();
}

const ORIGIN_LETTER: Record<TraitOrigin, string> = {
  'system-assumption': 's',
  model: 'm',
  user: 'u',
  evidence: 'e',
};

export function technicalAppendix(facts: Facts, tally: Tally): BriefSection {
  const writer = sectionWriter('technical-appendix', tally);
  const { analysis } = facts;
  const { config, fidelity, cost } = analysis;
  const seedSets = facts.measures.map((measure) =>
    measure.runs.map((run) => run.seed).sort((a, b) => a - b),
  );
  const seeds = seedSets[0] ?? [];
  const paired = seedSets.every((set) => set.join(',') === seeds.join(','));
  writer.add({
    origin: 'system-assumption',
    text: `Seeds and runs: ${config.variants.length} ${plural(config.variants.length, 'variant')}, each run ${config.runsPerVariant} times over ${config.rounds} rounds, from base seed ${config.baseSeed}${seeds.length > 0 ? `; the recorded seeds run from ${seeds[0]} to ${seeds.at(-1)}` : ''}. ${paired ? 'The same seeds are used for every variant, so runs can be paired.' : 'The seeds differ between variants, so runs are not paired.'}`,
    refs: {
      assumptions: ['The analysis configuration is a setting, not a measurement.'],
      variantIds: config.variants.map((variant) => variant.id),
    },
  });
  writer.add({
    origin: 'system-assumption',
    text: `Engine: ${fidelity.engine}; key actors by ${fidelity.keyActors}; cohorts by ${fidelity.cohorts}; the model-driven part was run ${fidelity.modelRepeats} ${plural(fidelity.modelRepeats, 'time')}; ${config.sensitivity ? 'sensitivity runs were requested' : 'no sensitivity runs were requested'}.`,
    refs: { assumptions: [fidelity.label] },
  });
  for (const variant of config.variants.slice(0, 8)) {
    writer.add({
      origin: 'system-assumption',
      text: `Variant ${embed(variant.label, 80)} (id ${variant.id}) is ${variant.kind === 'baseline' ? 'the baseline' : `an alternative; the change lands in round ${variant.round} at strength ${decimals(variant.intensity)}`}; ${Object.keys(variant.impactOverrides).length} impact ${plural(Object.keys(variant.impactOverrides).length, 'override')} and ${variant.traitEdits.length} trait ${plural(variant.traitEdits.length, 'edit')}.`,
      refs: { variantIds: [variant.id], assumptions: [`Variant ${variant.id} settings`] },
    });
  }
  writer.add({
    origin: 'simulation-aggregation',
    text: `Cost: ${cost.simulatedRuns} simulated runs covering ${cost.simulatedMembers} simulated members; ${cost.modelCalls} model ${plural(cost.modelCalls, 'call')} (${cost.inputTokens} input and ${cost.outputTokens} output tokens); ${cost.wallMs} ms of wall time.`,
    refs: { variantIds: config.variants.map((variant) => variant.id) },
  });
  const shown = analysis.actors.slice(0, 24);
  for (const actor of shown) {
    const origins = new Set(TRAIT_KEYS.map((key) => actor.traits[key].origin));
    const cited = facts.evidence.forActor(actor);
    const origin: StatementOrigin =
      origins.has('system-assumption') || origins.has('model')
        ? 'system-assumption'
        : origins.has('user')
          ? 'user-assumption'
          : cited[0]
            ? facts.evidence.originOf(cited[0])
            : 'unresolved-uncertainty';
    const line = TRAIT_KEYS.map(
      (key) =>
        `${traitLabel(key)} ${decimals(actor.traits[key].value)} [${ORIGIN_LETTER[actor.traits[key].origin]}]`,
    ).join(', ');
    writer.add({
      origin,
      text: `Traits of ${embed(actor.name, 60)} (${actor.kind}, ${actor.sampleSize} simulated ${plural(actor.sampleSize, 'member')}${actor.size > 1 ? `, population assumed ${actor.size}` : ''}): ${line}.`,
      refs: {
        stakeholderIds: [actor.stakeholderId],
        assumptions: [`Trait values of ${actor.name}`],
        evidence:
          origin === 'supplied-evidence' || origin === 'retrieved-public-evidence' ? cited : [],
      },
    });
  }
  if (analysis.actors.length > shown.length) {
    writer.add({
      origin: 'system-assumption',
      text: `${analysis.actors.length - shown.length} further simulated actors are not listed here; the table in the exports lists every actor and trait.`,
      refs: { assumptions: ['The trait table in the exports is complete.'] },
    });
  }
  writer.add({
    origin: 'system-assumption',
    text: 'Origin of each trait value: [s] filled in by Swarm as a default, [m] proposed by a model, [u] set by a person, [e] labelled as resting on evidence.',
    refs: { assumptions: ['Trait origin legend.'] },
  });
  return writer.build();
}
