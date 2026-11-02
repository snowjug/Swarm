import { Info } from 'lucide-react';
import { IconButton, Popover, PopoverContent, PopoverTrigger } from '../../design/ui';
import { signedNumber } from '../../lib/analysis';
import './legend.css';

/**
 * The key to the colours of a run: a gradient from against to in favour, with the stance it reaches full colour at. The
 * scale follows the run, because stances move by hundredths and a fixed scale would show none of it, so it says what it is.
 */
export function StanceKey({ scale, label = 'Stance' }: { scale: number; label?: string }) {
  return (
    <div className="sw-key">
      <div className="sw-key__scale">
        <span className="sw-key__bar" aria-hidden="true" />
        <span className="sw-key__ends">
          <span>
            Against <span className="sw-mono">{signedNumber(-scale)}</span>
          </span>
          <span>
            In favour <span className="sw-mono">{signedNumber(scale)}</span>
          </span>
        </span>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <IconButton label="How to read the colours" size="sm">
            <Info size={16} aria-hidden="true" />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" width="21rem" className="sw-key__pop">
          <p className="sw-eyebrow">How to read this</p>
          <p>
            {label} is how far each actor leans, from −1 to +1. The colours reach full strength at ±
            {scale}: stances move by hundredths, so the scale follows this run.
          </p>
          <p>
            Larger circles are more influential. A ring around one marks that it set something off
            in this round.
          </p>
          <p className="sw-caption">
            The actors are synthetic stand-ins, not real people. Every number is simulated under
            stated assumptions.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
