import { Play } from 'lucide-react';
import type { CounterfactualsView } from '../../../../../shared/constraints';
import { Button, Chip, Disclosure, Notice } from '../../../design/ui';
import { CLASS_WORDS, classTone, viewRowsOf } from './model';

export interface ViewsProps {
  views: CounterfactualsView | null;
  /** The project has actors and constraints, which the views need. */
  ready: boolean;
  canRun: boolean;
  working: boolean;
  onRun: () => void;
}

/**
 * The proposed change run again with one thing different, on the same seeds, so that a difference is the
 * thing's and not the dice's. Each row says how far the simulated share moved, whether that is more than
 * the noise, and what moved it; a view that does not fit the project says why it was not run.
 */
export function Views({ views, ready, canRun, working, onRun }: ViewsProps) {
  const set = views?.counterfactuals ?? null;
  const rows = set ? viewRowsOf(set) : [];
  return (
    <Disclosure
      heading={2}
      summary={
        <span className="sw-views__summary">
          What if one thing were different
          {set ? <Chip size="sm">{rows.length} views</Chip> : null}
        </span>
      }
    >
      <div className="sw-views">
        <p className="sw-read">
          Each view runs the proposed change again with one thing different, on the same seeds. The
          difference is a result of the simulation under the constraints as they stand, not a
          forecast of anything.
        </p>
        {set && !views?.current && (
          <Notice tone="caution" title="Made from earlier constraints">
            The constraints, the actors or the scenario changed after these were run. Run them again
            to describe the project as it is.
          </Notice>
        )}
        {canRun && (
          <div className="sw-views__run">
            <Button
              variant="glass"
              size="sm"
              icon={<Play size={14} aria-hidden="true" />}
              busy={working}
              busyLabel="Running the views"
              disabled={!ready}
              onClick={onRun}
            >
              {set ? 'Run the views again' : 'Run the views'}
            </Button>
            {!ready && (
              <span className="sw-caption">Make the actors and the constraints first.</span>
            )}
          </div>
        )}
        {set && (
          <>
            <p className="sw-caption">
              {set.metric}. Base: “{set.variantLabel}”, with a mean simulated share of{' '}
              {set.baseMean.toFixed(2)}.
            </p>
            <table className="sw-views__table">
              <caption className="sr-only">
                The proposed change under seven different conditions, compared with the base
              </caption>
              <thead>
                <tr>
                  <th scope="col">View</th>
                  <th scope="col">Difference</th>
                  <th scope="col">How much it matters</th>
                  <th scope="col">What moved it</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-applicable={row.applicable}>
                    <th scope="row">
                      <span className="sw-views__label">{row.label}</span>
                      <span className="sw-views__change">{row.change}</span>
                    </th>
                    {row.applicable ? (
                      <>
                        <td data-label="Difference">
                          <span className="sw-numeral sw-views__points">{row.points}</span>
                        </td>
                        <td data-label="How much it matters">
                          {row.classification && (
                            <Chip size="sm" tone={classTone(row.classification)}>
                              {CLASS_WORDS[row.classification]}
                            </Chip>
                          )}
                        </td>
                        <td data-label="What moved it">{row.driver}</td>
                      </>
                    ) : (
                      <td colSpan={3} className="sw-views__why">
                        Not run: {row.reason}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {!set && !canRun && (
          <p className="sw-caption">No views have been run for this project yet.</p>
        )}
      </div>
    </Disclosure>
  );
}
