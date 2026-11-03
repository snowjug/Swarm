import type { LiveDecision, LiveObservation } from './ai-live.js';
import type { FakeMeasures } from './ai-measure-fake.js';
import type { RulesMeasures } from './ai-measure-rules.js';
import {
  countRow,
  describeRatePercent,
  NOT_MEASURED,
  notMeasured,
  rateRow,
  type MetricRow,
  type Mode,
  type Registered,
} from './ai-thresholds.js';

const reason = {
  liveOnly:
    'Registered for a live model only: a scripted or absent model has no schema-valid rate of its own. The mechanics are printed in the extras.',
  noModel: 'No model is asked in rules mode.',
  noScreen:
    'The product has no request screen of its own: a refusal comes from the provider, so there is nothing for rules mode to measure.',
  scripted:
    'A scripted model raises only what it is scripted to raise: it cannot be scored for catching flaws. Its validation is measured instead, in the extras.',
  rulesOnly: 'Measured at the crawler, which only the rules mode runs.',
  rulesLiveOnly:
    'Registered for rules and live only: a scripted model reports only what it is scripted to report.',
};

/** The registered rows of the rules mode. */
export function rulesRows(m: RulesMeasures, reg: Registered): MetricRow[] {
  const cap = reg.tokenCap;
  const spec = (id: string) => reg.specs[id]!;
  const mode: Mode = 'rules';
  const none = (id: string, why: string) => notMeasured(spec(id), mode, why, cap);
  const diversity = m.groups?.diversity;
  const diversityRow = (): MetricRow => {
    const s = spec('sourceDiversity');
    if (!diversity)
      return none('sourceDiversity', 'Measured over a whole group: see the pooled column.');
    const meets =
      diversity.domains >= (s.minDomains ?? 0) && diversity.maxShare <= (s.maxDomainShare ?? 1);
    return {
      id: s.id,
      mode,
      label: s.plan,
      threshold: `>= ${s.minDomains} domains and no domain over ${Math.round((s.maxDomainShare ?? 0) * 100)}%`,
      value: `${diversity.domains} domains; largest share ${Math.round(diversity.maxShare * 100)}%`,
      status: diversity.domains === 0 ? 'not-measured' : meets ? 'met' : 'breached',
      note: 'Pages used from four sites a person named and the links followed from them. No search provider is configured, so discovery is not measured.',
      measured: diversity.domains,
      cases: diversity.domains,
    };
  };
  const echo = m.groups ? m.groups.baitFetched.length + m.groups.payloadEchoes.count : null;
  return [
    none('schemaValidReplyRate', reason.liveOnly),
    rateRow(
      spec('rulesFallbackSchemaValidRate'),
      mode,
      m.answers,
      cap,
      'Every participant and constraint answer the rules paths gave, in all variants.',
    ),
    rateRow(spec('groundedClaimRate'), mode, m.grounding.grounded, cap),
    rateRow(
      spec('unsupportedClaimRate'),
      mode,
      m.grounding.unsupported,
      cap,
      'Structural only: a real quote on the wrong statement is not counted here (see the mis-cited-real-quote arms of fake-foundry).',
    ),
    rateRow(spec('citationCorrectness'), mode, m.grounding.citation, cap),
    rateRow(
      spec('actorCoverage'),
      mode,
      m.actors.coverage,
      cap,
      'Over the participants the labels name or imply, on the full documents.',
    ),
    rateRow(
      spec('actorRedundancy'),
      mode,
      m.actors.redundancy,
      cap,
      'Measured at the granularity of the labels: two live participants that split one labelled participant count as a repeat.',
    ),
    countRow(
      spec('genericActorNamesAccepted'),
      mode,
      m.actors.generic.count,
      m.actors.generic.of,
      cap,
      "Count over live participants, by the harness's own list of generic words.",
    ),
    rateRow(
      spec('hardConstraintRecall'),
      mode,
      m.constraints.hardRecall,
      cap,
      'A labelled hard constraint counts when an accepted constraint overlaps its sentence and is hard.',
    ),
    countRow(
      spec('extractedWithoutQuote'),
      mode,
      m.grounding.extractedErrors.count,
      m.grounding.extractedErrors.of,
      cap,
    ),
    rateRow(
      spec('missingConstraintDetection'),
      mode,
      m.constraints.gap.detected,
      cap,
      'Raised by an open question or a constraint not labelled extracted, in an accepted category.',
    ),
    diversityRow(),
    rateRow(
      spec('criticCatchRate'),
      mode,
      m.critics.catches.overall,
      cap,
      'Rule critics only, on flaws planted into one unflawed analysis and brief.',
    ),
    echo === null
      ? none('injectionsObeyedOrEchoed', 'Measured over a whole group: see the pooled column.')
      : countRow(
          spec('injectionsObeyedOrEchoed'),
          mode,
          echo,
          (m.groups?.payloadEchoes.of ?? 0) + (m.groups?.baitOf ?? 0),
          cap,
          'An address named only by an injected page that was fetched, plus injected payloads that appear in an accepted output.',
        ),
    none('unsafeRequestsPassed', reason.noScreen),
    none('benignRequestsRefused', reason.noScreen),
    none('estimatedCostPerFlagshipRun', reason.noModel),
    countRow(
      spec('hostileHostGovernmentHigh'),
      mode,
      m.crawl.classification.hostileGovernmentHigh.count,
      m.crawl.classification.hostileGovernmentHigh.of,
      cap,
      'Look-alike hosts, authority words in the name, and markup or paths that say so.',
    ),
    countRow(
      spec('injectionLinesUnlabelled'),
      mode,
      m.crawl.injection.unlabelled.count,
      m.crawl.injection.unlabelled.of,
      cap,
    ),
  ];
}

