import type { Finding, Variant } from '../../../shared/analysis.js';
import type {
  BriefRefs,
  BriefSection,
  BriefSignal,
  StatementOrigin,
} from '../../../shared/brief.js';
import { isSetByPerson } from '../../../shared/analysis-plan.js';
import { CRITIC_ROLE_LABELS } from '../../../shared/critique.js';
import { canonicalField, type ScenarioFrame } from '../../../shared/scenario.js';
import { NO_DIRECTION_NOTICE } from '../../../shared/signal.js';
import { STAKEHOLDER_CATEGORY_LABELS } from '../../../shared/stakeholders.js';
import { effectOf } from './assumptions.js';
import { documentOrigin, provenanceLine, uniqueRefs } from './evidence.js';
import type { Facts } from './facts.js';
import { landscape } from './landscape.js';
import type { GroupShift, Headline } from './measures.js';
import type { Advice } from './recommend.js';
import { relianceOfEvidence, type Reliance } from './rules.js';
import {
  RESOLUTION_NOTE,
  clip,
  decimals,
  embed,
  fit,
  listed,
  perHundred,
  plural,
  traitLabel,
} from './text.js';
import {
  impactLeads,
  impactOrigin,
  openConflicts,
  unevidencedKeyActors,
  unstableFindings,
  type PlannedCheck,
} from './validation.js';
import { sectionWriter, type SectionWriter, type Tally } from './writer.js';

const CLASS_WORDS = {
  repeatable: 'repeatable',
  'mostly-repeatable': 'mostly repeatable',
  unstable: 'unstable',
  rare: 'rare',
} as const;

export const classWords = (classification: keyof typeof CLASS_WORDS): string =>
  CLASS_WORDS[classification];

const engineWords = (facts: Facts): string =>
  facts.analysis.fidelity.engine === 'rules'
    ? 'the rules engine'
    : `the hybrid engine (key actors ${facts.analysis.fidelity.keyActors === 'model' ? 'driven by a model' : 'driven by rules'}, cohorts by rules)`;

/** The one thing most worth knowing before leaning on the answer, in the order of how much it can change it. */
function caveatOf(facts: Facts): { text: string; refs: Partial<BriefRefs> } {
  const finding = facts.headline?.finding ?? null;
  const findingIds = finding ? [finding.id] : [];
  const row = facts.analysis.sensitivity
    .filter(
      (entry) =>
        entry.classification === 'assumption-sensitive' && entry.assumptionOrigin !== 'evidence',
    )
    .sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift) || (a.id < b.id ? -1 : 1))[0];
  if (row) {
    return {
      text: `Biggest open caveat: the simulated result is sensitive to ${embed(row.label, 120)}, which no cited passage backs; ${effectOf(row)}.`,
      refs: { sensitivityIds: [row.id], findingIds },
    };
  }
  if (finding && (finding.classification === 'unstable' || finding.classification === 'rare')) {
    return {
      text: `Biggest open caveat: the headline comparison was ${classWords(finding.classification)} across seeded simulated runs (it held in ${finding.holdsIn} of ${finding.of}), so it should not carry the decision on its own.`,
      refs: { findingIds },
    };
  }
  const unevidenced = facts.analysis.actors.filter((actor) => !facts.evidence.supports(actor));
  if (unevidenced.length > 0 && unevidenced.length === facts.analysis.actors.length) {
    return {
      text: `Biggest open caveat: no cited passage supports any of the ${unevidenced.length} simulated actors, so every simulated response rests on declared assumptions alone.`,
      refs: { findingIds, stakeholderIds: unevidenced.map((actor) => actor.stakeholderId) },
    };
  }
  const critique = facts.critiques.find(
    (entry) =>
      entry.status !== 'accepted' && (entry.severity === 'blocking' || entry.severity === 'major'),
  );
  if (critique) {
    return {
      text: `Biggest open caveat: an open ${critique.severity} objection from the ${CRITIC_ROLE_LABELS[critique.role].toLowerCase()}: ${embed(critique.objection, 200)}.`,
      refs: { critiqueIds: [critique.id], findingIds },
    };
  }
  const caveat = facts.analysis.fidelity.caveats[0];
  if (caveat) {
    return {
      text: `Biggest open caveat about how the simulation was run: ${embed(caveat, 200)}.`,
      refs: { findingIds, assumptions: [caveat] },
    };
  }
  return {
    text: 'Biggest open caveat: the result comes from a simulation of synthetic actors that has not been checked against real outcomes.',
    refs: { findingIds },
  };
}

export const NOT_TOLD =
  'What this does not tell you: how many real people act this way, how fast, or whether the assumptions behind the simulation hold. Simulated members are synthetic stand-ins for groups; the counts above are neither rates nor forecasts, and nor are the shares of simulated members.';

/** The same line when the comparison cannot be read as a result about the change, and there are no counts above it to qualify. */
export const NOT_TOLD_BY_SIGNAL: Record<BriefSignal, string> = {
  clear: NOT_TOLD,
  'no-direction':
    'What this does not tell you: what the change does. The simulation could not tell it from no change, so there is no simulated result about it, and nothing here says how many real people act this way, how fast, or whether the assumptions behind the simulation hold. Simulated members are synthetic stand-ins for groups; no count in this brief is a rate or a forecast.',
  'no-difference':
    'What this does not tell you: that the change makes no difference in the world. No measurable difference is a result under the assumptions made here, not a measurement of real people, and it does not say how many act this way, how fast, or whether the assumptions hold. Simulated members are synthetic stand-ins for groups; no count in this brief is a rate or a forecast.',
};

