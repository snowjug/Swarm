import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ArrowRight, Layers, MoreHorizontal, RotateCw, Telescope } from 'lucide-react';
import { useWorkspace } from '../../app/context';
import { SPRING } from '../../design/motion';
import {
  Button,
  EmptyState,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  IconButton,
  Notice,
  Orbit,
  Segmented,
  Skeleton,
} from '../../design/ui';
import { useAnalysis, type AnalysisState } from '../../hooks/useAnalysis';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { dateTime } from '../../lib/format';
import type { Analysis } from '../../../../shared/analysis';
import { LiveView } from './LiveView';
import { NetworkColour, NetworkView, RelationKinds } from './NetworkView';
import { Fine, StoryView, TimelineView } from './Pages';
import { Running } from './Running';
import { Setup, type SetupSettings } from './Setup';
import { NETWORK_DEFAULTS, replayOf, type NetworkSettings, type Replay } from './model';
import { useCastMap } from './useCastMap';
import { usePlayback } from './usePlayback';
import { useStageBoxes } from './useStage';
import './simulate.css';

type TheatreView = 'story' | 'live' | 'network' | 'timeline';
const VIEW_LABELS: Record<TheatreView, string> = {
  story: 'Story',
  live: 'Live',
  network: 'Network',
  timeline: 'Timeline',
};

const deepLoaders = import.meta.glob<{ default: ComponentType }>('./deep/index.tsx');
const Deep = lazy(
  deepLoaders['./deep/index.tsx'] ?? (() => Promise.resolve({ default: () => null })),
);

const running = (analysis: Analysis | null): boolean =>
  analysis?.status === 'running' || analysis?.status === 'queued';
const settingsOf = (analysis: Analysis): SetupSettings => ({
  variants: analysis.config.variants,
  runsPerVariant: analysis.config.runsPerVariant,
  sensitivity: analysis.config.sensitivity,
  baseSeed: analysis.config.baseSeed,
  rounds: analysis.config.rounds,
});

const REPLAYED_KEY = 'swarm.replayed';
function wasReplayed(id: string): boolean {
  try {
    return (JSON.parse(sessionStorage.getItem(REPLAYED_KEY) ?? '[]') as string[]).includes(id);
  } catch {
    return false;
  }
}
function markReplayed(id: string): void {
  try {
    const seen = (JSON.parse(sessionStorage.getItem(REPLAYED_KEY) ?? '[]') as string[]).slice(-20);
    sessionStorage.setItem(REPLAYED_KEY, JSON.stringify([...seen, id]));
  } catch {
    // A page that cannot keep this simply plays again.
  }
}

function availableViews(replay: Replay | null): TheatreView[] {
  return replay ? ['story', 'live', 'network', 'timeline'] : ['story', 'timeline'];
}

