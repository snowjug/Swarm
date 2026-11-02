import { useId, useRef, useState } from 'react';
import { m } from 'motion/react';
import {
  Activity,
  AlignLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ListChecks,
  Scale,
  TriangleAlert,
} from 'lucide-react';
import { cx } from '../../design/cx';
import { SPRING } from '../../design/motion';
import { IconButton, Sheet, SheetContent, SheetTrigger } from '../../design/ui';
import type { ContentsEntry } from './model';
import '../studio/Outline.css';

function Mark({ entry }: { entry: ContentsEntry }) {
  if (entry.kind === 'chapter') return <span className="num">{entry.index}</span>;
  const Icon =
    entry.kind === 'summary'
      ? AlignLeft
      : entry.kind === 'figures'
        ? Activity
        : entry.kind === 'checks'
          ? ListChecks
          : Scale;
  return <Icon size={13} strokeWidth={2.2} aria-hidden="true" />;
}

/** The page as a quiet list along a line, the section in view marked by a point that glides between them. */
export function Contents({
  entries,
  activeId,
  onSelect,
}: {
  entries: readonly ContentsEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const id = useId();
  return (
    <nav className="sw-outline sw-rep__contents" aria-label="On this page">
      <ol className="sw-outline__list" role="list">
        {entries.map((entry) => {
          const active = entry.id === activeId;
          return (
            <li key={entry.id}>
              <button
                type="button"
                className={cx('sw-outline__item', active && 'is-active')}
                aria-current={active ? 'location' : undefined}
                onClick={() => onSelect(entry.id)}
              >
                {active && (
                  <m.span
                    layoutId={`${id}-pill`}
                    className="sw-outline__pill"
                    transition={SPRING.snappy}
                    aria-hidden="true"
                  />
                )}
                <span className="sw-outline__node" aria-hidden="true">
                  <Mark entry={entry} />
                </span>
                <span className="sw-outline__title">{entry.label}</span>
                {entry.flag && (
                  <>
                    <span className="sw-outline__marks" aria-hidden="true">
                      <span className="sw-outline__mark sw-outline__mark--earlier">
                        <TriangleAlert size={13} strokeWidth={2.2} />
                      </span>
                    </span>
                    <span className="sr-only">Needs a look</span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** On a narrow screen the contents are one line under the top bar: where you are, a step each way, and the list. */
export function ContentsSwitcher({
  entries,
  activeId,
  onSelect,
}: {
  entries: readonly ContentsEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pending = useRef<string | null>(null);
  const index = Math.max(
    0,
    entries.findIndex((entry) => entry.id === activeId),
  );
  const entry = entries[index];
  if (!entry) return null;
  const previous = entries[index - 1];
  const next = entries[index + 1];
  return (
    <div className="sw-switcher sw-glass">
      <IconButton
        label="Previous section"
        size="sm"
        disabled={!previous}
        onClick={() => previous && onSelect(previous.id)}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </IconButton>
      <Sheet
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          // The sheet returns focus to its button as it closes; the jump waits until it has.
          if (!value && pending.current) {
            const target = pending.current;
            pending.current = null;
            window.setTimeout(() => onSelect(target), 60);
          }
        }}
      >
        <SheetTrigger asChild>
          <button
            type="button"
            className="sw-switcher__open"
            aria-label={`${index + 1} of ${entries.length} ${entry.label}, open the list`}
          >
            <span className="sw-switcher__text">
              <span className="sw-switcher__where num">
                {index + 1} of {entries.length}
              </span>{' '}
              <span className="sw-switcher__title">{entry.label}</span>
            </span>
            <ChevronsUpDown size={16} aria-hidden="true" />
          </button>
        </SheetTrigger>
        <SheetContent title="On this page" width="sm">
          <Contents
            entries={entries}
            activeId={activeId}
            onSelect={(id) => {
              pending.current = id;
              setOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>
      <IconButton
        label="Next section"
        size="sm"
        disabled={!next}
        onClick={() => next && onSelect(next.id)}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
