import type { Analysis } from '../../../shared/analysis.js';
import type { DecisionCanvas, Labelled } from '../../../shared/decision.js';
import {
  RESEARCH_STOP_LABELS,
  SOURCE_CATEGORY_LABELS,
  type ResearchRun,
  type SourceCategory,
} from '../../../shared/research.js';
import type { ScenarioFrame } from '../../../shared/scenario.js';
import type { StakeholderSet } from '../../../shared/stakeholders.js';
import { documentOrigin, evidenceIndex, type BriefDocument } from '../brief/evidence.js';
import type { BriefLedgerSummary } from '../brief/facts.js';
import { Guard, clip, embed, listed, plural } from './words.js';

/** At least this share of the cast has to be backed by a cited passage before the evidence is called adequate. */
export const ADEQUATE_SUPPORT_SHARE = 0.5;

export interface EvidenceInput {
  analysis: Pick<Analysis, 'actors'>;
  stakeholders: StakeholderSet | null;
  documents: readonly BriefDocument[];
  /** What the evidence ledger holds, or null when it has not been built or holds no claim to assess. */
  ledger: BriefLedgerSummary | null;
  research: ResearchRun | null;
  scenario: ScenarioFrame | null;
}

export type EvidenceReading = DecisionCanvas['evidence'];

/**
 * What the decision rests on, and how well. It reads only records the project holds (the sources, the
 * passages cited for the cast, the ledger’s conflicts and its sufficiency review, a research run) and
 * says what each one is. How adequate the whole is follows from fixed rules:
 *
 *  - insufficient: the grounding review abstains; or no source is attached; or no actor in the cast
 *    has a cited supporting passage, so every direction of impact is an assumption;
 *  - limited: not insufficient, but the review says limited, a conflict between sources is open, or
 *    fewer than half of the actors have a cited supporting passage;
 *  - adequate: none of the above.
 */
