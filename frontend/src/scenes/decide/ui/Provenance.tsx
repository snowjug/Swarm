import { Quote } from 'lucide-react';
import { STATEMENT_ORIGIN_LABELS, type BriefStatement } from '../../../../../shared/brief';
import { Popover, PopoverTrigger, Tooltip } from '../../../design/ui';
import {
  ORIGIN_MEANINGS,
  RELIANCE_LABELS,
  RELIANCE_MEANINGS,
  STABILITY_LABELS,
  hasRefs,
} from '../../../lib/brief';
import { SEVERITY_VIEW } from '../../../lib/critics';
import { clip, decimals, signedDecimals } from '../model/format';
import { useDoc } from './context';
import { DetailPopover } from './DetailPopover';
import { ORIGIN_FAMILY, ORIGIN_ICONS, SEVERITY_ICONS } from './meta';
import './provenance.css';

const LEVELS = { high: 3, moderate: 2, low: 1 } as const;

/** Three upright bars, filled to the level of reliance: a shape for what the word says. */
export function RelianceBars({ level }: { level: keyof typeof LEVELS }) {
  const filled = LEVELS[level];
  return (
    <svg
      className="sw-decide-bars"
      viewBox="0 0 14 12"
      width="14"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      {[0, 1, 2].map((index) => (
        <rect
          key={index}
          x={index * 5}
          y={8 - index * 3.5}
          width="3.4"
          height={4 + index * 3.5}
          rx="1"
          data-on={index < filled || undefined}
        />
      ))}
    </svg>
  );
}

/** One finding's interval on the scale from 0 to 1, with the share of runs it held in marked on it. */
function IntervalBar({ lo, hi, share }: { lo: number; hi: number; share: number }) {
  return (
    <svg
      className="sw-decide-interval"
      viewBox="0 0 100 10"
      width="100"
      height="10"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="0" x2="100" y1="5" y2="5" className="sw-decide-interval__axis" />
      <rect
        x={lo * 100}
        y="2"
        width={Math.max((hi - lo) * 100, 1)}
        height="6"
        rx="3"
        className="sw-decide-interval__span"
      />
      <circle cx={share * 100} cy="5" r="3.2" className="sw-decide-interval__dot" />
    </svg>
  );
}

