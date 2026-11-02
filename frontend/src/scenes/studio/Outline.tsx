import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { m } from 'motion/react';
import { AlignLeft, ChevronLeft, ChevronRight, ChevronsUpDown, Scale } from 'lucide-react';
import type { StudioSectionView } from '../../../../shared/studio';
import { cx } from '../../design/cx';
import { SPRING } from '../../design/motion';
import { IconButton, Sheet, SheetContent, SheetTrigger } from '../../design/ui';
import { MARK_ICONS } from './glyphs';
import {
  authorship,
  chapterNumber,
  describeMarks,
  isDirty,
  neighbour,
  plural,
  sectionMarks,
  type Draft,
} from './model';
import './Outline.css';

/** The first glyph of a section in the outline: its chapter number, or a mark for the summary and the limitations. */
function Index({ section }: { section: StudioSectionView }) {
  if (section.kind === 'summary')
    return <AlignLeft size={13} strokeWidth={2.2} aria-hidden="true" />;
  if (section.kind === 'limitations')
    return <Scale size={13} strokeWidth={2.2} aria-hidden="true" />;
  return <span className="num">{chapterNumber(section) ?? '·'}</span>;
}

/** How much of the text each kind of author wrote: a hairline cut in three, with the words under it. */
function Authorship({ sections }: { sections: readonly StudioSectionView[] }) {
  const { generated, human, regenerated, total } = authorship(sections);
  if (total === 0) return null;
  const parts = [
    { key: 'generated', count: generated, label: 'generated' },
    { key: 'human', count: human, label: human === 1 ? 'by a person' : 'by people' },
    { key: 'regenerated', count: regenerated, label: 'rewritten' },
  ].filter((part) => part.count > 0);
  return (
    <div className="sw-outline__authors">
      <div
        className="sw-outline__authorbar"
        role="img"
        aria-label={`Who wrote the text: ${parts.map((part) => `${part.count} ${part.label}`).join(', ')}`}
      >
        {parts.map((part) => (
          <span
            key={part.key}
            className={`sw-outline__author sw-outline__author--${part.key}`}
            style={{ flexGrow: part.count }}
          />
        ))}
      </div>
      <p className="sw-outline__authortext">
        {parts.map((part, index) => (
          <span key={part.key}>
            {index > 0 && ' · '}
            <span className="num">{part.count}</span> {part.label}
          </span>
        ))}
      </p>
    </div>
  );
}

/**
 * The sections of the report as a quiet list along a line, the one in view marked by a point that
 * glides between them. Each says what a reader should know before opening it; arrows move through them.
 */
export function Outline({
  sections,
  selectedId,
  onSelect,
  drafts,
  showAuthorship = true,
}: {
  sections: readonly StudioSectionView[];
  selectedId: string;
  onSelect: (id: string) => void;
  drafts: Readonly<Record<string, Draft | undefined>>;
  showAuthorship?: boolean;
}) {
  const id = useId();
  const list = useRef<HTMLOListElement>(null);

  const arrows = (event: KeyboardEvent<HTMLOListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const at = buttons.findIndex((button) => button === document.activeElement);
    const next = buttons[at + (event.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
    next.click();
  };

  return (
    <nav className="sw-outline" aria-label="Report sections">
      <ol className="sw-outline__list" role="list" ref={list} onKeyDown={arrows}>
        {sections.map((section) => {
          const marks = sectionMarks(section, { unsaved: isDirty(drafts[section.id]) });
          const active = section.id === selectedId;
          return (
            <li key={section.id}>
              <button
                type="button"
                className={cx('sw-outline__item', active && 'is-active')}
                aria-current={active ? 'true' : undefined}
                onClick={() => onSelect(section.id)}
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
                  <Index section={section} />
                </span>
                <span className="sw-outline__title">{section.title}</span>
                {marks.length > 0 && (
                  <span className="sw-outline__marks" aria-hidden="true">
                    {marks.slice(0, 3).map((mark) => {
                      const Icon = MARK_ICONS[mark.kind];
                      return (
                        <span
                          key={mark.kind}
                          className={`sw-outline__mark sw-outline__mark--${mark.kind}`}
                        >
                          <Icon size={13} strokeWidth={2.2} />
                        </span>
                      );
                    })}
                  </span>
                )}
                {marks.length > 0 && <span className="sr-only">{describeMarks(marks)}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {showAuthorship && <Authorship sections={sections} />}
    </nav>
  );
}

/**
 * On a narrow screen the outline is one line under the top bar: where you are, a step each way, and a
 * press that opens the whole list from below.
 */
export function SectionSwitcher({
  sections,
  selectedId,
  onSelect,
  drafts,
}: {
  sections: readonly StudioSectionView[];
  selectedId: string;
  onSelect: (id: string) => void;
  drafts: Readonly<Record<string, Draft | undefined>>;
}) {
  const [open, setOpen] = useState(false);
  const index = sections.findIndex((section) => section.id === selectedId);
  const section = sections[index];
  const previous = neighbour(sections, selectedId, -1);
  const next = neighbour(sections, selectedId, 1);
  if (!section) return null;
  return (
    <div className="sw-switcher sw-glass">
      <IconButton
        label="Previous section"
        size="sm"
        disabled={!previous}
        onClick={() => previous && onSelect(previous)}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </IconButton>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            className="sw-switcher__open"
            aria-label={`${index + 1} of ${plural(sections.length, 'section')} ${section.title}, open the list`}
          >
            <span className="sw-switcher__text">
              <span className="sw-switcher__where num">
                {index + 1} of {plural(sections.length, 'section')}
              </span>{' '}
              <span className="sw-switcher__title">{section.title}</span>
            </span>
            <ChevronsUpDown size={16} aria-hidden="true" />
          </button>
        </SheetTrigger>
        <SheetContent title="Sections" width="sm">
          <Outline
            sections={sections}
            selectedId={selectedId}
            drafts={drafts}
            onSelect={(id) => {
              onSelect(id);
              setOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>
      <IconButton
        label="Next section"
        size="sm"
        disabled={!next}
        onClick={() => next && onSelect(next)}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
