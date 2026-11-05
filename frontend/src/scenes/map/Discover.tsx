import { Plus, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { m } from 'motion/react';
import type { ModelAvailability } from '../../../../shared/stakeholders';
import { cx } from '../../design/cx';
import { Button, Disclosure } from '../../design/ui';
import { SPRING, stagger } from '../../design/motion';
import './discover.css';

export type FindMode = 'rules' | 'model';

/** What each way of finding stakeholders costs and cannot do, said before the person chooses one. */
export function FindExplanation({ model }: { model: ModelAvailability }) {
  return (
    <dl className="sw-how">
      <div>
        <dt>Reading the text for roles</dt>
        <dd>
          No model is used. Swarm looks for role words (customers, administrators, regulators and
          the like), the groups your question names and the people and organisations in your source
          graph, and quotes the sentence for each. It is always available, and it misses groups it
          has no word for.
        </dd>
      </div>
      <div>
        <dt>Asking the model</dt>
        <dd>
          Sends your source text to the model, which proposes stakeholders with quotes. Swarm checks
          every quote against your sources: one it cannot find is dropped. A stakeholder left
          without a quote is kept, marked inferred, only if your question or scenario names that
          group; otherwise it is dropped. If the model fails, Swarm stops and says what failed: you
          can ask the model again, edit the participants yourself, or continue with rules. A list
          the rules make after a model failed is labelled “Participants from the rules fallback”
          wherever it is shown, and is never presented as the model’s.
          {!model.available && model.reason && (
            <span className="sw-how__hint"> Not available here: {model.reason}</span>
          )}
        </dd>
      </div>
    </dl>
  );
}

/** The truth about what is on this page, said in full where there is room. */
export const SYNTHETIC_NOTE =
  'Stakeholders are the groups and roles around a change. The actors made from them are synthetic stand-ins, not real people, and every number they carry is a modelling assumption you can change. Swarm explores scenarios; it does not predict what real people will do.';

/** The same truth in a line, for where the full note would push the main action away. */
export const SYNTHETIC_LINE =
  'Actors are synthetic stand-ins, not real people: every number is an assumption you can change.';

const DOTS = [
  { a: 8, r: 1, c: 'cat-1', s: 9 },
  { a: 52, r: 2, c: 'cat-2', s: 7 },
  { a: 96, r: 1, c: 'cat-3', s: 8 },
  { a: 141, r: 3, c: 'cat-4', s: 6 },
  { a: 188, r: 2, c: 'cat-5', s: 9 },
  { a: 232, r: 1, c: 'cat-6', s: 7 },
  { a: 274, r: 3, c: 'cat-7', s: 6 },
  { a: 318, r: 2, c: 'cat-8', s: 8 },
  { a: 28, r: 3, c: 'cat-3', s: 5 },
  { a: 166, r: 1, c: 'cat-1', s: 6 },
] as const;

/** A change at the centre and the parties that gather around it: still when waiting, drawn in while looking. */
function DiscoverArt({ working }: { working: boolean }) {
  return (
    <div className={cx('sw-discover__art', working && 'is-working')} aria-hidden="true">
      <svg viewBox="-160 -120 320 240" focusable="false">
        {[44, 82, 120].map((radius, index) => (
          <ellipse
            key={radius}
            className={`sw-da-ring sw-da-ring--${index + 1}`}
            rx={radius}
            ry={radius * 0.72}
          />
        ))}
        <g className="sw-da-scan">
          <path d="M0 0 L124 0" />
        </g>
        {DOTS.map((dot, index) => {
          const radius = [44, 82, 120][dot.r - 1]!;
          const x = Math.cos((dot.a * Math.PI) / 180) * radius;
          const y = Math.sin((dot.a * Math.PI) / 180) * radius * 0.72;
          return (
            <g key={index} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
              <g
                className="sw-da-dot"
                style={
                  { '--d': `${index * 0.37}s`, color: `var(--${dot.c})` } as React.CSSProperties
                }
              >
                <line className="sw-da-tie" x1="0" y1="0" x2={-x} y2={-y} />
                <circle r={dot.s * 1.9} className="sw-da-halo" />
                <circle r={dot.s} className="sw-da-core" />
              </g>
            </g>
          );
        })}
        <circle className="sw-da-center-halo" r="22" />
        <circle className="sw-da-center" r="9" />
      </svg>
    </div>
  );
}

export interface DiscoverProps {
  model: ModelAvailability;
  may: { edit: boolean; run: boolean };
  working: boolean;
  pending: FindMode | null;
  onFind: (mode: FindMode) => void;
  onAdd: () => void;
  notice?: ReactNode;
}

/**
 * Before anything is found: the change at the centre, an invitation to look for who it touches, and the one
 * line that must be known first. While the search runs the picture draws the parties in.
 */
export function Discover({ model, may, working, pending, onFind, onAdd, notice }: DiscoverProps) {
  const modelMain = model.available;
  return (
    <section className="sw-discover" aria-labelledby="discover-title">
      <m.div
        className="sw-discover__body"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING.gentle, delay: stagger(1) }}
      >
        <DiscoverArt working={working} />
        <h1 id="discover-title" className="sw-display sw-discover__title">
          Who is <em>in play</em>?
        </h1>
        <p className="sw-lead sw-discover__lead">
          Swarm reads your evidence for the groups this change touches, and quotes what it found
          them in.
        </p>
        {notice}
        {may.run ? (
          <div className="sw-discover__actions">
            <Button
              variant="accent"
              size="lg"
              busy={working && pending === (modelMain ? 'model' : 'rules')}
              busyLabel={pending === 'model' ? 'Asking the model' : 'Reading your evidence'}
              disabled={working}
              icon={<Search size={18} aria-hidden="true" />}
              onClick={() => onFind(modelMain ? 'model' : 'rules')}
              data-stk-focus="primary"
            >
              Find who is affected
            </Button>
            {modelMain && (
              <Button
                variant="glass"
                size="lg"
                busy={working && pending === 'rules'}
                disabled={working}
                onClick={() => onFind('rules')}
              >
                Read the text instead
              </Button>
            )}
            {may.edit && (
              <Button
                variant="ghost"
                size="lg"
                icon={<Plus size={17} aria-hidden="true" />}
                disabled={working}
                onClick={onAdd}
                data-stk-focus="by-hand"
              >
                Add one yourself
              </Button>
            )}
          </div>
        ) : (
          <p className="sw-caption">
            You can read the stakeholders but not run this: it needs the right to run the project.
          </p>
        )}
        <p className="sw-discover__status" role="status" aria-live="polite">
          {working
            ? pending === 'model'
              ? 'Asking the model and checking its quotes against your sources. This can take a minute.'
              : 'Reading your evidence for roles.'
            : modelMain && may.run
              ? 'The model reads your source text, and Swarm checks every quote it gives.'
              : '\u00a0'}
        </p>
        <p className="sw-caption sw-discover__truth">{SYNTHETIC_LINE}</p>
        <Disclosure summary="How stakeholders are found" className="sw-discover__how">
          <FindExplanation model={model} />
          <p className="sw-caption">{SYNTHETIC_NOTE}</p>
        </Disclosure>
      </m.div>
    </section>
  );
}
