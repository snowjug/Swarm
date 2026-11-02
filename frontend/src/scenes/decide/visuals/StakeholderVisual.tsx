import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, LayoutGroup, m } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import {
  STATEMENT_ORIGIN_LABELS,
  type BriefStakeholderRow,
  type BriefVisuals,
} from '../../../../../shared/brief';
import { ChipButton, Popover, PopoverTrigger, Segmented } from '../../../design/ui';
import { SPRING } from '../../../design/motion';
import { DIRECTION_LABELS } from '../../../lib/brief';
import { SEVERITY_VIEW } from '../../../lib/critics';
import type { Movement } from '../model/analysis-model';
import { aboutTarget } from '../model/critique-model';
import { clip, perHundred, plural, signedDecimals } from '../model/format';
import { RESPONSE_ORDER } from '../model/visual-model';
import { useDoc } from '../ui/context';
import { DetailPopover } from '../ui/DetailPopover';
import { SEVERITY_ICONS } from '../ui/meta';
import { DirectionGlyph, FigureHead, ResponseBar, ResponseLegend, TableAlt } from './parts';
import './stakeholders.css';

interface Known {
  row: BriefStakeholderRow;
  group: string;
}

const KEY_LABEL = { key: 'Key', standard: 'Standard', background: 'Background' } as const;

/** A mean final stance, from -1 (against) to 1 (in favour), as a mark on a line, with the baseline's beside it. */
function Stance({ now, before }: { now: number; before: number }) {
  const at = (value: number) => `${((Math.max(-1, Math.min(1, value)) + 1) / 2) * 100}%`;
  return (
    <div
      className="sw-decide-stance"
      role="img"
      aria-label={`Mean final stance ${signedDecimals(now)}, against ${signedDecimals(before)} with no change, on a scale from -1, against, to 1, in favour`}
    >
      <span className="sw-decide-stance__mid" />
      <span className="sw-decide-stance__dot" data-end="base" style={{ left: at(before) }} />
      <span className="sw-decide-stance__dot" data-end="change" style={{ left: at(now) }} />
      <span className="sw-decide-stance__end" data-end="lo" aria-hidden="true">
        against
      </span>
      <span className="sw-decide-stance__end" data-end="hi" aria-hidden="true">
        in favour
      </span>
    </div>
  );
}

