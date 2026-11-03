import {
  Check,
  Copy,
  FileText,
  Ban,
  CircleX,
  SkipForward,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import {
  SOURCE_CATEGORY_LABELS,
  type AuthorityEstimate,
  type ResearchSource,
  type ResearchStatus,
  type SourceOutcome,
} from '../../../../../shared/research';
import { Chip, Segmented, type Tone } from '../../../design/ui';
import { isLive } from '../../../lib/research';
import { vars } from '../css';
import { plural } from '../model';
import { Provenance } from './Provenance';
import {
  addressOf,
  datesOf,
  filterSources,
  formatDay,
  reasonOf,
  siteOf,
  sourceTitle,
  type SourceFilter,
} from './model';
import { AUTHORITY_LABEL, AUTHORITY_NOTE, AUTHORITY_STEPS, OUTCOME_LABEL } from './words';

const OUTCOME_TONE: Record<SourceOutcome, Tone> = {
  used: 'favor',
  read: 'neutral',
  quarantined: 'caution',
  blocked: 'critical',
  failed: 'critical',
  duplicate: 'neutral',
  skipped: 'neutral',
};

const OUTCOME_ICON: Record<SourceOutcome, LucideIcon> = {
  used: Check,
  read: FileText,
  quarantined: ShieldAlert,
  blocked: Ban,
  failed: CircleX,
  duplicate: Copy,
  skipped: SkipForward,
};

/** What kind of site a page is on, as three marks and a word: an estimate, never a verdict, and never only a colour. */
function Authority({ estimate }: { estimate: AuthorityEstimate }) {
  const steps = AUTHORITY_STEPS[estimate];
  return (
    <span className="sw-research-authority" data-estimate={estimate} title={AUTHORITY_NOTE}>
      <span className="sw-research-authority__marks" aria-hidden="true">
        {[0, 1, 2].map((mark) => (
          <i key={mark} data-on={mark < steps ? '' : undefined} />
        ))}
      </span>
      <span>
        Authority estimate: <strong>{AUTHORITY_LABEL[estimate]}</strong>
      </span>
    </span>
  );
}

export interface PageActions {
  /** Opens the document a used page became. Null where the page has none that is held. */
  openDocument: ((documentId: string) => void) | null;
  /** The documents the project holds, by id. */
  holds: (documentId: string) => boolean;
}

/** An address that may break where it has a seam, and not in the middle of a word. */
function Breakable({ text }: { text: string }) {
  const parts = text.split(/(?<=[/?&#=])/u);
  return (
    <>
      {parts.map((part, index) => (
        <span key={`${index}:${part}`}>
          {index > 0 && <wbr />}
          {part}
        </span>
      ))}
    </>
  );
}

function PageRow({
  source,
  index,
  actions,
  status,
}: {
  source: ResearchSource;
  index: number;
  actions: PageActions;
  /** Where the run is: a page that was read has not been judged while it is under way. */
  status: ResearchStatus;
}) {
  const title = sourceTitle(source);
  const named = Boolean(source.title?.trim());
  const site = siteOf(addressOf(source));
  const reason = reasonOf(source, status);
  const dates = datesOf(source);
  const Icon = OUTCOME_ICON[source.outcome];
  const documentId = source.documentId;
  const openable =
    documentId !== null && actions.openDocument !== null && actions.holds(documentId)
      ? () => actions.openDocument?.(documentId)
      : null;
  const name = (
    <span className="sw-research-page__name" title={title}>
      {named ? title : <Breakable text={title} />}
    </span>
  );
  return (
    <li
      className="sw-research-page"
      data-outcome={source.outcome}
      data-source={source.id}
      style={vars({ '--i': Math.min(index, 4) })}
    >
      {openable ? (
        <button
          type="button"
          className="sw-research-page__open"
          aria-label={`${title}, open the source`}
          onClick={openable}
        >
          {name}
        </button>
      ) : (
        <div className="sw-research-page__open sw-research-page__open--plain">{name}</div>
      )}
      <p className="sw-research-page__where">
        {site || 'Supplied by you'}
        <span aria-hidden="true"> · </span>
        {SOURCE_CATEGORY_LABELS[source.category]}
      </p>
      <p className="sw-research-page__facts">
        <Authority estimate={source.authority} />
        {dates.map((date) => (
          <span key={date.label} className="sw-research-page__date">
            {date.label} <time dateTime={date.iso}>{formatDay(date.iso)}</time>
          </span>
        ))}
      </p>
      <div className="sw-research-page__state">
        <Chip size="sm" tone={OUTCOME_TONE[source.outcome]} icon={<Icon aria-hidden="true" />}>
          {OUTCOME_LABEL[source.outcome]}
        </Chip>
        {source.warnings.length > 0 && (
          <Chip size="sm" tone="caution" icon={<TriangleAlert aria-hidden="true" />}>
            {plural(source.warnings.length, 'warning')}
          </Chip>
        )}
        {source.injectionFlagged && (
          <Chip size="sm" tone="caution" icon={<ShieldAlert aria-hidden="true" />}>
            Instruction-like text
          </Chip>
        )}
      </div>
      {reason && (
        <p className="sw-research-page__reason">
          {reason.sentence}
          {reason.detail && <span className="sw-research-page__quote"> “{reason.detail}”</span>}
        </p>
      )}
      <div className="sw-research-page__more">
        <Provenance source={source} />
      </div>
    </li>
  );
}

/**
 * Every page the run looked at, in the order it did: the ones that became sources, and the ones that did not, each with
 * its reason in plain words. What the pages say is text, nothing else; where they are is in the provenance.
 */
export function Pages({
  sources,
  actions,
  status,
}: {
  sources: readonly ResearchSource[];
  actions: PageActions;
  /** Where the run is. */
  status: ResearchStatus;
}) {
  const [filter, setFilter] = useState<SourceFilter>('all');
  const usedCount = sources.filter((source) => source.outcome === 'used').length;
  const otherCount = sources.length - usedCount;
  const filtered = usedCount > 0 && otherCount > 0 ? filter : 'all';
  const shown = filterSources(sources, filtered);
  // A run that ended having looked at nothing has no pages to list, and says why elsewhere.
  if (sources.length === 0 && !isLive(status)) return null;
  return (
    <div className="sw-research-pages">
      <div className="sw-research-pages__head">
        <h3 className="sw-research-sub" id="ground-research-pages">
          Pages
        </h3>
        {usedCount > 0 && otherCount > 0 && (
          <Segmented<SourceFilter>
            size="sm"
            label="Which pages to show"
            value={filtered}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All ${sources.length}` },
              { value: 'used', label: `Used ${usedCount}` },
              { value: 'other', label: `Not used ${otherCount}` },
            ]}
          />
        )}
      </div>
      {sources.length > 0 && <p className="sw-research-quiet sw-caption">{AUTHORITY_NOTE}</p>}
      {shown.length === 0 ? (
        <p className="sw-research-quiet sw-caption">No page has been read yet.</p>
      ) : (
        <ul className="sw-research-pages__list" role="list" aria-labelledby="ground-research-pages">
          {shown.map((source, index) => (
            <PageRow
              key={source.id}
              source={source}
              index={index}
              actions={actions}
              status={status}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
