import { Hourglass, KeyRound, Ticket, TriangleAlert } from 'lucide-react';
import {
  Button,
  Meter,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from '../design/ui';
import { count } from '../lib/format';
import { formatLocal } from './format';
import { FREE_TIER_WORDS, freeTierAction } from './problems';
import { readUsage, type UsageReading, type UsageState } from './usageView';

function Details({
  usage,
  reading,
  byokEnabled,
  onManageKey,
  onRecheck,
  limitTestId,
}: {
  usage: UsageState;
  reading: UsageReading;
  byokEnabled: boolean;
  onManageKey: () => void;
  onRecheck: () => void;
  limitTestId: boolean;
}) {
  const view = usage.view;
  if (!view) {
    return (
      <div className="sw-usage-pop">
        <p className="sw-eyebrow">Free tier</p>
        <h2 className="sw-usage-pop__title">We could not read your free runs</h2>
        <p className="sw-caption">Check your connection, then try again.</p>
        <PopoverClose asChild>
          <Button size="sm" variant="glass" onClick={onRecheck}>
            Try again
          </Button>
        </PopoverClose>
      </div>
    );
  }

  if (reading.state === 'byok') {
    return (
      <div className="sw-usage-pop">
        <p className="sw-eyebrow">Your own key</p>
        <h2 className="sw-usage-pop__title">Using your own key</h2>
        <p className="sw-caption">
          Runs use your own Google Gemini quota, not the free tier.
          {view.byok
            ? ` Today on your key: ${count(view.byok.today.calls)} calls, ${count(view.byok.today.tokens)} tokens.`
            : ''}
        </p>
        <PopoverClose asChild>
          <Button size="sm" variant="glass" onClick={onManageKey}>
            Manage key
          </Button>
        </PopoverClose>
      </div>
    );
  }

  const { free } = view;
  const resets = (
    <div>
      <dt>Resets</dt>
      <dd>
        <time dateTime={free.resetsAt}>{formatLocal(free.resetsAt)}</time>
        <span className="sw-caption"> in your local time</span>
      </dd>
    </div>
  );

  if (reading.state === 'limit') {
    const words = reading.reason ? FREE_TIER_WORDS[reading.reason] : null;
    const action = reading.reason ? freeTierAction(reading.reason) : null;
    const offered = action && (action.kind !== 'byok' || byokEnabled) ? action : null;
    return (
      <div className="sw-usage-pop">
        <p className="sw-eyebrow">Free tier</p>
        <h2 className="sw-usage-pop__title">{words?.title ?? 'The free tier is not available'}</h2>
        <div
          className="sw-usage-pop__limit"
          data-testid={limitTestId ? 'limit-reached' : undefined}
          data-reason={reading.reason ?? undefined}
        >
          <p>{words?.message ?? 'The free tier is not available right now.'}</p>
          {offered ? (
            <PopoverClose asChild>
              <Button
                size="sm"
                variant="primary"
                onClick={offered.kind === 'byok' ? onManageKey : onRecheck}
              >
                {offered.label}
              </Button>
            </PopoverClose>
          ) : (
            <p className="sw-caption">Using your own key is switched off too. Try again later.</p>
          )}
        </div>
        <dl className="sw-usage-pop__list">{resets}</dl>
      </div>
    );
  }

  const { today } = free;
  return (
    <div className="sw-usage-pop">
      <p className="sw-eyebrow">Free tier</p>
      <h2 className="sw-usage-pop__title">{reading.words}</h2>
      <Meter
        value={today.tokens}
        max={today.tokenLimit || 1}
        label="Tokens used today"
        valueText={`${count(today.tokens)} of ${count(today.tokenLimit)} tokens`}
        tone={reading.tone === 'caution' ? 'caution' : 'accent'}
      />
      <dl className="sw-usage-pop__list">
        <div>
          <dt>Used today</dt>
          <dd>
            {count(today.tokens)} of {count(today.tokenLimit)} tokens
          </dd>
        </div>
        <div>
          <dt>Model calls today</dt>
          <dd>
            {count(today.calls)} of {count(today.callLimit)}
          </dd>
        </div>
        {resets}
        <div>
          <dt>Free allowance for this account</dt>
          <dd>
            {count(free.lifetime.tokens)} of {count(free.lifetime.limit)} tokens used
          </dd>
        </div>
      </dl>
      <p className="sw-caption">
        Runs left is an estimate: a run is taken to be about {count(today.tokensPerRun)} tokens.
      </p>
      {byokEnabled && (
        <PopoverClose asChild>
          <button
            type="button"
            className="sw-usage-pop__link"
            data-testid="usage-upgrade"
            onClick={onManageKey}
          >
            Use your own Google key to go past the free limit
          </button>
        </PopoverClose>
      )}
    </div>
  );
}

/**
 * In the top bar: how many free runs are left today, or that the person is using their own key, or why the free tier
 * cannot be used right now. It opens to the figures behind it and, always, one next step.
 */
export function UsageMeter({
  usage,
  byokEnabled,
  onManageKey,
  onRecheck,
  limitTestId,
}: {
  usage: UsageState;
  byokEnabled: boolean;
  onManageKey: () => void;
  onRecheck: () => void;
  /** Whether the card inside the popover carries the test id of the limit-reached state: only one at a time does. */
  limitTestId: boolean;
}) {
  const reading = readUsage(usage);
  if (!reading) return null;
  const Icon =
    reading.state === 'byok'
      ? KeyRound
      : reading.state === 'free'
        ? Ticket
        : reading.reason === 'concurrent'
          ? Hourglass
          : TriangleAlert;
  return (
    <Popover>
      <Tooltip label={reading.words} side="bottom">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="sw-usage"
            data-testid="usage-meter"
            data-usage={reading.state}
            data-reason={reading.reason ?? undefined}
            data-tone={reading.tone}
          >
            <Icon size={16} aria-hidden="true" />
            <span className="sw-usage__fig" data-figure={reading.figure} aria-hidden="true" />
            <span className="sw-usage__words">{reading.words}</span>
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" width="22rem" aria-label="Free runs" className="sw-usage-popover">
        <Details
          usage={usage}
          reading={reading}
          byokEnabled={byokEnabled}
          onManageKey={onManageKey}
          onRecheck={onRecheck}
          limitTestId={limitTestId}
        />
      </PopoverContent>
    </Popover>
  );
}
