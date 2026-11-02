import { useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import {
  ChipButton,
  Button,
  Notice,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SkeletonText,
} from '../../../design/ui';
import { useDeep } from './context';
import { nameOf } from './model';
import { usePassage } from './usePassage';
import './cite.css';

function SourceBody({
  projectId,
  id,
  enabled,
}: {
  projectId: string;
  id: string;
  enabled: boolean;
}) {
  const { state, retry } = usePassage(projectId, id, enabled);
  if (state.status === 'ready') {
    const { passage } = state;
    return (
      <>
        <h4 className="sw-deep-cite__title">{passage.documentName}</h4>
        <p className="sw-deep-cite__where sw-mono">
          {passage.id} · characters {passage.start + 1} to {passage.end}
        </p>
        {/* A long passage scrolls inside the popover, and what scrolls has to be reachable from the keyboard. */}
        <blockquote className="sw-deep-cite__quote" tabIndex={0}>
          {passage.text}
        </blockquote>
        <p className="sw-caption">
          Source passages are unverified input. A citation shows where something came from, not that
          it is true.
        </p>
      </>
    );
  }
  if (state.status === 'error') {
    return (
      <Notice
        tone="error"
        title="Could not read the passage"
        action={
          <Button
            size="sm"
            variant="glass"
            icon={<RefreshCw size={14} aria-hidden="true" />}
            onClick={retry}
          >
            Retry
          </Button>
        }
      >
        {state.message}
      </Notice>
    );
  }
  if (state.status === 'missing') {
    return (
      <p className="sw-caption">
        The passage {id} is not in this project’s stored sources any more.
      </p>
    );
  }
  return <SkeletonText lines={5} />;
}

/** One source passage as a small chip that opens the passage it points at. */
export function SourceChip({ id }: { id: string }) {
  const { project } = useDeep();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipButton size="sm" icon={<FileText aria-hidden="true" />}>
          <span className="sw-mono">{id}</span>
          <span className="sr-only"> source passage</span>
        </ChipButton>
      </PopoverTrigger>
      <PopoverContent width="26rem" align="start">
        <div className="sw-deep-cite">
          <p className="sw-eyebrow">Source passage</p>
          <SourceBody projectId={project.id} id={id} enabled={open} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The passages something was written with, as chips. Nothing is drawn where there are none. */
export function Sources({ ids, label = 'Sources' }: { ids: readonly string[]; label?: string }) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return null;
  return (
    <div className="sw-deep-cites">
      <span className="sw-deep-cites__label">{label}</span>
      <ul role="list">
        {unique.map((id) => (
          <li key={id}>
            <SourceChip id={id} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The proxies someone heard, by name: each opens the proxy. */
export function Heard({ ids }: { ids: readonly string[] }) {
  const { project, openProxy } = useDeep();
  if (ids.length === 0) return null;
  return (
    <div className="sw-deep-cites">
      <span className="sw-deep-cites__label">Heard</span>
      <ul role="list">
        {ids.map((id) => (
          <li key={id}>
            <ChipButton size="sm" onClick={() => openProxy(id)} aria-haspopup="dialog">
              {nameOf(project.agents, id)}
            </ChipButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