/** One group, in the popover: where its simulated members ended up, what the evidence says of it, and what was said against it. */
function GroupDetail({
  name,
  stakeholderId,
  movement,
  known,
}: {
  name: string;
  stakeholderId: string;
  movement?: Movement;
  known?: Known;
}) {
  const { brief, visuals, critiques, openReview, mode } = useDoc();
  const runs = visuals?.runsPerVariant ?? 0;
  const said = brief.sections
    .find((section) => section.id === 'stakeholders')
    ?.statements.find((statement) => statement.refs.stakeholderIds.includes(stakeholderId));
  const against = aboutTarget(critiques, 'stakeholder', stakeholderId);
  return (
    <div className="sw-decide-gd">
      <div className="sw-decide-gd__head">
        <h3 className="sw-decide-gd__name">{name}</h3>
        <p className="sw-decide-gd__meta">
          {known
            ? `${known.group} · ${KEY_LABEL[known.row.priority].toLowerCase()} stakeholder`
            : 'Simulated group'}
          {movement
            ? ` · ${movement.kind === 'key' ? 'one simulated member' : plural(movement.members, 'simulated member')}`
            : ''}
        </p>
      </div>
      {movement ? (
        <section className="sw-decide-gd__sec">
          <h4 className="sw-eyebrow">Where its members ended up</h4>
          <div className="sw-decide-gd__pair">
            <span>With the change</span>
            <ResponseBar
              shares={movement.shares}
              height="md"
              label={`${name} under the change`}
              labelled
            />
            <span>With no change</span>
            <ResponseBar
              shares={movement.baselineShares}
              height="md"
              label={`${name} under no change`}
              labelled
            />
          </div>
          <ResponseLegend
            values={
              Object.fromEntries(
                RESPONSE_ORDER.map((category) => [category, perHundred(movement.shares[category])]),
              ) as Record<(typeof RESPONSE_ORDER)[number], string>
            }
          />
          <Stance now={movement.stance} before={movement.baselineStance} />
          <p className="sw-decide-gd__fine">
            {movement.kind === 'key'
              ? `This group is one simulated member, so its share is the share of the ${runs} seeded runs in which it ended in each response.`
              : `Shares of the group’s own simulated members, in every 100. How many were sampled for it (${movement.members}) is a numerical resolution of the simulation, not a population.`}
          </p>
        </section>
      ) : null}
      {known ? (
        <section className="sw-decide-gd__sec">
          <h4 className="sw-eyebrow">What the evidence says</h4>
          <p className="sw-decide-gd__text">
            <b>{DIRECTION_LABELS[known.row.direction]}</b>.{' '}
            <span className="num">{known.row.supporting}</span> cited{' '}
            {known.row.supporting === 1 ? 'passage supports' : 'passages support'} it
            {known.row.contradicting > 0 ? (
              <>
                , <span className="num">{known.row.contradicting}</span> contradict it
              </>
            ) : null}
            . Uncertainty {known.row.uncertainty}. {STATEMENT_ORIGIN_LABELS[known.row.origin]}.
          </p>
        </section>
      ) : null}
      {said ? (
        <section className="sw-decide-gd__sec">
          <h4 className="sw-eyebrow">What the brief says</h4>
          <p className="sw-decide-gd__text">{clip(said.text, 360)}</p>
        </section>
      ) : null}
      {against.length > 0 ? (
        <section className="sw-decide-gd__sec">
          <h4 className="sw-eyebrow">Challenged by the review</h4>
          <ul role="list" className="sw-decide-gd__list">
            {against.map((critique) => {
              const Icon = SEVERITY_ICONS[critique.severity];
              return (
                <li key={critique.id}>
                  <button
                    type="button"
                    className="sw-decide-gd__crit"
                    onClick={() => openReview(critique.id)}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span>
                      <b>{SEVERITY_VIEW[critique.severity].label}.</b>{' '}
                      {clip(critique.objection, 140)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {mode === 'advanced' ? <p className="sw-decide-gd__id sw-mono">{stakeholderId}</p> : null}
    </div>
  );
}

const SHOWN = 8;

/** The groups ranked by how far their own share moved: each from where it began to where it ended. */
function MovementView({
  rows,
  known,
  runs,
  variantLabel,
  baselineLabel,
}: {
  rows: readonly Movement[];
  known: ReadonlyMap<string, Known>;
  runs: number;
  variantLabel: string;
  baselineLabel: string;
}) {
  const { critiques } = useDoc();
  const [all, setAll] = useState(false);
  const scale = Math.max(...rows.map((row) => Math.max(row.share, row.baselineShare)), 0.05);
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <figure className="sw-decide-fig">
      <FigureHead
        title="Who moved"
        note={
          <>
            Each group’s own share of simulated members looking for an alternative or resisting,
            under <b>{baselineLabel}</b> (open ring) and under <b>{variantLabel}</b> (filled), in
            every 100 of its members. Groups are ranked by how far that share moved, never by how
            many members were sampled for them.
          </>
        }
      />
      <ol className="sw-decide-mv" role="list">
        {shown.map((row, index) => {
          const info = known.get(row.stakeholderId);
          const challenged = aboutTarget(critiques, 'stakeholder', row.stakeholderId);
          const key = row.members === 1;
          const up = row.delta >= 0;
          return (
            <li
              key={row.actorId}
              className="sw-decide-mv__item"
              style={{ '--i': Math.min(index, 8) } as CSSProperties}
            >
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="sw-decide-mv__row">
                    <span className="sw-decide-mv__who">
                      <DirectionGlyph direction={info?.row.direction ?? 'unclear'} />
                      <span className="sw-decide-mv__name">
                        <strong>{row.name}</strong>
                        <small>
                          {info
                            ? `${info.group} · ${KEY_LABEL[info.row.priority].toLowerCase()}`
                            : row.category}
                        </small>
                      </span>
                    </span>
                    <span className="sw-decide-mv__track" aria-hidden="true" data-up={up}>
                      <span
                        className="sw-decide-mv__line"
                        style={{
                          left: `${(Math.min(row.baselineShare, row.share) / scale) * 100}%`,
                          width: `${(Math.abs(row.share - row.baselineShare) / scale) * 100}%`,
                        }}
                      />
                      <span
                        className="sw-decide-mv__dot"
                        data-end="base"
                        style={{ left: `${(row.baselineShare / scale) * 100}%` }}
                      />
                      <span
                        className="sw-decide-mv__dot"
                        data-end="change"
                        style={{ left: `${(row.share / scale) * 100}%` }}
                      />
                    </span>
                    <span className="sw-decide-mv__value num">
                      <span>
                        {key ? (
                          <>
                            <b>{Math.round(row.share * runs)}</b> of {runs} runs
                          </>
                        ) : (
                          <>
                            <b>{perHundred(row.share)}</b> in 100
                          </>
                        )}
                      </span>
                      <small>
                        from{' '}
                        {key ? Math.round(row.baselineShare * runs) : perHundred(row.baselineShare)}
                      </small>
                      <span className="sr-only"> under {baselineLabel}</span>
                    </span>
                  </button>
                </PopoverTrigger>
                <DetailPopover
                  label={`${row.name}: where it ended up`}
                  width="24rem"
                  className="sw-decide-gdpop"
                >
                  <GroupDetail
                    name={row.name}
                    stakeholderId={row.stakeholderId}
                    movement={row}
                    known={info}
                  />
                </DetailPopover>
              </Popover>
              {challenged.length > 0 && (
                <span className="sw-decide-mv__flag" title={plural(challenged.length, 'criticism')}>
                  {(() => {
                    const Icon = SEVERITY_ICONS[challenged[0]!.severity];
                    return <Icon size={14} aria-hidden="true" />;
                  })()}
                  <span className="sr-only">
                    {plural(challenged.length, 'criticism')} in the review
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="sw-decide-mv__axis" aria-hidden="true">
        <span>0</span>
        <span className="num">{perHundred(scale)} in 100</span>
      </div>
      {rows.length > SHOWN && (
        <button
          type="button"
          className="sw-decide-more"
          aria-expanded={all}
          onClick={() => setAll((old) => !old)}
        >
          <span>{all ? 'Show the first few' : `Show all ${rows.length} groups`}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      )}
      <TableAlt
        caption="Each group’s own share of simulated members looking for an alternative or resisting, in every 100"
        headers={[
          'Group',
          'With the change',
          'With no change',
          'Moved by',
          'Simulated members sampled',
        ]}
        rows={rows.map((row) => [
          row.name,
          perHundred(row.share),
          perHundred(row.baselineShare),
          `${row.delta >= 0 ? '+' : '\u2212'}${perHundred(Math.abs(row.delta))}`,
          String(row.members),
        ])}
      />
    </figure>
  );
}

const DIRECTIONS = ['harmed', 'mixed', 'benefited', 'unclear'] as const;

/** The groups as the evidence describes them, by kind of stakeholder, filtered by what the change is expected to do to them. */
function LandscapeView({
  groups,
  movementBy,
}: {
  groups: BriefVisuals['stakeholderMap'];
  movementBy: ReadonlyMap<string, Movement>;
}) {
  const [direction, setDirection] = useState<(typeof DIRECTIONS)[number] | null>(null);
  const [keyOnly, setKeyOnly] = useState(false);
  const all = groups.flatMap((group) => group.stakeholders);
  const counts = Object.fromEntries(
    DIRECTIONS.map((entry) => [entry, all.filter((row) => row.direction === entry).length]),
  ) as Record<(typeof DIRECTIONS)[number], number>;
  const visible = (row: BriefStakeholderRow) =>
    (direction === null || row.direction === direction) && (!keyOnly || row.priority === 'key');
  return (
    <figure className="sw-decide-fig">
      <FigureHead
        title="Who is affected"
        note="Each group the evidence names, by kind, with what the change is expected to do to it. An expected direction is read from the cited passages; it is not a result of the simulation."
      />
      <div className="sw-decide-ls__filters" role="group" aria-label="Filter the groups">
        {DIRECTIONS.filter((entry) => counts[entry] > 0).map((entry) => (
          <ChipButton
            key={entry}
            size="sm"
            pressed={direction === entry}
            onClick={() => setDirection((old) => (old === entry ? null : entry))}
            icon={<DirectionGlyph direction={entry} />}
          >
            {DIRECTION_LABELS[entry]} <span className="num">{counts[entry]}</span>
          </ChipButton>
        ))}
        <ChipButton size="sm" pressed={keyOnly} onClick={() => setKeyOnly((old) => !old)}>
          Key groups only
        </ChipButton>
      </div>
      <LayoutGroup>
        <div className="sw-decide-ls">
          {groups.map((group) => {
            const rows = group.stakeholders.filter(visible);
            return (
              <m.section
                layout
                key={group.category}
                className="sw-decide-ls__group"
                aria-label={group.label}
                transition={SPRING.smooth}
                hidden={rows.length === 0}
              >
                <h3 className="sw-decide-ls__title">
                  {group.label} <span className="num">{rows.length}</span>
                </h3>
                <ul role="list" className="sw-decide-ls__list">
                  <AnimatePresence initial={false}>
                    {rows.map((row) => (
                      <m.li
                        layout
                        key={row.id}
                        className="sw-decide-ls__row"
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={SPRING.snappy}
                      >
                        <LandscapeRow
                          row={row}
                          group={group.label}
                          movement={movementBy.get(row.id)}
                        />
                      </m.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </m.section>
            );
          })}
        </div>
      </LayoutGroup>
      <TableAlt
        caption="Stakeholders by kind, with the expected effect of the change"
        headers={[
          'Stakeholder',
          'Kind',
          'Priority',
          'Expected effect',
          'Cited support',
          'Uncertainty',
        ]}
        rows={groups.flatMap((group) =>
          group.stakeholders.map((row) => [
            row.name,
            group.label,
            row.priority,
            DIRECTION_LABELS[row.direction],
            `${row.supporting} supporting, ${row.contradicting} contradicting`,
            row.uncertainty,
          ]),
        )}
      />
    </figure>
  );
}

function LandscapeRow({
  row,
  group,
  movement,
}: {
  row: BriefStakeholderRow;
  group: string;
  movement?: Movement;
}) {
  const { critiques } = useDoc();
  const challenged = aboutTarget(critiques, 'stakeholder', row.id);
  const bars = row.uncertainty === 'low' ? 3 : row.uncertainty === 'medium' ? 2 : 1;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="sw-decide-ls__btn">
          <DirectionGlyph direction={row.direction} />
          <span className="sw-decide-ls__name" data-priority={row.priority}>
            {row.name}
          </span>
          <span className="sw-decide-ls__meta">
            <span
              className="sw-decide-ls__evidence num"
              title={`${row.supporting} supporting, ${row.contradicting} contradicting passages`}
            >
              {row.supporting}
              {row.contradicting > 0 ? <i> / {row.contradicting}</i> : null}
            </span>
            <span className="sr-only">
              {' '}
              cited passages supporting{row.contradicting > 0 ? ' and contradicting' : ''}
              {`, ${KEY_LABEL[row.priority].toLowerCase()} stakeholder`}
            </span>
            <span
              className="sw-decide-ls__unc"
              title={`Uncertainty ${row.uncertainty}`}
              aria-hidden="true"
            >
              {[0, 1, 2].map((index) => (
                <i key={index} data-on={index < bars || undefined} />
              ))}
            </span>
            {challenged.length > 0 && <span className="sw-decide-ls__flag" aria-hidden="true" />}
          </span>
        </button>
      </PopoverTrigger>
      <DetailPopover label={`${row.name}: what is known`} width="24rem" className="sw-decide-gdpop">
        <GroupDetail
          name={row.name}
          stakeholderId={row.id}
          movement={movement}
          known={{ row, group }}
        />
      </DetailPopover>
    </Popover>
  );
}

/** Who is affected: who moved in the simulation, and who the evidence says is affected, as two views of one thing. */
export function StakeholderVisual({ visuals }: { visuals: BriefVisuals }) {
  const { facts } = useDoc();
  const alternatives = visuals.scenarioComparison;
  const [variantId, setVariantId] = useState<string | null>(null);
  const [view, setView] = useState<'movement' | 'landscape'>('movement');
  const chosen = alternatives.find((row) => row.variantId === variantId) ?? alternatives[0];
  const movement = chosen ? facts?.movement[chosen.variantId] : undefined;
  const known = useMemo(() => {
    const map = new Map<string, Known>();
    for (const group of visuals.stakeholderMap)
      for (const row of group.stakeholders) map.set(row.id, { row, group: group.label });
    return map;
  }, [visuals.stakeholderMap]);
  const baselineLabel =
    visuals.outcomeDistribution.find((row) => row.kind === 'baseline')?.label ?? 'no change';
  const movementBy = useMemo(
    () => new Map((movement ?? []).map((entry) => [entry.stakeholderId, entry])),
    [movement],
  );
  const showing = movement && view === 'movement' ? 'movement' : 'landscape';
  return (
    <div className="sw-decide-sv">
      {(movement || alternatives.length > 1) && (
        <div className="sw-decide-sv__bar">
          {movement && (
            <Segmented
              size="sm"
              label="View"
              value={showing}
              onChange={setView}
              options={[
                { value: 'movement', label: 'Who moved' },
                { value: 'landscape', label: 'Who is affected' },
              ]}
            />
          )}
          {movement && showing === 'movement' && alternatives.length > 1 && (
            <Segmented
              size="sm"
              label="Which change"
              value={chosen!.variantId}
              onChange={setVariantId}
              options={alternatives.map((row) => ({ value: row.variantId, label: row.label }))}
            />
          )}
        </div>
      )}
      {showing === 'movement' && movement && chosen ? (
        <MovementView
          rows={movement}
          known={known}
          runs={visuals.runsPerVariant}
          variantLabel={chosen.label}
          baselineLabel={baselineLabel}
        />
      ) : (
        <LandscapeView groups={visuals.stakeholderMap} movementBy={movementBy} />
      )}
    </div>
  );
}
