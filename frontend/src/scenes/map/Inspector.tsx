import { useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, m, useIsPresent } from 'motion/react';
import { ChevronUp, X } from 'lucide-react';
import { SPRING } from '../../design/motion';
import { Button, IconButton, Sheet, SheetContent } from '../../design/ui';
import { clusterColour } from '../../viz/palette';
import { partyKicker } from './model';
import { PartyBody, type PartyBodyProps } from './PartyBody';
import './inspector.css';

export interface InspectorProps extends Omit<PartyBodyProps, 'bare'> {
  /** Wide screens get a panel beside the map; narrow ones a short strip under it, with the rest in a sheet. */
  layout: 'panel' | 'peek';
  actions: ReactNode;
  /** The few actions the strip has room for; the sheet that opens from it has all of `actions`. */
  stripActions?: ReactNode;
  onClose: () => void;
  /** A line above the actions: something to know before acting (unsaved changes, a refusal). */
  aside?: ReactNode;
}

/** One party's detail as it swaps for the next: while it is leaving it is inert, so that nothing is focused in it. */
function Swap({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  return (
    <m.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      inert={present ? undefined : true}
    >
      {children}
    </m.div>
  );
}

/**
 * The detail of the party that is selected. It is a surface that floats over the map and leaves the
 * map where it is: nothing under it is hidden, because the view moves to keep every party clear of it.
 */
export function Inspector(props: InspectorProps) {
  const { layout, actions, stripActions, onClose, aside, ...body } = props;
  const kicker = partyKicker(body.party, body.subject);
  const [details, setDetails] = useState(false);

  if (layout === 'peek') {
    return (
      <>
        <m.div
          key={body.party.id}
          className="sw-peek sw-glass sw-glass--overlay"
          role="region"
          aria-label={kicker.name}
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 28, transition: { duration: 0.14 } }}
          transition={SPRING.smooth}
        >
          <div className="sw-peek__top">
            <div className="sw-peek__titles">
              <p className="sw-eyebrow sw-insp__kicker">
                <span
                  className="sw-insp__dot"
                  style={{ background: clusterColour(kicker.cluster) }}
                  aria-hidden="true"
                />
                {kicker.text}
              </p>
              <h2 className="sw-peek__name" tabIndex={-1} data-stk-focus="inspector">
                {kicker.name}
              </h2>
            </div>
            <IconButton label="Close" size="sm" onClick={onClose}>
              <X size={16} aria-hidden="true" />
            </IconButton>
          </div>
          {aside}
          <div className="sw-peek__row">
            {stripActions ?? actions}
            <Button
              variant="glass"
              size="md"
              iconEnd={<ChevronUp size={16} aria-hidden="true" />}
              onClick={() => setDetails(true)}
            >
              Details
            </Button>
          </div>
        </m.div>
        <Sheet open={details} onOpenChange={setDetails}>
          <SheetContent
            title={kicker.name}
            eyebrow={kicker.text}
            width="md"
            footer={
              <>
                {aside}
                {actions}
              </>
            }
          >
            <PartyBody {...body} bare />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <m.aside
      className="sw-insp sw-glass sw-glass--overlay"
      aria-label={kicker.name}
      initial={{ opacity: 0, x: 36, scale: 0.985 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.99, transition: { duration: 0.16 } }}
      transition={SPRING.smooth}
    >
      <IconButton label="Close" size="sm" className="sw-insp__close" onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </IconButton>
      <div className="sw-insp__scroll">
        <AnimatePresence mode="wait" initial={false}>
          <Swap key={body.party.id}>
            <PartyBody {...body} />
          </Swap>
        </AnimatePresence>
      </div>
      {(aside || actions) && (
        <footer className="sw-insp__foot">
          {aside}
          {actions}
        </footer>
      )}
    </m.aside>
  );
}
