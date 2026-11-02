import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CircleCheck,
  CircleDashed,
  ListChecks,
  LoaderCircle,
  PlugZap,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import type { ProviderMonitorState } from '../hooks/useProviderStatus';
import {
  Button,
  Disclosure,
  Notice,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Stat,
  Tooltip,
} from '../design/ui';
import { cx } from '../design/cx';
import { count } from '../lib/format';
import {
  PROVIDER_BADGE_ID,
  PROVIDER_HINT_ID,
  TOKENS_NOT_REPORTED,
  formatCheckTime,
  realModelLabel,
} from '../lib/provider';
import { PRIVACY_REAL, chipModel, detailRows, headline, type Lamp } from './providerView';
// The shell loads this module with the page, and the panels that open later need to have been watching the focus.
import './shared/place';
import './provider.css';

export interface ProviderStatusProps {
  state: ProviderMonitorState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerify: () => void;
  onRetry: () => void;
}

/** Counts the times the state changed after the first reading, so that the lamp can say "this just happened" once. */
function useLampChanges(lamp: Lamp): number {
  const previous = useRef(lamp);
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    if (previous.current === lamp) return;
    if (previous.current !== 'checking') setChanges((value) => value + 1);
    previous.current = lamp;
  }, [lamp]);
  return changes;
}

function LampIcon({ lamp, size = 16 }: { lamp: Lamp; size?: number }) {
  switch (lamp) {
    case 'ok':
      return <CircleCheck size={size} aria-hidden="true" />;
    case 'failing':
      return <TriangleAlert size={size} aria-hidden="true" />;
    case 'unavailable':
      return <WifiOff size={size} aria-hidden="true" />;
    case 'unverified':
      return <CircleDashed size={size} aria-hidden="true" />;
    case 'checking':
      return <LoaderCircle size={size} className="sw-provider__spin" aria-hidden="true" />;
    default:
      return <ListChecks size={size} aria-hidden="true" />;
  }
}

/** The connection check: one real request, and what came of it, told in words that a screen reader gets too. */
function VerifyBlock({ state, onVerify }: { state: ProviderMonitorState; onVerify: () => void }) {
  const { status, verification } = state;
  const real = status?.mode === 'real-model';
  const verifying = verification.phase === 'pending';
  return (
    <div className="sw-provider-pop__verify">
      {real && (
        <Button
          variant="glass"
          size="sm"
          icon={<PlugZap size={15} aria-hidden="true" />}
          busy={verifying}
          busyLabel="Verifying"
          onClick={(event) => {
            if (event.detail > 1 || verifying) return;
            onVerify();
          }}
        >
          Verify connection
        </Button>
      )}
      <div className="sw-provider-pop__result" role="status">
        {verification.phase === 'pending' && (
          <p className="sw-caption">Verifying: sending one real request to the provider…</p>
        )}
        {verification.phase === 'success' && (
          <p className="sw-provider-pop__ok">
            <CircleCheck size={15} aria-hidden="true" />
            <span>
              Connection verified: one real round trip completed
              {verification.latencyMs !== null && ` in ${count(verification.latencyMs)} ms`} at{' '}
              <time dateTime={verification.at}>{formatCheckTime(verification.at)}</time>.
            </span>
          </p>
        )}
      </div>
      {verification.phase === 'error' && (
        <Notice tone="error" title="Connection check failed">
          {verification.message}
        </Notice>
      )}
    </div>
  );
}

