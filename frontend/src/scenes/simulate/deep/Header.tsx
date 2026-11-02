import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CircleDashed,
  Cpu,
  GitBranch,
  Pause,
  Play,
  Square,
  Sparkles,
} from 'lucide-react';
import { useWorkspace } from '../../../app/context';
import { useAway } from '../../../app/unsaved-context';
import {
  Button,
  Chip,
  ChipButton,
  Orbit,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Ring,
  type Tone,
} from '../../../design/ui';
import { stepLock } from '../../../lib/console';
import { sceneAvailable } from '../../../app/scenes';
import { readsThroughTheDeepDive } from '../engineOnly';
import { resumeActionLabel } from '../../../lib/whatIf';
import { LOCAL_NOTE, MODEL_NOTE, POSITION_NOTE, PROXY_LINE } from './copy';
import { useDeep, type DeepState } from './context';
import { engineLabel, phaseView, progressShare, savedRounds } from './model';
import './header.css';

/** What sits at the left of the strip: the rounds saved, as a ring, or the thing the run is waiting for. */
function Mark({
  phase,
  tone: said,
  saved,
  share,
  live,
}: {
  phase: string;
  tone: Tone;
  saved: number;
  share: number;
  live: boolean;
}) {
  if (phase === 'preparing') {
    return (
      <span className="sw-deep-strip__mark" data-empty>
        <Orbit size={26} label="Preparing the environment" />
      </span>
    );
  }
  if (
    phase === 'unprepared' ||
    phase === 'prep-stopped' ||
    phase === 'unavailable' ||
    phase === 'legacy'
  ) {
    return (
      <span className="sw-deep-strip__mark" data-empty>
        <CircleDashed size={26} aria-hidden="true" />
      </span>
    );
  }
  const tone =
    said === 'favor' ? 'favor' : said === 'caution' || said === 'critical' ? 'caution' : 'accent';
  return (
    <span className="sw-deep-strip__mark" data-live={live || undefined}>
      {live && <span key={saved} className="sw-deep-strip__ping" aria-hidden="true" />}
      <Ring
        value={share}
        size={60}
        stroke={4}
        tone={tone}
        label="Rounds saved"
        valueText={`${saved} rounds saved`}
      >
        <span className="sw-numeral sw-deep-strip__num">{saved}</span>
      </Ring>
    </span>
  );
}

function Primary({ state }: { state: DeepState }): ReactNode {
  const { project, controls, actions, environment } = state;
  const { go } = useWorkspace();
  const phase = phaseView(project).phase;
  const { pending } = actions;
  const dirty = (environment.changes?.total ?? 0) > 0;

  if (phase === 'unprepared' || phase === 'prep-stopped') {
    if (controls.prepare) {
      return (
        <Button
          variant="accent"
          icon={<Sparkles size={16} aria-hidden="true" />}
          busy={pending === 'prepare'}
          busyLabel="Preparing"
          onClick={actions.prepare}
        >
          {phase === 'prep-stopped' ? 'Prepare it again' : 'Prepare the environment'}
        </Button>
      );
    }
    const lock = stepLock(project, 'environment');
    return (
      <>
        {lock && <span className="sw-deep-strip__why">{lock}</span>}
        <Button
          variant="glass"
          iconEnd={<ArrowRight size={16} aria-hidden="true" />}
          onClick={() => go('ground')}
        >
          Open Ground
        </Button>
      </>
    );
  }
  if (phase === 'ready') {
    return controls.start ? (
      <Button
        variant="accent"
        icon={<Play size={16} aria-hidden="true" />}
        busy={pending === 'start'}
        busyLabel="Starting"
        disabled={dirty}
        title={dirty ? 'Save the environment first' : undefined}
        onClick={actions.start}
      >
        Start the simulation
      </Button>
    ) : null;
  }
  if (phase === 'queued' || phase === 'running') {
    return (
      <>
        {controls.pause && (
          <Button
            variant="glass"
            icon={<Pause size={16} aria-hidden="true" />}
            busy={pending === 'pause'}
            busyLabel="Pausing"
            onClick={actions.pause}
          >
            Pause at the last saved round
          </Button>
        )}
        {controls.cancel && (
          <Button
            variant="ghost"
            icon={<Square size={14} aria-hidden="true" />}
            busy={pending === 'cancel'}
            busyLabel="Cancelling"
            onClick={actions.cancel}
          >
            Cancel
          </Button>
        )}
      </>
    );
  }
  if (controls.resume) {
    return (
      <Button
        variant="accent"
        icon={<Play size={16} aria-hidden="true" />}
        busy={pending === 'resume'}
        busyLabel="Resuming"
        onClick={actions.resume}
      >
        {resumeActionLabel(project)}
      </Button>
    );
  }
  if (controls.start) {
    return (
      <Button
        variant="accent"
        icon={<Play size={16} aria-hidden="true" />}
        busy={pending === 'start'}
        busyLabel="Starting"
        onClick={actions.start}
      >
        {controls.retry ? 'Retry the simulation' : 'Start the simulation'}
      </Button>
    );
  }
  if (phase === 'complete') {
    if (controls.report === 'write') {
      return (
        <Button
          variant="accent"
          icon={<Sparkles size={16} aria-hidden="true" />}
          busy={pending === 'report'}
          busyLabel="Writing"
          onClick={actions.report}
        >
          Write the detailed report
        </Button>
      );
    }
    if (controls.report === 'open') {
      // The report is a page of the decision scene, which opens once the scenarios have been compared.
      if (!sceneAvailable(project, 'decide')) {
        return (
          <>
            <span className="sw-deep-strip__why">
              The report is written. It opens with the decision page, once the scenarios have been
              compared.
            </span>
            {!readsThroughTheDeepDive(project) && (
              <Button
                variant="glass"
                iconEnd={<ArrowRight size={16} aria-hidden="true" />}
                onClick={() => go('simulate', { view: 'setup' })}
              >
                Set up the comparison
              </Button>
            )}
          </>
        );
      }
      return (
        <Button
          variant="accent"
          iconEnd={<ArrowRight size={16} aria-hidden="true" />}
          onClick={actions.openReport}
        >
          Open the detailed report
        </Button>
      );
    }
    if (controls.branch) {
      return (
        <Button
          variant="glass"
          icon={<GitBranch size={16} aria-hidden="true" />}
          onClick={() => state.openBranch()}
        >
          Branch from a round
        </Button>
      );
    }
  }
  return null;
}

