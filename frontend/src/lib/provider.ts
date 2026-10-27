import type {
  EngineMode,
  ExecutionInfo,
  ProviderAuthMode,
  ProviderConnectivity,
  ProviderName,
  ProviderStatus,
} from '../../../shared/types';
import { count } from './format';

export const PROVIDER_PANEL_ID = 'provider-panel';
export const PROVIDER_BADGE_ID = 'provider-badge';
export const PROVIDER_HINT_ID = 'provider-badge-hint';
export const PROVIDER_TITLE_ID = 'provider-panel-title';
export const PROVIDER_REASON_ID = 'provider-verify-reason';
export const LOCAL_MODE_LABEL = 'LOCAL / RULES MODE';
export const STATUS_UNAVAILABLE = 'status unavailable';
export const TOKENS_NOT_REPORTED = 'not reported by provider — zero does not mean zero cost';

/** The one label every surface uses for a real model, so a model call is never understated. */
export function realModelLabel(provider: ProviderName): string {
  switch (provider) {
    case 'azure':
      return 'REAL AZURE AI';
    case 'openai':
      return 'REAL MODEL · OpenAI';
    case 'ollama':
      return 'REAL MODEL · Ollama (local)';
    default:
      return 'REAL MODEL';
  }
}

export function providerLabel(status: Pick<ProviderStatus, 'mode' | 'provider'>): string {
  return status.mode === 'real-model' ? realModelLabel(status.provider) : LOCAL_MODE_LABEL;
}

export function providerName(provider: ProviderName): string {
  switch (provider) {
    case 'azure':
      return 'Azure AI';
    case 'openai':
      return 'OpenAI';
    case 'ollama':
      return 'Ollama (local)';
    default:
      return 'none';
  }
}

export function authText(auth: ProviderAuthMode | undefined): string {
  switch (auth) {
    case 'entra':
      return 'Microsoft Entra ID — no API key';
    case 'api-key':
      return 'API key (kept on the server)';
    case 'none':
      return 'none';
    default:
      return 'not reported by this server';
  }
}

export function connectivityText(connectivity: ProviderConnectivity): string {
  switch (connectivity) {
    case 'ok':
      return 'connected';
    case 'failing':
      return 'failing';
    case 'unverified':
      return 'not verified yet';
    default:
      return 'not applicable';
  }
}

export type ChipTone = 'neutral' | 'ok' | 'failing' | 'warn';
export type ChipIcon = 'checking' | 'unverified' | 'ok' | 'failing' | 'unavailable';

/** State is always carried by the text; the tone and icon only reinforce it. */
export interface ProviderChip {
  text: string;
  tone: ChipTone;
  icon: ChipIcon;
}

const UNAVAILABLE_CHIP: ProviderChip = {
  text: STATUS_UNAVAILABLE,
  tone: 'warn',
  icon: 'unavailable',
};

export function connectivityChip(connectivity: ProviderConnectivity): ProviderChip {
  switch (connectivity) {
    case 'ok':
      return { text: 'connected', tone: 'ok', icon: 'ok' };
    case 'failing':
      return { text: 'failing', tone: 'failing', icon: 'failing' };
    default:
      return { text: 'not verified yet', tone: 'neutral', icon: 'unverified' };
  }
}

export interface ProviderBadgeView {
  kind: 'checking' | 'unavailable' | 'local' | 'real';
  label: string;
  model: string | null;
  chip: ProviderChip | null;
  /** Spoken description; it is never part of the accessible name. */
  hint: string;
}

/**
 * What the header badge says. `unavailable` is true when the latest status request failed; any
 * previously read status is still shown, but its connectivity is replaced by the failure.
 */
