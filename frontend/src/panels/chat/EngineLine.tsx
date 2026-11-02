import { Cpu, ListChecks, TriangleAlert } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../design/ui';
import type { EngineNote } from './chatView';

/**
 * What is answering, said where the question is written: the short form always, the whole of it one press
 * away. A lookup is never presented as a person speaking, and a real model is never presented as rules.
 */
export function EngineLine({ note }: { note: EngineNote }) {
  const Icon = note.kind === 'lookup' ? ListChecks : note.kind === 'model' ? Cpu : TriangleAlert;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="sw-chat__engine" data-kind={note.kind}>
          <Icon size={13} aria-hidden="true" />
          <span>{note.short}</span>
          <span className="sw-chat__engine-why">Why?</span>
        </button>
      </PopoverTrigger>
      <PopoverContent width="22rem" side="top" align="start" aria-label="What is answering">
        <p className="sw-chat__engine-long">{note.long}</p>
      </PopoverContent>
    </Popover>
  );
}
