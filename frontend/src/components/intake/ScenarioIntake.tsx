import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ScenarioFrame, ScenarioReadMode } from '../../../../shared/scenario';
import { useScenarioReading } from '../../hooks/useScenarioReading';
import { canRead, documentSummaries, frameIssues, tidyFrame } from '../../lib/intake';
import { IntakeSummary } from './IntakeParts';
import { IntakePrompt } from './IntakePrompt';
import { IntakeReview } from './IntakeReview';

export interface ScenarioIntakeProps {
  /** The question as the person has written it so far. */
  question: string;
  /** The structure read from the question, which the person may edit. Null until it has been read. */
  frame: ScenarioFrame | null;
  onFrame: (frame: ScenarioFrame | null) => void;
  disabled: boolean;
  /**
   * The documents attached so far, if the page has them. Only their names and sizes are listed as
   * evidence, and the start of each is checked for text aimed at an AI; none is stored or kept.
   */
  documents?: readonly { name: string; content: string }[];
}

interface Reading {
  notes: string[];
  mode: ScenarioReadMode;
  model: string | null;
  /** The question it was read from. */
  question: string;
  /** The frame that was handed on, so that the notes are only shown beside the frame they belong to. */
  used: ScenarioFrame | null;
}

/**
 * Turns an ordinary what-if question into an editable scenario. It is optional at every step: the
 * person asks for a reading, edits what came back, and either uses it or does not. Nothing is sent
 * until they ask, and nothing is kept until they say so.
 */
export function ScenarioIntake({
  question,
  frame,
  onFrame,
  disabled,
  documents = [],
}: ScenarioIntakeProps) {
  const reading = useScenarioReading();
  const [draft, setDraft] = useState<ScenarioFrame | null>(null);
  const [last, setLast] = useState<Reading | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const asked = question.trim();
  const stale = last !== null && last.question !== asked;
  const notes = last !== null && (draft !== null || last.used === frame) ? last : null;

  const read = async () => {
    const result = await reading.read(asked, documentSummaries(documents));
    if (!result) return;
    setDraft(result.frame);
    setLast({
      notes: result.notes,
      mode: result.mode,
      model: result.model,
      question: asked,
      used: null,
    });
    setProblems([]);
  };

  const use = () => {
    if (!draft) return;
    const tidy = tidyFrame(draft);
    const found = frameIssues(tidy);
    if (found.length > 0) {
      setProblems(found);
      return;
    }
    setProblems([]);
    setDraft(null);
    setLast((old) => (old ? { ...old, used: tidy } : old));
    onFrame(tidy);
  };

  const discard = () => {
    setDraft(null);
    setProblems([]);
  };

  const remove = () => {
    setLast(null);
    onFrame(null);
  };

  // Enter in a text box would otherwise submit the form this sits in, and create the experiment.
  const keepFormFromSubmitting = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
  };

  return (
    <section className="intake" aria-label="Scenario" onKeyDown={keepFormFromSubmitting}>
      {draft ? (
        <IntakeReview
          frame={draft}
          mode={notes?.mode ?? null}
          model={notes?.model ?? null}
          notes={notes?.notes ?? []}
          stale={stale}
          problems={problems}
          disabled={disabled}
          onChange={setDraft}
          onUse={use}
          onDiscard={discard}
        />
      ) : frame ? (
        <IntakeSummary
          frame={frame}
          stale={stale}
          disabled={disabled}
          onEdit={() => {
            // Notes that were made for another scenario do not describe this one.
            if (last !== null && last.used !== frame) setLast(null);
            setDraft(frame);
            setProblems([]);
          }}
          onRemove={remove}
        />
      ) : (
        <IntakePrompt
          ready={canRead(question)}
          reading={reading.reading}
          error={reading.error}
          disabled={disabled}
          onRead={() => void read()}
          onCancel={reading.cancel}
        />
      )}
    </section>
  );
}