/** How the proxies act in this run, in the engine's own words: one press from the engine chip. */
function EngineChip() {
  const { project } = useDeep();
  const local = project.mode === 'local';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ChipButton size="sm" icon={<Cpu aria-hidden="true" />}>
          {engineLabel(project)}
        </ChipButton>
      </PopoverTrigger>
      <PopoverContent width="24rem" align="end">
        <div className="sw-deep-engine">
          <p className="sw-eyebrow">{local ? 'Local rules' : 'Model-assisted'}</p>
          <p>{local ? LOCAL_NOTE : MODEL_NOTE}</p>
          <p className="sw-caption">{POSITION_NOTE}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The title, and one line that says what this is and what it is not. */
export function Header() {
  const ws = useWorkspace();
  const away = useAway();
  // A run the engine made on its own has no comparison to go back to: the deep dive is its simulation.
  const alone = readsThroughTheDeepDive(ws.project);
  return (
    <header className="sw-deep-header">
      {!alone && (
        <Button
          variant="ghost"
          size="sm"
          className="sw-deep-back"
          icon={<ArrowLeft size={15} aria-hidden="true" />}
          // A change of view is not an exit the shell controls, and the setup is lost with the deep dive: it asks for itself.
          onClick={() => away(() => ws.setView(null))}
        >
          Simulation
        </Button>
      )}
      <p className="sw-eyebrow">Deep dive</p>
      <h1 className="sw-title sw-deep-title" id="deep-title">
        A slower, <em>closer</em> look
      </h1>
      <p className="sw-lead sw-deep-lead">
        Fictional proxies act on two simulated platforms, round by round.
        {alone ? '' : ' The comparison and the decision brief do not wait for it.'}
      </p>
      <p className="sw-caption sw-deep-caution">{PROXY_LINE}</p>
    </header>
  );
}

/** Where the run stands, in one line, and the one thing that moves it on. */
export function RunStrip() {
  const state = useDeep();
  const { project, actions } = state;
  const view = phaseView(project);
  const saved = savedRounds(project);
  const label = useRef<HTMLParagraphElement>(null);
  const previous = useRef(view.phase);

  // The button that was pressed is gone once the state moves on: focus goes to the state itself.
  useEffect(() => {
    if (previous.current === view.phase) return;
    previous.current = view.phase;
    const active = document.activeElement;
    if (!active || active === document.body) label.current?.focus({ preventScroll: true });
  }, [view.phase]);

  if (view.phase === 'legacy' || view.phase === 'unavailable') return null;
  return (
    <div
      className="sw-deep-strip"
      data-phase={view.phase}
      data-live={view.live || undefined}
      role="group"
      aria-label="Where the run stands"
    >
      <Mark
        phase={view.phase}
        tone={view.tone}
        saved={saved}
        share={progressShare(project)}
        live={view.live}
      />
      <div className="sw-deep-strip__text">
        <p className="sw-deep-strip__label" ref={label} tabIndex={-1}>
          <span className="sw-deep-strip__word">{view.label}</span>
          {(view.phase === 'running' || view.phase === 'paused') && (
            <Chip tone={view.tone} dot={view.live} size="sm">
              {project.roundCount - saved} to go
            </Chip>
          )}
        </p>
        <p className="sw-deep-strip__detail">{view.detail}</p>
      </div>
      <div className="sw-deep-strip__actions">
        <EngineChip />
        <Primary state={state} />
      </div>
      {actions.error && (
        <p className="sw-deep-strip__error" role="alert">
          {actions.error}
        </p>
      )}
    </div>
  );
}
