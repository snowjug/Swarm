import type { ScenarioFrame } from '../../../../shared/scenario';

export interface ScenarioIntakeProps {
  /** The question as the person has written it so far. */
  question: string;
  /** The structure read from the question, which the person may edit. Null until it has been read. */
  frame: ScenarioFrame | null;
  onFrame: (frame: ScenarioFrame | null) => void;
  disabled: boolean;
}

/** Turns an ordinary what-if question into an editable scenario. Replaced by the intake feature. */
export function ScenarioIntake(_props: ScenarioIntakeProps) {
  return null;
}