/** What the popover holds. It takes the state it shows, so that every state of it can be looked at. */
export function ProviderPanelBody({
  state,
  onVerify,
  onRetry,
}: {
  state: ProviderMonitorState;
  onVerify: () => void;
  onRetry: () => void;
}) {
  const { status, error } = state;
  const unavailable = error !== null;
  const head = headline(status, unavailable);
  const real = status?.mode === 'real-model';
  const model = chipModel(status, unavailable);
  const eyebrow = !status ? 'Engine' : real ? realModelLabel(status.provider) : 'Local rules';
  return (
    <div className="sw-provider-pop">
      <div className="sw-provider-pop__head" data-tone={head.tone}>
        <p className="sw-eyebrow">{eyebrow}</p>
        <h2 className="sw-provider-pop__title">
          <span className="sw-provider-pop__lamp">
            <LampIcon lamp={model.lamp} size={20} />
          </span>
          {head.title}
        </h2>
        {real && status.model && <p className="sw-provider-pop__model sw-mono">{status.model}</p>}
        {head.note && <p className="sw-caption">{head.note}</p>}
      </div>

      {error && (
        <Notice
          tone="caution"
          action={
            <Button size="sm" variant="glass" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          {error}
        </Notice>
      )}

      {!status && !error && (
        <div className="sw-provider-pop__wait" aria-hidden="true">
          <Skeleton height="1rem" width="70%" />
          <Skeleton height="1rem" width="45%" />
        </div>
      )}

      {status && real && !error && status.connectivity === 'failing' && status.lastError && (
        <Notice tone="error" title="The last request failed">
          {status.lastError.message}
        </Notice>
      )}

      {status && real && (
        <>
          <div className="sw-provider-pop__stats">
            <Stat size="sm" value={status.counters.calls} label="Calls" />
            <Stat
              size="sm"
              value={status.counters.failures}
              label="Failures"
              tone={status.counters.failures > 0 ? 'caution' : undefined}
            />
            <Stat
              size="sm"
              className="sw-provider-pop__tokens"
              value={
                status.counters.tokensReported
                  ? `${count(status.counters.inputTokens)} / ${count(status.counters.outputTokens)}`
                  : '—'
              }
              label="Tokens in / out"
              caption={status.counters.tokensReported ? undefined : TOKENS_NOT_REPORTED}
            />
          </div>
          <p className="sw-caption">{PRIVACY_REAL}</p>
        </>
      )}

      <VerifyBlock state={state} onVerify={onVerify} />

      {status && (
        <Disclosure summary="Details">
          <dl className="sw-provider-pop__dl">
            {detailRows(status, unavailable).map((row) => (
              <div key={row.label} className="sw-provider-pop__row">
                <dt>{row.label}</dt>
                <dd className={row.mono ? 'sw-mono' : undefined}>{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="sw-caption sw-provider-pop__since">
            Counters cover every real provider round trip, repairs included, since the server
            started on <time dateTime={status.startedAt}>{formatCheckTime(status.startedAt)}</time>.
          </p>
        </Disclosure>
      )}
    </div>
  );
}

/**
 * The chip in the top bar that says which engine is in use, and the popover that opens from it. Its name
 * is its words: the engine, the deployment and how it is doing. It never says "connected" of something
 * that has only been configured.
 */
export function ProviderStatus({
  state,
  open,
  onOpenChange,
  onVerify,
  onRetry,
}: ProviderStatusProps) {
  const model = chipModel(state.status, state.error !== null);
  const changes = useLampChanges(model.lamp);
  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <Tooltip label={model.hint} side="bottom">
          <PopoverTrigger asChild>
            <button
              id={PROVIDER_BADGE_ID}
              type="button"
              className="sw-provider"
              data-kind={model.kind}
              data-lamp={model.lamp}
              data-tone={model.tone}
              aria-describedby={PROVIDER_HINT_ID}
            >
              <span
                key={changes}
                className={cx('sw-provider__lamp', changes > 0 && 'is-pinged')}
                aria-hidden="true"
              >
                <LampIcon lamp={model.lamp} size={16} />
              </span>
              <span className="sw-provider__label">{model.label}</span>
              {model.kind === 'real' && state.status?.model && (
                <span className="sw-provider__model">{state.status.model}</span>
              )}
              {model.detail && <span className="sw-provider__detail">{model.detail}</span>}
            </button>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent
          align="end"
          width="24rem"
          aria-label="Model provider"
          className="sw-provider-popover"
        >
          <ProviderPanelBody state={state} onVerify={onVerify} onRetry={onRetry} />
        </PopoverContent>
      </Popover>
      <span id={PROVIDER_HINT_ID} className="sr-only">
        {model.hint}
      </span>
      {/* Outside the bar: a live region keeps what holds it in the accessibility tree, and the bar must go with the page behind a dialog. */}
      {createPortal(
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {state.announcement}
        </span>,
        document.body,
      )}
    </>
  );
}