const variantIdsOf = (headline: Headline): string[] => [
  headline.variant.variant.id,
  ...(headline.baseline ? [headline.baseline.variant.id] : []),
];

const baselineLabel = (headline: Headline): string =>
  embed(headline.baseline?.variant.label ?? 'no change', 80);

/** The findings whose statement was chosen after the runs were seen: a direction, the largest response, an ordering, the most frequent event. */
const CHOSEN_AFTER: ReadonlySet<Finding['kind']> = new Set([
  'direction-vs-baseline',
  'majority-response',
  'ordering',
  'second-order-event',
]);

/**
 * The Wilson interval of a finding, in words. For a statement chosen after the runs were seen it
 * describes those runs: it is not an unconditional coverage claim, since the choice used the same runs.
 */
export const intervalWords = (finding: Finding): string =>
  `Wilson interval ${decimals(finding.interval.lo)} to ${decimals(finding.interval.hi)}${CHOSEN_AFTER.has(finding.kind) ? ', descriptive of these runs' : ''}`;

const CHOSEN_AFTER_NOTE =
  ' The statement was chosen after the runs were seen, so the interval describes these runs and does not claim long-run coverage.';

/** How far the finding about the direction against the baseline held across seeded runs. */
function addStability(
  writer: SectionWriter,
  facts: Facts,
  headline: Headline,
  reading: string,
): void {
  const { finding } = facts.signal;
  if (finding) {
    writer.add({
      origin: 'simulation-aggregation',
      text: `Stability: the finding ${embed(finding.statement, 260)} held in ${finding.holdsIn} of ${finding.of} seeded simulated runs (Wilson interval ${decimals(finding.interval.lo)} to ${decimals(finding.interval.hi)}), which the analysis classes as ${classWords(finding.classification)}. There is no confidence score.${CHOSEN_AFTER.has(finding.kind) ? CHOSEN_AFTER_NOTE : ''}${reading}`,
      refs: { findingIds: [finding.id] },
      reliance: facts.relianceOf([finding]),
    });
  } else {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'Stability: no finding about the direction against the baseline was recorded for this variant, so how often the difference holds across seeded simulated runs is not stated.',
      refs: { variantIds: [headline.variant.variant.id] },
    });
  }
}

/** What the answer is shown to lean on: an assumption, an evidence gap or an open objection, and what would settle it. */
interface Doubt {
  /** The premise it is about, in the vocabulary the validation plan's checks use. */
  key: string;
  origin: StatementOrigin;
  text: string;
  refs: Partial<BriefRefs>;
  /** What would settle it when no check of the plan does. */
  settle: string;
}

/**
 * The few assumptions or evidence gaps that could change the answer, the most consequential first:
 * what the runs were sensitive to, how hard the change lands on the groups the answer names, how large
 * the change is in practice, then the open conflicts between sources, the open serious objections, the
 * key actors nothing cited supports and the evidence the question names as missing. Each is a statement
 * of what is not known, with the ids it rests on.
 */
