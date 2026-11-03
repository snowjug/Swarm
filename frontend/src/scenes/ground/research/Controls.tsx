import { FastForward, Pause, Play, Plus, RotateCw, Search, Square } from 'lucide-react';
import { useState } from 'react';
import {
  Button,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  useToast,
  type ButtonSize,
} from '../../../design/ui';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { useGroundResearch, type GroundResearch } from './context';

/** Cancelling is asked about, since it ends the run: finishing early goes on with what was found, and this does not. */
function Cancel({ research, size }: { research: GroundResearch; size: ButtonSize }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const { state } = research;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          icon={<Square size={14} aria-hidden="true" />}
          disabled={state.working !== null}
        >
          Cancel
        </Button>
      </PopoverTrigger>
      <PopoverContent width="21rem" align="start" aria-label="Cancel the research">
        <div className="sw-research-confirm">
          <p className="sw-research-confirm__title">Cancel the research?</p>
          <p className="sw-research-confirm__text">
            Cancel stops the research now. Finish early stops reading and goes on with what was
            found. The pages already read stay listed, and you can research again.
          </p>
          <div className="sw-research-confirm__actions">
            <Button
              variant="danger"
              size="sm"
              busy={state.working === 'cancel'}
              onClick={() =>
                void state.cancel().then((ok) => {
                  if (!ok) return;
                  setOpen(false);
                  toast({ title: 'Research cancelled', tone: 'info', duration: 3200 });
                })
              }
            >
              Cancel research
            </Button>
            <PopoverClose asChild>
              <Button variant="ghost" size="sm">
                Keep going
              </Button>
            </PopoverClose>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * What a person does about the research, as the buttons at the head of the page, by where the run is: start, pause and
 * resume, finish early, cancel, try again. Only what the server allows is offered, and only one thing is asked at a
 * time.
 */
export function RunActions() {
  const research = useGroundResearch();
  const toast = useToast();
  // The three of a live run share the width of a phone; each is still as tall as a finger needs.
  const size = useMediaQuery('(max-width: 40rem)') ? 'sm' : 'md';
  if (!research) return null;
  const { state, presence, controls } = research;
  const idle = state.working === null;

  if (presence.kind === 'unavailable') {
    return (
      <Button
        variant="accent"
        size="lg"
        icon={<RotateCw size={16} aria-hidden="true" />}
        onClick={state.reload}
      >
        Try again
      </Button>
    );
  }
  if (presence.kind === 'empty') {
    return controls.start ? (
      <Button
        variant="accent"
        size="lg"
        icon={<Search size={17} aria-hidden="true" />}
        busy={state.working === 'start'}
        disabled={!idle}
        onClick={() => void state.start()}
      >
        Start research
      </Button>
    ) : null;
  }
  if (presence.kind !== 'run') return null;

  const { run } = presence;
  const live = run.status === 'queued' || run.status === 'running' || run.status === 'paused';
  if (live) {
    return (
      <div className="sw-research-controls" role="group" aria-label="Research controls">
        {controls.pause && (
          <Button
            variant="glass"
            size={size}
            icon={<Pause size={15} aria-hidden="true" />}
            busy={state.working === 'pause'}
            disabled={!idle}
            onClick={() =>
              void state.pause().then((ok) => {
                if (ok) toast({ title: 'Research paused', tone: 'info', duration: 2800 });
              })
            }
          >
            Pause
          </Button>
        )}
        {controls.resume && (
          <Button
            variant="glass"
            size={size}
            icon={<Play size={15} aria-hidden="true" />}
            busy={state.working === 'resume'}
            disabled={!idle}
            onClick={() => void state.resume()}
          >
            Resume
          </Button>
        )}
        {controls.finish && (
          <Tooltip
            label="Stop reading now and go on with what was found."
            side="bottom"
            align="start"
          >
            <Button
              variant="glass"
              size={size}
              icon={<FastForward size={15} aria-hidden="true" />}
              busy={state.working === 'finish'}
              disabled={!idle}
              onClick={() => void state.finish()}
            >
              Finish early
            </Button>
          </Tooltip>
        )}
        {controls.cancel && <Cancel research={research} size={size} />}
      </div>
    );
  }

  if (!controls.start && !controls.add) return null;
  const nothingUsed = run.sources.every((source) => source.outcome !== 'used');
  if (run.status === 'blocked' || (run.status === 'completed' && nothingUsed)) {
    return (
      <Button
        variant="accent"
        size="lg"
        icon={<Plus size={17} aria-hidden="true" />}
        onClick={research.showAdd}
      >
        Add a site or page
      </Button>
    );
  }
  return controls.start ? (
    <Button
      variant="accent"
      size="lg"
      icon={<RotateCw size={16} aria-hidden="true" />}
      busy={state.working === 'start'}
      disabled={!idle}
      onClick={() => void state.start()}
    >
      {run.status === 'failed' ? 'Try again' : 'Research again'}
    </Button>
  ) : null;
}
