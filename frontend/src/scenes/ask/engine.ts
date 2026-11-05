import type { AppConfig, SimulationSettings } from '../../../../shared/types';

type Mode = SimulationSettings['mode'];

/** The most a person may ask of the engine for a mode: a model-assisted run is held to a smaller size. */
const LIMIT: Record<Mode, number> = { llm: 10, local: 24 };

/** Changing the engine keeps every number inside what the other engine accepts. */
export function withMode(settings: SimulationSettings, mode: Mode): SimulationSettings {
  const limit = LIMIT[mode];
  return {
    ...settings,
    mode,
    agentCount: Math.min(settings.agentCount, limit),
    rounds: Math.min(settings.rounds, limit),
    intervention:
      settings.intervention && settings.intervention.round <= limit ? settings.intervention : null,
  };
}

/** Whether this server has a model that a question may be sent to. */
export const modelAvailable = (config: AppConfig | null): boolean =>
  Boolean(config?.capabilities.modelAssisted && config.provider.configured);

/**
 * What a new question starts with. Rules, unless the operator said the model (`DEFAULT_ENGINE`) and one is set up:
 * nothing is sent to a model by default, and never without the person being able to see and change it.
 */
export const startingMode = (config: AppConfig | null): Mode =>
  config?.capabilities.defaultEngine === 'llm' && modelAvailable(config) ? 'llm' : 'local';