function doubtsOf(facts: Facts, headline: Headline): Doubt[] {
  const { analysis } = facts;
  const doubts: Doubt[] = [];
  const row = analysis.sensitivity
    .filter(
      (entry) =>
        entry.classification === 'assumption-sensitive' && entry.assumptionOrigin !== 'evidence',
    )
    .sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift) || (a.id < b.id ? -1 : 1))[0];
  const findingIds = headline.finding ? [headline.finding.id] : [];
  if (row) {
    doubts.push({
      key: `sensitivity:${row.id}`,
      origin: 'unresolved-uncertainty',
      text: `the simulated result is sensitive to ${embed(row.label, 120)}, which no cited passage backs: ${effectOf(row)}`,
      refs: { sensitivityIds: [row.id], findingIds },
      settle: 'measuring it in the world',
    });
  }
  const lead = impactLeads(facts, 3).find((actor) => actor.traits.impact.origin !== 'user');
  if (lead && !(row?.target.actorId === lead.id && row.target.trait === 'impact')) {
    const direction =
      lead.traits.impact.value < -0.2
        ? 'harmed'
        : lead.traits.impact.value > 0.2
          ? 'helped'
          : 'unaffected';
    doubts.push({
      key: `premise:impact:${lead.id}`,
      origin: 'system-assumption',
      text: `how the change lands on ${embed(lead.name, 60)}, the group the simulated answer moves most, is an assumption (${direction} by the change itself; ${impactOrigin(lead)}) and not a measurement`,
      refs: {
        stakeholderIds: [lead.stakeholderId],
        assumptions: [`Impact of the change on ${lead.name}`],
        findingIds,
      },
      settle: 'measuring how the change lands on the group',
    });
  }
  const variant = headline.variant.variant;
  if (variant.kind === 'alternative' && row?.target.kind !== 'intensity') {
    doubts.push({
      key: 'premise:strength',
      origin: isSetByPerson(variant) ? 'user-assumption' : 'system-assumption',
      text: `how large the change is in practice, and how widely and soon it reaches the groups, is a setting of the simulation (strength ${decimals(variant.intensity)} of 1 from round ${variant.round}) and not a measurement`,
      refs: {
        variantIds: [variant.id],
        assumptions: ['The strength and timing of a change are settings of the simulation.'],
      },
      settle: 'observing what size of change reaches the groups, and when',
    });
  }
  for (const conflict of openConflicts(facts).slice(0, 1)) {
    const left = facts.evidence.documents.get(conflict.left.documentId);
    doubts.push({
      key: `conflict:${conflict.id}`,
      origin: documentOrigin(left),
      text: `the sources disagree on ${embed(conflict.topic, 100)}: ${embed(conflict.left.documentName, 60)} gives ${conflict.leftValue ? embed(conflict.leftValue, 60) : 'one position'} and ${embed(conflict.right.documentName, 60)} gives ${conflict.rightValue ? embed(conflict.rightValue, 60) : 'another'}`,
      refs: { evidence: [conflict.left, conflict.right] },
      settle: 'getting the underlying data from the owner of each source',
    });
  }
  const critique = facts.critiques.find(
    (entry) =>
      entry.status !== 'accepted' && (entry.severity === 'blocking' || entry.severity === 'major'),
  );
  if (critique) {
    doubts.push({
      key: `critique:${critique.id}`,
      origin: 'unresolved-uncertainty',
      text: `an open ${critique.severity} objection from the ${CRITIC_ROLE_LABELS[critique.role].toLowerCase()} stands: ${embed(critique.objection, 160)}`,
      refs: { critiqueIds: [critique.id], findingIds },
      settle: 'answering the objection, or changing the analysis it points at',
    });
  }
  const unsupported = unevidencedKeyActors(facts);
  if (unsupported.length > 0) {
    doubts.push({
      key: `gap:${unsupported[0]?.stakeholderId ?? ''}`,
      origin: 'unresolved-uncertainty',
      text: `no cited passage supports ${listed(unsupported.slice(0, 3).map((actor) => embed(actor.name, 40)))}${unsupported.length > 3 ? ' and others' : ''}, so how ${unsupported.length === 1 ? 'it responds' : 'they respond'} in the simulation rests on declared assumptions alone`,
      refs: { stakeholderIds: unsupported.slice(0, 8).map((actor) => actor.stakeholderId) },
      settle: 'finding direct evidence for them',
    });
  }
  const missing = facts.scenario?.evidenceMissing[0];
  if (missing) {
    doubts.push({
      key: 'evidence:missing',
      origin: 'unresolved-uncertainty',
      text: `the question itself names evidence as missing: ${embed(missing, 140)}`,
      refs: { assumptions: [missing] },
      settle: 'finding or commissioning a source for it',
    });
  }
  const unstable = unstableFindings(facts)[0];
  if (unstable) {
    doubts.push({
      key: `finding:${unstable.id}`,
      origin: 'simulation-aggregation',
      text: `the simulated finding ${embed(unstable.statement, 140)} held in only ${unstable.holdsIn} of ${unstable.of} seeded runs`,
      refs: { findingIds: [unstable.id] },
      settle: 'repeating the analysis with more seeded runs',
    });
  }
  return doubts;
}

/** The conditional recommendation, from the actions the recommendations name and the stability of the headline. */
function conditionalRecommendation(
  facts: Facts,
  headline: Headline,
  advice: readonly Advice[],
): { text: string; refs: Partial<BriefRefs>; reliance: Reliance | null } {
  const finding = headline.finding;
  const refs: Partial<BriefRefs> = {
    findingIds: finding ? [finding.id] : [],
    variantIds: [
      headline.variant.variant.id,
      ...(headline.baseline ? [headline.baseline.variant.id] : []),
    ],
  };
  if (!finding || finding.classification === 'unstable' || finding.classification === 'rare') {
    return {
      text: `Recommendation: do not decide on this simulated comparison yet. ${finding ? `The finding behind it held in ${finding.holdsIn} of ${finding.of} seeded runs, which the analysis classes as ${classWords(finding.classification)}` : 'The analysis recorded no finding that states how often it holds'}; repeat the analysis with more seeded runs, then take the checks named below.`,
      refs,
      reliance: 'low',
    };
  }
  // The groups the answer names, biggest move first; advice about any other comes after.
  const size = new Map(
    headline.groups.map((group, index) => [
      facts.actorById.get(group.actorId)?.stakeholderId ?? group.actorId,
      index,
    ]),
  );
  const bySize = (a: Advice, b: Advice): number =>
    (size.get(a.refs.stakeholderIds?.[0] ?? '') ?? Infinity) -
      (size.get(b.refs.stakeholderIds?.[0] ?? '') ?? Infinity) || 0;
  const subjects = (kind: Advice['kind']): string[] => [
    ...new Set(
      advice
        .filter((entry) => entry.kind === kind && entry.subject !== null)
        .sort(kind === 'mitigate' ? bySize : () => 0)
        .map((entry) => entry.subject ?? ''),
    ),
  ];
  const actions = [
    subjects('mitigate').length > 0
      ? `stage the change and mitigate it for ${listed(subjects('mitigate').slice(0, 3))}`
      : null,
    subjects('prepare-response').length > 0
      ? `prepare a response to ${listed(subjects('prepare-response').slice(0, 2))}`
      : null,
    subjects('build-on').length > 0
      ? `build on the favourable response of ${listed(subjects('build-on').slice(0, 2))}`
      : null,
  ].filter((action): action is string => action !== null);
  const used = advice.filter((entry) =>
    ['mitigate', 'prepare-response', 'build-on'].includes(entry.kind),
  );
  const findingIds = [
    ...new Set([...refs.findingIds!, ...used.flatMap((entry) => entry.linkedFindingIds)]),
  ];
  const stakeholderIds = [...new Set(used.flatMap((entry) => entry.refs.stakeholderIds ?? []))];
  const linked = findingIds.flatMap((id) => {
    const found = facts.findingById.get(id);
    return found ? [found] : [];
  });
  return {
    text:
      actions.length > 0
        ? `Recommendation, conditional on the premises below: if the checks in the validation plan confirm the premises behind the simulated result, ${listed(actions)}; if they do not, run the analysis again with the measured values before deciding.`
        : 'Recommendation, conditional on the premises below: if the checks in the validation plan confirm the premises behind the simulated result, treat the comparison as a basis for the decision and not as a forecast; if they do not, run the analysis again with the measured values before deciding.',
    refs: {
      ...refs,
      findingIds: findingIds.slice(0, 8),
      stakeholderIds: stakeholderIds.slice(0, 8),
    },
    reliance: facts.relianceOf(linked),
  };
}

