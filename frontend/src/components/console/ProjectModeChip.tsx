import { Cpu, ListChecks } from 'lucide-react';
import type { EngineMode, ExecutionInfo } from '../../../../shared/types';
import { projectModeChip } from '../../lib/provider';

/** Unmistakable per-project mode, read from what the project recorded, never from the server. */
export function ProjectModeChip({
  project,
}: {
  project: { mode: EngineMode; execution: ExecutionInfo | null };
}) {
  const chip = projectModeChip(project);
  const Icon = chip.real ? Cpu : ListChecks;
  return (
    <span className={`mode-pill${chip.real ? ' mode-pill-real' : ''}`}>
      <Icon size={13} aria-hidden="true" />
      <strong>{chip.label}</strong>
      {chip.model && (
        <>
          {' · '}
          <span className="mode-pill-model">{chip.model}</span>
        </>
      )}
    </span>
  );
}
