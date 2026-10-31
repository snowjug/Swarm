import { CRITIC_ROLES, type Critique } from '../../../shared/critique.js';
import type { EvidenceRef } from '../../../shared/evidence.js';
import { adversarialCritic } from './adversarial.js';
import { assumptionCritic } from './assumption.js';
import { biasCritic } from './bias.js';
import { coverageCritic } from './coverage.js';
import { evidenceCritic } from './evidence.js';
import { methodologyCritic } from './methodology.js';
import { recommendationCritic } from './recommendation.js';
import { byText, severityRank } from './text.js';
import type { CriticInput, Facts, Resolved, RoleCritic } from './types.js';

/** In the order the roles are listed in `CRITIC_ROLES`. */
const CRITICS: readonly RoleCritic[] = [
  evidenceCritic,
  assumptionCritic,
  methodologyCritic,
  coverageCritic,
  biasCritic,
  recommendationCritic,
  adversarialCritic,
];

function gather(input: CriticInput): Facts {
  const stakeholders = (input.stakeholders?.stakeholders ?? []).filter(
    (stakeholder) => stakeholder.status !== 'removed',
  );
  const cited = new Map<string, EvidenceRef>();
  for (const stakeholder of stakeholders) {
    for (const ref of stakeholder.evidence) {
      if (!cited.has(ref.passageId)) cited.set(ref.passageId, ref);
    }
  }
  const citedByDocument = new Map<string, EvidenceRef[]>();
  for (const ref of cited.values()) {
    const group = citedByDocument.get(ref.documentId);
    if (group) group.push(ref);
    else citedByDocument.set(ref.documentId, [ref]);
  }
  return { stakeholders, cited: [...cited.values()], citedByDocument };
}

/** Most severe first, then by role in the order of `CRITIC_ROLES`, then by id. */
export function sortCritiques(critiques: readonly Critique[]): Critique[] {
  return [...critiques].sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      CRITIC_ROLES.indexOf(a.role) - CRITIC_ROLES.indexOf(b.role) ||
      byText(a.id, b.id),
  );
}

/**
 * The deterministic critics. Pure: the same input gives the same critiques, in the same order, with
 * the same ids. Nothing here reads a clock (unless the caller gives no time), a network or a model.
 */
export function runRuleCritics(input: CriticInput): Critique[] {
  const resolved: Resolved = {
    ...input,
    brief: input.brief ?? null,
    now: input.now ?? new Date().toISOString(),
    facts: gather(input),
  };
  const unique = new Map<string, Critique>();
  for (const critic of CRITICS) {
    for (const critique of critic(resolved)) {
      if (!unique.has(critique.id)) unique.set(critique.id, critique);
    }
  }
  return sortCritiques([...unique.values()]);
}