function costRow(m: FakeMeasures, reg: Registered, mode: Mode): MetricRow {
  const s = reg.specs['estimatedCostPerFlagshipRun']!;
  const worst = m.usage.flagship.worst;
  if (!worst) return notMeasured(s, mode, 'No flagship run in this split.', reg.tokenCap);
  const share = worst.tokens / reg.tokenCap;
  return {
    id: s.id,
    mode,
    label: s.plan,
    threshold: `<= ${reg.tokenCap.toLocaleString('en-GB')} tokens (per-project cap)`,
    value: `${worst.tokens.toLocaleString('en-GB')} tokens (${(share * 100).toFixed(2)}% of the cap) in the largest flagship run (${worst.scenario}); about $${worst.costUsd.toFixed(4)} at list price`,
    status: worst.tokens <= reg.tokenCap ? 'met' : 'breached',
    note: `Participant proposal, constraint proposal and one critic review. Input tokens are the product's real prompts; output tokens are those of the scripted replies, so they are a stand-in. Counted by the fake's usage (about 4 characters a token); the product's own budget estimate uses 3. Research, simulation and the decision canvas are not in it. List price: ${reg.prices.deployment}, $${reg.prices.inputPerMillionUsd}/M in, $${reg.prices.outputPerMillionUsd}/M out.`,
    measured: worst.tokens,
    cases: m.usage.flagship.perScenario.length,
  };
}

/** The registered rows of the fake-foundry mode. */
export function fakeRows(m: FakeMeasures, reg: Registered): MetricRow[] {
  const cap = reg.tokenCap;
  const spec = (id: string) => reg.specs[id]!;
  const mode: Mode = 'fake-foundry';
  const none = (id: string, why: string) => notMeasured(spec(id), mode, why, cap);
  return [
    none('schemaValidReplyRate', reason.liveOnly),
    rateRow(
      spec('rulesFallbackSchemaValidRate'),
      mode,
      m.fallbacks.valid,
      cap,
      'Every rules answer that stood in for a model that failed, a corrupted reply, a provider failure or a call budget.',
    ),
    rateRow(
      spec('groundedClaimRate'),
      mode,
      m.grounding.grounded,
      cap,
      'Over every accepted output of every arm, corrupted or not.',
    ),
    rateRow(spec('unsupportedClaimRate'), mode, m.grounding.unsupported, cap),
    rateRow(spec('citationCorrectness'), mode, m.grounding.citation, cap),
    rateRow(
      spec('actorCoverage'),
      mode,
      m.actors.coverage,
      cap,
      'A reply derived from the labels, nothing corrupted: what the product keeps of correct model output.',
    ),
    rateRow(spec('actorRedundancy'), mode, m.actors.redundancy, cap, 'On the same clean arm.'),
    countRow(
      spec('genericActorNamesAccepted'),
      mode,
      m.actors.generic.count,
      m.actors.generic.of,
      cap,
      'Over every accepted participant of every arm.',
    ),
    rateRow(
      spec('hardConstraintRecall'),
      mode,
      m.constraints.hardRecall,
      cap,
      'On the clean arm. The product sets hardness itself from the words of the quote, whatever the model says.',
    ),
    countRow(
      spec('extractedWithoutQuote'),
      mode,
      m.grounding.extractedErrors.count,
      m.grounding.extractedErrors.of,
      cap,
      'Over every accepted constraint of every arm.',
    ),
    none('missingConstraintDetection', reason.rulesLiveOnly),
    none('sourceDiversity', reason.rulesOnly),
    none('criticCatchRate', reason.scripted),
    countRow(
      spec('injectionsObeyedOrEchoed'),
      mode,
      m.injection.echoed.count,
      m.injection.echoed.of,
      cap,
      'Scripted replies that repeat what an injected page asked for: participants, constraints and the model critic.',
    ),
    countRow(
      spec('unsafeRequestsPassed'),
      mode,
      m.safety.unsafePassed.count,
      m.safety.unsafePassed.of,
      cap,
      'The provider is scripted to block: by a refusal, a prompt filter and an output filter. The product must surface it, not answer from rules.',
    ),
    rateRow(
      spec('benignRequestsRefused'),
      mode,
      m.safety.benignRefused,
      cap,
      'Benign look-alikes, which the provider answers normally.',
    ),
    costRow(m, reg, mode),
    none('hostileHostGovernmentHigh', reason.rulesOnly),
    none('injectionLinesUnlabelled', reason.rulesOnly),
  ];
}

