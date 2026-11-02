import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { AnimatePresence, LayoutGroup, m } from 'motion/react';
import {
  CircleAlert,
  Check,
  Clock,
  GitBranch,
  GitCompareArrows,
  History,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react';
import type { ProjectSummary } from '../../../shared/types';
import { errorMessage } from '../api';
import { cx } from '../design/cx';
import { SPRING } from '../design/motion';
import {
  Button,
  Chip,
  ChipButton,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  IconButton,
  Notice,
  Ring,
  Sheet,
  SheetContent,
  Skeleton,
} from '../design/ui';
import {
  FILTER_LABELS,
  branchNote,
  canCompare,
  canDelete,
  countLine,
  engineOf,
  filterCounts,
  matchesFilter,
  matchesQuery,
  newestFirst,
  offeredFilters,
  rowState,
  type HistoryFilter,
  type RowState,
} from './historyView';
import { Orb } from './shared/Orb';
import { SearchField } from './shared/SearchField';
import { fullTime, groupByDay, timeAgo } from './shared/time';
import { focusPanel, usePanelLifecycle } from './shared/usePanelLifecycle';
import './history.css';

export interface HistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectSummary[];
  total: number;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  /** Whether the server can compare runs ("what if"); the Compare action is offered only then. */
  whatIf: boolean;
  onCompare: (id: string) => void;
  onRefresh: () => void;
  onDelete: (id: string) => Promise<void>;
}

/** The glyph at the start of a row: the exploration's own sphere, with its state as a badge or as the ring around it. */
function Lead({ project, state }: { project: ProjectSummary; state: RowState }) {
  if ((state.kind === 'working' || state.kind === 'paused') && state.progress !== null) {
    return (
      <span className="sw-hist__lead" aria-hidden="true">
        <Ring
          value={state.progress}
          size={44}
          stroke={3}
          tone={state.kind === 'paused' ? 'caution' : 'accent'}
          label={state.label}
          valueText={state.label}
          className="sw-hist__ring"
        >
          <Orb seed={project.id} size={28} />
        </Ring>
      </span>
    );
  }
  const Badge =
    state.kind === 'complete'
      ? Check
      : state.kind === 'failed'
        ? CircleAlert
        : state.kind === 'cancelled'
          ? Square
          : state.kind === 'working'
            ? Clock
            : null;
  return (
    <span className="sw-hist__lead">
      <Orb seed={project.id} size={38} />
      {Badge && (
        <span className="sw-hist__badge" data-kind={state.kind} aria-hidden="true">
          <Badge size={11} strokeWidth={3} />
        </span>
      )}
    </span>
  );
}

function HistoryRow({
  project,
  all,
  index,
  selected,
  whatIf,
  busy,
  active,
  onActive,
  onSelect,
  onCompare,
  onDelete,
}: {
  project: ProjectSummary;
  all: readonly ProjectSummary[];
  index: number;
  selected: boolean;
  whatIf: boolean;
  busy: boolean;
  active: boolean;
  onActive: (id: string | null) => void;
  onSelect: (id: string) => void;
  onCompare: (id: string) => void;
  onDelete: (project: ProjectSummary) => void;
}) {
  const state = rowState(project);
  const engine = engineOf(project);
  const branch = branchNote(project, all);
  const deletable = canDelete(project, busy);
  return (
    <m.li
      layout="position"
      className="sw-hist__item"
      data-selected={selected || undefined}
      data-state={state.kind}
      transition={SPRING.smooth}
      exit={{ opacity: 0, transition: { duration: 0.14 } }}
      onPointerEnter={() => onActive(project.id)}
      onFocusCapture={() => onActive(project.id)}
    >
      {active && (
        <m.span
          layoutId="sw-hist-pill"
          className="sw-hist__pill"
          transition={SPRING.snappy}
          aria-hidden="true"
        />
      )}
      <div className="sw-hist__row sw-rise" style={{ '--i': Math.min(index, 8) } as CSSProperties}>
        <button
          type="button"
          className="sw-hist__open"
          data-hist-open
          aria-current={selected ? 'true' : undefined}
          onClick={() => onSelect(project.id)}
        >
          <Lead project={project} state={state} />
          <span className="sw-hist__text">
            <span className="sw-hist__head">
              <span className="sw-hist__name">{project.name}</span>
              {selected && (
                <Chip tone="accent" size="sm" dot>
                  Open now
                </Chip>
              )}
            </span>
            <span className="sw-hist__question">{project.question}</span>
            {state.kind === 'failed' && project.error && (
              <span className="sw-hist__error" title={project.error}>
                {project.error}
              </span>
            )}
            <span className="sw-pmeta sw-hist__meta">
              <span className="sw-hist__status" data-kind={state.kind}>
                {state.label}
              </span>
              <span className={cx('sw-hist__engine', engine.real && 'is-real')}>
                {engine.label}
              </span>
              <time dateTime={project.updatedAt} title={fullTime(project.updatedAt)}>
                {timeAgo(project.updatedAt)}
              </time>
              {project.workflow === 'quick' && (
                <span title="Made by the earlier quick workflow">Quick run</span>
              )}
              {branch && (
                <span className="sw-hist__branch">
                  <GitBranch size={12} aria-hidden="true" /> {branch}
                </span>
              )}
            </span>
          </span>
        </button>
        <div className="sw-hist__actions">
          {canCompare(project, whatIf) && (
            <IconButton
              label={`Compare ${project.name}`}
              size="sm"
              onClick={() => onCompare(project.id)}
            >
              <GitCompareArrows size={16} aria-hidden="true" />
            </IconButton>
          )}
          <IconButton
            label={`Delete ${project.name}`}
            size="sm"
            disabled={!deletable}
            className="sw-hist__delete"
            onClick={() => onDelete(project)}
          >
            <Trash2 size={16} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </m.li>
  );
}

