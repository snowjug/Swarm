import { useId, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { CAPABILITIES, type CapabilityFlags } from './capabilities';
import { Reveal } from './Reveal';
import './Credibility.css';

/**
 * What every exploration includes, as a line of short words: the things Swarm does, never a claim about how good a
 * result is. Each is drawn only when this server does it. What each means is one press away.
 */
export function Credibility({ flags }: { flags: CapabilityFlags }) {
  const shown = CAPABILITIES.filter((capability) => flags[capability.id]);
  const [open, setOpen] = useState(false);
  const id = useId();
  if (shown.length === 0) return null;
  return (
    <div className="sw-ask-trust">
      <div className="sw-ask-trust__row">
        <ul role="list" className="sw-ask-trust__list" aria-label="What every exploration includes">
          {shown.map((capability) => (
            <li key={capability.id} className="sw-ask-trust__item">
              <Check size={14} aria-hidden="true" />
              {capability.label}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="sw-ask-trust__more"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          What this means
          <ChevronDown className="sw-ask-trust__chevron" size={14} aria-hidden="true" />
        </button>
      </div>
      <Reveal id={id} open={open}>
        <dl className="sw-ask-trust__defs">
          {shown.map((capability) => (
            <div key={capability.id}>
              <dt>{capability.label}</dt>
              <dd>{capability.detail}</dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </div>
  );
}
