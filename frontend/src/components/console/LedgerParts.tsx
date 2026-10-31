import { CircleCheck, CircleHelp, CircleX, Contrast, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { EvidenceSufficiency } from '../../../../shared/evidence';
import type { ChatGrounding } from '../../../../shared/types';
import {
  CHAT_GROUNDING,
  SUFFICIENCY_HEADLINE,
  SUFFICIENCY_TONE,
  type Tone,
} from '../../lib/ledger';

// A different glyph per tone, so meaning never depends on colour.
const TONE_ICONS: Record<Tone, LucideIcon> = {
  good: CircleCheck,
  caution: Contrast,
  bad: CircleX,
  neutral: CircleHelp,
  info: Info,
};

export function ToneChip({
  tone,
  label,
  title,
  icon,
}: {
  tone: Tone;
  label: string;
  title?: string;
  /** A glyph that says more than the tone's own, where the tone's would mislead (a state is not a doubt). */
  icon?: LucideIcon;
}) {
  const Icon = icon ?? TONE_ICONS[tone];
  return (
    <span className={`tone-chip tone-${tone}`} title={title}>
      <Icon size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Whether a chat answer rests on the project's evidence, and what the reader should make of it. */
export function ChatGroundingNote({ grounding }: { grounding: ChatGrounding }) {
  const view = CHAT_GROUNDING[grounding.status] ?? CHAT_GROUNDING.uncited;
  return (
    <div className={`chat-grounding chat-grounding-${view.tone}`}>
      <ToneChip tone={view.tone} label={view.label} />
      <p>{view.meaning}</p>
      {grounding.notes.length > 0 && (
        <ul>
          {grounding.notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Whether the evidence is strong enough for a recommendation, decided by a fixed rule, never a model. */
export function SufficiencyBanner({ sufficiency }: { sufficiency: EvidenceSufficiency }) {
  const tone = SUFFICIENCY_TONE[sufficiency.level];
  const Icon = TONE_ICONS[tone];
  return (
    <div className={`sufficiency sufficiency-${tone}`} role="status">
      <h3>
        <Icon size={17} aria-hidden="true" />
        {SUFFICIENCY_HEADLINE[sufficiency.level]}
      </h3>
      {sufficiency.directlySupportedShare !== null && (
        <p className="sufficiency-figure">
          {`${Math.round(sufficiency.directlySupportedShare * 100)}% of the statements that rest on a source are directly supported by it.`}
        </p>
      )}
      {sufficiency.reasons.length > 0 && (
        <ul>
          {sufficiency.reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
