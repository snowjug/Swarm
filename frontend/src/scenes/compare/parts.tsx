import type { ReactNode } from 'react';
import { Activity, CircleCheck, CircleDot, HelpCircle, Minus, Table2 } from 'lucide-react';
import {
  RESPONSE_CATEGORIES,
  RESPONSE_LABELS,
  RESPONSE_MEANINGS,
  type Finding,
  type ResponseCategory,
  type ResponseShares,
  type StabilityClass,
} from '../../../../shared/analysis';
import { cx } from '../../design/cx';
import {
  Chip,
  Disclosure,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from '../../design/ui';
import { STABILITY } from '../../lib/analysis';
import type { SectionInfo } from './copy';
import { useInView } from './hooks';
import { responseSummary, shareText } from './format';
import { CHIP_TONE } from './tones';
import './frame.css';

/** A part of the page: its number and name, a serif title, one line to open with, and what a person may do to it. */
export function Section({
  info,
  aside,
  children,
  className,
}: {
  info: SectionInfo;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [ref, seen] = useInView<HTMLElement>();
  return (
    <section
      ref={ref}
      id={info.id}
      className={cx('sw-cmp-section', className)}
      aria-labelledby={`${info.id}-title`}
      data-in={seen ? 'true' : undefined}
      tabIndex={-1}
    >
      <header className="sw-cmp-section__head">
        <p className="sw-cmp-section__no sw-eyebrow">
          <span className="num">{info.no}</span>
          <span>{info.nav}</span>
        </p>
        <h2 id={`${info.id}-title`} className="sw-title sw-cmp-section__title">
          {info.title}
        </h2>
        <p className="sw-cmp-section__lede">{info.lede}</p>
        {aside && <div className="sw-cmp-section__aside">{aside}</div>}
      </header>
      <div className="sw-cmp-section__body">{children}</div>
    </section>
  );
}

export interface TableSpec {
  caption: string;
  columns: readonly string[];
  rows: readonly (readonly ReactNode[])[];
}

function Grid({ spec }: { spec: TableSpec }) {
  return (
    <div className="sw-cmp-table" role="region" aria-label={spec.caption} tabIndex={0}>
      <table>
        <caption>{spec.caption}</caption>
        <thead>
          <tr>
            {spec.columns.map((column, index) => (
              <th key={`${column}-${index}`} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, index) =>
                index === 0 ? (
                  <th key={index} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={index} className="num">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The data of a chart as a table (or a few), for the person who reads it that way or cannot see the chart. It is part
 * of the page, not a feature of it: the same numbers the picture is drawn from, kept one press away.
 */
export function DataTable({
  spec,
  more = [],
  label = 'Data',
}: {
  spec: TableSpec;
  /** Further tables of the same chart, such as one for each run. */
  more?: readonly TableSpec[];
  label?: string;
}) {
  return (
    <Disclosure
      className="sw-cmp-data"
      summary={
        <span className="sw-cmp-data__summary">
          <Table2 size={15} aria-hidden="true" />
          {label}
        </span>
      }
    >
      <Grid spec={spec} />
      {more.map((extra) => (
        <Grid key={extra.caption} spec={extra} />
      ))}
    </Disclosure>
  );
}

const STABILITY_ICON: Record<StabilityClass, ReactNode> = {
  repeatable: <CircleCheck aria-hidden="true" />,
  'mostly-repeatable': <CircleDot aria-hidden="true" />,
  unstable: <Activity aria-hidden="true" />,
  rare: <Minus aria-hidden="true" />,
};

/** How steady a finding is, in a word and a shape as well as a colour. */
export function StabilityChip({
  classification,
  size = 'md',
}: {
  classification: StabilityClass;
  size?: 'sm' | 'md';
}) {
  return (
    <Chip
      tone={CHIP_TONE[STABILITY[classification].tone]}
      icon={STABILITY_ICON[classification]}
      size={size}
    >
      {STABILITY[classification].label}
    </Chip>
  );
}

const METER_TONE: Record<StabilityClass, string> = {
  repeatable: 'var(--c-favor)',
  'mostly-repeatable': 'var(--accent)',
  unstable: 'var(--c-caution)',
  rare: 'var(--c-neutral)',
};

/**
 * How many runs a statement held in, as a bar against all of them, with the 95% interval drawn over it as a
 * whisker. It repeats what the words beside it say; it is there to be seen at a glance.
 */
export function RepeatMeter({ finding, width = 132 }: { finding: Finding; width?: number }) {
  const height = 18;
  const pad = 3;
  const inner = width - pad * 2;
  const share = finding.of > 0 ? finding.holdsIn / finding.of : 0;
  const x = (value: number): number => pad + value * inner;
  const mid = height / 2;
  return (
    <svg
      className="sw-cmp-meter"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      <rect className="sw-cmp-meter__track" x={pad} y={mid - 3} width={inner} height={6} rx={3} />
      <rect
        className="sw-cmp-meter__fill"
        x={pad}
        y={mid - 3}
        width={Math.max(share * inner, share > 0 ? 6 : 0)}
        height={6}
        rx={3}
        style={{ fill: METER_TONE[finding.classification] }}
      />
      <g className="sw-cmp-meter__whisker">
        <line x1={x(finding.interval.lo)} x2={x(finding.interval.hi)} y1={mid} y2={mid} />
        <line x1={x(finding.interval.lo)} x2={x(finding.interval.lo)} y1={mid - 5} y2={mid + 5} />
        <line x1={x(finding.interval.hi)} x2={x(finding.interval.hi)} y1={mid - 5} y2={mid + 5} />
      </g>
    </svg>
  );
}

/**
 * Where simulated members ended up, as one bar: each response a segment as wide as its share. The segments run
 * from in favour to against, in colours that say it and in the words of the key; none of it is a measured rate.
 */
export function ResponseBar({
  shares,
  label,
  active = null,
  size = 'md',
  labelled = false,
}: {
  shares: ResponseShares;
  label: string;
  active?: ResponseCategory | null;
  size?: 'sm' | 'md' | 'lg';
  labelled?: boolean;
}) {
  return (
    <div
      className={cx('sw-cmp-resp', `sw-cmp-resp--${size}`)}
      role="img"
      aria-label={`${label}: ${responseSummary(shares)} of the simulated members`}
      data-active={active ?? undefined}
    >
      {RESPONSE_CATEGORIES.map((category) =>
        shares[category] > 0.0005 ? (
          <span
            key={category}
            className="sw-cmp-resp__seg"
            data-cat={category}
            style={{ flexGrow: shares[category] }}
            aria-hidden="true"
          >
            {labelled && shares[category] >= 0.085 ? <b>{shareText(shares[category], 0)}</b> : null}
          </span>
        ) : null,
      )}
    </div>
  );
}

/**
 * The six responses, as a key that is also a control: pressing one brings it forward in every bar. What each
 * one means is a hover or a press away, and is in the table; a tooltip never holds the only copy.
 */
export function ResponseKey({
  active,
  onActive,
}: {
  active: ResponseCategory | null;
  onActive: (category: ResponseCategory | null) => void;
}) {
  return (
    <div className="sw-cmp-key" role="group" aria-label="Responses, from in favour to against">
      {RESPONSE_CATEGORIES.map((category) => (
        <Tooltip key={category} label={RESPONSE_MEANINGS[category]}>
          <button
            type="button"
            className="sw-cmp-key__item"
            aria-pressed={active === category}
            data-cat={category}
            onClick={() => onActive(active === category ? null : category)}
          >
            <span className="sw-cmp-key__swatch" data-cat={category} aria-hidden="true" />
            {RESPONSE_LABELS[category]}
          </button>
        </Tooltip>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="sw-cmp-key__help" aria-label="What each response means">
            <HelpCircle size={16} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent width="24rem" align="end">
          <p className="sw-eyebrow">What each response means</p>
          <dl className="sw-cmp-means">
            {RESPONSE_CATEGORIES.map((category) => (
              <div key={category}>
                <dt>
                  <span className="sw-cmp-key__swatch" data-cat={category} aria-hidden="true" />
                  {RESPONSE_LABELS[category]}
                </dt>
                <dd>{RESPONSE_MEANINGS[category]}</dd>
              </div>
            ))}
          </dl>
          <p className="sw-caption">
            Readings of where each simulated member ended up, not observed behaviour.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