/** A group's own movement in a few words: its share under the change against its share under the baseline. */
function groupLine(facts: Facts, group: GroupShift, runs: number, against: string): string {
  const name = embed(facts.actorById.get(group.actorId)?.name ?? group.actorId, 50);
  if (group.members === 1) {
    return `${name} (its one simulated member, in about ${Math.round(group.share * runs)} of ${runs} seeded runs, against ${Math.round((group.baselineShare ?? 0) * runs)} under ${against})`;
  }
  return `${name} (${perHundred(group.share)} in 100 of its simulated members, against ${perHundred(group.baselineShare ?? 0)} under ${against})`;
}

/**
 * The answer first, in the order a client reads it in a minute: the decision and the recommendation it
 * supports on conditions, the comparison the engine itself makes (every actor counting equally, run by
 * run on the same seeds), the groups that moved most, the few assumptions or gaps that could change it,
 * what would settle them, and then how steady the comparison was. Counts of sampled members are left
 * to later sections, where they say what they are.
 */
function answerFirst(
  facts: Facts,
  writer: SectionWriter,
  headline: Headline,
  ahead: { advice: readonly Advice[]; plan: readonly PlannedCheck[] },
): string {
  const { variant, baseline, pairing, finding } = headline;
  const runs = variant.runs.length;
  const here = embed(variant.variant.label, 80);
  const there = baseline ? embed(baseline.variant.label, 80) : 'no change';
  const refs = { findingIds: finding ? [finding.id] : [], variantIds: variantIdsOf(headline) };

  const scenario = facts.scenario;
  writer.add({
    origin: scenario?.origin === 'user' || !scenario ? 'user-assumption' : 'system-assumption',
    text: scenario
      ? `Decision evaluated: ${embed(scenario.decision, 300)}.`
      : `The question asked: ${embed(facts.inputs.project.question, 300)}.`,
    refs: { assumptions: [scenario ? scenario.decision : facts.inputs.project.question] },
  });
  const conditional = conditionalRecommendation(facts, headline, ahead.advice);
  writer.add({
    origin: 'simulation-aggregation',
    text: conditional.text,
    refs: conditional.refs,
    reliance: conditional.reliance,
  });

  let comparison: string;
  if (baseline && pairing && pairing.pairs > 0) {
    const change =
      Math.abs(pairing.delta) < 0.0005
        ? 'no net difference in the mean'
        : `${perHundred(Math.abs(pairing.delta))} in 100 ${pairing.delta > 0 ? 'more' : 'fewer'} (paired standard error ${perHundred(pairing.standardError)})`;
    const runsClause =
      pairing.delta >= 0
        ? `higher under the change in ${pairing.higher} of ${pairing.pairs} paired runs`
        : `lower under the change in ${pairing.lower} of ${pairing.pairs} paired runs`;
    comparison = `With ${engineWords(facts)}, on the same ${pairing.pairs} seeded runs and counting each of the ${facts.analysis.actors.length} simulated actors equally, not each simulated member, the mean share of simulated members looking for an alternative or resisting was about ${perHundred(pairing.variantMean)} in 100 under ${here} against ${perHundred(pairing.baselineMean)} in 100 under ${there}: ${change}, ${runsClause}.`;
  } else if (baseline) {
    comparison = `With ${engineWords(facts)}, ${here} could not be paired with ${there} on the same seeded runs, so no paired comparison is stated; the mean share of simulated members ending up looking for an alternative or resisting under ${here} was about ${perHundred(variant.share.mean)} in 100, counting each simulated actor equally.`;
  } else {
    comparison = `With ${engineWords(facts)}, across ${runs} seeded runs and counting each simulated actor equally, the mean share of simulated members ending up looking for an alternative or resisting under ${here} was about ${perHundred(variant.share.mean)} in 100. No baseline was run, so nothing is compared.`;
  }
  writer.add({
    origin: 'simulation-aggregation',
    text: comparison,
    refs,
    reliance: finding ? facts.relianceOf([finding]) : 'low',
  });

  const named = headline.groups.slice(0, 3);
  let groups = '';
  if (baseline && pairing && pairing.pairs > 0 && !headline.groupsKnown) {
    // Without each group's own results nothing can be said of which moved, and nothing is said.
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'Which groups moved most is not stated: the stored analysis kept no per-actor results for the change and for the baseline, so each group’s own share cannot be worked out.',
      refs: { variantIds: refs.variantIds },
    });
  } else if (baseline && pairing && pairing.pairs > 0) {
    const ownFindings = named.flatMap((group) =>
      facts.analysis.findings.filter(
        (candidate) =>
          candidate.actorId === group.actorId && candidate.variantId === variant.variant.id,
      ),
    );
    groups =
      named.length > 0
        ? `The groups whose own share looking for an alternative or resisting moved most were ${listed(named.map((group) => groupLine(facts, group, runs, there)))}. They are ranked by their own share and never by member counts: ${RESOLUTION_NOTE}.`
        : `No simulated group’s own share looking for an alternative or resisting moved by as much as 1 in 100 against ${there} on the same seeds.`;
    writer.add({
      origin: 'actor-behavior',
      text: groups,
      refs: {
        stakeholderIds: named.flatMap((group) => {
          const actor = facts.actorById.get(group.actorId);
          return actor ? [actor.stakeholderId] : [];
        }),
        findingIds: ownFindings.map((candidate) => candidate.id).slice(0, 8),
        variantIds: refs.variantIds,
      },
      reliance: ownFindings.length > 0 ? facts.relianceOf(ownFindings) : null,
    });
  }

  const doubts = doubtsOf(facts, headline).slice(0, 3);
  doubts.forEach((doubt, index) => {
    writer.add({
      origin: doubt.origin,
      text: `${index === 0 ? 'Biggest open caveat' : 'Also open'}: ${doubt.text}.`,
      refs: doubt.refs,
    });
  });
  if (doubts.length > 0) {
    const settle = doubts.map((doubt) => {
      const check = ahead.plan.find((entry) => entry.keys.includes(doubt.key));
      return check ? `${check.gist} (${check.id})` : doubt.settle;
    });
    writer.add({
      origin: 'unresolved-uncertainty',
      text: `What would settle ${doubts.length === 1 ? 'it' : 'them'}: ${settle.join('; ')}. None of this has been done, and the decision thresholds are left for you to set before any check starts.`,
    });
  }
  addStability(writer, facts, headline, '');
  writer.add({ origin: 'unresolved-uncertainty', text: NOT_TOLD });
  // The headline: the comparison, the groups it moved most by name, and the biggest caveat if it fits.
  const names = named.map((group) =>
    embed(facts.actorById.get(group.actorId)?.name ?? group.actorId, 40),
  );
  return fit(
    [
      comparison,
      names.length > 0 ? `The groups moved most were ${listed(names)}.` : '',
      doubts[0] ? `Biggest open caveat: ${doubts[0].text}.` : '',
    ].filter((part) => part !== ''),
    700,
  );
}

