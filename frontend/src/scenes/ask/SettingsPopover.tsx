import type { ReactElement } from 'react';
import { Cpu, Server, X } from 'lucide-react';
import type { AppConfig, ProviderConnectivity, SimulationSettings } from '../../../../shared/types';
import { Button, Disclosure, Field, Input, Notice, Segmented } from '../../design/ui';
import { authText, modelReadiness, realModelLabel } from '../../lib/provider';
import { Surface } from './Surface';
import { withMode } from './engine';
import './SettingsPopover.css';

/** The most the engine accepts of a number, for the mode in use. */
function settingLimits(config: AppConfig | null, mode: SimulationSettings['mode']) {
  return {
    agents:
      mode === 'llm'
        ? (config?.limits.modelMaxAgents ?? 10)
        : (config?.limits.localMaxAgents ?? 24),
    rounds:
      mode === 'llm'
        ? (config?.limits.modelMaxRounds ?? 10)
        : (config?.limits.localMaxRounds ?? 24),
  };
}

/**
 * How the exploration runs, kept out of the way: which engine reads and simulates (rules on this machine,
 * or a model the server is set up to use), and the size of the optional deep dive. The defaults are
 * right for nearly everyone; nothing here is needed to begin.
 */
export function SettingsPopover({
  config,
  connectivity,
  settings,
  onSettings,
  name,
  onName,
  disabled,
  trigger,
}: {
  config: AppConfig | null;
  connectivity: ProviderConnectivity | null;
  settings: SimulationSettings;
  onSettings: (settings: SimulationSettings) => void;
  name: string;
  onName: (name: string) => void;
  disabled: boolean;
  trigger: ReactElement;
}) {
  const modelAvailable = Boolean(config?.capabilities.modelAssisted && config.provider.configured);
  const limits = settingLimits(config, settings.mode);
  const readiness = modelReadiness(modelAvailable, connectivity);
  const number = (value: string, fallback: number) => (value === '' ? fallback : Number(value));
  return (
    <Surface title="Options" trigger={trigger} width="23rem">
      <div className="sw-opt">
        <Segmented
          label="Engine"
          value={settings.mode}
          onChange={(mode) => onSettings(withMode(settings, mode))}
          block
          options={[
            {
              value: 'local',
              label: 'Local rules',
              icon: <Cpu size={15} aria-hidden="true" />,
              disabled: config ? !config.capabilities.local : true,
            },
            {
              value: 'llm',
              label: 'Model assisted',
              icon: <Server size={15} aria-hidden="true" />,
              disabled: !modelAvailable,
            },
          ]}
        />
        {settings.mode === 'llm' && modelAvailable && config ? (
          <p className="sw-caption">
            Runs on {realModelLabel(config.provider.name)} ·{' '}
            {config.provider.model ?? 'model unspecified'}
            {config.provider.auth && config.provider.auth !== 'none'
              ? ` · ${authText(config.provider.auth)}`
              : ''}
            . Your question and evidence context are sent to this provider.
          </p>
        ) : (
          <p className="sw-caption">
            {modelAvailable
              ? 'Rules run on this machine. Nothing is sent anywhere.'
              : `Model assistance is off: ${config?.provider.reason ?? 'waiting for the server.'}`}
            {modelAvailable && readiness.failing ? ' The provider is failing.' : ''}
          </p>
        )}

        <Field label="Name" hint="Optional. Defaults to the start of your question.">
          <Input
            value={name}
            maxLength={100}
            disabled={disabled}
            placeholder="Untitled"
            onChange={(event) => onName(event.target.value)}
          />
        </Field>

        <Disclosure summary="Deep dive" tone="quiet" className="sw-opt__deep">
          <div className="sw-opt__grid">
            <Field label="Proxies" hint={`4–${limits.agents}`}>
              <Input
                type="number"
                inputMode="numeric"
                min={4}
                max={limits.agents}
                value={settings.agentCount}
                disabled={disabled}
                onChange={(event) =>
                  onSettings({ ...settings, agentCount: number(event.target.value, 12) })
                }
              />
            </Field>
            <Field label="Rounds" hint={`3–${limits.rounds}`}>
              <Input
                type="number"
                inputMode="numeric"
                min={3}
                max={limits.rounds}
                value={settings.rounds}
                disabled={disabled}
                onChange={(event) =>
                  onSettings({ ...settings, rounds: number(event.target.value, 8) })
                }
              />
            </Field>
            <Field label="Seed" hint="Repeatable">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={2_147_483_647}
                value={settings.seed}
                disabled={disabled}
                onChange={(event) =>
                  onSettings({ ...settings, seed: number(event.target.value, 42) })
                }
              />
            </Field>
          </div>
          <p className="sw-caption">
            The optional agent-by-agent run uses fictional proxies. The comparison does not need it.
          </p>
        </Disclosure>

        {settings.intervention && (
          <Notice
            title="An intervention was copied"
            action={
              <Button
                size="sm"
                variant="ghost"
                icon={<X size={14} />}
                disabled={disabled}
                onClick={() => onSettings({ ...settings, intervention: null })}
              >
                Remove
              </Button>
            }
          >
            Round {settings.intervention.round}: {settings.intervention.label}
          </Notice>
        )}
      </div>
    </Surface>
  );
}
