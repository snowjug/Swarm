import { forwardRef, useId } from 'react';
import { Globe } from 'lucide-react';
import { Input, Segmented, Select } from '../../design/ui';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { LIMITS } from '../../lib/intake';
import { ADDRESS_MAX, HORIZONS, type HorizonChoice, type Site } from './research';
import './ContextFields.css';

/**
 * The website the person names, if they name one: a site, or one page of it. The field says what it understood
 * ("Site", "Page") and, once it has been left, says gently when it understood nothing. It reads no page: the server
 * validates every address and is the only one that fetches.
 */
export const SiteField = forwardRef<
  HTMLInputElement,
  {
    value: string;
    site: Site;
    onChange: (value: string) => void;
    /** The field has been left, or the person asked with it as it is: only then does it say what looks wrong. */
    seen: boolean;
    onSeen: () => void;
    disabled: boolean;
    /** Automatic research is on: a website is what it starts from. */
    active: boolean;
  }
>(function SiteField({ value, site, onChange, seen, onSeen, disabled, active }, ref) {
  const id = useId();
  const kind = site.kind === 'domain' ? 'Site' : site.kind === 'url' ? 'Page' : null;
  const unclear = active && seen && site.kind === 'unclear';
  const described = [`${id}-optional`, kind && active ? `${id}-kind` : null, `${id}-hint`]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="sw-ask-field sw-ask-site">
      <div className="sw-ask-field__head">
        <label htmlFor={id} className="sw-ask-field__label">
          Website or domain
        </label>
        <span id={`${id}-optional`} className="sw-ask-field__opt">
          {active ? 'optional' : 'used by automatic research'}
        </span>
      </div>
      <div className="sw-ask-site__box">
        <Globe className="sw-ask-site__icon" size={16} aria-hidden="true" />
        <Input
          id={id}
          ref={ref}
          className="sw-ask-site__input"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="example.org"
          maxLength={ADDRESS_MAX}
          value={value}
          disabled={disabled || !active}
          aria-invalid={unclear || undefined}
          aria-describedby={described}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onSeen}
        />
        {kind && active && (
          <span id={`${id}-kind`} className="sw-ask-site__kind">
            {kind}
          </span>
        )}
      </div>
      <p id={`${id}-hint`} className="sw-ask-field__hint">
        {unclear
          ? 'That does not look like a website yet. Try example.org, or the address of one page.'
          : ''}
      </p>
    </div>
  );
});

/**
 * How far ahead the effects are judged, as a few common spans and the person's own words. Not saying is a choice:
 * the reading then asks. A wide screen shows the spans; a phone, where six would not fit in a row, shows a list.
 */
export function HorizonField({
  choice,
  custom,
  onChoice,
  onCustom,
  disabled,
}: {
  choice: HorizonChoice;
  custom: string;
  onChoice: (choice: HorizonChoice) => void;
  onCustom: (value: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  const phone = useMediaQuery('(max-width: 40rem)');
  return (
    <div className="sw-ask-field sw-ask-horizon">
      <div className="sw-ask-field__head">
        <label
          htmlFor={phone ? id : undefined}
          id={`${id}-label`}
          className="sw-ask-field__label"
          aria-hidden={phone ? undefined : true}
        >
          Time horizon
        </label>
      </div>
      {phone ? (
        <Select
          id={id}
          value={choice}
          disabled={disabled}
          onChange={(event) => onChoice(event.target.value as HorizonChoice)}
        >
          {HORIZONS.map((horizon) => (
            <option key={horizon.value} value={horizon.value}>
              {horizon.label}
            </option>
          ))}
        </Select>
      ) : (
        <Segmented
          label="Time horizon"
          value={choice}
          onChange={onChoice}
          options={HORIZONS.map((horizon) => ({
            value: horizon.value,
            label: horizon.label,
            disabled,
          }))}
        />
      )}
      {choice === 'custom' && (
        <Input
          className="sw-ask-horizon__custom"
          aria-label="Your time horizon, in your own words"
          placeholder="For example, the next two quarters"
          autoFocus
          maxLength={LIMITS.horizon}
          value={custom}
          disabled={disabled}
          onChange={(event) => onCustom(event.target.value)}
        />
      )}
    </div>
  );
}