export function executiveAnswer(
  facts: Facts,
  tally: Tally,
  ahead: { advice: readonly Advice[]; plan: readonly PlannedCheck[] } = { advice: [], plan: [] },
): { section: BriefSection; headline: string } {
  const writer = sectionWriter('executive-answer', tally);
  const headline = facts.headline;
  const { state, finding } = facts.signal;
  let answer: string;
  if (!headline) {
    answer =
      'The analysis recorded no simulated runs, so there is no comparison to report. Run the simulation again before relying on this brief.';
    writer.add({ origin: 'unresolved-uncertainty', text: answer });
  } else if (state === 'no-direction') {
    // Counts of adverse members are not quoted: with no one to move, they are noise, not a result.
    answer = `With ${engineWords(facts)}, the simulated comparison of ${embed(headline.variant.variant.label, 80)} with ${baselineLabel(headline)} across ${headline.variant.runs.length} seeded runs could not tell the change from no change. ${NO_DIRECTION_NOTICE}`;
    writer.add({
      origin: 'unresolved-uncertainty',
      text: answer,
      refs: { findingIds: finding ? [finding.id] : [], variantIds: variantIdsOf(headline) },
    });
    addStability(
      writer,
      facts,
      headline,
      ' With no expected direction of impact it describes the noise of the simulation, and says nothing about the change.',
    );
  } else if (state === 'no-difference' && finding) {
    answer = `With ${engineWords(facts)}, there is no measurable difference under these assumptions: simulated members ended up about the same under ${embed(headline.variant.variant.label, 80)} as under ${baselineLabel(headline)} on the same seed in ${finding.holdsIn} of ${finding.of} paired runs, and no simulated group moved clearly on its own.`;
    writer.add({
      origin: 'simulation-aggregation',
      text: answer,
      refs: { findingIds: [finding.id], variantIds: variantIdsOf(headline) },
      reliance: facts.relianceOf([finding]),
    });
    addStability(
      writer,
      facts,
      headline,
      ' It supports reading the two as about the same under these assumptions, not as the same in the world.',
    );
  } else {
    // The comparison can be read as a result: the answer comes first, in the order a client reads it.
    const written = answerFirst(facts, writer, headline, ahead);
    return { section: writer.build(), headline: written };
  }
  // With no one to move, the answer is itself the biggest caveat.
  const caveat = state === 'no-direction' ? null : caveatOf(facts);
  const caveatStatement = caveat
    ? writer.add({ origin: 'unresolved-uncertainty', text: caveat.text, refs: caveat.refs })
    : null;
  writer.add({ origin: 'unresolved-uncertainty', text: NOT_TOLD_BY_SIGNAL[state] });
  return {
    section: writer.build(),
    headline: clip(caveatStatement ? `${answer} ${caveatStatement.text}` : answer, 700),
  };
}

/**
 * Whether the person has filled in, in the scenario itself, what a question back was about. The
 * reading asks it of the question, and a person who then writes the answer into the field has
 * settled it: listing it as an open point beside the answer would contradict the scenario.
 */
