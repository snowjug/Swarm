import { Clock3, History } from 'lucide-react';
import type { AnalysisSummary } from '../../../../shared/analysis-plan';
import { UNRECORDED_INPUTS_ADVICE } from '../../../../shared/analysis';
import { Button, ChipButton, Popover, PopoverContent, PopoverTrigger } from '../../design/ui';
import { whenText } from './format';
import { changedSentence, type Freshness } from './freshness';
import './fresh.css';

/**
 * Said beside the title only when there is something to say: this comparison describes the project as it was
 * (a document changed since), or it is an older one and a newer one exists. Each opens to say so in full and
 * to offer the way to mend it. When nothing is known nothing is claimed.
 */
export function Fresh({
  freshness,
  newer,
  canRun,
  onRun,
  onNewer,
}: {
  freshness: Freshness;
  newer: AnalysisSummary | null;
  canRun: boolean;
  onRun: () => void;
  onNewer: (id: string) => void;
}) {
  const stale = freshness.changed.length > 0;
  if (!stale && !newer && !freshness.unrecorded) return null;
  return (
    <span className="sw-cmp-fresh">
      {stale && (
        <Popover>
          <PopoverTrigger asChild>
            <ChipButton tone="caution" size="sm" icon={<Clock3 aria-hidden="true" />}>
              Out of date
            </ChipButton>
          </PopoverTrigger>
          <PopoverContent width="22rem" align="start">
            <p className="sw-eyebrow">Out of date</p>
            <p className="sw-cmp-fresh__text">{changedSentence(freshness.changed)}</p>
            <p className="sw-cmp-fresh__text">Only simulating again brings it up to date.</p>
            {canRun && (
              <Button size="sm" variant="primary" onClick={onRun}>
                Simulate again
              </Button>
            )}
          </PopoverContent>
        </Popover>
      )}
      {newer && (
        <Popover>
          <PopoverTrigger asChild>
            <ChipButton size="sm" icon={<History aria-hidden="true" />}>
              An older comparison
            </ChipButton>
          </PopoverTrigger>
          <PopoverContent width="22rem" align="start">
            <p className="sw-eyebrow">An older comparison</p>
            <p className="sw-cmp-fresh__text">
              A newer one finished {whenText(newer.completedAt ?? newer.createdAt)}. This one is
              kept so that the two can be read side by side.
            </p>
            <Button size="sm" variant="primary" onClick={() => onNewer(newer.id)}>
              Read the newest
            </Button>
          </PopoverContent>
        </Popover>
      )}
      {!stale && freshness.unrecorded && (
        <Popover>
          <PopoverTrigger asChild>
            <ChipButton size="sm" icon={<Clock3 aria-hidden="true" />}>
              Freshness unknown
            </ChipButton>
          </PopoverTrigger>
          <PopoverContent width="22rem" align="start">
            <p className="sw-eyebrow">Freshness unknown</p>
            <p className="sw-cmp-fresh__text">{UNRECORDED_INPUTS_ADVICE}</p>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}