export function providerBadgeView(
  status: ProviderStatus | null,
  unavailable: boolean,
): ProviderBadgeView {
  if (!status) {
    return unavailable
      ? {
          kind: 'unavailable',
          label: 'MODEL PROVIDER',
          model: null,
          chip: UNAVAILABLE_CHIP,
          hint: 'The server did not return the provider status. Opens details and a retry.',
        }
      : {
          kind: 'checking',
          label: 'MODEL PROVIDER',
          model: null,
          chip: { text: 'checking…', tone: 'neutral', icon: 'checking' },
          hint: 'Reading the provider status. Opens provider details.',
        };
  }
  if (status.mode !== 'real-model') {
    return {
      kind: 'local',
      label: LOCAL_MODE_LABEL,
      model: null,
      chip: unavailable ? UNAVAILABLE_CHIP : null,
      hint: 'No model calls happen in this mode. Opens provider details.',
    };
  }
  return {
    kind: 'real',
    label: realModelLabel(status.provider),
    model: status.model ?? 'model not specified',
    chip: unavailable ? UNAVAILABLE_CHIP : connectivityChip(status.connectivity),
    hint: 'This server is configured to make real model calls in Model assisted mode. Opens provider details and a connection check.',
  };
}

function summary(status: ProviderStatus): string {
  const view = providerBadgeView(status, false);
  return [view.label, view.model, view.chip?.text].filter(Boolean).join(', ');
}

/**
 * Spoken text for a change between two reads; empty when nothing a person needs to know changed,
 * so a routine poll is silent.
 */
export function providerChangeAnnouncement(
  previous: ProviderStatus | null,
  next: ProviderStatus,
  wasUnavailable: boolean,
): string {
  if (wasUnavailable) return `Model provider status is available again: ${summary(next)}.`;
  if (!previous) return '';
  if (
    previous.mode !== next.mode ||
    previous.provider !== next.provider ||
    previous.model !== next.model
  ) {
    return `Model provider is now ${summary(next)}.`;
  }
  if (previous.connectivity !== next.connectivity) {
    return `Model provider connectivity is now ${connectivityChip(next.connectivity).text}.`;
  }
  return '';
}

export function formatCheckTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'unknown time'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

export function tokensText(status: ProviderStatus): string {
  if (status.mode !== 'real-model') return 'none: no model is called';
  if (!status.counters.tokensReported) return TOKENS_NOT_REPORTED;
  return `${count(status.counters.inputTokens)} / ${count(status.counters.outputTokens)}`;
}

export interface ProjectModeChipView {
  label: string;
  model: string | null;
  real: boolean;
}

/** Per-project mode, taken from what the project recorded rather than the server's current setting. */
export function projectModeChip(project: {
  mode: EngineMode;
  execution: ExecutionInfo | null;
}): ProjectModeChipView {
  if (project.mode !== 'llm') return { label: LOCAL_MODE_LABEL, model: null, real: false };
  const provider = project.execution?.provider;
  return {
    label:
      provider && provider !== 'none'
        ? realModelLabel(provider)
        : 'REAL MODEL · provider not recorded yet',
    model: project.execution?.model ?? null,
    real: true,
  };
}

export function projectUsageText(execution: ExecutionInfo): string {
  const calls = `${execution.modelCalls} real model calls`;
  return execution.modelCalls > 0 && execution.inputTokens === 0 && execution.outputTokens === 0
    ? `${calls} · tokens not reported`
    : `${calls} · ${execution.inputTokens} input / ${execution.outputTokens} output tokens`;
}

export interface ModelReadiness {
  /** Short state shown in the readiness row. */
  label: string;
  /** What the state does and does not mean. */
  note: string;
  failing: boolean;
}

const UNVERIFIED_NOTE =
  'Configured is not a connectivity check. Real provider errors are shown when a model operation runs.';

/**
 * The entry card must agree with the header badge: once a real request has succeeded the provider
 * is connected, and after a failure it is failing; "configured" only describes the settings.
 */
export function modelReadiness(
  configured: boolean,
  connectivity: ProviderConnectivity | null | undefined,
): ModelReadiness {
  if (!configured) return { label: 'Not configured', note: UNVERIFIED_NOTE, failing: false };
  if (connectivity === 'ok') {
    return {
      label: 'Connected',
      note: 'A real request has succeeded since the server started. Open the header provider badge for details or to check again.',
      failing: false,
    };
  }
  if (connectivity === 'failing') {
    return {
      label: 'Failing',
      note: 'The most recent real request failed. Open the header provider badge for the error.',
      failing: true,
    };
  }
  return {
    label: 'Configured',
    note: `${UNVERIFIED_NOTE} Use Verify connection in the header provider badge to test it with one real request.`,
    failing: false,
  };
}