function filledIn(scenario: ScenarioFrame, field: string): boolean {
  const written = (value: string | null): boolean => (value ?? '').trim() !== '';
  const groups = scenario.likelyStakeholders.some((group) => written(group));
  switch (canonicalField(field)) {
    case 'horizon':
      return written(scenario.horizon);
    case 'geography':
      return written(scenario.geography);
    case 'likelyStakeholders':
      return groups;
    case 'system':
      return written(scenario.system) || groups;
    case 'requestedDecision':
      return written(scenario.requestedDecision);
    case 'desiredOutput':
      return written(scenario.desiredOutput);
    default:
      return false;
  }
}

export function decision(facts: Facts, tally: Tally): BriefSection {
  const writer = sectionWriter('decision', tally);
  const { scenario, inputs } = facts;
  writer.add({
    origin: 'user-assumption',
    text: `The question asked: ${embed(inputs.project.question, 400)}`,
    refs: { assumptions: [inputs.project.question] },
  });
  if (!scenario) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'No structured scenario was recorded for this project, so the decision is the question as asked and its changes, baseline and assumptions are not separately stated.',
    });
  } else {
    const origin = scenario.origin === 'user' ? 'user-assumption' : 'system-assumption';
    const owner =
      scenario.origin === 'user'
        ? 'written or accepted by a person'
        : `read from the question by ${scenario.origin === 'model' ? 'a model' : 'rules'} and open to edit`;
    writer.add({
      origin,
      text: `Decision evaluated: ${embed(scenario.decision, 300)}. System affected: ${embed(scenario.system, 200)}. This framing was ${owner}.`,
      refs: { assumptions: [scenario.decision] },
    });
    if (scenario.geography || scenario.horizon) {
      writer.add({
        origin,
        text: `Scope: ${scenario.geography ? `geography ${embed(scenario.geography, 150)}` : 'no geography stated'}; ${scenario.horizon ? `horizon ${embed(scenario.horizon, 150)}` : 'no horizon stated'}.`,
        refs: { assumptions: [scenario.geography ?? '', scenario.horizon ?? ''].filter(Boolean) },
      });
    }
    for (const change of scenario.changes.slice(0, 8)) {
      writer.add({
        origin,
        text: `Change examined: ${embed(change.name, 120)}${change.from ? ` from ${embed(change.from, 100)}` : ''}${change.to ? ` to ${embed(change.to, 100)}` : ''}.`,
        refs: { assumptions: [change.name] },
      });
    }
    if (scenario.baseline.trim()) {
      writer.add({
        origin,
        text: `Baseline, what is expected without the change: ${embed(scenario.baseline, 400)}.`,
        refs: { assumptions: [scenario.baseline] },
      });
    }
    for (const alternative of scenario.alternatives.slice(0, 5)) {
      const simulated = facts.analysis.config.variants.some(
        (variant) => variant.id === alternative.id,
      );
      writer.add({
        origin,
        text: `Alternative named in the scenario: ${embed(alternative.label, 100)}${alternative.description ? `, ${embed(alternative.description, 160)}` : ''}. ${simulated ? 'It was simulated in this analysis.' : 'It was not simulated in this analysis.'}`,
        refs: { assumptions: [alternative.label] },
      });
    }
    if (scenario.requestedDecision || scenario.desiredOutput) {
      writer.add({
        origin,
        text: `The person asked for ${scenario.requestedDecision ? embed(scenario.requestedDecision, 160) : 'no particular decision'}, with the output ${scenario.desiredOutput ? embed(scenario.desiredOutput, 160) : 'in no particular form'}.`,
        refs: {
          assumptions: [scenario.requestedDecision ?? '', scenario.desiredOutput ?? ''].filter(
            Boolean,
          ),
        },
      });
    }
    const open = scenario.ambiguities.filter((ambiguity) => !filledIn(scenario, ambiguity.field));
    for (const ambiguity of open.slice(0, 5)) {
      writer.add({
        origin: 'unresolved-uncertainty',
        text: `Open point in the scenario, ${embed(ambiguity.field, 60)}: ${embed(ambiguity.message, 240)}${ambiguity.question ? ` To settle it: ${embed(ambiguity.question, 160)}` : ''}`,
        refs: { assumptions: [ambiguity.message] },
      });
    }
  }
  const variants = facts.analysis.config.variants;
  const actorName = (id: string): string => embed(facts.actorById.get(id)?.name ?? id, 60);
  /** What a variant sets for particular actors, which is what an intervention is, so that it is not only a label. */
  const sets = (variant: Variant): string => {
    const changes = [
      ...Object.entries(variant.impactOverrides).map(
        ([id, value]) => `the impact on ${actorName(id)} to ${decimals(value)}`,
      ),
      ...variant.traitEdits.map(
        (edit) =>
          `the ${traitLabel(edit.trait)} of ${actorName(edit.actorId)} to ${decimals(edit.value)}`,
      ),
    ];
    if (changes.length === 0) return '';
    const more = changes.length > 3 ? ` and ${changes.length - 3} more` : '';
    return `; it sets ${listed(changes.slice(0, 3))}${more}`;
  };
  const described = (list: typeof variants): string =>
    listed(
      list
        .slice(0, 6)
        .map(
          (variant) =>
            `${embed(variant.label, 60)} (${variant.kind}${variant.kind === 'alternative' ? `, lands in round ${variant.round} at strength ${decimals(variant.intensity)} of 1` : ''}${sets(variant)})`,
        ),
    );
  // A strength or a round the person chose is theirs, and is said to be, as the sensitivity rows do.
  const byPerson = variants.filter(isSetByPerson);
  const bySystem = variants.filter((variant) => !isSetByPerson(variant));
  if (bySystem.length > 0) {
    writer.add({
      origin: 'system-assumption',
      text: `Variants simulated: ${described(bySystem)}. The strength of a change is a setting of the simulation, not a measurement.`,
      refs: {
        variantIds: bySystem.map((variant) => variant.id),
        assumptions: ['Variant settings are assumptions of the simulation.'],
      },
    });
  }
  if (byPerson.length > 0) {
    writer.add({
      origin: 'user-assumption',
      text: `Variants whose strength or timing the person set: ${described(byPerson)}. A setting that was chosen is still a setting of the simulation, not a measurement.`,
      refs: {
        variantIds: byPerson.map((variant) => variant.id),
        assumptions: ['Variant settings were chosen by the person.'],
      },
    });
  }
  return writer.build();
}

