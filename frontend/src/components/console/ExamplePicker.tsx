import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, CircleCheck } from 'lucide-react';
import type { ExampleScenario } from '../../../../shared/example-scenarios';
import { exampleEvidence } from '../../lib/product';

/** What has been put into the form from the picker: an example, or the fictional starter. */
export interface LoadedExample {
  kind: 'example' | 'starter';
  title: string;
  /** What came with it, in a line: "5 documents · sample evidence". */
  evidence: string;
}

export const STARTER = {
  title: 'Fictional library hours',
  blurb: 'A made-up question and notes, for learning the workflow. No real case.',
  evidence: '1 document · sample evidence',
} as const;

const LOADED_NOTES = {
  example:
    'The question and evidence came from this example. Read them, change what you like, then build. No results come with an example.',
  starter:
    'This editable input is invented for learning the workflow. No prerecorded outputs or case-study results are included.',
} as const;

/**
 * Starting points for a person who does not yet know what to ask. An example is only a question and
 * some evidence: the scenario, stakeholders and results are made the same way as for any question.
 * With no examples to offer, the fictional starter is still here, so the picker is never empty.
 * Once one has been chosen the cards give way to a line that says which, where the person is looking,
 * and a button that brings the cards back.
 */
export function ExamplePicker({
  examples,
  disabled,
  loaded = null,
  onPick,
  onStarter,
}: {
  examples: readonly ExampleScenario[];
  disabled: boolean;
  loaded?: LoadedExample | null;
  onPick: (example: ExampleScenario) => void;
  onStarter: () => void;
}) {
  const headingId = useId();
  const [changing, setChanging] = useState(false);
  const cards = useRef<HTMLUListElement>(null);
  const change = useRef<HTMLButtonElement>(null);
  const collapsed = loaded !== null && !changing;

  // The button that asked for the cards is gone once they are there: focus goes to the first of them.
  useEffect(() => {
    if (changing) cards.current?.querySelector('button')?.focus();
  }, [changing]);

  const choose = (action: () => void) => {
    setChanging(false);
    action();
  };
  // Keeping the example takes the cards away again, and focus goes back to the button that brought them.
  const keep = () => {
    setChanging(false);
    requestAnimationFrame(() => change.current?.focus());
  };

  return (
    <section className="example-picker" aria-labelledby={headingId}>
      <h3 id={headingId} className={collapsed ? 'sr-only' : undefined}>
        Not sure what to ask? Try an example
      </h3>
      {collapsed ? (
        <div className={`example-loaded example-loaded-${loaded.kind}`}>
          <div className="example-loaded-text" role="status">
            <strong>
              <CircleCheck size={16} aria-hidden="true" />
              {loaded.kind === 'starter'
                ? `Fictional starter INPUT loaded: ${loaded.title}`
                : `Example loaded: ${loaded.title}`}
            </strong>{' '}
            <span>({loaded.evidence})</span>
            <small>{LOADED_NOTES[loaded.kind]}</small>
          </div>
          <button
            ref={change}
            className="button button-secondary button-small"
            type="button"
            disabled={disabled}
            onClick={() => setChanging(true)}
          >
            Change example
          </button>
        </div>
      ) : (
        <>
          <p className="field-help">
            An example fills in a question and its evidence, which you can change. Swarm builds the
            scenario, the stakeholders and the results from them as it does for any question.
          </p>
          <ul className="example-list" ref={cards}>
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
                  onClick={() => choose(() => onPick(example))}
                >
                  Use this example <ArrowRight size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
            <li className="example-card example-starter">
              <h4>{STARTER.title}</h4>
              <p>{STARTER.blurb}</p>
              <small className="mono">{STARTER.evidence}</small>
              <button
                className="button button-secondary button-small"
                type="button"
                disabled={disabled}
                aria-label={`Use this example: ${STARTER.title}`}
                onClick={() => choose(onStarter)}
              >
                Use this example <ArrowRight size={13} aria-hidden="true" />
              </button>
            </li>
          </ul>
          {loaded ? (
            <button className="text-button example-keep" type="button" onClick={keep}>
              Keep “{loaded.title}”
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
