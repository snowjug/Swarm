import { Cpu, Server } from 'lucide-react';
import type { EngineMode, ExecutionInfo } from '../../../shared/types';
import { projectEngineWords } from '../lib/provider';

/**
 * Which engine the open project uses, said beside the provider chip in the top bar and so on every screen that
 * shows results. The chip beside it is about the server (which model it could call, and whether that works); this
 * is about the project: rules, which call no model, or model-assisted, which can.
 */
export function ProjectEngine({
  mode,
  execution,
}: {
  mode: EngineMode;
  execution: ExecutionInfo | null;
}) {
  const words = projectEngineWords({ mode, execution });
  const Icon = words.model ? Server : Cpu;
  return (
    <span
      className="sw-engine"
      data-engine={words.model ? 'model' : 'rules'}
      role="img"
      aria-label={`This project: ${words.text}. ${words.detail}`}
      title={words.detail}
    >
      <Icon size={15} aria-hidden="true" />
    </span>
  );
}
