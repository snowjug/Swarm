import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import type { Platform, SimulationMemory } from '../../../../../shared/guided';
import type { Agent, RoundSnapshot } from '../../../../../shared/types';
import { Disclosure, IconButton, Switch } from '../../../design/ui';
import { CHART_NOTE, NETWORK_BLURB } from './copy';
import { usePlayback } from './controller';
import { useDeep } from './context';
import { Inspector } from './Inspector';
import { Lanes } from './Lanes';
import {
  chartSummary,
  copiedRounds,
  interventionMark,
  minutesText,
  proxyLines,
  roundDetail,
  roundPoints,
  shareText,
  stanceText,
  startMean,
  zoomSuggested,
} from './model';
import { PlatformSwitch, SectionHead } from './parts';
import { RoundTrack } from './RoundTrack';
import { NoRounds } from './States';
import './rounds.css';

export interface RoundsSource {
  /** What is being looked at: a platform's name, or the quick run's. */
  name: string;
  lead?: string;
  platform: Platform | null;
  rounds: RoundSnapshot[];
  saved: number;
  minutes: number | null;
  seeds: SimulationMemory[];
}

function Table({
  source,
  agents,
  total,
}: {
  source: RoundsSource;
  agents: readonly Agent[];
  total: number;
}) {
  const points = roundPoints(source.rounds);
  const lines = proxyLines(source.rounds, agents);
  const columns = [0, ...points.map((point) => point.round)];
  return (
    <Disclosure summary="The same numbers, as a table">
      <div
        className="sw-deep-table-wrap"
        role="region"
        aria-label={`Per-round values for ${source.name}`}
        tabIndex={0}
      >
        <table className="sw-deep-table">
          <caption>
            {source.name}: the figures recorded for each saved round, of {total} planned. Unitless;
            inclinations to three places.
          </caption>
          <thead>
            <tr>
              <th scope="col">Round</th>
              <th scope="col">Mean inclination</th>
              <th scope="col">Against</th>
              <th scope="col">Undecided</th>
              <th scope="col">In favour</th>
              <th scope="col">Polarization</th>
              <th scope="col">Actions</th>
              <th scope="col">Heard</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.round}>
                <th scope="row">{point.round}</th>
                <td>{stanceText(point.mean, 3)}</td>
                <td>{shareText(point.opposition)}</td>
                <td>{shareText(point.undecided)}</td>
                <td>{shareText(point.support)}</td>
                <td>{point.polarization.toFixed(3)}</td>
                <td>{point.actions}</td>
                <td>{point.interactions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        className="sw-deep-table-wrap"
        role="region"
        aria-label={`Each proxy's inclination by round for ${source.name}`}
        tabIndex={0}
      >
        <table className="sw-deep-table">
          <caption>
            Each proxy’s inclination at the start (round 0) and after each saved round.
          </caption>
          <thead>
            <tr>
              <th scope="col">Proxy</th>
              {columns.map((round) => (
                <th scope="col" key={round}>
                  {round === 0 ? 'Start' : round}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <th scope="row">{line.name}</th>
                {columns.map((round) => {
                  const found = line.points.find((item) => item.round === round);
                  return <td key={round}>{found ? stanceText(found.opinion, 3) : '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Disclosure>
  );
}

/**
 * The rounds of one run, looked at: the four lanes on one clock, the round in view with who stood where and
 * who did what, and the same numbers as a table. Any round can be reached by dragging the chart, pressing the
 * track, the arrow keys, or playing the run back: playing back changes only the round in view.
 */
export function RoundsView({
  source,
  agents,
  total,
  round,
  setRound,
  head,
  event,
  copied,
  inFlight,
}: {
  source: RoundsSource;
  agents: readonly Agent[];
  total: number;
  round: number;
  setRound: (round: number) => void;
  head?: ReactNode;
  event: { round: number; applied: boolean } | null;
  copied: number;
  inFlight: boolean;
}) {
  const [follow, setFollow] = useState<string | null>(null);
  const [override, setOverride] = useState<boolean | null>(null);
  const points = useMemo(() => roundPoints(source.rounds), [source.rounds]);
  const lines = useMemo(() => proxyLines(source.rounds, agents), [source.rounds, agents]);
  const start = startMean(agents);
  const zoom = override ?? zoomSuggested(points, lines);
  const at = Math.min(round, source.saved);
  const detail = roundDetail(source.rounds, agents, at, source.minutes);
  const previousMean = at === 1 ? start : (detail.previous?.mean ?? null);
  const playback = usePlayback(at, source.saved, setRound);
  const summary = chartSummary(source.name, points, start, total);
  const go = (next: number) => {
    playback.stop();
    setRound(Math.min(source.saved, Math.max(0, next)));
  };

  return (
    <div className="sw-deep-rounds">
      <SectionHead title={source.name} lead={source.lead} aside={head} />

      <div className="sw-deep-transport">
        <div className="sw-deep-transport__buttons">
          <IconButton
            label={
              playback.playing
                ? 'Pause the replay'
                : at >= source.saved
                  ? 'Replay from the start'
                  : 'Replay the rounds'
            }
            tone="accent"
            size="md"
            pressed={playback.playing}
            disabled={source.saved === 0}
            onClick={playback.toggle}
          >
            {playback.playing ? (
              <Pause size={18} aria-hidden="true" />
            ) : (
              <Play size={18} aria-hidden="true" />
            )}
          </IconButton>
          <IconButton
            label="Previous round"
            size="sm"
            disabled={at <= 0}
            onClick={() => go(at - 1)}
          >
            <ChevronLeft size={17} aria-hidden="true" />
          </IconButton>
          <IconButton
            label="Next round"
            size="sm"
            disabled={at >= source.saved}
            onClick={() => go(at + 1)}
          >
            <ChevronRight size={17} aria-hidden="true" />
          </IconButton>
        </div>
        <RoundTrack
          label={`Round in view, ${source.name}`}
          total={total}
          saved={source.saved}
          value={at}
          onChange={go}
          inFlight={inFlight}
          event={event}
          copied={copied}
          valueText={(value) =>
            value === 0 ? 'The start, before round 1' : `Round ${value} of ${total}`
          }
          className="sw-deep-transport__track"
        />
        <p className="sw-deep-transport__read" aria-hidden="true">
          <span className="sw-numeral num">{at}</span>
          <span>of {total}</span>
        </p>
      </div>

      <div className="sw-deep-chart">
        <Lanes
          points={points}
          lines={lines}
          startMean={start}
          total={total}
          saved={source.saved}
          round={at}
          onSelect={go}
          event={event}
          copied={copied}
          zoom={zoom}
          follow={follow}
          summary={summary}
        />
        <div className="sw-deep-chart__foot">
          <Switch
            label="Zoom in"
            description={
              zoom
                ? 'The inclination and polarization scales are fitted to the data.'
                : 'The inclination scale runs the full −1 to +1.'
            }
            checked={zoom}
            onChange={(event_) => setOverride(event_.target.checked)}
          />
          <p className="sw-deep-fine">{CHART_NOTE}</p>
        </div>
      </div>

      <Inspector
        detail={detail}
        platformName={source.name}
        platform={source.platform}
        seeds={source.seeds}
        total={total}
        previousMean={previousMean}
        onFollow={setFollow}
      />
      <Table source={source} agents={agents} total={total} />
      {source.minutes !== null && source.saved > 0 && (
        <p className="sw-deep-fine">
          Scenario time at the last saved round: {minutesText(source.saved * source.minutes)}. It
          moves only when a round is saved.
        </p>
      )}
    </div>
  );
}

/** The rounds of the run, one platform at a time. */
export function Rounds() {
  const { project, platforms, platform, setPlatform, round, setRound } = useDeep();
  const mark = interventionMark(project);
  const ran = platforms.filter((item) => item.rounds.length > 0);
  const shown = ran.find((item) => item.id === platform) ?? ran[0];
  if (!shown) return <NoRounds what="The rounds" />;
  const seeds = (project.console?.memories ?? []).filter(
    (memory) => memory.platform === shown.id && memory.kind === 'seed',
  );
  return (
    <RoundsView
      key={shown.id}
      source={{
        name: shown.name,
        lead: NETWORK_BLURB[shown.id],
        platform: shown.id,
        rounds: shown.rounds,
        saved: shown.saved,
        minutes: project.console?.environment?.minutesPerRound ?? null,
        seeds,
      }}
      agents={project.agents}
      total={project.roundCount}
      round={round}
      setRound={setRound}
      head={<PlatformSwitch platforms={platforms} value={shown.id} onChange={setPlatform} />}
      event={mark ? { round: mark.round, applied: mark.applied } : null}
      copied={copiedRounds(project)}
      inFlight={project.console?.steps.simulation === 'running'}
    />
  );
}
