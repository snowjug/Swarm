import { useId, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, Flag, GitBranch, Radio, TrendingUp } from 'lucide-react';
import type { ProjectDetail, RoundSnapshot } from '../../../shared/types';
import { count, percent, signed } from '../lib/format';
import { EmptyPanel, SourceLinks } from './ui';

function TrajectoryChart({
  rounds,
  selectedRound,
  onSelect,
}: {
  rounds: RoundSnapshot[];
  selectedRound: number;
  onSelect: (round: number) => void;
}) {
  const chartId = useId();
  const x = (index: number) => 52 + (index / Math.max(1, rounds.length - 1)) * 596;
  const y = (value: number) => 119 - Math.max(-1, Math.min(1, value)) * 82;
  const points = rounds.map((round, index) => `${x(index)},${y(round.meanOpinion)}`).join(' ');
  const area = `52,201 ${points} ${x(rounds.length - 1)},201`;
  return (
    <svg className="trajectory-chart" viewBox="0 0 690 250" role="group" aria-labelledby={chartId}>
      <title id={chartId}>
        Mean simulated stance by round, from minus one opposing to plus one supporting. Select a
        point to inspect that round.
      </title>
      <defs>
        <linearGradient id={`${chartId}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#53d4b3" stopOpacity=".17" />
          <stop offset="1" stopColor="#53d4b3" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[-1, -0.5, 0, 0.5, 1].map((value) => (
        <g key={value}>
          <line
            x1="52"
            x2="648"
            y1={y(value)}
            y2={y(value)}
            stroke="#2c3b3d"
            strokeDasharray={value === 0 ? undefined : '3 5'}
          />
          <text x="35" y={y(value) + 4} fill="#8a9c9a" fontSize="10" textAnchor="end">
            {value > 0 ? '+' : ''}
            {value}
          </text>
        </g>
      ))}
      <polygon points={area} fill={`url(#${chartId}-fill)`} />
      <polyline
        points={points}
        fill="none"
        stroke="#6de0c1"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {rounds.map((round, index) => (
        <g
          className="chart-point"
          key={round.round}
          role="button"
          tabIndex={0}
          aria-pressed={round.round === selectedRound}
          aria-label={`Round ${round.round}, mean stance ${signed(round.meanOpinion)}`}
          onClick={() => onSelect(round.round)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(round.round);
            }
          }}
        >
          <circle
            cx={x(index)}
            cy={y(round.meanOpinion)}
            r="11"
            fill="transparent"
            className="point-hit"
          />
          <circle
            cx={x(index)}
            cy={y(round.meanOpinion)}
            r={round.round === selectedRound ? 5 : 3}
            fill={round.round === selectedRound ? '#b8ffeb' : '#152c27'}
            stroke="#6de0c1"
            strokeWidth="2"
          />
          {(rounds.length <= 12 || index % 2 === 0 || index === rounds.length - 1) && (
            <text x={x(index)} y="225" textAnchor="middle" fontSize="10" fill="#8a9c9a">
              {round.round}
            </text>
          )}
        </g>
      ))}
      <text x="350" y="247" textAnchor="middle" fontSize="9" fill="#7e918f" letterSpacing="1.5">
        SIMULATION ROUND
      </text>
    </svg>
  );
}

