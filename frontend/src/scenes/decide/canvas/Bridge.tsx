import { COPY, FULL_REPORT_ANCHOR } from './model';

/**
 * Where the decision view ends and the full report begins: the brief the picture was drawn beside, as it was. Where the
 * question is one that Swarm does not decide, it says that the note at the top applies to everything below it.
 */
export function ReportBridge({ scoped = false }: { scoped?: boolean }) {
  return (
    <div id={FULL_REPORT_ANCHOR} className="sw-canvas-bridge" tabIndex={-1}>
      <h2 className="sw-canvas-bridge__title">{COPY.fullReport}</h2>
      <p className="sw-canvas-bridge__lead">
        {COPY.fullReportLead}
        {scoped ? ` ${COPY.scopeBridge}` : ''}
      </p>
    </div>
  );
}