export function evidenceBase(facts: Facts, tally: Tally): BriefSection {
  const writer = sectionWriter('evidence-base', tally);
  const { documents, evidence } = facts;
  const cited = evidence.all();
  if (documents.length === 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'No source document is attached to this project, so no statement in this brief rests on supplied or retrieved evidence.',
    });
  }
  for (const origin of [
    'supplied-evidence',
    'retrieved-public-evidence',
    'historical-comparison',
  ] as const) {
    const group = documents.filter((document) => documentOrigin(document) === origin);
    if (group.length === 0) continue;
    const refs = cited.filter((ref) => group.some((document) => document.id === ref.documentId));
    const names = listed(group.slice(0, 5).map((document) => embed(document.name, 60)));
    const what =
      origin === 'supplied-evidence'
        ? 'supplied by the person'
        : origin === 'retrieved-public-evidence'
          ? 'retrieved from public pages by this server'
          : 'supplied as historical material';
    writer.add({
      origin,
      text: `${group.length} source ${plural(group.length, 'document')} ${what}: ${names}${group.length > 5 ? ' and others' : ''}. ${refs.length === 0 ? `No passage from ${plural(group.length, 'it', 'them')} is cited by a stakeholder or an actor` : `${refs.length} cited ${plural(refs.length, 'passage')} from ${plural(group.length, 'it', 'them')} ${plural(refs.length, 'supports', 'support')} the stakeholders and actors`}. A cited passage shows where a statement came from, not that the source is true.`,
      refs: { documentIds: group.map((document) => document.id), evidence: refs },
    });
  }
  const actors = facts.analysis.actors;
  const withoutSupport = actors.filter((actor) => !evidence.supports(actor));
  if (actors.length > 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text:
        withoutSupport.length === 0
          ? `Every one of the ${actors.length} simulated ${plural(actors.length, 'actor')} has at least one cited supporting passage.`
          : `${actors.length - withoutSupport.length} of ${actors.length} simulated actors have at least one cited supporting passage; ${withoutSupport.length} have none${withoutSupport.length <= 6 ? ` (${listed(withoutSupport.map((actor) => embed(actor.name, 40)))})` : ''}.`,
      refs: { stakeholderIds: withoutSupport.map((actor) => actor.stakeholderId) },
    });
  }
  for (const conflict of (facts.ledger?.conflicts ?? []).slice(0, 5)) {
    const open = conflict.status === 'detected' || conflict.status === 'confirmed';
    const left = evidence.documents.get(conflict.left.documentId);
    writer.add({
      origin: documentOrigin(left),
      text: `${open ? 'Open' : 'Closed'} conflict between sources (${conflict.status}): ${embed(conflict.topic, 100)}. ${embed(conflict.left.documentName, 60)} gives ${conflict.leftValue ? embed(conflict.leftValue, 60) : 'one position'} and ${embed(conflict.right.documentName, 60)} gives ${conflict.rightValue ? embed(conflict.rightValue, 60) : 'another'}.`,
      refs: { evidence: [conflict.left, conflict.right] },
    });
  }
  if (facts.ledger === null) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'Conflicts between the sources were not checked for this brief.',
    });
  } else if (facts.ledger.conflicts.length === 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'No conflict between the supplied sources was detected. That does not show that the sources agree.',
    });
  }
  if (facts.ledger?.sufficiency && facts.ledger.sufficiency.level !== 'sufficient') {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: `The evidence ledger rates the evidence behind the report as ${facts.ledger.sufficiency.level}: ${listed(facts.ledger.sufficiency.reasons.slice(0, 3).map((reason) => embed(reason, 120)))}.`,
    });
  }
  for (const missing of (facts.scenario?.evidenceMissing ?? []).slice(0, 6)) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: `Evidence still missing, as the scenario states: ${embed(missing, 200)}.`,
      refs: { assumptions: [missing] },
    });
  }
  for (const available of (facts.scenario?.evidenceAvailable ?? []).slice(0, 4)) {
    writer.add({
      origin: 'user-assumption',
      text: `Evidence the person lists as available: ${embed(available, 200)}. This brief does not check that it was supplied.`,
      refs: { assumptions: [available] },
    });
  }
  return writer.build(['evidence-map']);
}

