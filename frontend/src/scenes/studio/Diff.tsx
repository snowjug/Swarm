import { Fragment, useMemo } from 'react';
import { cx } from '../../design/cx';
import { diffCounts, diffWords } from '../../lib/studio';
import { plural, splitEdges } from './model';
import './Diff.css';

/**
 * What changed between two texts, in the words themselves: added text is underlined, removed text is
 * struck through, and a screen reader is told which is which, so that colour is never the only cue.
 * The text is only ever rendered as text.
 */
export function Diff({
  before,
  after,
  className,
  quiet = false,
}: {
  before: string;
  after: string;
  className?: string;
  /** Leave out the count line, where the page says it already. */
  quiet?: boolean;
}) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  const { added, removed } = useMemo(() => diffCounts(parts), [parts]);
  return (
    <div className={cx('sw-diff', className)}>
      {!quiet && (
        <p className="sw-diff__count num">
          <span className="sw-diff__stat sw-diff__stat--add">+{added}</span>
          <span className="sw-diff__stat sw-diff__stat--del">−{removed}</span>
          <span className="sw-diff__unit">
            {added + removed === 0
              ? 'No words changed'
              : `${plural(added, 'word')} added, ${removed} removed`}
          </span>
        </p>
      )}
      <div className="sw-diff__text sw-studio-prose">
        {parts.map((part, index) => {
          if (part.kind === 'same') return <span key={index}>{part.text}</span>;
          // The white space at the ends of a change stays plain, so that a highlight never covers a line break.
          const { lead, core, trail } = splitEdges(part.text);
          if (!core) return <span key={index}>{part.text}</span>;
          const added = part.kind === 'added';
          const Mark = added ? 'ins' : 'del';
          return (
            <Fragment key={index}>
              {lead}
              <Mark className={added ? 'sw-diff__ins' : 'sw-diff__del'}>
                <span className="sr-only">{added ? '[added: ' : '[removed: '}</span>
                {core}
                <span className="sr-only">]</span>
              </Mark>
              {trail}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
