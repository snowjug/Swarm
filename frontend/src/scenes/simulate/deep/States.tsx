import { ArrowRight, Layers, Play, Sparkles } from 'lucide-react';
import { useWorkspace } from '../../../app/context';
import { Button, EmptyState, Notice, Orbit } from '../../../design/ui';
import { stepLock } from '../../../lib/console';
import { useDeep } from './context';
import { deepPhase } from './model';
import './states.css';

/** Before there is an environment: what making one involves, and the one button that does it. */
export function Prepare() {
  const { project, controls, actions, setTab } = useDeep();
  const ws = useWorkspace();
  const phase = deepPhase(project);
  const lock = stepLock(project, 'environment');
  const latest = project.events.at(-1)?.message ?? null;

  if (phase === 'preparing') {
    return (
      <section className="sw-deep-start" aria-live="polite" aria-busy="true">
        <Orbit size={44} label="Preparing the environment" />
        <h2 className="sw-title sw-deep-start__title">
          Making the cast and <em>the platforms</em>
        </h2>
        {latest && (
          <p className="sw-deep-start__note">
            <span>Latest record from the engine</span>
            {latest}
          </p>
        )}
      </section>
    );
  }
  return (
    <section className="sw-deep-start" aria-labelledby="deep-start-title">
      <p className="sw-eyebrow">Before anything runs</p>
      <h2 className="sw-title sw-deep-start__title" id="deep-start-title">
        Make the cast and <em>the platforms</em>
      </h2>
      <p className="sw-lead sw-deep-start__lead">
        A small cast of fictional proxies, two simulated platforms to meet on, and a few assumed
        inputs to start from. You can read and change all of it before the first round.
      </p>
      {phase === 'prep-stopped' && (
        <Notice tone="caution" title="Preparation stopped">
          {project.error ?? 'It did not finish. Preparing it again starts it fresh.'}
        </Notice>
      )}
      <ol className="sw-deep-steps" role="list">
        <li>
          <span className="sw-numeral sw-deep-steps__n" aria-hidden="true">
            1
          </span>
          <div>
            <strong>Prepare</strong>
            <p>
              {project.lab?.actors
                ? 'The cast is made from the actors you approved on the map.'
                : 'The cast is drawn from the topics in your evidence.'}{' '}
              Where they meet and what they start from are set from the same evidence.
            </p>
          </div>
        </li>
        <li>
          <span className="sw-numeral sw-deep-steps__n" aria-hidden="true">
            2
          </span>
          <div>
            <strong>Check</strong>
            <p>Read each proxy and change what you disagree with. Every number is an assumption.</p>
          </div>
        </li>
        <li>
          <span className="sw-numeral sw-deep-steps__n" aria-hidden="true">
            3
          </span>
          <div>
            <strong>Run</strong>
            <p>
              Watch it round by round. Pause to add one assumed event, or branch to try another.
            </p>
          </div>
        </li>
      </ol>
      <div className="sw-deep-start__actions">
        {controls.prepare ? (
          <Button
            variant="accent"
            size="lg"
            icon={<Sparkles size={18} aria-hidden="true" />}
            busy={actions.pending === 'prepare'}
            busyLabel="Preparing"
            onClick={actions.prepare}
          >
            {phase === 'prep-stopped' ? 'Prepare it again' : 'Prepare the environment'}
          </Button>
        ) : (
          <>
            {lock && <span className="sw-deep-fine">{lock}.</span>}
            <Button
              variant="glass"
              size="lg"
              iconEnd={<ArrowRight size={17} aria-hidden="true" />}
              onClick={() => ws.go('ground')}
            >
              Open Ground
            </Button>
          </>
        )}
        {phase !== 'prep-stopped' && (
          <Button variant="ghost" onClick={() => setTab('run')}>
            See the run
          </Button>
        )}
      </div>
    </section>
  );
}

/** A part of the deep dive that has nothing to show until something has run. It says so, and what starts it. */
export function NoRounds({ what }: { what: string }) {
  const { controls, actions, setTab, project } = useDeep();
  const phase = deepPhase(project);
  return (
    <EmptyState
      level={2}
      icon={<Layers size={24} aria-hidden="true" />}
      title="Nothing has run yet"
      action={
        controls.start && phase === 'ready' ? (
          <Button
            variant="accent"
            icon={<Play size={16} aria-hidden="true" />}
            busy={actions.pending === 'start'}
            busyLabel="Starting"
            onClick={actions.start}
          >
            Start the simulation
          </Button>
        ) : phase === 'unprepared' || phase === 'prep-stopped' ? (
          <Button variant="glass" onClick={() => setTab('setup')}>
            Go to the setup
          </Button>
        ) : undefined
      }
    >
      {what} appear here as the server saves each round. Nothing is staged or estimated.
    </EmptyState>
  );
}
