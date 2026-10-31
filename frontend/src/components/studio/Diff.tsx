import { diffCounts, diffWords } from '../../lib/studio';

/**
 * What changed between two texts, in the words themselves: added text is underlined and marked,
 * removed text is struck through and marked, and a screen reader is told which is which, so that
 * colour is never the only cue.
 */
export function Diff({ before, after }: { before: string; after: string }) {
  const parts = diffWords(before, after);
  const { added, removed } = diffCounts(parts);
  return (
    <div className="studio-diff">
      <p className="field-help">
        {added} {added === 1 ? 'word' : 'words'} added, {removed} removed.
      </p>
      <div className="studio-diff-text preserve-text">
        {parts.map((part, index) =>
          part.kind === 'same' ? (
            <span key={index}>{part.text}</span>
          ) : part.kind === 'added' ? (
            <ins key={index}>
              <span className="sr-only">[added: </span>
              {part.text}
              <span className="sr-only">]</span>
            </ins>
          ) : (
            <del key={index}>
              <span className="sr-only">[removed: </span>
              {part.text}
              <span className="sr-only">]</span>
            </del>
          ),
        )}
      </div>
    </div>
  );
}
