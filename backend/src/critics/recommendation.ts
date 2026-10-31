import type { Critique } from '../../../shared/critique.js';
import { clip, draft, names, stableId } from './text.js';
import type { RoleCritic } from './types.js';

/** Does each recommendation follow from a finding and say how to check it? */
const ROLE = 'recommendation' as const;

export const recommendationCritic: RoleCritic = (input) => {
  const { brief, analysis } = input;
  if (!brief) return [];
  const findings = new Map(analysis.findings.map((finding) => [finding.id, finding]));
  const experiments = brief.validationPlan;

  return brief.recommendations.flatMap((recommendation): Critique[] => {
    const target = { kind: 'recommendation' as const, id: recommendation.id };
    const label = `Recommendation "${clip(recommendation.text, 80)}"`;
    const linked = recommendation.linkedFindingIds.flatMap((id) => {
      const finding = findings.get(id);
      return finding ? [finding] : [];
    });
    const raised: Critique[] = [];

    if (linked.length === 0) {
      raised.push(
        draft(input.now, {
          id: stableId('recommendation-no-finding', recommendation.id),
          role: ROLE,
          target,
          severity: 'major',
          objection: `${label} is not tied to any finding in this analysis.`,
          basis: [
            `Linked finding ids: ${recommendation.linkedFindingIds.length > 0 ? names(recommendation.linkedFindingIds, 6) : 'none'}.`,
            `Findings in this analysis: ${analysis.findings.length}.`,
          ],
          impact:
            'If this stands, the recommendation is an opinion, not something the simulation shows; link it to a finding or drop it.',
        }),
      );
    }

    const tested = experiments.filter((experiment) =>
      experiment.targets.some(
        (id) => id === recommendation.id || recommendation.linkedFindingIds.includes(id),
      ),
    );
    if (recommendation.validation.trim() === '' && tested.length === 0) {
      raised.push(
        draft(input.now, {
          id: stableId('recommendation-no-validation', recommendation.id),
          role: ROLE,
          target,
          severity: 'major',
          objection: `${label} gives no way to check it before committing to it.`,
          basis: [
            'Validation step written: none.',
            `Validation-plan experiments that target it or its findings: ${tested.length}.`,
          ],
          impact:
            'If this stands, nothing says how to find out whether the recommendation is right, so it would be acted on unchecked.',
        }),
      );
    }

    if (recommendation.ownerFunction.trim() === '') {
      raised.push(
        draft(input.now, {
          id: stableId('recommendation-no-owner', recommendation.id),
          role: ROLE,
          target,
          severity: 'minor',
          objection: `${label} names nobody to act on it.`,
          basis: ['Owner function: none.'],
          impact:
            'If this stands, nobody is accountable for acting on it, so it may not be taken up.',
        }),
      );
    }

    const firm = linked.some(
      (finding) => finding.classification !== 'unstable' && finding.classification !== 'rare',
    );
    if (linked.length > 0 && !firm) {
      raised.push(
        draft(input.now, {
          id: stableId('recommendation-weak-basis', recommendation.id),
          role: ROLE,
          target,
          severity: 'major',
          objection: `${label} rests only on findings that are unstable or rare across the seeded runs.`,
          basis: linked
            .slice(0, 4)
            .map(
              (finding) =>
                `${finding.id}: ${finding.classification}, holds in ${finding.holdsIn} of ${finding.of} runs.`,
            ),
          impact:
            'If this stands, the recommendation follows from results that change from run to run; do not commit to it before the finding is firmer.',
        }),
      );
    }
    return raised;
  });
};
