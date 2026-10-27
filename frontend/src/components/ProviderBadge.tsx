import {
  ChevronDown,
  CircleCheck,
  CircleHelp,
  Cpu,
  ListChecks,
  LoaderCircle,
  PlugZap,
  Server,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import type { ProviderStatus } from '../../../shared/types';
import type { ProviderMonitorState } from '../hooks/useProviderStatus';
import { count } from '../lib/format';
import {
  PROVIDER_BADGE_ID,
  PROVIDER_HINT_ID,
  PROVIDER_PANEL_ID,
  PROVIDER_REASON_ID,
  PROVIDER_TITLE_ID,
  authText,
  formatCheckTime,
  providerBadgeView,
  providerName,
  tokensText,
} from '../lib/provider';
import type { ChipIcon, ProviderChip } from '../lib/provider';
import { Notice, Spinner } from './ui';

function ChipIconView({ icon }: { icon: ChipIcon }) {
  switch (icon) {
    case 'ok':
      return <CircleCheck size={13} aria-hidden="true" />;
    case 'failing':
      return <TriangleAlert size={13} aria-hidden="true" />;
    case 'unavailable':
      return <WifiOff size={13} aria-hidden="true" />;
    case 'checking':
      return <LoaderCircle size={13} className="spin" aria-hidden="true" />;
    default:
      return <CircleHelp size={13} aria-hidden="true" />;
  }
}

function ProviderChipView({ chip }: { chip: ProviderChip }) {
  return (
    <span className={`provider-chip provider-chip-${chip.tone}`}>
      <ChipIconView icon={chip.icon} />
      {chip.text}
    </span>
  );
}

/**
 * The always-visible header control. Its accessible name is exactly its visible text; the longer
 * explanation is a description, so the name still starts with what a sighted user reads.
 */
export function ProviderBadge({
  state,
  open,
  onToggle,
}: {
  state: ProviderMonitorState;
  open: boolean;
  onToggle: () => void;
}) {
  const view = providerBadgeView(state.status, state.error !== null);
  const real = view.kind === 'real';
  const Icon = real ? Cpu : view.kind === 'local' ? ListChecks : Server;
  return (
    <>
      <button
        id={PROVIDER_BADGE_ID}
        type="button"
        className={`provider-badge ${real ? 'provider-badge-real' : 'provider-badge-neutral'}`}
        aria-expanded={open}
        aria-controls={PROVIDER_PANEL_ID}
        aria-describedby={PROVIDER_HINT_ID}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) onToggle();
        }}
      >
        <Icon size={14} aria-hidden="true" />
        <span className="provider-badge-label">{view.label}</span>
        {view.model && (
          <>
            {' · '}
            <span className="provider-badge-model">{view.model}</span>
          </>
        )}
        {view.chip && (
          <>
            {' '}
            <ProviderChipView chip={view.chip} />
          </>
        )}
        <ChevronDown size={14} className="provider-badge-chevron" aria-hidden="true" />
      </button>
      <span id={PROVIDER_HINT_ID} className="sr-only">
        {view.hint}
      </span>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {state.announcement}
      </span>
    </>
  );
}

function ProviderDetails({
  status,
  unavailable,
}: {
  status: ProviderStatus;
  unavailable: boolean;
}) {
  const { chip } = providerBadgeView(status, unavailable);
  const local = status.mode !== 'real-model';
  const { counters } = status;
  return (
    <>
      <dl className="record-grid provider-grid">
        <dt>Provider</dt>
        <dd>{local ? 'none: local rules only' : providerName(status.provider)}</dd>
        <dt>Deployment / model</dt>
        <dd className="mono">{status.model ?? 'none'}</dd>
        <dt>Authentication</dt>
        <dd>{authText(status.auth)}</dd>
        <dt>Connectivity</dt>
        <dd>
          {chip ? <ProviderChipView chip={chip} /> : 'not applicable: no model is configured'}
        </dd>
        <dt>Last check</dt>
        <dd>
          {status.lastCheckedAt ? (
            <>
              <time dateTime={status.lastCheckedAt}>{formatCheckTime(status.lastCheckedAt)}</time>
              {status.lastLatencyMs !== null && ` · ${count(status.lastLatencyMs)} ms`}
            </>
          ) : (
            'none since the server started'
          )}
        </dd>
        <dt>Model calls</dt>
        <dd>{count(counters.calls)}</dd>
        <dt>Repair calls</dt>
        <dd>{count(counters.repairCalls)}</dd>
        <dt>Failures</dt>
        <dd>{count(counters.failures)}</dd>
        <dt>Input / output tokens</dt>
        <dd>{tokensText(status)}</dd>
        <dt>Last error</dt>
        <dd>
          {status.lastError ? (
            <>
              <code className="mono">{status.lastError.code}</code> {status.lastError.message}
            </>
          ) : (
            'none'
          )}
        </dd>
      </dl>
      <p className="field-help">
        Counters cover every real provider round trip, repairs included, since the server started on{' '}
        <time dateTime={status.startedAt}>{formatCheckTime(status.startedAt)}</time>.
      </p>
    </>
  );
}

