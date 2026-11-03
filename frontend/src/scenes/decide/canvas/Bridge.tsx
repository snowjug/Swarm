import { COPY, FULL_REPORT_ANCHOR } from './model';

/** Where the decision view ends and the full report begins: the brief the picture was drawn beside, as it was. */
export function ReportBridge() {
  return (
    <div id={FULL_REPORT_ANCHOR} className="sw-canvas-bridge" tabIndex={-1}>
      <h2 className="sw-canvas-bridge__title">{COPY.fullReport}</h2>
      <p className="sw-canvas-bridge__lead">{COPY.fullReportLead}</p>
    </div>
  );
}
