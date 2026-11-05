import { Cpu, Server } from 'lucide-react';
import type { AppConfig, SimulationSettings } from '../../../../shared/types';
import { Segmented } from '../../design/ui';
import { providerName } from '../../lib/provider';
import { modelAvailable } from './engine';
import './EngineChoice.css';

type Mode = SimulationSettings['mode'];

/**
 * Who reads the question and plays the scenario: rules on this server, or the model the server is set up to use.
 * It sits beside Evidence and Options, where it is seen before the question is asked, and it is the same choice as
 * the Engine in Options. Each option says where the question goes.
 */
export function EngineChoice({
  config,
  mode,
  onMode,
  disabled,
}: {
  config: AppConfig | null;
  mode: Mode;
  onMode: (mode: Mode) => void;
  disabled: boolean;
}) {
  const available = modelAvailable(config);
  const provider = config ? providerName(config.provider.name) : 'the model';
  return (
    <div className="sw-engine-choice" aria-disabled={disabled || undefined}>
      <Segmented<Mode>
        size="sm"
        label="How it is read"
        value={mode}
        onChange={(next) => {
          if (!disabled) onMode(next);
        }}
        options={[
          {
            value: 'local',
            label: 'Rules only',
            icon: <Cpu size={14} aria-hidden="true" />,
            hint: 'Read and played on this server by rules. Nothing is sent to a model.',
            disabled: config ? !config.capabilities.local : true,
          },
          {
            value: 'llm',
            label: 'Model-assisted',
            icon: <Server size={14} aria-hidden="true" />,
            hint: available
              ? `Your question and the text of your sources are sent to ${provider}.`
              : `Not available: ${config?.provider.reason ?? 'waiting for the server.'}`,
            disabled: !available,
          },
        ]}
      />
    </div>
  );
}