/** What a statement rests on, resolved from the data the brief kept so that no further request is made. */
function Rests({ statement }: { statement: BriefStatement }) {
  const { visuals, critiques, openReview, mode } = useDoc();
  const lookups = visuals?.lookups ?? null;
  const { refs } = statement;
  const advanced = mode === 'advanced';
  if (!hasRefs(refs)) {
    return (
      <p className="sw-decide-prov__none">
        Stated from the brief’s own data. Nothing further is cited.
      </p>
    );
  }
  return (
    <ul className="sw-decide-rests" role="list">
      {refs.evidence.map((ref) => (
        <li key={`${ref.passageId}-${ref.role}`}>
          <span className="sw-decide-rests__kind">
            {ref.role === 'supports' ? 'Passage that supports' : 'Passage that contradicts'}
          </span>
          <span className="sw-decide-rests__body">
            <span className="sw-decide-rests__doc">
              <Quote size={13} aria-hidden="true" /> {ref.documentName}
              <span className="sw-mono"> {ref.passageId}</span>
            </span>
            {ref.quote ? <q className="sw-decide-rests__quote">{clip(ref.quote, 320)}</q> : null}
          </span>
        </li>
      ))}
      {refs.findingIds.map((id) => {
        const finding = lookups?.findings.find((entry) => entry.id === id);
        return (
          <li key={`finding-${id}`}>
            <span className="sw-decide-rests__kind">Finding</span>
            <span className="sw-decide-rests__body">
              {finding ? (
                <>
                  <span>{clip(finding.statement, 220)}</span>
                  <span className="sw-decide-rests__meta">
                    Held in <b className="num">{finding.holdsIn}</b> of{' '}
                    <b className="num">{finding.of}</b> seeded runs ·{' '}
                    {STABILITY_LABELS[finding.classification]} · interval{' '}
                    <span className="num">
                      {decimals(finding.interval.lo)} to {decimals(finding.interval.hi)}
                    </span>
                  </span>
                  <IntervalBar
                    lo={finding.interval.lo}
                    hi={finding.interval.hi}
                    share={finding.holdsIn / finding.of}
                  />
                </>
              ) : (
                <span className="sw-mono">{id}</span>
              )}
              {advanced && finding ? (
                <span className="sw-decide-rests__id sw-mono">{id}</span>
              ) : null}
            </span>
          </li>
        );
      })}
      {refs.sensitivityIds.map((id) => {
        const row = visuals?.sensitivity.find((entry) => entry.id === id);
        return (
          <li key={`sensitivity-${id}`}>
            <span className="sw-decide-rests__kind">Assumption moved</span>
            <span className="sw-decide-rests__body">
              {row ? (
                <>
                  <span>{row.label}</span>
                  <span className="sw-decide-rests__meta">
                    Shift <span className="num">{signedDecimals(row.shift)}</span> (standard error{' '}
                    <span className="num">{decimals(row.standardError)}</span>)
                  </span>
                </>
              ) : (
                <span className="sw-mono">{id}</span>
              )}
            </span>
          </li>
        );
      })}
      {refs.assumptions.map((assumption) => (
        <li key={`assumption-${assumption}`}>
          <span className="sw-decide-rests__kind">Assumption</span>
          <span className="sw-decide-rests__body">{clip(assumption, 260)}</span>
        </li>
      ))}
      {refs.stakeholderIds.length > 0 && (
        <li>
          <span className="sw-decide-rests__kind">
            {refs.stakeholderIds.length === 1 ? 'Group' : 'Groups'}
          </span>
          <span className="sw-decide-rests__body">
            {refs.stakeholderIds
              .map((id) => lookups?.stakeholders.find((entry) => entry.id === id)?.name ?? id)
              .join(', ')}
          </span>
        </li>
      )}
      {refs.documentIds.map((id) => {
        const document = lookups?.documents.find((entry) => entry.id === id);
        return (
          <li key={`document-${id}`}>
            <span className="sw-decide-rests__kind">Source</span>
            <span className="sw-decide-rests__body">
              <span>{document?.name ?? id}</span>
              {document ? (
                <span className="sw-decide-rests__meta">{clip(document.provenance, 200)}</span>
              ) : null}
            </span>
          </li>
        );
      })}
      {refs.variantIds.length > 0 && (
        <li>
          <span className="sw-decide-rests__kind">Seeded runs of</span>
          <span className="sw-decide-rests__body">
            {refs.variantIds
              .map((id) => lookups?.variants.find((entry) => entry.id === id)?.label ?? id)
              .join(' and ')}
          </span>
        </li>
      )}
      {refs.critiqueIds.map((id) => {
        const critique = critiques.find((entry) => entry.id === id);
        const Icon = critique ? SEVERITY_ICONS[critique.severity] : null;
        return (
          <li key={`critique-${id}`}>
            <span className="sw-decide-rests__kind">Criticism</span>
            <span className="sw-decide-rests__body">
              {critique && Icon ? (
                <>
                  <span>{clip(critique.objection, 200)}</span>
                  <button
                    type="button"
                    className="sw-decide-rests__open"
                    onClick={() => openReview(id)}
                  >
                    <Icon size={13} aria-hidden="true" /> {SEVERITY_VIEW[critique.severity].label} ·
                    open in the review
                  </button>
                </>
              ) : (
                <span className="sw-mono">{id}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Where a statement comes from and how far it can be relied on, with what it rests on, one press away. */
export function OriginMark({ statement }: { statement: BriefStatement }) {
  const Icon = ORIGIN_ICONS[statement.origin];
  const label = STATEMENT_ORIGIN_LABELS[statement.origin];
  const { mode } = useDoc();
  const name = statement.reliance
    ? `${label}, ${RELIANCE_LABELS[statement.reliance].toLowerCase()}. What this rests on`
    : `${label}. What this rests on`;
  return (
    <Popover>
      <Tooltip
        label={
          statement.reliance
            ? `${label} · ${RELIANCE_LABELS[statement.reliance].toLowerCase()}`
            : label
        }
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="sw-decide-origin"
            data-family={ORIGIN_FAMILY[statement.origin]}
            aria-label={name}
          >
            <Icon size={13} aria-hidden="true" />
            {statement.reliance ? <RelianceBars level={statement.reliance} /> : null}
          </button>
        </PopoverTrigger>
      </Tooltip>
      <DetailPopover
        label="What this statement rests on"
        width="26rem"
        align="start"
        className="sw-decide-prov"
      >
        <div className="sw-decide-prov__head" data-family={ORIGIN_FAMILY[statement.origin]}>
          <span className="sw-decide-prov__icon">
            <Icon size={16} aria-hidden="true" />
          </span>
          <div>
            <strong>{label}</strong>
            <p>{ORIGIN_MEANINGS[statement.origin]}</p>
          </div>
        </div>
        {statement.reliance ? (
          <div className="sw-decide-prov__reliance">
            <RelianceBars level={statement.reliance} />
            <div>
              <strong>{RELIANCE_LABELS[statement.reliance]}</strong>
              <p>{RELIANCE_MEANINGS[statement.reliance]} Not a probability.</p>
            </div>
          </div>
        ) : null}
        <h3 className="sw-decide-prov__title sw-eyebrow">What it rests on</h3>
        <Rests statement={statement} />
        {mode === 'advanced' ? <p className="sw-decide-prov__id sw-mono">{statement.id}</p> : null}
      </DetailPopover>
    </Popover>
  );
}
