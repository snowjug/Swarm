import { Save } from 'lucide-react';
import { Button } from '../../design/ui';

/**
 * Where the pill gives way to the strip of a party (below 64rem), the changes that have not been saved are said and
 * saved where they were made: in the strip, and in the sheet that opens from it.
 */
export function UnsavedBar({
  count,
  invalid,
  onSave,
  onDiscard,
}: {
  count: number;
  invalid: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="sw-held" role="group" aria-label="Unsaved changes">
      <p className="sw-held__text">
        <span className="sw-held__main">
          <strong>{count}</strong> {count === 1 ? 'actor' : 'actors'} changed
        </span>
        <span className="sw-held__sub">Not saved yet</span>
      </p>
      <div className="sw-held__buttons">
        <Button variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
        <Button
          variant="primary"
          icon={<Save size={16} aria-hidden="true" />}
          onClick={onSave}
          disabled={invalid}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
