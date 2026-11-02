import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Check,
  CircleHelp,
  Cpu,
  Download,
  FileSearch,
  KeyRound,
  Play,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { AuditState, Verification } from '../hooks/useAudit';
import { useAudit } from '../hooks/useAudit';
import { cx } from '../design/cx';
import {
  Button,
  ChipButton,
  Disclosure,
  EmptyState,
  IconButton,
  Notice,
  Orbit,
  Sheet,
  SheetContent,
  Skeleton,
} from '../design/ui';
import {
  CATEGORY_LABELS,
  PAGE,
  categoryCounts,
  entryIntegrity,
  entryView,
  matchesAuditQuery,
  newestFirst,
  offeredCategories,
  type AuditCategory,
  type EntryView,
  type Integrity,
} from './auditView';
import { Orb } from './shared/Orb';
import { SearchField } from './shared/SearchField';
import { clockTime, fullTime, groupByDay } from './shared/time';
import { focusPanel, usePanelLifecycle } from './shared/usePanelLifecycle';
import './audit.css';

export interface AuditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

const CATEGORY_ICONS: Record<AuditCategory, typeof Play> = {
  work: Play,
  evidence: FileSearch,
  access: KeyRound,
  exports: Download,
  model: Cpu,
};

/** The result of checking the chain, told as a mark that is drawn and as words, in a live region. */
function Seal({ verification, onVerify }: { verification: Verification; onVerify: () => void }) {
  const running = verification.state === 'running';
  const done = verification.state === 'done';
  const intact = done && verification.result.ok;
  return (
    <section
      className="sw-audit__seal"
      aria-label="Integrity of the log"
      data-state={verification.state}
    >
      <div className="sw-audit__mark" aria-hidden="true">
        {running && <Orbit size={30} label="Checking the audit chain" />}
        {done && (
          <svg viewBox="0 0 48 48" className="sw-audit__glyph" data-ok={intact || undefined}>
            <circle className="sw-audit__ring" cx="24" cy="24" r="21" pathLength={1} />
            {intact ? (
              <path className="sw-audit__tick" d="M14.5 25 L21.5 32 L34 17" pathLength={1} />
            ) : (
              <path className="sw-audit__tick" d="M17 17 L31 31 M31 17 L17 31" pathLength={1} />
            )}
          </svg>
        )}
        {!running && !done && <ShieldCheck size={26} strokeWidth={1.6} />}
      </div>
      <div className="sw-audit__sealtext" role="status" aria-live="polite">
        {verification.state === 'idle' && (
          <>
            <p className="sw-audit__sealtitle">Is the log intact?</p>
            <p className="sw-caption">
              Recompute the chain that links every entry to the one before it.
            </p>
          </>
        )}
        {running && (
          <>
            <p className="sw-audit__sealtitle">Checking…</p>
            <p className="sw-caption">Recomputing the hash chain.</p>
          </>
        )}
        {verification.state === 'done' && intact && (
          <>
            <p className="sw-audit__sealtitle is-ok">Chain intact</p>
            <p className="sw-caption">
              {verification.result.checked} entries checked across the whole log. None was altered
              or removed.
            </p>
          </>
        )}
        {verification.state === 'done' && !intact && (
          <>
            <p className="sw-audit__sealtitle is-broken">Chain broken</p>
            <p className="sw-caption">
              Entry #{verification.result.brokenAt} does not match the one before it, after{' '}
              {verification.result.checked} entries that did. The log was altered, or an entry was
              removed.
            </p>
          </>
        )}
        {verification.state === 'failed' && (
          <Notice tone="error" title="Integrity could not be checked">
            {verification.error}
          </Notice>
        )}
      </div>
      <Button
        variant={verification.state === 'idle' ? 'glass' : 'ghost'}
        size="sm"
        busy={running}
        busyLabel="Checking"
        icon={
          verification.state === 'done' && !intact ? (
            <ShieldAlert size={15} />
          ) : (
            <ShieldCheck size={15} />
          )
        }
        onClick={onVerify}
      >
        {verification.state === 'idle' ? 'Verify integrity' : 'Check again'}
      </Button>
    </section>
  );
}

