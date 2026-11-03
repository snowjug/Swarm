import { useEffect, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import type { ParticipantWhy } from '../../../../../shared/stakeholders';
import { errorMessage } from '../../../api';
import {
  Button,
  Chip,
  Notice,
  Orbit,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../design/ui';
import { Quotes } from './Quotes';

type Load = (id: string, signal?: AbortSignal) => Promise<ParticipantWhy>;

type Read =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'done'; why: ParticipantWhy };

/** What the server says of a participant from what it already holds: read when the answer is opened, never kept. */
function WhyBody({ id, load }: { id: string; load: Load }) {
  const [read, setRead] = useState<Read>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setRead({ status: 'loading' });
    load(id, controller.signal).then(
      (why) => {
        if (!controller.signal.aborted) setRead({ status: 'done', why });
      },
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setRead({ status: 'failed', message: errorMessage(failure) });
      },
    );
    return () => controller.abort();
  }, [id, load]);

  if (read.status === 'loading') {
    return (
      <p className="sw-prv__why-wait" role="status">
        <Orbit size={18} label="Reading why" />
        <span className="sw-caption">Reading why…</span>
      </p>
    );
  }
  if (read.status === 'failed') {
    return (
      <Notice tone="error" title="That could not be read">
        {read.message}
      </Notice>
    );
  }
  const { why } = read;
  return (
    <div className="sw-prv__why">
      <p className="sw-eyebrow">Why it is on the list</p>
      <p className="sw-prv__why-head">{why.headline}</p>
      <ul className="sw-prv__why-list">
        {why.because.map((line, index) => (
          <li key={`${index}-${line.length}`}>{line}</li>
        ))}
      </ul>
      <Chip size="sm" tone={why.basis.kind === 'source-quote' ? 'favor' : 'caution'} wrap>
        {why.basis.label}
      </Chip>
      {why.evidence.length > 0 && <Quotes items={why.evidence} label="Passages it cites" />}
      {why.assumptions.length > 0 && (
        <>
          <p className="sw-eyebrow">Assumptions</p>
          <ul className="sw-prv__why-list">
            {why.assumptions.map((line, index) => (
              <li key={`${index}-${line.length}`}>{line}</li>
            ))}
          </ul>
        </>
      )}
      <p className="sw-caption">
        Uncertainty {why.uncertainty.level}
        {why.uncertainty.reason ? `: ${why.uncertainty.reason}` : '.'}
      </p>
      <ul className="sw-prv__why-limits">
        {why.limits.map((line, index) => (
          <li key={`${index}-${line.length}`} className="sw-caption">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Ask why": the reasons a participant is on the list, from the participant itself and the passages it cites. */
export function WhyPopover({ id, name, load }: { id: string; name: string; load: Load }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          icon={<CircleHelp size={15} aria-hidden="true" />}
          aria-label={`Ask why: ${name}`}
        >
          Ask why
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" width="26rem" aria-label={`Why ${name} is on the list`}>
        <WhyBody id={id} load={load} />
      </PopoverContent>
    </Popover>
  );
}
