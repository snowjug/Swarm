import { useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import type { Platform, SimulationMemory } from '../../../../shared/guided';
import type { ProjectDetail } from '../../../../shared/types';
import { actionLabel } from '../../lib/console';
import { signed } from '../../lib/format';
import type { Inspection } from '../../lib/graph';
import { EmptyPanel } from '../ui';
import { Citations } from './Citations';
import { StatedReason } from './StatedReason';

export function MemoryStream({
  project,
  platform,
  onInspect,
}: {
  project: ProjectDetail;
  platform: Platform;
  onInspect: (selection: Inspection) => void;
}) {
  const [query, setQuery] = useState('');
  const [agentId, setAgentId] = useState('');
  const [round, setRound] = useState('');
  const [action, setAction] = useState('');
  const [limit, setLimit] = useState(20);
  const memories = project.console?.memories.filter((memory) => memory.platform === platform) ?? [];
  const rounds = [...new Set(memories.map((memory) => memory.round))].sort((a, b) => a - b);
  const actions = [...new Set(memories.map((memory) => memory.actionType))];
  const local = project.mode === 'local';
  const filtered = memories.filter(
    (memory) =>
      (!agentId || memory.agentId === agentId) &&
      (!round || memory.round === Number(round)) &&
      (!action || memory.actionType === action) &&
      `${memory.id} ${memory.text} ${memory.agentId ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const visible = filtered.slice().reverse().slice(0, limit);
  return (
    <section className="memory-stream stage-card">
      <div className="section-heading">
        <h3>{local ? 'Recorded rule events' : 'Recorded fictional activity'}</h3>
        <span className="mono muted">
          {filtered.length} / {memories.length} RECORDS
        </span>
      </div>
      <label className="search-field">
        <Search size={14} />
        <input
          type="search"
          aria-label="Search recorded simulation memory"
          maxLength={300}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(20);
          }}
          placeholder="Search recorded action text or ID…"
        />
      </label>
      <div className="fields-grid three stream-filters">
        <div className="field">
          <label htmlFor={`stream-agent-${platform}`}>Fictional proxy</label>
          <select
            id={`stream-agent-${platform}`}
            value={agentId}
            onChange={(event) => {
              setAgentId(event.target.value);
              setLimit(20);
            }}
          >
            <option value="">All proxies / seed</option>
            {project.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`stream-round-${platform}`}>Round</label>
          <select
            id={`stream-round-${platform}`}
            value={round}
            onChange={(event) => {
              setRound(event.target.value);
              setLimit(20);
            }}
          >
            <option value="">All recorded</option>
            {rounds.map((value) => (
              <option key={value} value={value}>
                {value === 0 ? '0 / seed inputs' : value}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`stream-action-${platform}`}>Action type</label>
          <select
            id={`stream-action-${platform}`}
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setLimit(20);
            }}
          >
            <option value="">All recorded</option>
            {actions.map((value) => (
              <option key={value} value={value}>
                {actionLabel(value, local)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!visible.length && (
        <EmptyPanel
          title={memories.length ? 'No matching memory records' : 'No memory records yet'}
        >
          {memories.length
            ? 'Change your filters to inspect other recorded actions.'
            : 'Only saved seed inputs and simulation actions appear here. No activity is staged for display.'}
        </EmptyPanel>
      )}
      <div className="memory-list">
        {visible.map((memory: SimulationMemory) => (
          <article className={`memory-record memory-${memory.actionType}`} key={memory.id}>
            <div className="section-heading">
              <span className="eyebrow">{actionLabel(memory.actionType, local)}</span>
              <button
                className="text-button mono"
                type="button"
                onClick={() => onInspect({ kind: 'memory', id: memory.id })}
                aria-label={`${memory.id}, inspect recorded memory`}
              >
                {memory.id} <ArrowUpRight size={12} />
              </button>
            </div>
            <div className="memory-byline">
              <strong>
                {memory.agentId
                  ? (project.agents.find((agent) => agent.id === memory.agentId)?.name ??
                    memory.agentId)
                  : 'Initial seed input'}
              </strong>
              <span className="mono muted">
                R{memory.round} · {memory.simulatedMinute} SCENARIO MIN
              </span>
            </div>
            <p className="preserve-text">{memory.text}</p>
            <StatedReason rationale={memory.rationale} confidence={memory.confidence} />
            <div className="memory-footer mono">
              <span>
                {memory.opinion === null
                  ? 'NO POSITION RECORDED'
                  : `POSITION ${signed(memory.opinion)}`}
              </span>
              <span>{memory.peerIds.length} RECORDED PEER LINKS</span>
            </div>
            <Citations sourceIds={memory.sourceIds} onInspect={onInspect} />
          </article>
        ))}
      </div>
      {visible.length < filtered.length && (
        <button
          className="button button-secondary button-small"
          type="button"
          onClick={() => setLimit((old) => old + 20)}
        >
          Show more saved records ({filtered.length - visible.length} remaining)
        </button>
      )}
      <small className="muted">
        Newest recorded scenario time first. Dashed graph overlays link these actual memory IDs to
        actors and their recorded peer context.
      </small>
    </section>
  );
}