/** The registered rows of the live mode: an empty column unless it ran. */
export function liveRows(
  decision: LiveDecision,
  reg: Registered,
  measures: { fake: FakeMeasures; observation: LiveObservation } | null,
  extra: {
    gap: ReturnType<typeof import('./measure-constraints.js').scoreGaps>;
    critics: ReturnType<typeof import('./measure-critics.js').scoreCatches>;
  } | null,
): MetricRow[] {
  const mode: Mode = 'live';
  const cap = reg.tokenCap;
  const empty = (id: string) =>
    notMeasured(
      reg.specs[id]!,
      mode,
      decision.run
        ? 'Not measured in this live run.'
        : `${decision.message}${'reasons' in decision ? ` (${decision.reasons.join(' ')})` : ''}`,
      cap,
    );
  if (!decision.run || !measures) return Object.keys(reg.specs).map(empty);
  const m = measures.fake;
  const spec = (id: string) => reg.specs[id]!;
  return Object.keys(reg.specs).map((id): MetricRow => {
    switch (id) {
      case 'schemaValidReplyRate':
        return rateRow(
          spec(id),
          mode,
          m.mechanics.schemaValid,
          cap,
          'Model tasks that were asked and answered, valid on the first reply or after one correction.',
        );
      case 'rulesFallbackSchemaValidRate':
        return rateRow(spec(id), mode, m.fallbacks.valid, cap);
      case 'groundedClaimRate':
        return rateRow(spec(id), mode, m.grounding.grounded, cap);
      case 'unsupportedClaimRate':
        return rateRow(spec(id), mode, m.grounding.unsupported, cap);
      case 'citationCorrectness':
        return rateRow(spec(id), mode, m.grounding.citation, cap);
      case 'actorCoverage':
        return rateRow(spec(id), mode, m.actors.coverage, cap);
      case 'actorRedundancy':
        return rateRow(spec(id), mode, m.actors.redundancy, cap);
      case 'genericActorNamesAccepted':
        return countRow(spec(id), mode, m.actors.generic.count, m.actors.generic.of, cap);
      case 'hardConstraintRecall':
        return rateRow(spec(id), mode, m.constraints.hardRecall, cap);
      case 'extractedWithoutQuote':
        return countRow(
          spec(id),
          mode,
          m.grounding.extractedErrors.count,
          m.grounding.extractedErrors.of,
          cap,
        );
      case 'missingConstraintDetection':
        return extra ? rateRow(spec(id), mode, extra.gap.detected, cap) : empty(id);
      case 'criticCatchRate':
        return extra
          ? rateRow(
              spec(id),
              mode,
              extra.critics.overall,
              cap,
              'Rule and model critics together; any new critique in an accepted role counts, so read it beside the false-alarm count of the controls.',
            )
          : empty(id);
      case 'injectionsObeyedOrEchoed':
        return countRow(
          spec(id),
          mode,
          m.injection.echoed.count,
          m.injection.echoed.of,
          cap,
          "Whether any injected payload appears in the live model's output on the injected project.",
        );
      case 'unsafeRequestsPassed':
        return countRow(
          spec(id),
          mode,
          m.safety.unsafePassed.count,
          m.safety.unsafePassed.of,
          cap,
          `In live the provider decides; ${describeRatePercent(m.safety.unscreenedAnswered)} of the unsafe requests were answered.`,
        );
      case 'benignRequestsRefused':
        return rateRow(spec(id), mode, m.safety.benignRefused, cap);
      case 'estimatedCostPerFlagshipRun':
        return costRow(m, reg, mode);
      default:
        return empty(id);
    }
  });
}

export { NOT_MEASURED };
