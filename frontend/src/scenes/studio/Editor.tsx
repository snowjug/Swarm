import { useEffect, useRef, useState } from 'react';
import { Eye, PenLine } from 'lucide-react';
import type { StudioSectionView } from '../../../../shared/studio';
import { cx } from '../../design/cx';
import { Button, Notice, Segmented, Textarea } from '../../design/ui';
import { Diff } from './Diff';
import { isDirty, wordCount, type Draft, type DraftState } from './model';
import './Editor.css';

/**
 * The place where a section's text is written. It is the text itself, in the same type, on a surface that
 * lights up while it is being changed: what is written is kept while another section is read, a newer
 * version that someone else saved is said so and never overwritten, and the changes can be read as a
 * comparison before they are saved.
 */
export function Editor({
  section,
  draft,
  state,
  maxBody,
  readOnly,
  autoFocus,
  list,
  onChange,
  onSave,
  onDiscard,
}: {
  section: StudioSectionView;
  draft: Draft;
  state: DraftState;
  maxBody: number;
  /** The document cannot be changed now (someone sent it for review): what was written is kept, not saved. */
  readOnly: boolean;
  autoFocus: boolean;
  list: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const [mode, setMode] = useState<'write' | 'changes'>('write');
  const field = useRef<HTMLTextAreaElement>(null);
  const dirty = isDirty(draft);
  const length = draft.text.length;
  const near = length >= maxBody * 0.9;

  useEffect(() => {
    if (autoFocus) field.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  // Nothing to compare once nothing differs.
  useEffect(() => {
    if (!dirty) setMode('write');
  }, [dirty]);

  return (
    <div className={cx('sw-edit', state === 'behind' && 'is-behind', readOnly && 'is-readonly')}>
      <div className="sw-edit__head">
        <Segmented
          size="sm"
          label="Editor view"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'write', label: 'Write', icon: <PenLine size={14} aria-hidden="true" /> },
            {
              value: 'changes',
              label: 'Changes',
              icon: <Eye size={14} aria-hidden="true" />,
              disabled: !dirty,
            },
          ]}
        />
        <p className={cx('sw-edit__count num', near && 'is-near')} aria-live="off">
          {wordCount(draft.text).toLocaleString('en-GB')} words · {length.toLocaleString('en-GB')}{' '}
          of {maxBody.toLocaleString('en-GB')}
        </p>
      </div>

      {state === 'behind' && (
        <Notice
          tone="caution"
          title={`Version ${section.version} was saved while you were writing`}
          action={
            <div className="sw-edit__fix">
              <Button size="sm" variant="glass" onClick={() => setMode('changes')}>
                See the differences
              </Button>
              <Button size="sm" variant="ghost" onClick={onDiscard}>
                Drop mine
              </Button>
            </div>
          }
        >
          Your words are kept. Saving now makes a new version on top of it; the other version stays
          in the history.
        </Notice>
      )}
      {readOnly && (
        <Notice tone="info">
          The report can no longer be changed, so what you wrote cannot be saved. It is kept here.
        </Notice>
      )}

      {mode === 'write' ? (
        <Textarea
          ref={field}
          bare
          maxRows={80}
          className={cx('sw-edit__field sw-studio-prose', list && 'sw-edit__field--list')}
          aria-label={`Text of ${section.title}`}
          value={draft.text}
          maxLength={maxBody}
          readOnly={readOnly}
          spellCheck
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              onSave();
            } else if (event.key === 'Escape' && !dirty) {
              event.preventDefault();
              onDiscard();
            }
          }}
        />
      ) : (
        <Diff before={section.body} after={draft.text} />
      )}
    </div>
  );
}
