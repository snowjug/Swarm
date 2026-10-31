import {
  ArrowLeftRight,
  Bot,
  Check,
  CircleDot,
  CircleHelp,
  FileText,
  Pencil,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  UserRound,
  Wand2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Stakeholder, TraitOrigin, UncertaintyLevel } from '../../../../shared/stakeholders';
import type { Tone } from '../../lib/ledger';
import { ToneChip } from '../console/LedgerParts';
import {
  DIRECTNESS_LABELS,
  IMPACT_LABELS,
  IMPACT_ORIGIN_LABELS,
  STATUS_LABELS,
  TRAIT_ORIGIN_HELP,
  TRAIT_ORIGIN_LABELS,
  UNCERTAINTY_LABELS,
  stakeholderOriginLabel,
} from './labels';

type Direction = Stakeholder['expectedImpact']['direction'];

const UNCERTAINTY_TONE: Record<UncertaintyLevel, Tone> = {
  low: 'good',
  medium: 'info',
  high: 'caution',
};

const IMPACT_TONE: Record<Direction, Tone> = {
  harmed: 'bad',
  benefited: 'good',
  mixed: 'caution',
  unclear: 'neutral',
};

const IMPACT_ICON: Record<Direction, LucideIcon> = {
  harmed: TrendingDown,
  benefited: TrendingUp,
  mixed: ArrowLeftRight,
  unclear: CircleHelp,
};

const ORIGIN_ICON: Record<Stakeholder['origin'], LucideIcon> = {
  rules: Wand2,
  scenario: FileText,
  model: Bot,
  user: UserRound,
};

/**
 * The expected direction of impact, in words, with where it came from: read from the cited wording,
 * assumed from the category, set by the person or read by a model. An assumed direction has a dashed
 * edge as well, so that it is never mistaken for a finding.
 */
export function ImpactChip({ stakeholder }: { stakeholder: Stakeholder }) {
  const { direction, origin = 'system-assumption', rationale } = stakeholder.expectedImpact;
  const assumed = direction !== 'unclear' && origin === 'system-assumption';
  const label =
    direction === 'unclear'
      ? 'Impact: unclear'
      : `Impact: ${IMPACT_LABELS[direction].toLowerCase()} · ${IMPACT_ORIGIN_LABELS[origin]}`;
  return (
    <span className={assumed ? 'stk-assumed' : undefined}>
      <ToneChip
        tone={IMPACT_TONE[direction]}
        label={label}
        title={rationale || 'No direction of impact is assumed or read for this group.'}
        icon={IMPACT_ICON[direction]}
      />
    </span>
  );
}

/** Whether anything cited supports the stakeholder; if not, it is an assumption and says so. */
function EvidenceChip({ stakeholder }: { stakeholder: Stakeholder }) {
  const cited = stakeholder.evidence.length;
  if (cited === 0) {
    return (
      <span className="stk-assumed">
        <ToneChip
          tone="caution"
          label="Assumption: no cited evidence"
          title="No passage of your sources is cited for this stakeholder."
          icon={TriangleAlert}
        />
      </span>
    );
  }
  return (
    <ToneChip
      tone="good"
      label={`${cited} cited quote${cited === 1 ? '' : 's'}`}
      title="Quotes from your sources, copied word for word."
      icon={FileText}
    />
  );
}

function StatusChip({ stakeholder }: { stakeholder: Stakeholder }) {
  const { status } = stakeholder;
  if (status === 'proposed') {
    return (
      <ToneChip
        tone="info"
        label="Needs review"
        title="Nobody has checked this stakeholder yet."
        icon={CircleDot}
      />
    );
  }
  return (
    <ToneChip
      tone={status === 'removed' ? 'neutral' : 'good'}
      label={STATUS_LABELS[status]}
      icon={
        status === 'edited' || status === 'added'
          ? Pencil
          : status === 'accepted'
            ? Check
            : undefined
      }
    />
  );
}

/** What a person weighs before accepting a stakeholder, each fact in words as well as in colour. */
export function StakeholderChips({ stakeholder }: { stakeholder: Stakeholder }) {
  return (
    <ul className="stk-chips" aria-label={`About ${stakeholder.name}`}>
      <li>
        <ImpactChip stakeholder={stakeholder} />
      </li>
      <li>
        <ToneChip
          tone={UNCERTAINTY_TONE[stakeholder.uncertainty.level]}
          label={UNCERTAINTY_LABELS[stakeholder.uncertainty.level]}
          title={stakeholder.uncertainty.reason}
        />
      </li>
      <li>
        <EvidenceChip stakeholder={stakeholder} />
      </li>
      <li>
        <StatusChip stakeholder={stakeholder} />
      </li>
    </ul>
  );
}

/** How directly the stakeholder is affected and who proposed it: facts for the detail, not the scan. */
export function ProvenanceChips({ stakeholder }: { stakeholder: Stakeholder }) {
  return (
    <ul className="stk-chips" aria-label={`Where ${stakeholder.name} came from`}>
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
          tone="neutral"
          label={stakeholderOriginLabel(stakeholder)}
          title="Who proposed this stakeholder."
          icon={ORIGIN_ICON[stakeholder.origin]}
        />
      </li>
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
