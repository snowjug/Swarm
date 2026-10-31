import { RESPONSE_CATEGORIES } from '../../../shared/analysis.js';
import type {
  BriefAssumptionRow,
  BriefComparisonRow,
  BriefEvidenceRow,
  BriefLookups,
  BriefOutcomeRow,
  BriefSensitivityRow,
  BriefStakeholderGroup,
  BriefTraitRow,
  BriefVisuals,
} from '../../../shared/brief.js';
import { STAKEHOLDER_CATEGORY_LABELS, TRAIT_KEYS } from '../../../shared/stakeholders.js';
import { sensitivityContext } from './assumptions.js';
import { documentOrigin, provenanceLine } from './evidence.js';
import type { Facts } from './facts.js';
import { landscape } from './landscape.js';
import { baselineOf, pairShares } from './measures.js';
import { oneLine } from './text.js';

/**
 * What the page draws and the exports tabulate, worked out again from the analysis each time it is
 * asked for, so that no chart carries a number the analysis does not hold.
 */

function outcomeRows(facts: Facts): BriefOutcomeRow[] {
  return facts.measures.map((measure) => ({
    variantId: measure.variant.id,
    label: measure.variant.label,
    kind: measure.variant.kind,
    runs: measure.runs.length,
    members: measure.members,
    shares: RESPONSE_CATEGORIES.map((category) => ({
      category,
      ...measure.shares[category],
    })),
    adverseShare: measure.share,
    responses: measure.counts
      ? RESPONSE_CATEGORIES.map((category) => ({
          category,
          ...measure.counts![category],
        }))
      : null,
    adverse: measure.adverseCount,
    perRun: measure.detail === 'runs',
    stanceMean: measure.stance.mean,
  }));
}

function comparisonRows(facts: Facts): BriefComparisonRow[] {
  const baseline = baselineOf(facts.measures);
  return facts.measures
    .filter((measure) => measure.variant.kind === 'alternative')
    .map((measure) => {
      // The engine's own measure, every actor counting equally, needs only what every run keeps.
      const pairing = baseline ? pairShares(measure.runs, baseline.runs) : null;
      const paired = pairing !== null && pairing.pairs > 0;
      const direction =
        facts.analysis.findings.find(
          (finding) =>
            finding.kind === 'direction-vs-baseline' &&
            finding.variantId === measure.variant.id &&
            finding.actorId === null,
        ) ?? null;
      // Counts of simulated members come from the runs or from the totals over them; a mean of
      // paired differences is the difference of the means because both ran the same seeds.
      const countDelta =
        paired && measure.adverseCount && baseline?.adverseCount
          ? measure.adverseCount.mean - baseline.adverseCount.mean
          : null;
      return {
        variantId: measure.variant.id,
        label: measure.variant.label,
        members: measure.members,
        adverseShare: measure.share.mean,
        baselineAdverseShare: baseline?.share.mean ?? null,
        shareDelta: paired ? pairing.delta : null,
        shareDeltaError: paired ? pairing.standardError : null,
        adverseMean: measure.adverseCount?.mean ?? null,
        baselineAdverseMean: baseline?.adverseCount?.mean ?? null,
        adverseDelta: countDelta,
        stanceMean: measure.stance.mean,
        stanceDelta: paired ? pairing.stanceDelta : null,
        pairedRuns: pairing?.pairs ?? 0,
        worseInRuns: pairing?.higher ?? 0,
        findingId: direction?.id ?? null,
        classification: direction?.classification ?? null,
        holdsIn: direction?.holdsIn ?? null,
        of: direction?.of ?? null,
      };
    });
}

function sensitivityRows(facts: Facts): BriefSensitivityRow[] {
  return [...facts.analysis.sensitivity]
    .sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift) || (a.id < b.id ? -1 : 1))
    .slice(0, 30)
    .map((row) => {
      const { origin, evidenced } = sensitivityContext(row, facts.analysis, facts.evidence);
      return {
        id: row.id,
        label: row.label,
        metric: row.metric,
        shift: row.shift,
        standardError: row.standardError,
        classification: row.classification,
        origin,
        evidenced,
      };
    });
}

function registerRows(facts: Facts): BriefAssumptionRow[] {
  return facts.assumptions.map((row) => ({
    id: row.id,
    text: row.text,
    value: row.value,
    origin: row.origin,
    sensitive: row.sensitive,
    evidenced: row.evidenced,
    effect: row.effect,
  }));
}

function stakeholderMap(facts: Facts): BriefStakeholderGroup[] {
  const groups = new Map<string, BriefStakeholderGroup>();
  for (const entry of landscape(facts)) {
    const group = groups.get(entry.category) ?? {
      category: entry.category,
      label: STAKEHOLDER_CATEGORY_LABELS[entry.category],
      stakeholders: [],
    };
    group.stakeholders.push({
      id: entry.id,
      name: entry.name,
      priority: entry.priority,
      direction: entry.direction,
      supporting: entry.supporting,
      contradicting: entry.contradicting,
      uncertainty: entry.uncertainty.level,
      origin: entry.origin,
    });
    groups.set(entry.category, group);
  }
  return [...groups.values()];
}

function evidenceRows(facts: Facts): BriefEvidenceRow[] {
  return landscape(facts).map((entry) => ({
    stakeholderId: entry.id,
    name: entry.name,
    category: entry.category,
    supporting: entry.supporting,
    contradicting: entry.contradicting,
    documents: [...new Set(entry.refs.map((ref) => ref.documentName))].sort(),
    gap: entry.supporting === 0,
  }));
}

function traitRows(facts: Facts): BriefTraitRow[] {
  return facts.analysis.actors.map((actor) => ({
    actorId: actor.id,
    name: actor.name,
    kind: actor.kind,
    members: actor.sampleSize,
    size: actor.size,
    traits: TRAIT_KEYS.map((key) => ({
      key,
      value: actor.traits[key].value,
      spread: actor.traits[key].spread,
      origin: actor.traits[key].origin,
    })),
  }));
}

function lookups(facts: Facts): BriefLookups {
  const names = new Map<string, string>();
  for (const entry of landscape(facts)) names.set(entry.id, entry.name);
  for (const actor of facts.analysis.actors) {
    if (!names.has(actor.stakeholderId)) names.set(actor.stakeholderId, actor.name);
  }
  return {
    findings: facts.analysis.findings.map((finding) => ({
      id: finding.id,
      statement: finding.statement,
      classification: finding.classification,
      holdsIn: finding.holdsIn,
      of: finding.of,
      interval: finding.interval,
    })),
    variants: facts.analysis.config.variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
    })),
    stakeholders: [...names].map(([id, name]) => ({ id, name })),
    documents: facts.documents.map((document) => ({
      id: document.id,
      name: document.name,
      origin: documentOrigin(document),
      provenance: oneLine(provenanceLine(document)),
    })),
  };
}

export function briefVisuals(facts: Facts): BriefVisuals {
  return {
    analysisId: facts.analysis.id,
    runsPerVariant: facts.analysis.config.runsPerVariant,
    stakeholderMap: stakeholderMap(facts),
    outcomeDistribution: outcomeRows(facts),
    scenarioComparison: comparisonRows(facts),
    sensitivity: sensitivityRows(facts),
    assumptionRegister: registerRows(facts),
    evidenceMap: evidenceRows(facts),
    traitTable: traitRows(facts),
    lookups: lookups(facts),
  };
}
