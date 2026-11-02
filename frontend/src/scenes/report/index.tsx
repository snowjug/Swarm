import { useCallback, useState } from 'react';
import type { SupportVerdict } from '../../../../shared/grounding';
import { useWorkspace } from '../../app/context';
import { ReportDocument } from './Document';
import { useReportExport } from './useReportExport';
import { resolveReport, writingView } from './model';
import { Blocked, Nothing, Ready } from './Writing';

/**
 * The detailed report of the deep dive: the report the engine wrote from the recorded run, with the sources it
 * cites and, for a model-written one, how far each statement was checked against them. It is also where the
 * report is written, while it is being written, and what is left of it if it stopped. The page reads the
 * workspace only; the shell polls the project while the report is being written.
 */
export default function ReportScene() {
  const { project, mode, busy, run, cancel, go, setView, panels } = useWorkspace();
  const [verdicts, setVerdicts] = useState<Set<SupportVerdict>>(() => new Set());
  const exporter = useReportExport(project.id);
  const state = resolveReport(project);

  const back = useCallback(() => setView(null), [setView]);
  const studio = useCallback(() => setView('studio'), [setView]);
  const write = useCallback(() => void run('report'), [run]);
  const stop = useCallback(() => void cancel(), [cancel]);
  const ask = useCallback(
    (message?: string) => panels.ask(message ? { message } : undefined),
    [panels],
  );

  if (state.kind === 'ready') {
    return <Ready project={project} busy={busy} onWrite={write} onBack={back} />;
  }
  if (state.kind === 'blocked') {
    return (
      <Blocked
        project={project}
        running={state.running}
        onDeepDive={() => go('simulate', { view: 'deep' })}
        onBack={back}
      />
    );
  }
  if (state.kind === 'none') return <Nothing onBack={back} />;

  return (
    <ReportDocument
      project={project}
      report={project.report}
      state={state}
      writing={writingView(project, state.kind === 'stopped')}
      mode={mode}
      busy={busy}
      verdicts={verdicts}
      onVerdicts={setVerdicts}
      exporter={exporter}
      onBack={back}
      onStudio={studio}
      onAsk={ask}
      onWrite={write}
      onCancel={stop}
    />
  );
}
