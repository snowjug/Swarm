import { useId } from 'react';
import { ArrowRight } from 'lucide-react';
import type { ExampleScenario } from '../../../../shared/example-scenarios';
import { exampleEvidence } from '../../lib/product';

/**
 * Starting points for a person who does not yet know what to ask. An example is only a question and
 * some evidence: the scenario, stakeholders and results are made the same way as for any question.
 * With no examples to offer, the fictional starter is still here, so the picker is never empty.
 */
export function ExamplePicker({
  examples,
  disabled,
  onPick,
  onStarter,
}: {
  examples: readonly ExampleScenario[];
  disabled: boolean;
  onPick: (example: ExampleScenario) => void;
  onStarter: () => void;
}) {
  const headingId = useId();
  return (
    <section className="example-picker" aria-labelledby={headingId}>
      <h3 id={headingId}>Not sure what to ask? Try an example</h3>
      <p className="field-help">
        An example fills in a question and its evidence, which you can change. Swarm builds the
        scenario, the stakeholders and the results from them as it does for any question.
      </p>
      <ul className="example-list">
        {examples.map((example) => (
          <li className="example-card" key={example.id}>
            <h4>{example.title}</h4>
            <p>{example.blurb}</p>
            <small className="mono">{exampleEvidence(example)}</small>
            <button
              className="button button-secondary button-small"
              type="button"
              disabled={disabled}
              aria-label={`Use this example: ${example.title}`}
              onClick={() => onPick(example)}
            >
              Use this example <ArrowRight size={13} aria-hidden="true" />
            </button>
          </li>
        ))}
        <li className="example-card example-starter">
          <h4>Fictional library hours</h4>
          <p>A made-up question and notes, for learning the workflow. No real case.</p>
          <small className="mono">1 document · sample evidence</small>
          <button
            className="button button-secondary button-small"
            type="button"
            disabled={disabled}
            onClick={onStarter}
          >
            Load fictional starter input
          </button>
        </li>
      </ul>
    </section>
  );
}
