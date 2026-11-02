import { Info } from 'lucide-react';
import { IconButton, Popover, PopoverContent, PopoverTrigger } from '../../design/ui';
import type { Subject } from './model';

/** The picture's own key. Each row draws the thing it names, so that it can be learned by looking. */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg className="sw-legend__glyph" viewBox="0 0 44 28" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export function Legend({ subject }: { subject: Subject }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          label="How to read this map"
          tone="glass"
          size="md"
          className="sw-map__legend-btn"
        >
          <Info size={17} aria-hidden="true" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" width="21rem" className="sw-legend">
        <p className="sw-eyebrow">How to read this</p>
        <dl className="sw-legend__rows">
          <div>
            <dt>
              <Glyph>
                <circle cx="12" cy="14" r="5" className="sw-lg-fill" />
                <circle cx="31" cy="14" r="9" className="sw-lg-fill" />
              </Glyph>
            </dt>
            <dd>
              {subject === 'actors'
                ? 'Larger means more influence'
                : 'Larger means it matters more'}
            </dd>
          </div>
          <div>
            <dt>
              <Glyph>
                <circle cx="6" cy="14" r="5" className="sw-lg-against" />
                <circle cx="17" cy="14" r="5" className="sw-lg-mixed" />
                <circle cx="28" cy="14" r="5" className="sw-lg-favor" />
                <circle cx="39" cy="14" r="5" className="sw-lg-neutral" />
              </Glyph>
            </dt>
            <dd>Colour is the effect: harmed, mixed or benefits. A quiet tint means unclear</dd>
          </div>
          <div>
            <dt>
              <Glyph>
                <circle cx="12" cy="14" r="6" className="sw-lg-fill" />
                <circle cx="12" cy="14" r="10" className="sw-lg-ring" />
                <circle cx="32" cy="14" r="6" className="sw-lg-fill" />
                <circle cx="32" cy="14" r="10" className="sw-lg-ring sw-lg-dash" />
              </Glyph>
            </dt>
            <dd>A solid ring is reached directly; a dashed one, indirectly</dd>
          </div>
          <div>
            <dt>
              <Glyph>
                <circle cx="12" cy="14" r="7" className="sw-lg-fill" />
                <circle cx="32" cy="14" r="7" className="sw-lg-fill sw-lg-faint" />
              </Glyph>
            </dt>
            <dd>Paler means Swarm is less sure</dd>
          </div>
          <div>
            <dt>
              <Glyph>
                <circle cx="22" cy="14" r="6" className="sw-lg-fill" />
                {[0, 1, 2, 3, 4, 5].map((at) => (
                  <circle
                    key={at}
                    cx={22 + Math.cos((at / 6) * Math.PI * 2) * 11}
                    cy={14 + Math.sin((at / 6) * Math.PI * 2) * 11}
                    r="1.5"
                    className="sw-lg-fill"
                  />
                ))}
              </Glyph>
            </dt>
            <dd>Dots around it: a cohort of many, not one actor</dd>
          </div>
          <div>
            <dt>
              <Glyph>
                <path d="M4 20 Q22 4 38 14" className="sw-lg-line" />
                <path d="M33 9l6 5-7 2z" className="sw-lg-head" />
              </Glyph>
            </dt>
            <dd>Lines are relations; an arrow runs one way</dd>
          </div>
        </dl>
        <p className="sw-caption">
          {subject === 'actors'
            ? 'Actors are synthetic stand-ins, not real people. Every number is an assumption you can change.'
            : 'These are groups and roles, found in your evidence or added by you. They are not measurements.'}
        </p>
      </PopoverContent>
    </Popover>
  );
}
