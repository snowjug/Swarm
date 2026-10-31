import { Bot, CircleHelp, FileText, Pencil, UserRound, Wand2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Stakeholder, TraitOrigin, UncertaintyLevel } from '../../../../shared/stakeholders';
import type { Tone } from '../../lib/ledger';
import { ToneChip } from '../console/LedgerParts';
import {
  DIRECTNESS_LABELS,
  PRIORITY_HELP,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TRAIT_ORIGIN_HELP,
  TRAIT_ORIGIN_LABELS,
  UNCERTAINTY_LABELS,
  stakeholderOriginLabel,
} from './labels';

const UNCERTAINTY_TONE: Record<UncertaintyLevel, Tone> = {
  low: 'good',
  medium: 'info',
  high: 'caution',
};

const ORIGIN_ICON: Record<Stakeholder['origin'], LucideIcon> = {
  rules: Wand2,
  scenario: FileText,
  model: Bot,
  user: UserRound,
};

/** The facts about a stakeholder that a person weighs before accepting it, each in words as well as colour. */
export function StakeholderChips({ stakeholder }: { stakeholder: Stakeholder }) {
  return (
    <ul className="stk-chips" aria-label={`About ${stakeholder.name}`}>
      <li>
        <ToneChip
          tone={stakeholder.priority === 'key' ? 'info' : 'neutral'}
          label={PRIORITY_LABELS[stakeholder.priority]}
          title={PRIORITY_HELP[stakeholder.priority]}
          icon={UserRound}
        />
      </li>
      <li>
        <ToneChip
          tone="neutral"
          label={DIRECTNESS_LABELS[stakeholder.directness]}
          title={
            stakeholder.directness === 'direct'
              ? 'Directly affected by the change, or directly able to decide it.'
              : 'Affected by way of others, or able to react to what others do.'
          }
          icon={CircleHelp}
        />
      </li>
      <li>
        <ToneChip
          tone={UNCERTAINTY_TONE[stakeholder.uncertainty.level]}
          label={UNCERTAINTY_LABELS[stakeholder.uncertainty.level]}
          title={stakeholder.uncertainty.reason}
        />
      </li>
      <li>
        <ToneChip
          tone="neutral"
          label={stakeholderOriginLabel(stakeholder)}
          title="Who proposed this stakeholder."
          icon={ORIGIN_ICON[stakeholder.origin]}
        />
      </li>
      {stakeholder.status !== 'proposed' && (
        <li>
          <ToneChip
            tone={stakeholder.status === 'removed' ? 'neutral' : 'good'}
            label={STATUS_LABELS[stakeholder.status]}
            icon={
              stakeholder.status === 'edited' || stakeholder.status === 'added' ? Pencil : undefined
            }
          />
        </li>
      )}
    </ul>
  );
}

/** Where a trait came from, as one word: assumption, evidence, model or you. */
export function OriginBadge({ origin }: { origin: TraitOrigin }) {
  return (
    <span className={`stk-origin stk-origin-${origin}`} title={TRAIT_ORIGIN_HELP[origin]}>
      {TRAIT_ORIGIN_LABELS[origin]}
    </span>
  );
}
