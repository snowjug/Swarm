import { rateOf, type Rate } from './measure-stats.js';

/** What became of one model task, in terms that do not depend on which stage it was. */
export interface TaskOutcome {
  /** The provider produced a reply (even a bad one). False for a refusal or an outage. */
  answered: boolean;
  /** A reply passed the strict schema and the server's own checks, on the first reply or on the correction. */
  accepted: boolean;
  /** It took the one correction round. */
  corrected: boolean;
  /** Rules answered after the model's reply could not be used. */
  fellBack: boolean;
  /** For a rules answer: it passed the same schema and checks as a model's reply. */
  fallbackValid: boolean | null;
}

export interface TaskScores {
  /** Of the tasks that were asked and answered: reply valid on the first reply or the correction. */
  schemaValid: Rate;
  firstReplyValid: Rate;
  corrected: Rate;
  fellBack: Rate;
  /** Of the rules answers: valid by the shared schema and checks. */
  rulesAnswerValid: Rate;
}

export function scoreTasks(outcomes: readonly TaskOutcome[]): TaskScores {
  const answered = outcomes.filter((outcome) => outcome.answered);
  const accepted = answered.filter((outcome) => outcome.accepted);
  const rules = outcomes.filter((outcome) => outcome.fellBack);
  return {
    schemaValid: rateOf(accepted.length, answered.length),
    firstReplyValid: rateOf(
      accepted.filter((outcome) => !outcome.corrected).length,
      answered.length,
    ),
    corrected: rateOf(accepted.filter((outcome) => outcome.corrected).length, answered.length),
    fellBack: rateOf(rules.length, answered.length),
    rulesAnswerValid: rateOf(
      rules.filter((outcome) => outcome.fallbackValid === true).length,
      rules.length,
    ),
  };
}
