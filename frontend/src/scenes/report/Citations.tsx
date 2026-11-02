import { useState } from 'react';
import { FileText, FlaskConical, MessagesSquare, RefreshCw } from 'lucide-react';
import { useWorkspace } from '../../app/context';
import {
  ChipButton,
  Notice,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SkeletonText,
  Button,
} from '../../design/ui';
import { actionLabel, platformNames } from '../../lib/console';
import { signed } from '../../lib/format';
import { usePassage } from './usePassage';
import './Citations.css';

export type CitationKind = 'source' | 'memory' | 'interview';

const KIND_LABEL: Record<CitationKind, string> = {
  source: 'Source passage',
  memory: 'Simulated memory',
  interview: 'Fictional interview',
};
const KIND_ICON = { source: FileText, memory: FlaskConical, interview: MessagesSquare } as const;

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
        <p className="sw-cite__title">{passage.documentName}</p>
        <p className="sw-cite__loc sw-mono">
          {passage.id} · characters {passage.start + 1} to {passage.end}
        </p>
        <blockquote className="sw-cite__quote">{passage.text}</blockquote>
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

function MemoryBody({ id }: { id: string }) {
  const { project } = useWorkspace();
  const memory = project.console?.memories.find((item) => item.id === id);
  if (!memory) {
    return (
      <p className="sw-caption">
        This memory is not in the guided record that is loaded. Older quick runs did not keep one.
      </p>
    );
  }
  const proxy =
    project.agents.find((agent) => agent.id === memory.agentId)?.name ??
    memory.agentId ??
    'Initial input';
  return (
    <>
      <p className="sw-cite__title">{actionLabel(memory.actionType, project.mode === 'local')}</p>
      <p className="sw-cite__loc">
        {platformNames[memory.platform]} · round {memory.round} · minute {memory.simulatedMinute} ·{' '}
        {proxy}
        {memory.opinion === null ? '' : ` · position ${signed(memory.opinion)}`}
      </p>
      <blockquote className="sw-cite__quote">{memory.text}</blockquote>
      {memory.rationale && <p className="sw-cite__why">“{memory.rationale}”</p>}
      <p className="sw-caption">
        A simulated record, not source evidence. The proxies are fictional.
      </p>
    </>
  );
}

function InterviewBody({ id }: { id: string }) {
  const { project } = useWorkspace();
  const interview = project.console?.interviews.find((item) => item.id === id);
  if (!interview)
    return <p className="sw-caption">No interview with this identifier was recorded.</p>;
  const proxy =
    project.agents.find((agent) => agent.id === interview.agentId)?.name ?? interview.agentId;
  return (
    <>
      <p className="sw-cite__title">{proxy}</p>
      <p className="sw-cite__loc">{interview.question}</p>
      <blockquote className="sw-cite__quote">{interview.answer}</blockquote>
      <p className="sw-caption">Role-play written by a model, not testimony from a real person.</p>
    </>
  );
}

/** One citation as a small chip that opens what it points at: the passage, the simulated record or the interview. */
export function CitationChip({ kind, id }: { kind: CitationKind; id: string }) {
  const { project } = useWorkspace();
  const [open, setOpen] = useState(false);
  const Icon = KIND_ICON[kind];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipButton
          size="sm"
          icon={<Icon aria-hidden="true" />}
          aria-label={`${KIND_LABEL[kind]} ${id}`}
        >
          <span className="sw-mono">{id}</span>
        </ChipButton>
      </PopoverTrigger>
      {/* Named for what it shows, and focusable, so that a keyboard can scroll what is taller than the room left for it. */}
      <PopoverContent
        tabIndex={0}
        aria-label={`${KIND_LABEL[kind]} ${id}`}
        width="26rem"
        align="start"
      >
        <div className="sw-cite">
          <p className="sw-eyebrow">{KIND_LABEL[kind]}</p>
          {kind === 'source' && <SourceBody projectId={project.id} id={id} enabled={open} />}
          {kind === 'memory' && <MemoryBody id={id} />}
          {kind === 'interview' && <InterviewBody id={id} />}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** What a chapter cites, as chips, grouped by what kind of thing each is. Nothing is shown for a chapter that cites nothing. */
export function Citations({
  sourceIds = [],
  memoryIds = [],
  interviewIds = [],
}: {
  sourceIds?: readonly string[];
  memoryIds?: readonly string[];
  interviewIds?: readonly string[];
}) {
  const groups = [
    { kind: 'source' as const, label: 'Sources', ids: [...new Set(sourceIds)] },
    { kind: 'memory' as const, label: 'Simulated records', ids: [...new Set(memoryIds)] },
    { kind: 'interview' as const, label: 'Interviews', ids: [...new Set(interviewIds)] },
  ].filter((group) => group.ids.length > 0);
  if (groups.length === 0) return null;
  return (
    <div className="sw-cites">
      {groups.map((group) => (
        <div key={group.kind} className="sw-cites__group">
          <span className="sw-cites__label">{group.label}</span>
          <ul role="list">
            {group.ids.map((id) => (
              <li key={id}>
                <CitationChip kind={group.kind} id={id} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
