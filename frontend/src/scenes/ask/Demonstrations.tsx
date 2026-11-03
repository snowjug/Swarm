import { useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { DemoProject } from '../../../../shared/demo';
import { Button } from '../../design/ui';
import {
  exampleLabel,
  OFFERED_EXAMPLES,
  startingFromExample,
  startingFromStarter,
  STARTER,
} from './examples';
import type { Starting } from './examples';
import { Surface } from './Surface';
import './Demonstrations.css';

/**
 * The way in for a person who wants to see the whole thing before writing anything: a recorded demonstration, when
 * this workspace holds one, and the sample cases, which are a question with invented evidence. It is one quiet
 * link, and it says what is behind it: it does not call a sample case a recording, nor offer a recording that is
 * not there.
 */
export function Demonstrations({
  recording,
  disabled,
  onRecording,
  onSample,
  onFocusQuestion,
}: {
  recording: DemoProject | null;
  disabled: boolean;
  onRecording: () => void;
  onSample: (starting: Starting) => void;
  /** Where focus goes once a sample case has filled the question. */
  onFocusQuestion: () => void;
}) {
  const [open, setOpen] = useState(false);
  const picked = useRef(false);
  const label = recording ? 'Try a recorded demonstration' : 'Try a sample case';
  const pick = (starting: Starting) => {
    picked.current = true;
    onSample(starting);
    setOpen(false);
  };
  return (
    <Surface
      title={label}
      width="26rem"
      open={open}
      onOpenChange={setOpen}
      onCloseAutoFocus={(event) => {
        if (!picked.current) return;
        picked.current = false;
        event.preventDefault();
        onFocusQuestion();
      }}
      trigger={
        <button type="button" className="sw-ask-foot__link" disabled={disabled}>
          {label}
        </button>
      }
    >
      <div className="sw-ask-demo">
        {recording && (
          <section className="sw-ask-demo__group" aria-labelledby="sw-ask-demo-recording">
            <h3 id="sw-ask-demo-recording" className="sw-eyebrow">
              Recorded demonstration
            </h3>
            <p className="sw-caption">
              {recording.title}. A fictional island ferry, recorded with a real model. Nothing in it
              describes a real place.
            </p>
            <Button
              size="sm"
              variant="glass"
              iconEnd={<ArrowRight size={14} aria-hidden="true" />}
              onClick={() => {
                setOpen(false);
                onRecording();
              }}
            >
              Open the recording
            </Button>
          </section>
        )}
        <section className="sw-ask-demo__group" aria-labelledby="sw-ask-demo-samples">
          <h3 id="sw-ask-demo-samples" className="sw-eyebrow">
            Sample cases
          </h3>
          <p className="sw-caption">
            A question with invented evidence, to see the whole flow. None of it describes a real
            case.
          </p>
          <ul className="sw-ask-demo__list" role="list">
            {[
              ...OFFERED_EXAMPLES.map((example) => ({
                id: example.id,
                label: exampleLabel(example),
                blurb: example.blurb,
                starting: () => startingFromExample(example),
              })),
              {
                id: STARTER.id,
                label: STARTER.label,
                blurb: STARTER.blurb,
                starting: startingFromStarter,
              },
            ].map((sample) => (
              <li key={sample.id} className="sw-ask-demo__item">
                <button
                  type="button"
                  className="sw-ask-demo__pick"
                  aria-describedby={`sw-ask-demo-${sample.id}`}
                  onClick={() => pick(sample.starting())}
                >
                  <span>{sample.label}</span>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
                <span id={`sw-ask-demo-${sample.id}`} className="sw-caption">
                  {sample.blurb}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Surface>
  );
}
