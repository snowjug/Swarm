import type { Analysis } from '../../../../shared/analysis';
import { Sheet, SheetContent } from '../../design/ui';
import { listText, plural, seedsText } from './format';
import './method.css';

/**
 * How the comparison was made and what its numbers are, in plain words, one press from anywhere on the page.
 * What is particular to this comparison (how many scenarios, runs and rounds, which seeds) is read from it;
 * what is true of every comparison is said once.
 */
export function MethodSheet({
  open,
  onOpenChange,
  analysis,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analysis: Analysis;
}) {
  const { runsPerVariant, baseSeed, rounds, variants, sensitivity } = analysis.config;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        eyebrow="Compare"
        title="Method"
        description="How these futures were made, and what the numbers are."
        width="md"
      >
        <div className="sw-cmp-method">
          <section>
            <h3>What was run</h3>
            <p>
              {variants.length} {plural(variants.length, 'scenario')}:{' '}
              {listText(variants.map((variant) => variant.label))}. Each was simulated{' '}
              {runsPerVariant} times over {rounds} rounds, with{' '}
              {seedsText(baseSeed, runsPerVariant)} used for every scenario.
            </p>
          </section>
          <section>
            <h3>Why the seeds are shared</h3>
            <p>
              A run of the change and the run of the baseline with the same seed share their
              randomness, so what differs between them is the change, not two unrelated draws.
            </p>
          </section>
          <section>
            <h3>What the spread is</h3>
            <p>
              A bar or band spans the 10th to the 90th percentile of the seeded runs: the middle 80%
              of them. The mark inside it is their average.
            </p>
          </section>
          <section>
            <h3>What “repeatable” means</h3>
            <p>
              A finding is a statement that is true of a run or not. It is repeatable when even the
              cautious end of its 95% interval is four runs in five. That describes how steady it is
              under the simulation’s own randomness. It is not a likelihood of anything in the
              world.
            </p>
          </section>
          <section>
            <h3>What the result depends on</h3>
            <p>
              {sensitivity
                ? 'Each assumption is moved on its own, on the same seeds, and the headline is compared with the unmoved run. It shows what the result leans on. It is not a measure of uncertainty, and assumptions moved together were not explored.'
                : 'Sensitivity was turned off for this comparison, so how far the result depends on its assumptions has not been tested.'}
            </p>
          </section>
          <section>
            <h3>What the counts are</h3>
            <p>
              Counts are of simulated members and seeded runs. Actors are synthetic stand-ins, and
              the sizes they stand for are assumptions. Stance runs from −1 (clearly against) to +1
              (clearly in favour).
            </p>
          </section>
          <section>
            <h3>{analysis.fidelity.label}</h3>
            <ul>
              {analysis.fidelity.caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
