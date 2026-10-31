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
import { baselineOf, pairRuns } from './measures.js';
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
    responses: RESPONSE_CATEGORIES.map((category) => ({
      category,
      ...measure.responses[category],
    })),
    adverse: measure.adverse,
    stanceMean: measure.stance.mean,
  }));
}

function comparisonRows(facts: Facts): BriefComparisonRow[] {
  const baseline = baselineOf(facts.measures);
  return facts.measures
    .filter((measure) => measure.variant.kind === 'alternative')
    .map((measure) => {
      const pairing = baseline ? pairRuns(measure.runs, baseline.runs) : null;
      const direction =
        facts.analysis.findings.find(
          (finding) =>
            finding.kind === 'direction-vs-baseline' &&
            finding.variantId === measure.variant.id &&
            finding.actorId === null,
        ) ?? null;
      return {
        variantId: measure.variant.id,
        label: measure.variant.label,
        members: measure.members,
        adverseMean: measure.adverse.mean,
        baselineAdverseMean: baseline?.adverse.mean ?? null,
        adverseDelta: pairing && pairing.pairs > 0 ? pairing.adverseDelta : null,
        stanceMean: measure.stance.mean,
        stanceDelta: pairing && pairing.pairs > 0 ? pairing.stanceDelta : null,
        pairedRuns: pairing?.pairs ?? 0,
        worseInRuns: pairing?.worse ?? 0,
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