export function RoundsView({
  project,
  onSource,
}: {
  project: ProjectDetail;
  onSource: (id: string) => void;
}) {
  const [chosenRound, setChosenRound] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const selected =
    project.rounds.find((round) => round.round === chosenRound) ?? project.rounds.at(-1);
  if (!selected) {
    return (
      <EmptyPanel title="No rounds recorded yet" icon={<Activity size={27} aria-hidden="true" />}>
        The timeline fills with actual snapshots as the simulation runs. No outcomes are shown
        before the engine records them.
      </EmptyPanel>
    );
  }
  const latest = project.rounds.at(-1)!;
  const selectedIndex = project.rounds.indexOf(selected);
  const agents = new Map(project.agents.map((agent) => [agent.id, agent]));
  const filteredActions = selected.actions.filter((action) =>
    `${agents.get(action.agentId)?.name ?? action.agentId} ${action.content}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const actionLabel = (type: string) => {
    if (type === 'update') return 'State update';
    if (type === 'observe') return 'Observation';
    if (project.mode === 'llm' && type === 'post') return 'Generated post';
    if (project.mode === 'llm' && type === 'reply') return 'Generated reply';
    return 'Simulation action';
  };
  return (
    <div className="view-stack">
      <div className="section-heading">
        <div>
          <span className="eyebrow">OBSERVE, THEN QUESTION</span>
          <h2>The shape of a scenario.</h2>
        </div>
        <span className="method-tag">
          <Activity size={13} aria-hidden="true" /> {project.rounds.length} / {project.roundCount}{' '}
          ROUNDS RECORDED
        </span>
      </div>
      <p className="view-description">
        All quantities below describe this simulated group, not probabilities, public sentiment, or
        validated forecasts. Stance runs from −1 opposing to +1 supporting.
      </p>
      <div className="metric-grid">
        <div className="metric-card">
          <span>Simulated support share</span>
          <strong className="text-teal">{percent(latest.supportShare)}</strong>
          <small>At round {latest.round} · fraction of agents</small>
        </div>
        <div className="metric-card">
          <span>Mean simulated stance</span>
          <strong>{signed(latest.meanOpinion)}</strong>
          <small>At round {latest.round} · −1 to +1</small>
        </div>
        <div className="metric-card">
          <span>Simulated polarization</span>
          <strong className="text-violet">{latest.polarization.toFixed(3)}</strong>
          <small>Engine-computed dispersion</small>
        </div>
        <div className="metric-card">
          <span>Recorded interactions</span>
          <strong>
            {count(project.rounds.reduce((sum, round) => sum + round.interactions, 0))}
          </strong>
          <small>Across {project.rounds.length} rounds</small>
        </div>
      </div>
      <div className="round-charts">
        <section className="card trajectory-card">
          <div className="card-toolbar">
            <span>
              <TrendingUp size={15} aria-hidden="true" /> MEAN STANCE TRAJECTORY
            </span>
            <span className="chart-legend">
              <i className="legend-line" /> Mean stance
            </span>
          </div>
          <TrajectoryChart
            rounds={project.rounds}
            selectedRound={selected.round}
            onSelect={setChosenRound}
          />
        </section>
        <section className="card distribution-card">
          <div className="card-toolbar">
            <span>
              <GitBranch size={15} aria-hidden="true" /> SIMULATED STANCE MIX
            </span>
          </div>
          <div className="distribution-legend">
            <span>
              <i className="legend-dot support-color" />
              Support
            </span>
            <span>
              <i className="legend-dot undecided-color" />
              Undecided
            </span>
            <span>
              <i className="legend-dot opposition-color" />
              Oppose
            </span>
          </div>
          <div className="distribution-list">
            {project.rounds.map((round) => (
              <button
                className={`distribution-row ${round.round === selected.round ? 'distribution-selected' : ''}`}
                type="button"
                key={round.round}
                onClick={() => setChosenRound(round.round)}
                aria-label={`Round ${round.round}: ${percent(round.supportShare)} support, ${percent(round.undecidedShare)} undecided, ${percent(round.oppositionShare)} opposition`}
                aria-pressed={round.round === selected.round}
              >
                <span>R{round.round}</span>
                <span className="distribution-bar">
                  <i className="support-color" style={{ flex: Math.max(0, round.supportShare) }} />
                  <i
                    className="undecided-color"
                    style={{ flex: Math.max(0, round.undecidedShare) }}
                  />
                  <i
                    className="opposition-color"
                    style={{ flex: Math.max(0, round.oppositionShare) }}
                  />
                </span>
                <span>{percent(round.supportShare)}</span>
              </button>
            ))}
          </div>
          <p className="chart-caption">Bar segments show fractions of simulated agents.</p>
        </section>
      </div>
      <details className="card round-data-table">
        <summary>View chart data as a table</summary>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Recorded simulation metrics by round</caption>
            <thead>
              <tr>
                <th scope="col">Round</th>
                <th scope="col">Mean stance</th>
                <th scope="col">Support share</th>
                <th scope="col">Undecided share</th>
                <th scope="col">Opposition share</th>
                <th scope="col">Polarization</th>
                <th scope="col">Interactions</th>
              </tr>
            </thead>
            <tbody>
              {project.rounds.map((round) => (
                <tr key={round.round}>
                  <th scope="row">{round.round}</th>
                  <td>{signed(round.meanOpinion)}</td>
                  <td>{percent(round.supportShare)}</td>
                  <td>{percent(round.undecidedShare)}</td>
                  <td>{percent(round.oppositionShare)}</td>
                  <td>{round.polarization.toFixed(3)}</td>
                  <td>{count(round.interactions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <section className="round-inspector card">
        <div className="round-inspector-header">
          <div>
            <span className="eyebrow">ROUND NOTEBOOK</span>
            <h3>Inside round {selected.round}</h3>
          </div>
          <div className="round-controls">
            <button
              className="icon-button"
              type="button"
              aria-label="Previous recorded round"
              disabled={selectedIndex === 0}
              onClick={() => setChosenRound(project.rounds[selectedIndex - 1]!.round)}
            >
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
            <label className="sr-only" htmlFor="selected-round">
              Inspect recorded round
            </label>
            <select
              id="selected-round"
              value={selected.round}
              onChange={(event) => setChosenRound(Number(event.target.value))}
            >
              {project.rounds.map((round) => (
                <option key={round.round} value={round.round}>
                  Round {round.round}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              type="button"
              aria-label="Next recorded round"
              disabled={selectedIndex >= project.rounds.length - 1}
              onClick={() => setChosenRound(project.rounds[selectedIndex + 1]!.round)}
            >
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="round-summary">
          <span>{count(selected.activityCount)} actions</span>
          <span>{count(selected.interactions)} interactions</span>
          <span>Mean stance {signed(selected.meanOpinion)}</span>
        </div>
        {selected.intervention && (
          <div className="intervention-event">
            <Flag size={18} aria-hidden="true" />
            <div>
              <strong>Scheduled intervention</strong>
              <p className="plain-text">{selected.intervention.label}</p>
              <small>
                Assumed stance {signed(selected.intervention.stance)} · strength{' '}
                {selected.intervention.strength.toFixed(2)}
              </small>
            </div>
          </div>
        )}
        <div className="round-action-heading">
          <h4>
            {project.mode === 'local'
              ? 'Recorded state updates & observations'
              : 'Model-generated simulation actions'}
          </h4>
          <label>
            <span className="sr-only">Filter round actions</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter actions…"
              maxLength={200}
            />
          </label>
        </div>
        {project.mode === 'local' && (
          <p className="field-help">
            Rules-based actions are state transitions, not AI-generated conversations or social
            posts.
          </p>
        )}
        <div className="action-list">
          {filteredActions.map((action) => (
            <article className="round-action" key={action.id}>
              <span className="action-mark">
                <Radio size={15} aria-hidden="true" />
              </span>
              <div>
                <div className="action-heading">
                  <strong>{agents.get(action.agentId)?.name ?? action.agentId}</strong>
                  <span>{actionLabel(action.type)}</span>
                  <span className="action-opinion">{signed(action.opinion)}</span>
                </div>
                <p className="plain-text">{action.content}</p>
                <SourceLinks ids={action.sourceIds} onOpen={onSource} />
              </div>
            </article>
          ))}
          {!filteredActions.length && (
            <p className="empty-inline">
              {query
                ? 'No recorded actions match this filter.'
                : 'No actions were recorded for this round.'}
            </p>
          )}
        </div>
        <details className="round-opinions">
          <summary>Individual simulated stances</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Fictional agent</th>
                  <th scope="col">Stance (−1 to +1)</th>
                </tr>
              </thead>
              <tbody>
                {selected.opinions.map((opinion) => (
                  <tr key={opinion.agentId}>
                    <th scope="row">{agents.get(opinion.agentId)?.name ?? opinion.agentId}</th>
                    <td>{signed(opinion.opinion)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </div>
  );
}
