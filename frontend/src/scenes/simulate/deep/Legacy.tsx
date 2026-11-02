import { useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { useWorkspace } from '../../../app/context';
import { Button, EmptyState, Notice } from '../../../design/ui';
import { LEGACY_BODY, NETWORK_BLURB } from './copy';
import { Cast } from './Cast';
import { useDeep } from './context';
import { plural } from './model';
import { SectionHead } from './parts';
import { RoundsView } from './Rounds';
import './states.css';

/**
 * A record that has no staged run: a quick run saved before the engine had stages, or a guided record whose
 * stages the server did not return. What it kept is shown; nothing is made up for what it did not.
 */
export function Legacy() {
  const { project } = useDeep();
  const ws = useWorkspace();
  const quick = project.workflow !== 'guided';
  const saved = project.rounds.length;
  const [round, setRound] = useState(saved);

  return (
    <div className="sw-deep-legacy">
      <section aria-labelledby="deep-legacy">
        <Notice
          tone="caution"
          title={
            quick
              ? 'A quick run, saved before the staged engine'
              : 'The staged record is unavailable'
          }
        >
          {quick
            ? LEGACY_BODY
            : 'The server did not return the stages for this guided exploration. What was stored is shown below; the controls are off until it is read again.'}
        </Notice>
        <div className="sw-deep-legacy__actions" id="deep-legacy">
          {quick && (
            <Button
              variant="accent"
              icon={<Copy size={16} aria-hidden="true" />}
              disabled={ws.busy}
              onClick={ws.duplicate}
            >
              Duplicate as a guided exploration
            </Button>
          )}
          {!quick && (
            <Button
              variant="glass"
              icon={<RefreshCw size={16} aria-hidden="true" />}
              onClick={() => ws.refresh()}
            >
              Read it again
            </Button>
          )}
        </div>
      </section>

      {project.agents.length > 0 && (
        <section className="sw-deep-sec" aria-labelledby="deep-legacy-cast">
          <SectionHead
            id="deep-legacy-cast"
            title="The recorded proxies"
            lead={`${plural(project.agents.length, 'fictional proxy', 'fictional proxies')}, read-only. Where they started and where the run left them.`}
          />
          <Cast />
        </section>
      )}

      {saved > 0 ? (
        <RoundsView
          source={{
            name: 'The recorded rounds',
            lead: `${quick ? 'One original run' : 'The combined rounds the server kept'}, on the saved ${project.settings.network} network. ${project.settings.network === 'broadcast' ? NETWORK_BLURB.plaza : NETWORK_BLURB.community} Platform runs, memory records and scenario-minute clocks were ${quick ? 'not recorded' : 'not returned'}.`,
            platform: null,
            rounds: project.rounds,
            saved,
            minutes: null,
            seeds: [],
          }}
          agents={project.agents}
          total={project.roundCount}
          round={round}
          setRound={setRound}
          event={null}
          copied={0}
          inFlight={false}
        />
      ) : (
        <EmptyState level={2} title="No rounds were recorded">
          This record has no saved simulation output.
        </EmptyState>
      )}
    </div>
  );
}