function IntegrityBadge({ integrity }: { integrity: Integrity }) {
  if (integrity === 'unchecked') return null;
  const Icon = integrity === 'verified' ? Check : integrity === 'broken' ? X : CircleHelp;
  return (
    <span className="sw-audit__badge" data-integrity={integrity} aria-hidden="true">
      <Icon size={10} strokeWidth={3.4} />
    </span>
  );
}

const INTEGRITY_WORDS: Record<Integrity, string> = {
  unchecked: '',
  verified: 'Verified by the chain check.',
  broken: 'The chain breaks at this entry.',
  'after-break': 'After the break, so it cannot be vouched for.',
};

function Entry({
  view,
  integrity,
  index,
  step,
}: {
  view: EntryView;
  integrity: Integrity;
  index: number;
  /** How far this entry is from the oldest one, for the sweep that follows a check. */
  step: number;
}) {
  const Icon = CATEGORY_ICONS[view.category];
  return (
    <li
      className="sw-audit__item sw-rise"
      data-integrity={integrity}
      style={{ '--i': Math.min(index, 8), '--n': Math.min(step, 40) } as CSSProperties}
    >
      <span className="sw-audit__node" data-category={view.category} aria-hidden="true">
        <Icon size={14} />
        <IntegrityBadge integrity={integrity} />
      </span>
      <div className="sw-audit__main">
        <div className="sw-audit__line">
          <h4 className="sw-audit__title" title={view.code}>
            {view.title}
          </h4>
          <time className="sw-audit__time num" dateTime={view.at} title={fullTime(view.at)}>
            {clockTime(view.at)}
          </time>
        </div>
        <div className="sw-audit__who">
          <Orb seed={view.actorFull} size={14} />
          <span className="sw-mono" title={view.actorFull}>
            {view.actor}
          </span>
          <span className="sw-audit__seq num">#{view.seq}</span>
        </div>
        {view.pairs.length > 0 && (
          <dl className="sw-audit__pairs">
            {view.pairs.map((pair) => (
              <div key={pair.key} className="sw-audit__pair">
                <dt>{pair.key}</dt>
                <dd>{pair.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {integrity !== 'unchecked' && <span className="sr-only">{INTEGRITY_WORDS[integrity]}</span>}
      </div>
    </li>
  );
}

function TimelineSkeleton() {
  return (
    <div className="sw-audit__skeleton" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="sw-audit__skeleton-row" style={{ opacity: 1 - index * 0.16 }}>
          <Skeleton width="1.75rem" height="1.75rem" radius="50%" />
          <div className="sw-audit__skeleton-text">
            <Skeleton width={`${58 - index * 6}%`} height="1rem" />
            <Skeleton width="38%" height="0.8rem" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The entries and the check of the chain, without the sheet around them. */
export function AuditBody({ state, now }: { state: AuditState; now?: Date }) {
  const { entries, loading, error, reload, verification, verify } = state;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<AuditCategory | 'all'>('all');
  const [limit, setLimit] = useState(PAGE);

  const views = useMemo(() => newestFirst(entries ?? []).map(entryView), [entries]);
  const counts = useMemo(() => categoryCounts(views), [views]);
  const offered = offeredCategories(counts);
  const effective = category !== 'all' && offered.includes(category) ? category : 'all';
  const matching = useMemo(
    () =>
      views.filter(
        (view) =>
          (effective === 'all' || view.category === effective) && matchesAuditQuery(view, query),
      ),
    [views, effective, query],
  );
  const shown = matching.slice(0, limit);
  const groups = useMemo(() => groupByDay(shown, (view) => view.at, now), [shown, now]);
  const oldest = views.length > 0 ? views[views.length - 1]!.seq : 0;
  const filtered = query.trim() !== '' || effective !== 'all';

  let index = 0;
  const content = groups.map((group) => (
    <section key={group.key} className="sw-audit__group">
      <h3 className="sw-eyebrow sw-audit__day">{group.label}</h3>
      <ol className="sw-audit__list" role="list">
        {group.items.map((view) => (
          <Entry
            key={view.seq}
            view={view}
            integrity={entryIntegrity(view.seq, verification)}
            index={index++}
            step={view.seq - oldest}
          />
        ))}
      </ol>
    </section>
  ));

  return (
    <div className="sw-audit__body">
      <Seal verification={verification} onVerify={verify} />

      <div className="sw-audit__tools">
        <div className="sw-audit__search">
          <SearchField
            value={query}
            onChange={setQuery}
            label="Search the log"
            placeholder="Search the log"
          />
          <IconButton label="Refresh the log" disabled={loading} onClick={reload}>
            <RefreshCw size={17} className={cx(loading && 'sw-audit__spin')} aria-hidden="true" />
          </IconButton>
        </div>
        {offered.length > 0 && (
          <div className="sw-audit__filters" role="group" aria-label="Show">
            <ChipButton size="sm" pressed={effective === 'all'} onClick={() => setCategory('all')}>
              All<span className="sw-audit__count num">{views.length}</span>
            </ChipButton>
            {offered.map((name) => (
              <ChipButton
                key={name}
                size="sm"
                pressed={effective === name}
                onClick={() => setCategory(name)}
              >
                {CATEGORY_LABELS[name]}
                <span className="sw-audit__count num">{counts[name]}</span>
              </ChipButton>
            ))}
          </div>
        )}
      </div>

      {error && (
        <Notice
          tone="error"
          title="The audit log could not be read"
          action={
            <Button size="sm" variant="glass" busy={loading} onClick={reload}>
              Retry
            </Button>
          }
        >
          {error}
        </Notice>
      )}

      {loading && !entries && !error && <TimelineSkeleton />}

      {entries && entries.length === 0 && (
        <EmptyState
          icon={<ScrollText size={22} aria-hidden="true" />}
          title="No recorded actions yet"
        >
          Actions on this project, such as starting a stage or exporting, appear here as they
          happen.
        </EmptyState>
      )}

      {entries && entries.length > 0 && matching.length === 0 && filtered && (
        <EmptyState
          title="No match"
          action={
            <Button
              size="sm"
              variant="glass"
              onClick={() => {
                setQuery('');
                setCategory('all');
              }}
            >
              Clear the search
            </Button>
          }
        >
          No entry matches that.
        </EmptyState>
      )}

      <div className={cx('sw-audit__timeline', loading && entries && 'is-refreshing')}>
        {content}
      </div>

      {matching.length > shown.length && (
        <div className="sw-audit__more">
          <Button variant="glass" size="sm" onClick={() => setLimit((value) => value + PAGE)}>
            Show older entries
          </Button>
          <span className="sw-caption num">
            {shown.length} of {matching.length}
          </span>
        </div>
      )}

      <Disclosure summary="How the log is protected" className="sw-audit__how">
        <p className="sw-caption sw-audit__how-text">
          Entries hold identifiers, counts and short labels, never questions, answers or source
          text. Each entry commits to the one before it, so an edit or a removal shows up as a
          broken chain. The check runs over the whole log, not only this project.
        </p>
      </Disclosure>
    </div>
  );
}

/** The record of who did what to the project and when, and a check that none of it has been changed. */
export function AuditSheet({ open, onOpenChange, projectId }: AuditSheetProps) {
  const lifecycle = usePanelLifecycle(open, onOpenChange);
  const state = useAudit(projectId);
  return (
    <Sheet open={lifecycle.open} onOpenChange={lifecycle.onOpenChange}>
      <SheetContent
        eyebrow="Project"
        title="Audit log"
        description="Who did what, and when. Never your questions, answers or sources."
        width="lg"
        className="sw-audit"
        onOpenAutoFocus={focusPanel}
      >
        <AuditBody state={state} />
      </SheetContent>
    </Sheet>
  );
}