function RowsSkeleton() {
  return (
    <div className="sw-hist__skeleton" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="sw-hist__skeleton-row" style={{ opacity: 1 - index * 0.18 }}>
          <Skeleton width="2.4rem" height="2.4rem" radius="50%" />
          <div className="sw-hist__skeleton-text">
            <Skeleton width={`${62 - index * 8}%`} height="1.2rem" />
            <Skeleton width="92%" height="0.9rem" />
            <Skeleton width="48%" height="0.8rem" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Everything inside the sheet but the sheet: the search, the list and what it says when it cannot show one. */
export function HistoryBody({
  projects,
  total,
  loading,
  error,
  selectedId,
  busy,
  whatIf,
  onSelect,
  onCompare,
  onRefresh,
  onDelete,
  now,
}: Omit<HistorySheetProps, 'open' | 'onOpenChange' | 'onDelete'> & {
  onDelete: (project: ProjectSummary) => void;
  now?: Date;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [active, setActive] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  // The bar over the list takes a fill only once the list has moved under it.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(entry ? !entry.isIntersecting : false),
      { root: node.closest('.sw-sheet__body') },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const sorted = useMemo(() => newestFirst(projects), [projects]);
  const counts = useMemo(() => filterCounts(sorted), [sorted]);
  const filters = offeredFilters(counts);
  const effective: HistoryFilter = filters.includes(filter) ? filter : 'all';
  const visible = useMemo(
    () =>
      sorted.filter((project) => matchesFilter(project, effective) && matchesQuery(project, query)),
    [sorted, effective, query],
  );
  const groups = useMemo(
    () => groupByDay(visible, (project) => project.updatedAt, now),
    [visible, now],
  );
  const filtered = query.trim() !== '' || effective !== 'all';

  // The person's place in the list is the highlighted row; it follows the keyboard as well as the pointer.
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const buttons = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>('button[data-hist-open]') ?? []),
    ];
    const current = buttons.findIndex((button) => button === document.activeElement);
    if (buttons.length === 0 || (current < 0 && event.key !== 'ArrowDown' && event.key !== 'Home'))
      return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : Math.min(
              buttons.length - 1,
              Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)),
            );
    buttons[next]?.focus();
  };

  useEffect(() => {
    if (active && !visible.some((project) => project.id === active)) setActive(null);
  }, [active, visible]);

  const refreshing = loading && projects.length > 0;
  return (
    <div className="sw-hist__body">
      <div ref={sentinel} className="sw-hist__sentinel" aria-hidden="true" />
      <div className={cx('sw-hist__tools', stuck && 'is-stuck')}>
        <div className="sw-hist__search">
          <SearchField
            value={query}
            onChange={setQuery}
            label="Search your explorations"
            placeholder="Search by name or question"
          />
          <IconButton label="Refresh the list" disabled={loading} onClick={onRefresh}>
            <RefreshCw size={17} className={cx(loading && 'sw-hist__spin')} aria-hidden="true" />
          </IconButton>
        </div>
        {filters.length > 0 && (
          <div className="sw-hist__filters" role="group" aria-label="Show">
            {filters.map((name) => (
              <ChipButton
                key={name}
                size="sm"
                pressed={effective === name}
                onClick={() => setFilter(name)}
              >
                {FILTER_LABELS[name]}
                <span className="sw-hist__count num">{counts[name]}</span>
              </ChipButton>
            ))}
          </div>
        )}
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {!loading && !error && projects.length > 0
          ? countLine(total, projects.length, visible.length, filtered)
          : ''}
      </div>

      {error && (
        <Notice
          tone="error"
          title="The list could not be read"
          action={
            <Button size="sm" variant="glass" busy={loading} onClick={onRefresh}>
              Retry
            </Button>
          }
        >
          {projects.length > 0 ? `Showing what was read last. ${error}` : error}
        </Notice>
      )}

      {loading && projects.length === 0 && !error && <RowsSkeleton />}

      {!loading && !error && projects.length === 0 && (
        <EmptyState icon={<History size={22} aria-hidden="true" />} title="Nothing yet">
          Ask a question and what you explore is kept here.
        </EmptyState>
      )}

      {projects.length > 0 && visible.length === 0 && (
        <EmptyState
          title="No match"
          action={
            <Button
              size="sm"
              variant="glass"
              onClick={() => {
                setQuery('');
                setFilter('all');
              }}
            >
              Clear the search
            </Button>
          }
        >
          Nothing you explored matches that.
        </EmptyState>
      )}

      <div
        ref={list}
        className={cx('sw-hist__groups', refreshing && 'is-refreshing')}
        onKeyDown={move}
        onPointerLeave={() => setActive(null)}
      >
        <LayoutGroup>
          <AnimatePresence initial={false}>
            {groups.map((group) => (
              <m.section
                key={group.label}
                layout="position"
                exit={{ opacity: 0, transition: { duration: 0.14 } }}
                className="sw-hist__group"
              >
                {groups.length > 1 && <h3 className="sw-eyebrow sw-hist__day">{group.label}</h3>}
                <ul role="list" className="sw-hist__list">
                  <AnimatePresence initial={false} mode="popLayout">
                    {group.items.map((project, index) => (
                      <HistoryRow
                        key={project.id}
                        project={project}
                        all={projects}
                        index={index}
                        selected={selectedId === project.id}
                        whatIf={whatIf}
                        busy={busy}
                        active={active === project.id}
                        onActive={setActive}
                        onSelect={onSelect}
                        onCompare={onCompare}
                        onDelete={onDelete}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              </m.section>
            ))}
          </AnimatePresence>
        </LayoutGroup>
      </div>

      {projects.length > 0 && (
        <p className="sw-caption sw-hist__foot">
          Kept on this server, not in your browser. An exploration that is working cannot be
          deleted.
        </p>
      )}
    </div>
  );
}

/** "Your explorations": the saved projects, newest first, with a way back into any of them. */
export function HistorySheet(props: HistorySheetProps) {
  const { open, onOpenChange, projects, total, loading, error } = props;
  const lifecycle = usePanelLifecycle(open, onOpenChange);
  const [pending, setPending] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const lastPending = useRef<ProjectSummary | null>(null);
  if (pending) lastPending.current = pending;
  const target = pending ?? lastPending.current;

  const description =
    projects.length > 0 ? countLine(total, projects.length, projects.length, false) : undefined;

  const confirm = async () => {
    if (!pending || deleting) return;
    setDeleting(true);
    setFailure(null);
    try {
      await props.onDelete(pending.id);
      setPending(null);
    } catch (problem) {
      setFailure(errorMessage(problem));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Sheet open={lifecycle.open} onOpenChange={lifecycle.onOpenChange}>
        <SheetContent
          eyebrow="History"
          title="Your explorations"
          description={description ?? 'Newest first'}
          className="sw-hist"
          onOpenAutoFocus={focusPanel}
        >
          <HistoryBody
            projects={projects}
            total={total}
            loading={loading}
            error={error}
            selectedId={props.selectedId}
            busy={props.busy}
            whatIf={props.whatIf}
            onSelect={props.onSelect}
            onCompare={props.onCompare}
            onRefresh={props.onRefresh}
            onDelete={(project) => {
              setFailure(null);
              setPending(project);
            }}
          />
        </SheetContent>
      </Sheet>
      <Dialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next && !deleting) setPending(null);
        }}
      >
        <DialogContent
          tone="danger"
          className="sw-hist-confirm"
          title={
            <span className="sw-hist-confirm__title">
              <Trash2 size={22} aria-hidden="true" /> Delete this exploration?
            </span>
          }
          description={
            target
              ? `“${target.name}”, with its evidence, conversations and outputs, is deleted for good. This cannot be undone.`
              : undefined
          }
          footer={
            <>
              <DialogClose asChild>
                <Button variant="ghost" disabled={deleting}>
                  Keep it
                </Button>
              </DialogClose>
              <Button
                variant="danger"
                busy={deleting}
                busyLabel="Deleting"
                onClick={() => void confirm()}
              >
                Delete permanently
              </Button>
            </>
          }
        >
          <div role="status" aria-live="polite">
            {failure && (
              <Notice tone="error" title="It was not deleted">
                {failure} Nothing was removed; you can try again.
              </Notice>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
