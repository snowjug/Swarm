import type { ReactNode, Ref } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, Field, Input, Switch } from '../../design/ui';
import { LIMITS } from '../../lib/intake';
import { GUIDANCE_MAX } from './research';
import { Reveal } from './Reveal';
import './Advanced.css';

/** Automatic research: on or off, and when the server cannot do it, off and saying so. */
export function ResearchSwitch({
  available,
  on,
  onChange,
  disabled,
}: {
  available: boolean;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled: boolean;
}) {
  const description = !available
    ? 'Off on this server. Attach your own sources.'
    : on
      ? 'Swarm finds and reads public sources for you.'
      : 'Manual sources only: Swarm reads what you add.';
  return (
    <Switch
      className="sw-ask-research"
      label="Research automatically"
      description={description}
      checked={available && on}
      disabled={disabled || !available}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

/** The button that opens the advanced fields. It says how many of them hold something, so that nothing is hidden. */
export function AdvancedToggle({
  open,
  onToggle,
  controls,
  count,
}: {
  open: boolean;
  /** `keyboard` is whether it was pressed with the keyboard, which is then taken into the fields that opened. */
  onToggle: (keyboard: boolean) => void;
  controls: string;
  count: number;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="sw-ask-adv__toggle"
      aria-expanded={open}
      aria-controls={controls}
      iconEnd={<ChevronDown className="sw-ask-adv__chevron" size={16} aria-hidden="true" />}
      // A press of Enter or Space is a click with no pointer: it has a detail of 0.
      onClick={(event) => onToggle(event.detail === 0)}
    >
      Advanced
      {count > 0 && (
        <>
          {' '}
          <span className="sw-ask__badge num">{count}</span>
          <span className="sr-only"> set</span>
        </>
      )}
    </Button>
  );
}

/**
 * Where the question applies and how research should read: both optional, both the person's own words. The place
 * becomes the geography of the scenario they confirm; the guidance only ranks what research reads. What the person
 * takes as given goes here too.
 */
export function AdvancedPanel({
  id,
  open,
  geography,
  geographyRef,
  onGeography,
  guidance,
  onGuidance,
  researchOn,
  disabled,
  assumptions,
}: {
  id: string;
  open: boolean;
  geography: string;
  /** The first field, for the keyboard to be taken to when the panel is opened with it. */
  geographyRef: Ref<HTMLInputElement>;
  onGeography: (value: string) => void;
  guidance: string;
  onGuidance: (value: string) => void;
  researchOn: boolean;
  disabled: boolean;
  assumptions: ReactNode;
}) {
  return (
    <Reveal id={id} open={open} className="sw-ask-adv">
      <div className="sw-ask-adv__grid">
        <Field label="Geography" hint="Where it applies, if that matters.">
          <Input
            ref={geographyRef}
            value={geography}
            maxLength={LIMITS.geography}
            disabled={disabled}
            placeholder="A country, region or city"
            onChange={(event) => onGeography(event.target.value)}
          />
        </Field>
        <Field
          label="Research guidance"
          hint={
            researchOn
              ? 'Used to rank what research reads, never as an instruction to it.'
              : 'Used by automatic research, which is off.'
          }
        >
          <Input
            value={guidance}
            maxLength={GUIDANCE_MAX}
            disabled={disabled || !researchOn}
            placeholder="For example, official sources only"
            onChange={(event) => onGuidance(event.target.value)}
          />
        </Field>
        <div className="sw-ask-adv__tools">
          {assumptions}
          <span className="sw-ask-field__hint">What Swarm should take as given.</span>
        </div>
      </div>
    </Reveal>
  );
}
