import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, Tags } from 'lucide-react';
import { Button, Notice, Popover, PopoverContent, PopoverTrigger } from '../../../design/ui';
import { useReducedMotion } from '../../../design/motion';
import type { DecisionHandle } from '../../../hooks/useDecision';
import { dayLabel } from '../model/format';
import { smooth } from '../ui/scroll';
import { CanvasEmpty, CanvasError, CanvasLoading } from './CanvasStates';
import { Detail, Legend } from './Detail';
import type { DetailId } from './details';
import { ScopeNotice } from './Scope';
import { Viewport } from './Viewport';
import { COPY, FULL_REPORT_ANCHOR, basedOnWords, noticesOf, stateOf } from './model';
import './canvas.css';

interface Props {
  handle: DecisionHandle;
  go: Record<'ask' | 'ground' | 'map' | 'simulate', () => void>;
  /** The full report stands below the picture, so that there is somewhere to go to. */
  below: boolean;
  /** The detailed report of the exploration, where it has one. */
  onDetailed: (() => void) | null;
}

/**
 * The decision canvas: the first thing the Decide scene shows. It reads the answer, the constraints and the
 * evidence behind it from the project at every read, says what kind of statement each is, and keeps the full
 * report one step below. It never shows a recommendation without what it rests on, and never says more than
 * the simulation shows.
 */
export function DecisionCanvasView({ handle, go, below, onDetailed }: Props) {
  const reduced = useReducedMotion();
  const state = stateOf(handle.view, handle.loading, handle.error);
  const canvas = handle.view?.canvas ?? null;
  const scope = canvas?.scope ?? handle.view?.readiness.scope ?? null;
  const [open, setOpen] = useState<ReadonlySet<DetailId>>(() => new Set());
  const pending = useRef<DetailId | null>(null);

  const setDetail = useCallback((id: DetailId, next: boolean) => {
    setOpen((old) => {
      const copy = new Set(old);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }, []);
  const openDetail = useCallback(
    (id: DetailId) => {
      setDetail(id, true);
      pending.current = id;
    },
    [setDetail],
  );
  // A detail that was asked for is reached once it has been opened, and it takes the reader’s place.
  useEffect(() => {
    const id = pending.current;
    if (!id || !open.has(id)) return;
    pending.current = null;
    requestAnimationFrame(() => {
      const target = document.getElementById(`canvas-detail-${id}`);
      target?.scrollIntoView({ block: 'start', behavior: smooth(reduced) });
      target?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    });
  }, [open, reduced]);

  const toReport = () => {
    const target = document.getElementById(FULL_REPORT_ANCHOR);
    target?.scrollIntoView({ block: 'start', behavior: smooth(reduced) });
    target?.focus({ preventScroll: true });
  };

  return (
    <section
      className="sw-canvas"
      aria-labelledby="canvas-title"
      data-state={state}
      data-status={canvas?.status.status}
      data-scope={scope?.aboutIndividual ? 'individual' : scope?.notice ? 'domain' : undefined}
    >
      <header className="sw-canvas-top">
        <div className="sw-canvas-top__lead">
          <h1 id="canvas-title" className="sw-eyebrow sw-canvas-top__title">
            {COPY.decisionView}
          </h1>
          <p className="sw-canvas-top__notice">{COPY.notice}</p>
        </div>
        {scope && <ScopeNotice scope={scope} />}
        {canvas && (
          <div className="sw-canvas-top__tools">
            <span className="sw-canvas-top__based">{basedOnWords(canvas, dayLabel)}</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost" icon={<Tags size={15} aria-hidden="true" />}>
                  Labels
                </Button>
              </PopoverTrigger>
              <PopoverContent aria-label={COPY.legendTitle} width="min(26rem, 92vw)" tabIndex={0}>
                <p className="sw-canvas-quiet">{COPY.legendLead}</p>
                <Legend />
              </PopoverContent>
            </Popover>
            {below && (
              <Button
                size="sm"
                variant="glass"
                iconEnd={<ArrowDown size={15} aria-hidden="true" />}
                onClick={toReport}
              >
                {COPY.fullReport}
              </Button>
            )}
          </div>
        )}
      </header>

      {state === 'loading' && <CanvasLoading />}
      {handle.error && !handle.loading && (
        <CanvasError
          message={handle.error}
          onRetry={handle.reload}
          busy={handle.refreshing}
          kept={canvas !== null}
        />
      )}
      {handle.view && !canvas && (
        <CanvasEmpty readiness={handle.view.readiness} go={go} onReport={onDetailed} />
      )}

      {canvas && (
        <>
          {noticesOf(canvas).map((notice) => (
            <Notice
              key={notice.title}
              tone={notice.tone}
              className="sw-canvas-notice"
              title={notice.title}
              action={
                notice.action && handle.view?.may.run ? (
                  <Button size="sm" variant="glass" onClick={go[notice.action]}>
                    {notice.action === 'simulate' ? 'Open Simulate' : 'Open the Map'}
                  </Button>
                ) : null
              }
            >
              {notice.text}
            </Notice>
          ))}
          <Viewport canvas={canvas} openDetail={openDetail} />
          <Detail canvas={canvas} open={open} onOpenChange={setDetail} />
        </>
      )}
    </section>
  );
}