/**
 * Provider details as an in-flow block directly under the header: it pushes the page down rather
 * than floating over it, and it is hidden, not unmounted, so the badge's aria-controls always
 * resolves.
 */
export function ProviderPanel({
  state,
  open,
  onVerify,
  onRetry,
  onClose,
}: {
  state: ProviderMonitorState;
  open: boolean;
  onVerify: () => Promise<void> | void;
  onRetry: () => Promise<void> | void;
  onClose: () => void;
}) {
  const { status, error, verification } = state;
  const real = status?.mode === 'real-model';
  const verifying = verification.phase === 'pending';
  const reason = !status
    ? 'Verification needs the provider status, which is not available yet.'
    : real
      ? null
      : 'Nothing to verify: no model provider is configured, so no model call can happen.';
  return (
    <section
      id={PROVIDER_PANEL_ID}
      className="provider-panel"
      aria-labelledby={PROVIDER_TITLE_ID}
      hidden={!open}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="provider-panel-inner">
        <h2 id={PROVIDER_TITLE_ID}>Model provider</h2>
        {status && (
          <p className="field-help">
            {real
              ? 'Projects created in Model assisted mode send bounded context to this provider; Local rules projects never call it. Credentials stay on the server and are never shown here.'
              : 'No model calls happen in this mode. Everything is produced by deterministic local rules on this server.'}
          </p>
        )}
        {error && (
          <Notice
            tone="warning"
            title="Provider status unavailable"
            action={
              <button
                className="button button-secondary button-small"
                type="button"
                onClick={() => void onRetry()}
              >
                Retry status
              </button>
            }
          >
            {status
              ? 'Showing the last values read from the server; connectivity is unknown until the next successful read. '
              : ''}
            {error}
          </Notice>
        )}
        {status ? (
          <ProviderDetails status={status} unavailable={error !== null} />
        ) : (
          !error && (
            <div className="inline-pending">
              <Spinner label="Reading provider status" /> Reading provider status…
            </div>
          )
        )}
        <div className="provider-verify">
          <button
            className="button button-secondary button-small provider-verify-button"
            type="button"
            disabled={!real}
            aria-disabled={verifying || undefined}
            aria-busy={verifying}
            aria-describedby={reason ? PROVIDER_REASON_ID : undefined}
            onClick={(event) => {
              if (event.detail > 1 || verifying) return;
              void onVerify();
            }}
          >
            {verifying ? (
              <LoaderCircle size={14} className="spin" aria-hidden="true" />
            ) : (
              <PlugZap size={14} aria-hidden="true" />
            )}{' '}
            Verify connection
          </button>
          {reason && (
            <p id={PROVIDER_REASON_ID} className="field-help">
              {reason}
            </p>
          )}
          <div className="provider-result" role="status">
            {verification.phase === 'pending' && (
              <>
                <LoaderCircle size={13} className="spin" aria-hidden="true" /> Verifying: sending
                one real request to the provider…
              </>
            )}
            {verification.phase === 'success' && (
              <>
                <CircleCheck size={13} aria-hidden="true" /> Connection verified: one real round
                trip completed
                {verification.latencyMs !== null &&
                  ` in ${count(verification.latencyMs)} ms`} at{' '}
                <time dateTime={verification.at}>{formatCheckTime(verification.at)}</time>.
              </>
            )}
          </div>
          {verification.phase === 'error' && (
            <Notice tone="error" title="Connection check failed">
              {verification.message}
            </Notice>
          )}
        </div>
      </div>
    </section>
  );
}
