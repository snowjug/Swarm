import { useId, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { MessageSquarePlus } from 'lucide-react';
import type { StudioSectionView } from '../../../../shared/studio';
import { SPRING } from '../../design/motion';
import { Button, Textarea } from '../../design/ui';
import { dateTime } from '../../lib/format';
import { actorLabel } from '../../lib/studio';
import './Notes.css';

/**
 * What reviewers said about a section, oldest first, and where a reviewer says more. A note is kept with the
 * section; it changes no text and does not disturb an approval, so it is allowed in every state.
 */
export function Notes({
  section,
  canNote,
  maxNote,
  saving,
  onAdd,
}: {
  section: StudioSectionView;
  canNote: boolean;
  maxNote: number;
  saving: boolean;
  onAdd: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const id = useId();
  const ready = text.trim().length > 0;

  const submit = () => {
    if (!ready || saving) return;
    void onAdd(text.trim()).then((made) => {
      if (made) setText('');
    });
  };

  return (
    <div className="sw-notes">
      {section.notes.length === 0 ? (
        <p className="sw-tool__empty">
          {canNote
            ? 'No one has left a note on this section yet.'
            : 'Reviewers leave their notes here. There are none yet.'}
        </p>
      ) : (
        <ul className="sw-notes__list" role="list">
          <AnimatePresence initial={false}>
            {section.notes.map((note) => (
              <m.li
                key={note.id}
                className="sw-note"
                layout="position"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={SPRING.smooth}
              >
                <p className="sw-note__text">{note.text}</p>
                <p className="sw-note__meta">
                  {actorLabel(note.actor)} · {dateTime(note.at)}
                </p>
              </m.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {canNote && (
        <form
          className="sw-notes__form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label htmlFor={id} className="sr-only">
            Add a note for the author
          </label>
          <Textarea
            id={id}
            maxRows={7}
            maxLength={maxNote}
            value={text}
            placeholder="Add a note for the author"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="sw-notes__foot">
            <p className="sw-caption">
              Kept with the section for good: it cannot be edited or removed.
            </p>
            <Button
              type="submit"
              size="sm"
              variant="glass"
              icon={<MessageSquarePlus size={15} aria-hidden="true" />}
              busy={saving}
              busyLabel="Adding"
              disabled={!ready}
            >
              Add note
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
