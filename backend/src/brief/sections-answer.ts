import type { BriefRefs, BriefSection, BriefSignal } from '../../../shared/brief.js';
import { CRITIC_ROLE_LABELS } from '../../../shared/critique.js';
import { NO_DIRECTION_NOTICE } from '../../../shared/signal.js';
import { STAKEHOLDER_CATEGORY_LABELS } from '../../../shared/stakeholders.js';
import { effectOf } from './assumptions.js';
import { documentOrigin, provenanceLine, uniqueRefs } from './evidence.js';
import type { Facts } from './facts.js';
import { landscape } from './landscape.js';
import type { Headline } from './measures.js';
import { relianceOfEvidence } from './rules.js';
import { clip, decimals, embed, listed, plural, whole } from './text.js';
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
  'What this does not tell you: how many real people act this way, how fast, or whether the assumptions behind the simulation hold. Simulated members are synthetic stand-ins for groups; the counts above are neither rates nor forecasts.';

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
      text: `Stability: the finding ${embed(finding.statement, 200)} held in ${finding.holdsIn} of ${finding.of} seeded simulated runs (Wilson interval ${decimals(finding.interval.lo)} to ${decimals(finding.interval.hi)}), which the analysis classes as ${classWords(finding.classification)}. There is no confidence score.${reading}`,
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

export function executiveAnswer(
  facts: Facts,
  tally: Tally,
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
    const { variant, baseline, pairing } = headline;
    const base = `With ${engineWords(facts)}, across ${variant.runs.length} seeded runs of ${variant.members} simulated members each, about ${whole(variant.adverse.mean)} simulated members ended up looking for an alternative or resisting under ${embed(variant.variant.label, 80)}`;
    let clause: string;
    if (baseline && pairing && pairing.pairs > 0) {
      const direction =
        pairing.adverseDelta > 0
          ? `more simulated members ended up looking for an alternative or resisting under the change in ${pairing.worse} of ${pairing.pairs} paired runs`
          : pairing.adverseDelta < 0
            ? `fewer simulated members ended up looking for an alternative or resisting under the change in ${pairing.better} of ${pairing.pairs} paired runs`
            : 'the paired runs showed no net difference';
      clause = `, against about ${whole(baseline.adverse.mean)} under ${embed(baseline.variant.label, 80)}; ${direction}.`;
    } else {
      clause = '. No baseline was run, so nothing is compared.';
    }
    answer = `${base}${clause}`;
    writer.add({
      origin: 'simulation-aggregation',
      text: answer,
      refs: { findingIds: finding ? [finding.id] : [], variantIds: variantIdsOf(headline) },
      reliance: finding ? facts.relianceOf([finding]) : 'low',
    });
    addStability(writer, facts, headline, '');
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
    for (const ambiguity of scenario.ambiguities.slice(0, 5)) {
      writer.add({
        origin: 'unresolved-uncertainty',
        text: `Open point in the scenario, ${embed(ambiguity.field, 60)}: ${embed(ambiguity.message, 240)}${ambiguity.question ? ` To settle it: ${embed(ambiguity.question, 160)}` : ''}`,
        refs: { assumptions: [ambiguity.message] },
      });
    }
  }
  const variants = facts.analysis.config.variants;
  const described = variants
    .slice(0, 6)
    .map(
      (variant) =>
        `${embed(variant.label, 60)} (${variant.kind}${variant.kind === 'alternative' ? `, lands in round ${variant.round} at strength ${decimals(variant.intensity)} of 1` : ''})`,
    );
  writer.add({
    origin: 'system-assumption',
    text: `Variants simulated: ${listed(described)}. The strength of a change is a setting of the simulation, not a measurement.`,
    refs: {
      variantIds: variants.map((variant) => variant.id),
      assumptions: ['Variant settings are assumptions of the simulation.'],
    },
  });
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