export function stakeholdersSection(facts: Facts, tally: Tally): BriefSection {
  const writer = sectionWriter('stakeholders', tally);
  const set = facts.inputs.stakeholders;
  const entries = landscape(facts);
  if (set) {
    const by =
      set.discovery.mode === 'rules'
        ? 'rules'
        : set.discovery.mode === 'model'
          ? 'a model'
          : 'a person';
    writer.add({
      origin: 'system-assumption',
      text: `The ${entries.length} stakeholders below were proposed by ${by} and ${set.approvedAt ? `approved by a person on ${set.approvedAt.slice(0, 10)}` : 'have not been approved by a person'}${set.discovery.note ? `: ${embed(set.discovery.note, 200)}` : '.'}`,
      refs: { assumptions: [set.discovery.note || 'Stakeholders were proposed by Swarm.'] },
    });
  } else {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'No stakeholder set was recorded, so the landscape below is read from the simulated actors alone.',
    });
  }
  const shown = entries.slice(0, 26);
  for (const entry of shown) {
    const support =
      entry.supporting + entry.contradicting === 0
        ? 'No passage is cited for it'
        : `${entry.supporting} cited ${plural(entry.supporting, 'passage')} support it${entry.contradicting > 0 ? ` and ${entry.contradicting} ${plural(entry.contradicting, 'contradicts it', 'contradict it')}` : ''}`;
    const population =
      entry.populationSize !== null && entry.populationSize > 1
        ? ` It stands for a population assumed at ${entry.populationSize}, which is not a count.`
        : '';
    writer.add({
      origin: entry.origin,
      text: `${embed(entry.name, 60)} (${STAKEHOLDER_CATEGORY_LABELS[entry.category]}; ${entry.priority} stakeholder${entry.directness ? `, ${entry.directness}` : ''}): ${embed(entry.relevance || 'no reason recorded', 150)}. Expected effect on it: ${entry.direction}${entry.rationale ? `, ${embed(entry.rationale, 100)}` : ''}. ${support}. Uncertainty ${entry.uncertainty.level}: ${embed(entry.uncertainty.reason || 'no reason recorded', 100)}.${population}`,
      refs: {
        stakeholderIds: [entry.id],
        evidence: entry.refs,
        assumptions:
          entry.origin === 'user-assumption'
            ? [entry.relevance || `${entry.name} was set by the person`, ...entry.assumptions]
            : entry.assumptions,
      },
      reliance: relianceOfEvidence(entry.supporting, entry.contradicting),
    });
  }
  if (entries.length > shown.length) {
    const rest = entries.slice(shown.length);
    writer.add({
      origin: 'inferred-stakeholder',
      text: `${rest.length} further ${plural(rest.length, 'stakeholder')} are not listed here (${listed(rest.slice(0, 4).map((entry) => embed(entry.name, 40)))}${rest.length > 4 ? ' and others' : ''}); the evidence map and the exports list every one.`,
      refs: { stakeholderIds: rest.map((entry) => entry.id) },
    });
  }
  if (facts.removedStakeholders.length > 0) {
    writer.add({
      origin: 'user-assumption',
      text: `The person removed ${facts.removedStakeholders.length} proposed ${plural(facts.removedStakeholders.length, 'stakeholder')} from the landscape: ${listed(facts.removedStakeholders.slice(0, 5).map((entry) => embed(entry.name, 50)))}.`,
      refs: {
        stakeholderIds: facts.removedStakeholders.map((entry) => entry.id),
        assumptions: ['Stakeholders removed by the person.'],
      },
    });
  }
  if (facts.mergedStakeholders.length > 0) {
    const merges = facts.mergedStakeholders;
    writer.add({
      origin: 'inferred-stakeholder',
      text: `${merges.length} ${plural(merges.length, 'name')} ${merges.length === 1 ? 'was' : 'were'} merged into another stakeholder because ${merges.length === 1 ? 'it was' : 'they were'} taken to be the same group: ${listed(merges.slice(0, 5).map(({ stakeholder, into }) => `${embed(stakeholder.name, 50)} into ${embed(into.name, 50)}`))}.`,
      refs: {
        stakeholderIds: merges.flatMap(({ stakeholder, into }) => [stakeholder.id, into.id]),
      },
    });
  }
  for (const gap of (set?.gaps ?? []).slice(0, 5)) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: `Nobody was found for: ${embed(gap, 200)}.`,
      refs: { assumptions: [gap] },
    });
  }
  return writer.build(['stakeholder-map']);
}

export function sources(facts: Facts, tally: Tally): BriefSection {
  const writer = sectionWriter('sources', tally);
  const { documents, evidence } = facts;
  const cited = evidence.all();
  for (const document of documents.slice(0, 30)) {
    const refs = uniqueRefs(cited.filter((ref) => ref.documentId === document.id));
    const origin = documentOrigin(document);
    const pages = document.pageCount
      ? `, ${document.pageCount} ${plural(document.pageCount, 'page')}`
      : '';
    writer.add({
      origin,
      text: `${embed(document.name, 80)}${pages}: ${provenanceLine(document)} ${refs.length === 0 ? 'No stakeholder or actor cites a passage from it.' : `${refs.length} ${plural(refs.length, 'passage')} from it ${plural(refs.length, 'is', 'are')} cited.`}`,
      refs: { documentIds: [document.id], evidence: refs },
    });
  }
  if (documents.length === 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: 'No source document is attached to this project.',
    });
  }
  const known = new Set(documents.map((document) => document.id));
  const orphaned = cited.filter((ref) => !known.has(ref.documentId));
  if (orphaned.length > 0) {
    writer.add({
      origin: 'unresolved-uncertainty',
      text: `${orphaned.length} cited ${plural(orphaned.length, 'passage')} refer to ${plural(orphaned.length, 'a document', 'documents')} that ${plural(orphaned.length, 'is', 'are')} no longer in the project, so ${plural(orphaned.length, 'its', 'their')} provenance cannot be shown.`,
    });
  }
  return writer.build();
}
