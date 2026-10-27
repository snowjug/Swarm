import type { ProjectDetail } from '../../../shared/types.js';

/**
 * Returns the last fully persisted simulation round, or null when the saved state is empty or
 * internally inconsistent. A checkpoint is only trusted when the combined history and every
 * platform population agree on the same round, so a resume can never splice mismatched state.
 */
export function readCheckpoint(project: ProjectDetail): number | null {
  const state = project.console;
  if (project.workflow !== 'guided' || !state?.environment) return null;
  const round = project.rounds.length;
  if (round < 1 || round > project.settings.rounds || project.currentRound !== round) return null;
  if (project.rounds.some((snapshot, index) => snapshot.round !== index + 1)) return null;
  const expected = state.environment.platforms;
  if (state.platforms.length !== expected.length) return null;
  const consistent = state.platforms.every(
    (run, index) =>
      run.platform === expected[index] &&
      run.currentRound === round &&
      run.rounds.length === round &&
      run.agents.length === project.agents.length,
  );
  return consistent ? round : null;
}
