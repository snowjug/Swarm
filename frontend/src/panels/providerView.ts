import type { ProviderStatus } from '../../../shared/types';
import type { Tone } from '../design/ui';
import { count } from '../lib/format';
import {
  authText,
  connectivityChip,
  connectivityText,
  formatCheckTime,
  providerBadgeView,
  providerName,
  tokensText,
  type ChipTone,
} from '../lib/provider';

/** The glyph that carries the state, so that it is never the colour alone that says it. */
export type Lamp = 'local' | 'ok' | 'failing' | 'unverified' | 'unavailable' | 'checking';

export interface ChipModel {
  kind: 'checking' | 'unavailable' | 'local' | 'real';
  lamp: Lamp;
  tone: Tone;
  /** The first thing the chip says: the engine. */
  label: string;
  /** The second: how it is doing. Absent for rules, which have nothing to connect to. */
  detail: string | null;
  /** Spoken description; it is not part of the control's name. */
  hint: string;
}

const TONES: Record<ChipTone, Tone> = {
  neutral: 'neutral',
  ok: 'favor',
  failing: 'critical',
  warn: 'caution',
};

/** What the control in the top bar says, from the status the page last read and whether the latest read failed. */
export function chipModel(status: ProviderStatus | null, unavailable: boolean): ChipModel {
  const view = providerBadgeView(status, unavailable);
  const lamp: Lamp = view.chip ? view.chip.icon : 'local';
  return {
    kind: view.kind,
    lamp,
    tone: view.chip ? TONES[view.chip.tone] : 'neutral',
    label: view.kind === 'local' ? 'Local rules' : view.kind === 'real' ? view.label : 'Provider',
    detail: view.chip?.text ?? null,
    hint: view.hint,
  };
}

/** The control's name: its visible words, then the deployment, which the bar has no room for. */
export function chipName(model: ChipModel, status: ProviderStatus | null): string {
  return [model.label, model.kind === 'real' ? status?.model : null, model.detail]
    .filter(Boolean)
    .join(', ');
}

export interface Headline {
  title: string;
  tone: Tone;
  note: string | null;
}

export const PRIVACY_REAL =
  'Projects created in Model assisted mode send bounded context to this provider; Local rules projects never call it. Credentials stay on the server and are never shown here.';
export const NOTE_LOCAL =
  'No model calls happen in this mode. Everything is produced by deterministic local rules on this server.';
export const NOTE_UNVERIFIED =
  'Configured is not a connectivity check. Verify to make one real request.';

/** The answer the popover opens with: is the engine all right? */
export function headline(status: ProviderStatus | null, unavailable: boolean): Headline {
  if (!status) {
    return unavailable
      ? {
          title: 'Status unavailable',
          tone: 'caution',
          note: 'The server did not return the provider status.',
        }
      : { title: 'Checking…', tone: 'neutral', note: 'Reading the provider status.' };
  }
  if (status.mode !== 'real-model')
    return { title: 'No model in use', tone: 'neutral', note: NOTE_LOCAL };
  if (unavailable) {
    return {
      title: 'Status unavailable',
      tone: 'caution',
      note: 'Showing the last values read from the server; connectivity is unknown until the next successful read.',
    };
  }
  const chip = connectivityChip(status.connectivity);
  const title = `${chip.text[0]!.toUpperCase()}${chip.text.slice(1)}`;
  return {
    title,
    tone: TONES[chip.tone],
    note: status.connectivity === 'unverified' ? NOTE_UNVERIFIED : null,
  };
}

export const NOTHING_TO_VERIFY =
  'Nothing to verify: no model provider is configured, so no model call can happen.';

/** Why there is nothing to verify, or null where a check can be made. */
export function verifyReason(status: ProviderStatus | null): string | null {
  if (!status) return 'Verification needs the provider status, which is not available yet.';
  return status.mode === 'real-model' ? null : NOTHING_TO_VERIFY;
}

export interface DetailRow {
  label: string;
  value: string;
  mono?: boolean;
}

/** Everything the status holds that the headline does not say, as label and value. */
export function detailRows(status: ProviderStatus, unavailable: boolean): DetailRow[] {
  const local = status.mode !== 'real-model';
  const connectivity = unavailable
    ? 'status unavailable'
    : local
      ? 'not applicable: no model is configured'
      : connectivityText(status.connectivity);
  return [
    { label: 'Provider', value: local ? 'none: local rules only' : providerName(status.provider) },
    { label: 'Deployment / model', value: status.model ?? 'none', mono: true },
    { label: 'Authentication', value: authText(status.auth) },
    { label: 'Connectivity', value: connectivity },
    ...(local ? [{ label: 'Verification', value: NOTHING_TO_VERIFY }] : []),
    {
      label: 'Last check',
      value: status.lastCheckedAt
        ? `${formatCheckTime(status.lastCheckedAt)}${status.lastLatencyMs !== null ? ` · ${count(status.lastLatencyMs)} ms` : ''}`
        : 'none since the server started',
    },
    { label: 'Repair calls', value: count(status.counters.repairCalls) },
    { label: 'Input / output tokens', value: tokensText(status) },
    {
      label: 'Last error',
      value: status.lastError ? `${status.lastError.code}: ${status.lastError.message}` : 'none',
    },
  ];
}