export function readEvidence(input: EvidenceInput, guard: Guard): EvidenceReading {
  const { analysis, documents, ledger, research, scenario } = input;
  const index = evidenceIndex(input.stakeholders, analysis.actors, documents);
  const actors = analysis.actors;
  const unsupported = actors.filter((actor) => !index.supports(actor));
  const supported = actors.length - unsupported.length;
  const origins = documents.map((document) => documentOrigin(document));
  const counts = {
    total: documents.length,
    supplied: origins.filter((origin) => origin === 'supplied-evidence').length,
    retrieved: origins.filter((origin) => origin === 'retrieved-public-evidence').length,
    historical: origins.filter((origin) => origin === 'historical-comparison').length,
  };
  const conflicts = ledger
    ? {
        open: ledger.conflicts.filter(
          (conflict) => conflict.status === 'detected' || conflict.status === 'confirmed',
        ).length,
        total: ledger.conflicts.length,
      }
    : null;
  const review = ledger?.sufficiency ?? null;

  const reasons: string[] = [];
  let level: EvidenceReading['level'] = 'adequate';
  const insufficient: string[] = [];
  if (review?.level === 'insufficient') {
    insufficient.push(
      `The grounding review abstains: ${clip(review.reasons[0] ?? 'the evidence behind it is not strong enough', 200)}`,
    );
  }
  if (documents.length === 0) {
    insufficient.push(
      'No source document is attached, so nothing the comparison rests on is sourced.',
    );
  }
  if (actors.length > 0 && supported === 0) {
    insufficient.push(
      'No simulated actor has a cited supporting passage, so every direction of impact is an assumption.',
    );
  }
  const limited: string[] = [];
  if (review?.level === 'limited') {
    limited.push(
      `The grounding review rates the evidence as limited: ${clip(review.reasons[0] ?? '', 200)}`,
    );
  }
  if (conflicts && conflicts.open > 0) {
    limited.push(
      `${conflicts.open} ${plural(conflicts.open, 'conflict')} between sources ${plural(conflicts.open, 'is', 'are')} still open.`,
    );
  }
  if (actors.length > 0 && supported > 0 && supported / actors.length < ADEQUATE_SUPPORT_SHARE) {
    limited.push(
      `Only ${supported} of ${actors.length} simulated actors have a cited supporting passage.`,
    );
  }
  if (insufficient.length > 0) {
    level = 'insufficient';
    reasons.push(...insufficient);
  } else if (limited.length > 0) {
    level = 'limited';
    reasons.push(...limited);
  }

  const statements: Labelled[] = [];
  statements.push(
    guard.statement(
      counts.total === 0
        ? 'No source document is attached to this project.'
        : `${counts.total} source ${plural(counts.total, 'document')} attached: ${counts.supplied} supplied by a person, ${counts.retrieved} retrieved from public pages by this server and ${counts.historical} supplied as historical material.`,
      'fact',
      'record:documents',
    ),
  );
  if (actors.length > 0) {
    statements.push(
      guard.statement(
        `${supported} of ${actors.length} simulated ${plural(actors.length, 'actor')} ${plural(supported, 'has', 'have')} at least one cited supporting passage. A cited passage shows where a statement came from, not that the source is right.`,
        'fact',
        'record:citations',
      ),
    );
  }
  if (conflicts) {
    statements.push(
      guard.statement(
        conflicts.total === 0
          ? 'No conflict between the sources was detected, which does not show that they agree.'
          : `${conflicts.open} of ${conflicts.total} detected ${plural(conflicts.total, 'conflict')} between sources ${plural(conflicts.open, 'is', 'are')} open: the sources disagree.`,
        'source-claim',
        'ledger:conflicts',
      ),
    );
  }
  if (review) {
    statements.push(
      guard.statement(
        `The grounding review rates the evidence behind the report as ${review.level}.`,
        'model-inference',
        'rule:ledger-sufficiency',
      ),
    );
  }

  let researchReading: EvidenceReading['research'] = null;
  if (research) {
    const used = research.sources.filter((source) => source.outcome === 'used');
    const categories = new Map<SourceCategory, number>();
    for (const source of used)
      categories.set(source.category, (categories.get(source.category) ?? 0) + 1);
    const authority = { high: 0, medium: 0, low: 0, unknown: 0 };
    for (const source of used) authority[source.authority] += 1;
    researchReading = {
      status: research.status,
      pagesRead: research.used.pages,
      pagesUsed: used.length,
      quarantined: research.used.quarantined,
      failed: research.used.failures,
      conflicts: research.conflictCount,
      categories: [...categories]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 10)
        .map(([category, count]) => ({ category, label: SOURCE_CATEGORY_LABELS[category], count })),
      authorityEstimates: authority,
      stoppedBecause: research.stoppedBecause
        ? RESEARCH_STOP_LABELS[research.stoppedBecause]
        : null,
    };
    statements.push(
      guard.statement(
        `Automatic research read ${research.used.pages} ${plural(research.used.pages, 'page')}, used ${used.length} as evidence and set ${research.used.quarantined} aside as unusable.`,
        'fact',
        'record:research',
      ),
    );
    if (used.length > 0) {
      statements.push(
        guard.statement(
          `How reliable each page is was estimated only from the kind of site: ${authority.high} high, ${authority.medium} medium, ${authority.low} low and ${authority.unknown} unknown. The estimate is not a verdict on whether a page is right.`,
          'assumption',
          'estimate:source-authority',
        ),
      );
    }
  }
  const missing = (scenario?.evidenceMissing ?? []).slice(0, 6).map((item) => clip(item, 240));
  if (missing.length > 0) {
    statements.push(
      guard.statement(
        `Evidence the scenario says is still missing: ${listed(missing.slice(0, 3).map((item) => embed(item, 80)))}.`,
        'validation-requirement',
        'scenario:evidence-missing',
      ),
    );
  }
  return {
    level,
    reasons: reasons.slice(0, 8).map((reason) => guard.say(reason, 300)),
    documents: counts,
    actors: {
      total: actors.length,
      supported,
      unsupported: unsupported.slice(0, 6).map((actor) => clip(actor.name, 120)),
    },
    conflicts,
    ledger: {
      assessed: review !== null,
      level: review?.level ?? null,
      reasons: (review?.reasons ?? []).slice(0, 4).map((reason) => clip(reason, 300)),
    },
    research: researchReading,
    missing,
    statements: statements.slice(0, 8),
  };
}
