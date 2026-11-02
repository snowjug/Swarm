import { AnimatePresence, m } from 'motion/react';
import { SPRING } from '../../../design/motion';
import { Button } from '../../../design/ui';
import { useDeep } from './context';
import { plural } from './model';
import './save.css';

/**
 * The bar that appears while the setup has edits that are not saved: what is pending, anything still to fix,
 * and the two things to do about it. It floats, because the page under it scrolls and the edits are anywhere on it.
 */
export function SaveBar() {
  const { environment } = useDeep();
  const total = environment.changes?.total ?? 0;
  const fixes = Object.keys(environment.check?.fields ?? {}).length;
  const open = environment.editable && total > 0;
  return (
    <AnimatePresence>
      {open && (
        <m.div
          key="save"
          className="sw-deep-save sw-glass sw-glass--overlay"
          role="region"
          aria-label="Unsaved changes to the setup"
          initial={{ opacity: 0, y: 28, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, transition: { duration: 0.14 } }}
          transition={SPRING.snappy}
        >
          <p className="sw-deep-save__text" role="status">
            <strong>{plural(total, 'change')}</strong> not saved
            {fixes > 0 && (
              <span className="sw-deep-save__fix"> · {plural(fixes, 'thing')} to fix</span>
            )}
          </p>
          {environment.error && (
            <p className="sw-deep-save__error" role="alert">
              {environment.error}
            </p>
          )}
          <div className="sw-deep-save__actions">
            <Button
              variant="ghost"
              size="sm"
              disabled={environment.saving}
              onClick={environment.discard}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              size="sm"
              busy={environment.saving}
              busyLabel="Saving"
              disabled={fixes > 0}
              onClick={() => void environment.save()}
            >
              Save the setup
            </Button>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
