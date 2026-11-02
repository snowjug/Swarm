import { useState } from 'react';
import { Brain, FileText, Quote } from 'lucide-react';
import type { ClaimDetail } from '../../../../shared/evidence';
import { SUPPORT_CLASS_LABELS, SUPPORT_CLASS_MEANINGS } from '../../../../shared/evidence';
import type { EvidenceMatch, ProjectDetail } from '../../../../shared/types';
import {
  Button,
  Chip,
  ChipButton,
  Notice,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SkeletonText,
} from '../../design/ui';
import { SUPPORT_TONE } from '../../lib/ledger';
import { memoryLabel, toneOf } from './chatView';
import { useRoomySide } from './useRoomySide';
import { fetchClaim, fetchPassage, useRecord, type RecordState } from './useRecord';

function Reading({ label }: { label: string }) {
  return (
    <div className="sw-chat__reading" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <SkeletonText lines={3} />
    </div>
  );
}

function Failed({ state, what }: { state: RecordState<unknown>; what: string }) {
  return (
    <Notice
      tone="error"
      title={`${what} could not be read`}
      action={
        <Button size="sm" variant="glass" onClick={state.retry}>
          Retry
        </Button>
      }
    >
      {state.error}
    </Notice>
  );
}

function PassageView({ id, state }: { id: string; state: RecordState<EvidenceMatch | null> }) {
  if (state.error) return <Failed state={state} what="The passage" />;
  if (state.loading) return <Reading label="Reading the passage" />;
  if (!state.data) {
    return <p className="sw-caption">The passage {id} is not in this project’s record.</p>;
  }
  const match = state.data;
  return (
    <>
      <p className="sw-eyebrow">Source {match.id}</p>
      <h3 className="sw-chat__cite-title">{match.documentName}</h3>
      <blockquote className="sw-chat__quote">{match.text}</blockquote>
      <p className="sw-caption num">
        Characters {match.start + 1} to {match.end}
      </p>
    </>
  );
}

function SourceCite({ projectId, id }: { projectId: string; id: string }) {
  const [open, setOpen] = useState(false);
  const { side, measure } = useRoomySide();
  const state = useRecord(
    `${projectId}:passage:${id}`,
    (signal) => fetchPassage(projectId, id, signal),
    open,
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipButton
          size="sm"
          icon={<FileText aria-hidden="true" />}
          aria-label={`Source ${id}`}
          onClick={measure}
        >
          {id}
        </ChipButton>
      </PopoverTrigger>
      <PopoverContent
        width="26rem"
        side={side}
        className="sw-chat__cite-pop"
        aria-label={`Source ${id}`}
      >
        <PassageView id={id} state={state} />
      </PopoverContent>
    </Popover>
  );
}

function ClaimView({ id, state }: { id: string; state: RecordState<ClaimDetail> }) {
  if (state.error) return <Failed state={state} what="The statement" />;
  if (state.loading || !state.data) return <Reading label="Reading the statement" />;
  const { claim, passages } = state.data;
  return (
    <>
      <p className="sw-eyebrow">Report statement {id}</p>
      <p className="sw-chat__cite-statement">{claim.text}</p>
      <div className="sw-chat__cite-support">
        <Chip tone={toneOf(SUPPORT_TONE[claim.supportClass])} size="sm" dot>
          {SUPPORT_CLASS_LABELS[claim.supportClass]}
        </Chip>
        <p className="sw-caption">{SUPPORT_CLASS_MEANINGS[claim.supportClass]}</p>
      </div>
      {passages.length > 0 && (
        <p className="sw-caption">Rests on {passages.map((passage) => passage.id).join(', ')}.</p>
      )}
    </>
  );
}

function ClaimCite({ projectId, id }: { projectId: string; id: string }) {
  const [open, setOpen] = useState(false);
  const { side, measure } = useRoomySide();
  const state = useRecord(
    `${projectId}:claim:${id}`,
    (signal) => fetchClaim(projectId, id, signal),
    open,
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipButton
          size="sm"
          icon={<Quote aria-hidden="true" />}
          aria-label={`Report statement ${id}`}
          onClick={measure}
        >
          {id}
        </ChipButton>
      </PopoverTrigger>
      <PopoverContent
        width="26rem"
        side={side}
        className="sw-chat__cite-pop"
        aria-label={`Report statement ${id}`}
      >
        <ClaimView id={id} state={state} />
      </PopoverContent>
    </Popover>
  );
}

function MemoryCite({ project, id }: { project: ProjectDetail; id: string }) {
  const { side, measure } = useRoomySide();
  const memories = project.console?.memories ?? [];
  const memory = memories.find((item) => item.id === id);
  const label = memoryLabel(memories, id);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ChipButton
          size="sm"
          icon={<Brain aria-hidden="true" />}
          aria-label={`Simulated memory, ${label}`}
          onClick={measure}
        >
          {label}
        </ChipButton>
      </PopoverTrigger>
      <PopoverContent
        width="26rem"
        side={side}
        className="sw-chat__cite-pop"
        aria-label={`Simulated memory, ${label}`}
      >
        {memory ? (
          <>
            <p className="sw-eyebrow">Simulated memory</p>
            <h3 className="sw-chat__cite-title">
              {memory.platform}, round {memory.round}
            </h3>
            <blockquote className="sw-chat__quote">{memory.text}</blockquote>
            <p className="sw-caption">
              Made by the simulation. It is not evidence about the real world.
            </p>
          </>
        ) : (
          <p className="sw-caption">The memory {id} is not in this project’s record.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

const unique = (ids: readonly string[] | undefined): string[] => [...new Set(ids ?? [])];

/** What an answer rests on, as chips that open the thing itself: the passage, the statement, the memory. */
export function Citations({
  project,
  sourceIds,
  memoryIds,
  claimIds,
}: {
  project: ProjectDetail;
  sourceIds: readonly string[];
  memoryIds?: readonly string[];
  claimIds?: readonly string[];
}) {
  const sources = unique(sourceIds);
  const memories = unique(memoryIds);
  const claims = unique(claimIds);
  if (sources.length + memories.length + claims.length === 0) return null;
  return (
    <div className="sw-chat__cites" role="group" aria-label="What this answer cites">
      {sources.map((id) => (
        <SourceCite key={`s-${id}`} projectId={project.id} id={id} />
      ))}
      {claims.map((id) => (
        <ClaimCite key={`c-${id}`} projectId={project.id} id={id} />
      ))}
      {memories.map((id) => (
        <MemoryCite key={`m-${id}`} project={project} id={id} />
      ))}
    </div>
  );
}
