import type {
  Stakeholder,
  TraitKey,
  TraitOrigin,
  UncertaintyLevel,
} from '../../../../shared/stakeholders';

/** The words the person reads for each fact about a stakeholder. Nothing here is a finding. */

export const PRIORITY_LABELS: Record<Stakeholder['priority'], string> = {
  key: 'Key actor',
  standard: 'Standard cohort',
  background: 'Background cohort',
};

export const PRIORITY_HELP: Record<Stakeholder['priority'], string> = {
  key: 'Modelled as one actor of its own.',
  standard: 'Modelled as a cohort of simulated members.',
  background: 'Modelled as a smaller cohort of simulated members.',
};

export const DIRECTNESS_LABELS: Record<Stakeholder['directness'], string> = {
  direct: 'Direct',
  indirect: 'Indirect',
};

export const IMPACT_LABELS: Record<Stakeholder['expectedImpact']['direction'], string> = {
  harmed: 'Harmed',
  benefited: 'Benefited',
  mixed: 'Mixed',
  unclear: 'Unclear',
};

export const UNCERTAINTY_LABELS: Record<UncertaintyLevel, string> = {
  low: 'Uncertainty: low',
  medium: 'Uncertainty: medium',
  high: 'Uncertainty: high',
};

/** Who proposed a stakeholder. A model's proposal with nothing quoted is said to be inferred. */
export function stakeholderOriginLabel(stakeholder: Stakeholder): string {
  switch (stakeholder.origin) {
    case 'rules':
      return 'Found by reading the text';
    case 'scenario':
      return 'Named in your question';
    case 'model':
      return stakeholder.evidence.length === 0 ? 'Model, inferred' : 'Proposed by a model';
    case 'user':
      return 'Added by you';
  }
}

export const STATUS_LABELS: Record<Stakeholder['status'], string> = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  edited: 'Edited by you',
  added: 'Added by you',
  removed: 'Removed',
};

export const TRAIT_ORIGIN_LABELS: Record<TraitOrigin, string> = {
  'system-assumption': 'assumption',
  evidence: 'evidence',
  model: 'model',
  user: 'you',
};

export const TRAIT_ORIGIN_HELP: Record<TraitOrigin, string> = {
  'system-assumption': 'A starting assumption made by Swarm from the category. Not a finding.',
  evidence: 'Stated by a passage of the evidence.',
  model: 'A model’s reading of the evidence. Check the passages it cites.',
  user: 'Set by you.',
};

export const TRAIT_LABELS: Record<TraitKey, string> = {
  priorStance: 'Starting stance',
  impact: 'Impact on them',
  influence: 'Influence',
  openness: 'Openness',
  sensitivity: 'Sensitivity',
  riskTolerance: 'Risk tolerance',
  switchingCost: 'Switching cost',
  trust: 'Trust',
  adoptionTendency: 'Readiness to adopt',
  authority: 'Authority',
  reactivity: 'Reactivity',
};

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}
