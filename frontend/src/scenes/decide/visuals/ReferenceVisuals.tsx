import { useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronDown, Check, Minus } from 'lucide-react';
import { STATEMENT_ORIGIN_LABELS, type BriefVisuals } from '../../../../../shared/brief';
import {
  SIGNED_TRAIT_KEYS,
  TRAIT_MEANINGS,
  type TraitKey,
} from '../../../../../shared/stakeholders';
import { Chip, ChipButton } from '../../../design/ui';
import { clip, plural, sentence } from '../model/format';
import {
  evidenceByThinness,
  filterAssumptions,
  type AssumptionFilter,
} from '../model/visual-model';
import { ORIGIN_FAMILY, ORIGIN_ICONS } from '../ui/meta';
import { FigureHead, TableAlt } from './parts';
import './reference.css';

const MAX_DOTS = 8;

/** Who the cited passages support, thinnest evidence first: a filled dot for each passage that supports it, a ringed one for each that contradicts it. */
export function EvidenceVisual({ visuals }: { visuals: BriefVisuals }) {
  const rows = evidenceByThinness(visuals.evidenceMap);
  const [all, setAll] = useState(false);
  if (rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, 6);
  const gaps = rows.filter((row) => row.gap).length;
  return (
    <figure className="sw-decide-fig">
      <FigureHead
        title="What each group rests on"
        note={
          gaps > 0
            ? `${plural(gaps, 'group')} ${gaps === 1 ? 'has' : 'have'} nothing cited in support. A cited passage shows where a statement came from, not that its source is true.`
            : 'Every group has at least one cited passage in support. A cited passage shows where a statement came from, not that its source is true.'
        }
      />
      <ul className="sw-decide-ev" role="list">
        {shown.map((row, index) => (
          <li
            key={row.stakeholderId}
            className="sw-decide-ev__row"
            data-gap={row.gap || undefined}
            style={{ '--i': Math.min(index, 8) } as CSSProperties}
          >
            <span className="sw-decide-ev__name">{row.name}</span>
            <span
              className="sw-decide-ev__dots"
              role="img"
              aria-label={`${row.supporting} cited ${row.supporting === 1 ? 'passage supports' : 'passages support'} it${row.contradicting > 0 ? `, ${row.contradicting} contradict it` : ''}`}
            >
              {Array.from({ length: Math.min(row.supporting, MAX_DOTS) }, (_, dot) => (
                <i key={`s${dot}`} data-side="for" />
              ))}
              {row.supporting > MAX_DOTS ? (
                <span className="num">+{row.supporting - MAX_DOTS}</span>
              ) : null}
              {Array.from({ length: Math.min(row.contradicting, MAX_DOTS) }, (_, dot) => (
                <i key={`c${dot}`} data-side="against" />
              ))}
            </span>
            <span className="sw-decide-ev__docs">
              {row.gap ? (
                <Chip size="sm" tone="caution">
                  Nothing cited
                </Chip>
              ) : (
                <span title={row.documents.join('; ')}>
                  {plural(row.documents.length, 'document')}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {rows.length > 6 && (
        <button
          type="button"
          className="sw-decide-more"
          aria-expanded={all}
          onClick={() => setAll((old) => !old)}
        >
          <span>{all ? 'Show the thinnest few' : `Show all ${rows.length} groups`}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      )}
      <TableAlt
        caption="Evidence map: cited passages for each group"
        headers={['Group', 'Supporting passages', 'Contradicting passages', 'Documents', 'Gap']}
        rows={rows.map((row) => [
          row.name,
          String(row.supporting),
          String(row.contradicting),
          row.documents.join('; ') || 'none',
          row.gap ? 'No cited support' : '',
        ])}
      />
    </figure>
  );
}

const FILTERS: readonly { id: AssumptionFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'sensitive', label: 'Result is sensitive to it' },
  { id: 'unevidenced', label: 'No cited passage' },
];

const PAGE = 8;

/** What the simulated result rests on, each assumption with where it came from and what moving it did. */
export function AssumptionVisual({ visuals }: { visuals: BriefVisuals }) {
  const [filter, setFilter] = useState<AssumptionFilter>('all');
  const [limit, setLimit] = useState(PAGE);
  const register = visuals.assumptionRegister;
  if (register.length === 0) return null;
  const rows = filterAssumptions(register, filter);
  const counts: Record<AssumptionFilter, number> = {
    all: register.length,
    sensitive: filterAssumptions(register, 'sensitive').length,
    unevidenced: filterAssumptions(register, 'unevidenced').length,
  };
  return (
    <figure className="sw-decide-fig">
      <FigureHead
        title="Assumption register"
        note="What the simulated result rests on. Each assumption says where it came from, whether a cited passage backs it, and what moving it did."
      />
      <div className="sw-decide-as__filters" role="group" aria-label="Filter the assumptions">
        {FILTERS.map((entry) => (
          <ChipButton
            key={entry.id}
            size="sm"
            pressed={filter === entry.id}
            onClick={() => {
              setFilter(entry.id);
              setLimit(PAGE);
            }}
          >
            {entry.label} <span className="num">{counts[entry.id]}</span>
          </ChipButton>
        ))}
      </div>
      <ul className="sw-decide-as" role="list" key={filter}>
        {rows.slice(0, limit).map((row) => {
          const Icon = ORIGIN_ICONS[row.origin];
          return (
            <li key={row.id} className="sw-decide-as__row">
              <p className="sw-decide-as__text">{row.text}</p>
              <p className="sw-decide-as__meta">
                <span className="sw-decide-as__origin" data-family={ORIGIN_FAMILY[row.origin]}>
                  <Icon size={13} aria-hidden="true" /> {STATEMENT_ORIGIN_LABELS[row.origin]}
                </span>
                {row.sensitive && (
                  <Chip size="sm" tone="caution">
                    Result is sensitive to it
                  </Chip>
                )}
                <span className="sw-decide-as__ev">
                  {row.evidenced ? (
                    <Check size={13} aria-hidden="true" />
                  ) : (
                    <Minus size={13} aria-hidden="true" />
                  )}
                  {row.evidenced ? 'A cited passage backs it' : 'No cited passage'}
                </span>
              </p>
              {row.effect ? <p className="sw-decide-as__effect">{clip(row.effect, 260)}</p> : null}
            </li>
          );
        })}
      </ul>
      {rows.length > limit && (
        <button
          type="button"
          className="sw-decide-more"
          onClick={() => setLimit((old) => old + PAGE)}
        >
          <span>Show {Math.min(PAGE, rows.length - limit)} more</span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      )}
      <TableAlt
        caption="Assumption register: what the simulated result rests on"
        headers={['Assumption', 'Origin', 'Sensitive', 'Evidenced', 'Effect of moving it']}
        rows={register.map((row) => [
          row.text,
          STATEMENT_ORIGIN_LABELS[row.origin],
          row.sensitive ? 'Yes' : 'No',
          row.evidenced ? 'Yes' : 'No',
          row.effect ?? 'Not moved',
        ])}
      />
    </figure>
  );
}

const TRAIT_ORIGIN_NAMES = {
  evidence: 'from the evidence',
  user: 'set by a person',
  'system-assumption': 'a default Swarm filled in',
  model: 'from a model',
} as const;

const humanise = (key: string): string => sentence(key.replace(/([A-Z])/gu, ' $1').toLowerCase());

/** The traits every simulated actor was run with, each on its scale, and where each value came from. */
export function TraitVisual({ visuals }: { visuals: BriefVisuals }) {
  const rows = visuals.traitTable;
  const [all, setAll] = useState(false);
  if (rows.length === 0) return null;
  const defaults = rows
    .flatMap((row) => row.traits)
    .filter((trait) => trait.origin === 'system-assumption').length;
  const total = rows.flatMap((row) => row.traits).length;
  const shown = all ? rows : rows.slice(0, 4);
  return (
    <figure className="sw-decide-fig">
      <FigureHead
        title="The actors, as they were run"
        note={`${defaults} of ${total} trait values were filled in by Swarm as defaults. A trait is on a scale from 0 to 1 (from −1 to 1 for stance and impact); the population an actor stands for is an assumption, never a count.`}
      />
      <ul className="sw-decide-tr" role="list">
        {shown.map((row) => (
          <li key={row.actorId} className="sw-decide-tr__actor">
            <p className="sw-decide-tr__head">
              <strong>{row.name}</strong>
              <span>
                {row.kind === 'key'
                  ? 'key actor'
                  : `cohort · ${plural(row.members, 'simulated member')} · population assumed ${row.size}`}
              </span>
            </p>
            <ul className="sw-decide-tr__traits" role="list">
              {row.traits.map((trait) => {
                const signed = (SIGNED_TRAIT_KEYS as readonly string[]).includes(trait.key);
                const at = signed ? (trait.value + 1) / 2 : trait.value;
                return (
                  <li
                    key={trait.key}
                    title={`${TRAIT_MEANINGS[trait.key as TraitKey] ?? ''} Value ${trait.value.toFixed(2)}, ${TRAIT_ORIGIN_NAMES[trait.origin]}.`}
                  >
                    <span className="sw-decide-tr__name">{humanise(trait.key)}</span>
                    <span
                      className="sw-decide-tr__bar"
                      data-origin={trait.origin}
                      aria-hidden="true"
                    >
                      {signed ? <i className="sw-decide-tr__zero" /> : null}
                      <i
                        className="sw-decide-tr__dot"
                        style={{ left: `${Math.max(0, Math.min(1, at)) * 100}%` }}
                      />
                    </span>
                    <span className="sw-decide-tr__val num">
                      {trait.value.toFixed(2)}
                      <small className="sr-only"> {TRAIT_ORIGIN_NAMES[trait.origin]}</small>
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      {rows.length > 4 && (
        <button
          type="button"
          className="sw-decide-more"
          aria-expanded={all}
          onClick={() => setAll((old) => !old)}
        >
          <span>{all ? 'Show fewer' : `Show all ${rows.length} actors`}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      )}
      <p className="sw-decide-note-line">
        An open dot is a default Swarm filled in; a filled dot was set by a person, a model or the
        evidence.
      </p>
    </figure>
  );
}