function Theatre({
  analysis,
  state,
  autoplay,
}: {
  analysis: Analysis;
  state: AnalysisState;
  autoplay: boolean;
}) {
  const ws = useWorkspace();
  const replay = useMemo(() => replayOf(analysis), [analysis]);
  const wide = useMediaQuery('(min-width: 64rem)');
  const views = availableViews(replay);
  const requested = ws.view as TheatreView | null;
  const view: TheatreView =
    requested && views.includes(requested) ? requested : replay ? 'live' : 'story';
  const playback = usePlayback(replay?.firstRound ?? 1, replay?.lastRound ?? 1, {
    autoplay: autoplay && Boolean(replay) && view === 'live',
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [network, setNetwork] = useState<NetworkSettings>(NETWORK_DEFAULTS);
  const cast = useCastMap(analysis);
  const stage = view === 'live' || view === 'network';
  const boxes = useStageBoxes();

  useEffect(() => {
    if (autoplay) markReplayed(analysis.id);
  }, [autoplay, analysis.id]);

  const heading =
    view === 'live' ? (
      <>
        Watch it <em>unfold</em>
      </>
    ) : (
      <>
        Who is <em>connected</em>
      </>
    );

  return (
    <section
      className="sw-sim"
      data-view={view}
      data-stage={stage || undefined}
      aria-label="Simulation"
      style={
        {
          '--stage-dock': `${boxes.dock}px`,
          '--stage-top': `${boxes.top}px`,
        } as React.CSSProperties
      }
    >
      {/* The heading and the ways to look come first, in the page and for the keyboard; the picture is laid under them. */}
      <div className="sw-sim__top" ref={boxes.topRef}>
        {stage && replay ? (
          <m.header
            className="sw-sim__head"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING.smooth}
            key={view}
          >
            <h1 className="sw-display sw-sim__title" tabIndex={-1} data-focus-key="theatre-title">
              {heading}
            </h1>
            <p className="sw-sim__sub">
              {view === 'live'
                ? `One typical run of ${analysis.config.runsPerVariant}`
                : 'The relations the comparison used'}
              <span aria-hidden="true"> · </span>
              {replay.variant.label}
              {view === 'live' && (
                <>
                  <span aria-hidden="true"> · </span>seed{' '}
                  <span className="sw-mono">{replay.run.seed}</span>
                </>
              )}
            </p>
            <Fine className="sw-sim__fine" />
            {view === 'network' && (
              <div className="sw-net__controls">
                <NetworkColour settings={network} onChange={setNetwork} />
                {wide && <RelationKinds cast={cast} settings={network} onChange={setNetwork} />}
              </div>
            )}
          </m.header>
        ) : (
          <span />
        )}
        <div
          className="sw-sim__bar sw-glass sw-glass--overlay"
          role="toolbar"
          aria-label="Ways to look at it"
        >
          <Segmented<TheatreView>
            size="sm"
            label="View"
            value={view}
            onChange={(next) => {
              setSelectedId(null);
              ws.setView(next === (replay ? 'live' : 'story') ? null : next);
            }}
            options={views.map((value) => ({ value, label: VIEW_LABELS[value] }))}
          />
          <Button
            size="sm"
            variant="glass"
            className="sw-hide-sm"
            iconEnd={<ArrowRight size={15} aria-hidden="true" />}
            onClick={() => ws.go('compare')}
          >
            Compare
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <IconButton label="More" size="sm">
                <MoreHorizontal size={17} aria-hidden="true" />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={<RotateCw size={16} />} onSelect={() => ws.setView('setup')}>
                Run it again…
              </MenuItem>
              <MenuItem
                icon={<Layers size={16} />}
                onSelect={() => ws.go('simulate', { view: 'deep' })}
              >
                Deep dive
              </MenuItem>
              {state.summaries.length > 1 && (
                <>
                  <MenuSeparator />
                  <MenuLabel>Saved simulations</MenuLabel>
                  <MenuRadioGroup value={analysis.id} onValueChange={(id) => state.select(id)}>
                    {state.summaries.slice(0, 8).map((item) => (
                      <MenuRadioItem key={item.id} value={item.id}>
                        {dateTime(item.createdAt)} · {item.variants.length}×{item.runsPerVariant}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </>
              )}
            </MenuContent>
          </Menu>
        </div>
      </div>

      {view === 'live' && replay && (
        <LiveView
          analysis={analysis}
          cast={cast}
          replay={replay}
          playback={playback}
          selectedId={selectedId}
          onSelect={setSelectedId}
          wide={wide}
          boxes={boxes}
        />
      )}
      {view === 'network' && replay && (
        <NetworkView
          analysis={analysis}
          cast={cast}
          settings={network}
          onSettings={setNetwork}
          replay={replay}
          selectedId={selectedId}
          onSelect={setSelectedId}
          wide={wide}
          boxes={boxes}
        />
      )}

      {view === 'story' && (
        <StoryView
          analysis={analysis}
          replay={replay}
          onWatch={(id) => (id && setSelectedId(id), ws.setView(replay ? null : 'timeline'))}
          onCompare={() => ws.go('compare')}
          onReview={() => ws.go('map')}
          onDeep={() => ws.go('simulate', { view: 'deep' })}
        />
      )}
      {view === 'timeline' && (
        <TimelineView analysis={analysis} replay={replay} playback={playback} />
      )}
    </section>
  );
}

/**
 * A screen of the scene is a place of its own: when the one that is open changes (the form that was pressed gives way to
 * the progress, a stopped run to its notice) the new one opens at its top, not where the last was scrolled to.
 */
function ScreenTop({ stage }: { stage: string }) {
  const previous = useRef(stage);
  useEffect(() => {
    if (previous.current === stage) return;
    previous.current = stage;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [stage]);
  return null;
}

/**
 * The simulation, the hero of the product. Before a run it is a small set of choices; while it runs it is the work, drawn
 * as it happens; once it is done it is a theatre with four ways to look at the same real run: a story written from its
 * numbers, the actors moving round by round, the network they sit in, and the spread of every run over time.
 */
export function SimulateScene() {
  const ws = useWorkspace();
  const state = useAnalysis(ws.project.id);
  const { readiness, current, loading, error } = state;
  const [announcement, setAnnouncement] = useState('');
  const isRunning = running(current);
  const currentId = current?.id ?? null;
  const finished = current?.status === 'completed';
  // The id of the simulation this person watched run: its results arrive as a reveal, and the finish is said aloud.
  const [watched, setWatched] = useState<string | null>(null);
  useEffect(() => {
    if (isRunning && currentId) setWatched(currentId);
  }, [isRunning, currentId]);
  useEffect(() => {
    if (finished && watched !== null && watched === currentId)
      setAnnouncement('The simulation finished. The results are shown.');
  }, [finished, watched, currentId]);
  const autoplay = Boolean(
    finished && currentId && (watched === currentId || !wasReplayed(currentId)),
  );

  let stage: string;
  let body: React.ReactNode;
  if (ws.view === 'deep') {
    stage = 'deep';
    body = (
      <Suspense
        fallback={
          <div className="sw-scene-loading">
            <Orbit size={28} label="Opening the deep dive" />
          </div>
        }
      >
        <Deep />
      </Suspense>
    );
  } else if (!readiness) {
    stage = error ? 'error' : 'loading';
    body = error ? (
      <section className="sw-sim-state">
        <Notice
          tone="error"
          title="Saved simulations could not be read"
          action={
            <Button size="sm" variant="glass" onClick={state.reload}>
              Retry
            </Button>
          }
        >
          {error}
        </Notice>
      </section>
    ) : (
      <section className="sw-sim-state" aria-busy="true" aria-live="polite">
        <Skeleton className="sw-sim-state__skeleton" />
        <p className="sw-caption">{loading ? 'Reading saved simulations…' : ''}</p>
      </section>
    );
  } else if (readiness.actors === null && !current) {
    stage = 'no-actors';
    body = (
      <section className="sw-sim-state">
        <EmptyState
          icon={<Telescope size={26} aria-hidden="true" />}
          title="No actors to simulate yet"
          action={
            <Button
              variant="accent"
              size="lg"
              iconEnd={<ArrowRight size={17} aria-hidden="true" />}
              onClick={() => ws.go('map')}
            >
              Open the map
            </Button>
          }
        >
          Approve the stakeholders, then create the actors from them on the map. Then the futures
          can be set side by side.
        </EmptyState>
      </section>
    );
  } else if (current && isRunning) {
    stage = 'running';
    body = (
      <Running
        analysis={current}
        perturbations={readiness.perturbations}
        cancelling={state.cancelling}
        trouble={state.trouble}
        error={state.startError}
        mayRun={readiness.may.run}
        onCancel={() => void state.cancel()}
      />
    );
  } else if (current?.status === 'completed' && ws.view !== 'setup') {
    stage = 'theatre';
    body = <Theatre key={current.id} analysis={current} state={state} autoplay={autoplay} />;
  } else {
    stage = current ? 'unfinished' : 'setup';
    const again = current ? (
      <Button
        size="sm"
        variant="glass"
        disabled={state.starting || !readiness.may.run}
        onClick={() => void state.start(settingsOf(current))}
      >
        Run it again with the same settings
      </Button>
    ) : undefined;
    body = (
      <>
        {current && current.status !== 'completed' && (
          <div className="sw-sim-state__notice">
            {current.status === 'cancelled' ? (
              <Notice tone="info" title="This simulation was cancelled" action={again}>
                It stopped after {current.progress.completedRuns.toLocaleString('en-GB')} of{' '}
                {current.progress.totalRuns.toLocaleString('en-GB')} runs. Nothing is shown from a
                partial simulation, because its scenarios would not yet all have the same seeds.
              </Notice>
            ) : current.status === 'interrupted' ? (
              <Notice tone="caution" title="This simulation was interrupted" action={again}>
                {current.error?.message ??
                  'The server stopped before it finished. It can be reproduced exactly from its seeds.'}
              </Notice>
            ) : (
              <Notice tone="error" title="This simulation failed" action={again}>
                {current.error?.message ?? 'It stopped before it finished.'}
              </Notice>
            )}
          </div>
        )}
        <Setup
          key={current?.id ?? 'new'}
          readiness={readiness}
          {...(current ? { initial: settingsOf(current) } : {})}
          lastWallMs={
            state.summaries.find((item) => item.status === 'completed')?.cost.wallMs ?? null
          }
          starting={state.starting}
          error={state.startError}
          onStart={(input) =>
            void state.start(input).then((started) => started && ws.setView(null))
          }
          onOpenMap={() => ws.go('map')}
          {...(current?.status === 'completed' ? { onBack: () => ws.setView(null) } : {})}
        />
      </>
    );
  }

  return (
    <>
      <ScreenTop stage={stage} />
      <AnimatePresence mode="wait" initial={false}>
        <m.div
          key={stage}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.14 } }}
          transition={{ duration: 0.28 }}
        >
          {body}
        </m.div>
      </AnimatePresence>
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </>
  );
}
