import { z } from 'zod';

export const STAKEHOLDER_PROGRESS = ['none', 'proposed', 'approved'] as const;
export const ANALYSIS_PROGRESS = ['none', 'running', 'completed', 'failed'] as const;

/**
 * How far a project has come along the path from a question to a decision brief, read from what it
 * holds: the scenario, the stakeholders and whether a person approved them, the simulated actors made
 * from them, the comparison of scenarios, the critics' review and the brief. The pages use it to tell
 * what can be opened next and to tick the journey. It is a summary of stored documents, not a claim
 * about anything real.
 */
export const labProgressSchema = z.object({
  /** A scenario was settled on in intake. */
  scenario: z.boolean(),
  /** None found yet, a list waiting for a person's review, or a list a person approved. */
  stakeholders: z.enum(STAKEHOLDER_PROGRESS),
  /** How many simulated actors the project has. */
  actors: z.int().min(0),
  /**
   * What the comparison of scenarios is doing, looking from the newest back: one queued or running,
   * or else one that finished, is what counts. Comparisons that stopped without a result are passed
   * over, so a finished one is not forgotten because a later one was cancelled. 'failed' means every
   * comparison there is stopped without one.
   */
  analysis: z.enum(ANALYSIS_PROGRESS),
  /** The critics reviewed the work. */
  critiques: z.boolean(),
  /** A decision brief was written. */
  brief: z.boolean(),
});
export type LabProgress = z.infer<typeof labProgressSchema>;
