import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Platform, SimulationMemory } from '../../../../../shared/guided';
import { Button, Chip, ChipButton, Input, Select } from '../../../design/ui';
import { actionLabel } from '../../../lib/console';
import { SIMULATED_RECORD } from './copy';
import { Avatar } from './Cast';
import { Heard, Sources } from './Cite';
import { useDeep } from './context';
import {
  NO_FILTER,
  filterActive,
  filterMemories,
  memoriesOf,
  memoryFacets,
  minutesText,
  nameOf,
  plural,
  type ActionType,
} from './model';
import { Clamp, PlatformSwitch, Position, SectionHead, StatedReason } from './parts';
import { NoRounds } from './States';
import './memory.css';

const PAGE = 20;
const NO_MEMORIES: readonly SimulationMemory[] = [];

function Record({ memory }: { memory: SimulationMemory }) {
  const { project, advanced, openProxy } = useDeep();
  const local = project.mode === 'local';
  const agent = project.agents.find((item) => item.id === memory.agentId);
  return (
    <li className="sw-deep-mem" data-kind={memory.actionType}>
      <p className="sw-deep-mem__who">
        {agent ? (
          <button type="button" className="sw-deep-mem__person" onClick={() => openProxy(agent.id)}>
            <Avatar name={agent.name} value={agent.initialOpinion} size="sm" />
            <strong>{agent.name}</strong>
          </button>
        ) : (
          <strong>
            {memory.agentId ? nameOf(project.agents, memory.agentId) : 'Assumed input'}
          </strong>
        )}
        <Chip size="sm">{actionLabel(memory.actionType, local)}</Chip>
        {memory.opinion !== null && (
          <span className="sw-deep-mem__pos">
            <Position value={memory.opinion} word={false} />
          </span>
        )}
      </p>
      <Clamp text={memory.text} lines={3} limit={200} />
      <StatedReason rationale={memory.rationale} confidence={memory.confidence} />
      {(memory.peerIds.length > 0 || memory.sourceIds.length > 0) && (
        <div className="sw-deep-mem__foot">
          <Heard ids={memory.peerIds} />
          <Sources ids={memory.sourceIds} />
        </div>
      )}
      {advanced && <p className="sw-deep-mem__id sw-mono">{memory.id}</p>}
    </li>
  );
}

function Feed({ records, total }: { records: SimulationMemory[]; total: number }) {
  const { project } = useDeep();
  const [limit, setLimit] = useState(PAGE);
  const visible = records.slice(0, limit);
  const minutes = project.console?.environment?.minutesPerRound ?? null;
  const groups = useMemo(() => {
    const out: { round: number; items: SimulationMemory[] }[] = [];
    for (const memory of visible) {
      const last = out.at(-1);
      if (last && last.round === memory.round) last.items.push(memory);
      else out.push({ round: memory.round, items: [memory] });
    }
    return out;
  }, [visible]);
  if (records.length === 0) {
    return (
      <p className="sw-deep-fine sw-deep-memory__none">
        {total > 0
          ? 'Nothing matches those filters. Clear one to see more of what was recorded.'
          : 'No record was saved for this platform. Only saved inputs and actions appear here; none are staged.'}
      </p>
    );
  }
  return (
    <>
      {groups.map((group) => (
        <section
          className="sw-deep-memg"
          key={`${group.round}-${group.items[0]?.id}`}
          aria-label={group.round === 0 ? 'The start' : `Round ${group.round}`}
        >
          <h3 className="sw-deep-memg__title">
            {group.round === 0 ? 'The start' : `Round ${group.round}`}
            {minutes !== null && group.round > 0 && (
              <span className="sw-deep-memg__minute">
                {' '}
                · {minutesText(group.round * minutes)} in
              </span>
            )}
          </h3>
          <ul className="sw-deep-memg__list" role="list">
            {group.items.map((memory) => (
              <Record key={memory.id} memory={memory} />
            ))}
          </ul>
        </section>
      ))}
      {visible.length < records.length && (
        <div className="sw-deep-memory__more">
          <Button variant="glass" onClick={() => setLimit((old) => old + PAGE)}>
            Show more ({records.length - visible.length} left)
          </Button>
        </div>
      )}
    </>
  );
}

/** The memory stream of one platform: what was recorded, newest first, with the reason a proxy gave where it gave one. */
export function Memory() {
  const { project, platforms, platform, setPlatform, filter, setFilter } = useDeep();
  const local = project.mode === 'local';
  const all = project.console?.memories ?? NO_MEMORIES;
  const ran = platforms.filter(
    (item) => item.run !== null || all.some((memory) => memory.platform === item.id),
  );
  const shown: Platform = ran.some((item) => item.id === platform)
    ? platform
    : (ran[0]?.id ?? platform);
  const memories = useMemo(() => memoriesOf(all, shown), [all, shown]);
  const facets = useMemo(() => memoryFacets(memories), [memories]);
  const records = useMemo(() => filterMemories(memories, filter), [memories, filter]);
  const active = filterActive(filter);
  if (all.length === 0) return <NoRounds what="The memory stream" />;

  return (
    <div className="sw-deep-memory">
      <SectionHead
        title={local ? 'Recorded rule events' : 'Recorded fictional activity'}
        lead={`Newest first. ${SIMULATED_RECORD}`}
        aside={<PlatformSwitch platforms={platforms} value={shown} onChange={setPlatform} />}
      />

      <div className="sw-deep-filters">
        <div className="sw-deep-search">
          <Search size={16} aria-hidden="true" className="sw-deep-search__icon" />
          <Input
            type="search"
            aria-label="Search the recorded text or an identifier"
            placeholder="Search what was recorded"
            maxLength={300}
            value={filter.query}
            onChange={(event) => setFilter({ ...filter, query: event.target.value })}
          />
        </div>
        <div className="sw-deep-filters__selects">
          <Select
            aria-label="Proxy"
            value={filter.agentId ?? ''}
            onChange={(event) => setFilter({ ...filter, agentId: event.target.value || null })}
          >
            <option value="">All proxies and inputs</option>
            {project.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Round"
            value={filter.round === null ? '' : String(filter.round)}
            onChange={(event) =>
              setFilter({
                ...filter,
                round: event.target.value === '' ? null : Number(event.target.value),
              })
            }
          >
            <option value="">Every round</option>
            {facets.rounds.map((round) => (
              <option key={round} value={round}>
                {round === 0 ? 'The start' : `Round ${round}`}
              </option>
            ))}
          </Select>
        </div>
        <div className="sw-deep-filters__kinds" role="group" aria-label="Kind of record">
          {facets.actions.map((type: ActionType) => (
            <ChipButton
              key={type}
              size="sm"
              pressed={filter.action === type}
              onClick={() => setFilter({ ...filter, action: filter.action === type ? null : type })}
            >
              {actionLabel(type, local)}
            </ChipButton>
          ))}
          {active && (
            <Button
              size="sm"
              variant="ghost"
              icon={<X size={14} aria-hidden="true" />}
              onClick={() => setFilter(NO_FILTER)}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <p className="sw-deep-memory__count" role="status">
        {records.length === memories.length
          ? plural(memories.length, 'record')
          : `${records.length} of ${plural(memories.length, 'record')}`}
      </p>
      <Feed key={`${shown}|${JSON.stringify(filter)}`} records={records} total={memories.length} />
    </div>
  );
}
