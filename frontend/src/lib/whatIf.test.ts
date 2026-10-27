import { describe, expect, it } from 'vitest';
import { checkpointFixture, projectFixture } from '../test/project';
import {
  canBranch,
  canEditIntervention,
  canResume,
  describeChange,
  historyStatus,
  maxBranchRound,
  validateBranch,
  validateIntervention,
} from './whatIf';
import { canExecute, needsPolling } from './console';
import { validateEntry } from './entryValidation';

describe('checkpoint and branch guards', () => {
  it('keeps pause non-error, non-polling and separate from an unconfirmed restart', () => {
    const project = checkpointFixture();
    expect(project.status).toBe('ready');
    expect(needsPolling(project)).toBe(false);
    expect(canExecute(project, 'simulation')).toBe(false);
    expect(canResume(project)).toBe(true);
    expect(historyStatus(project)).toBe('paused');
    expect(canBranch(project)).toBe(true);
  });
  it.each(['failed', 'cancelled'] as const)('recovers %s only with a real checkpoint', (status) => {
    const project = checkpointFixture();
    project.console!.steps.simulation = status;
    project.status = status;
    expect(canResume(project)).toBe(true);
    project.rounds = [];
    expect(canResume(project)).toBe(false);
  });
  it('allows injection only while paused or failed with a checkpoint, and only in future rounds', () => {
    const project = checkpointFixture();
    expect(canEditIntervention(project)).toBe(true);
    expect(
      validateIntervention({ round: 1, label: 'Already passed', stance: 0, strength: 0.5 }, project)
        .error,
    ).toContain('future round');
    expect(
      validateIntervention({ round: 4, label: 'Beyond end', stance: 0, strength: 0.5 }, project)
        .error,
    ).toContain('future round');
    expect(validateIntervention(null, project).data).toBeNull();
    project.console!.steps.simulation = 'cancelled';
    expect(canEditIntervention(project)).toBe(false);
  });
  it('validates branch round bounds, IDs, numeric values and duplicate proxy rows', () => {
    const project = checkpointFixture();
    expect(maxBranchRound(project)).toBe(1);
    expect(validateBranch({ fromRound: 2 }, project).error).toContain('round 0 through 1');
    expect(validateBranch({ fromRound: -1 }, project).error).toBeTruthy();
    expect(
      validateBranch(
        {
          fromRound: 1,
          agentEdits: [
            { id: 'agent-1', influence: 1 },
            { id: 'agent-1', openness: 0.4 },
          ],
        },
        project,
      ).error,
    ).toContain('only once');
    expect(
      validateBranch({ fromRound: 1, agentEdits: [{ id: 'agent-2', influence: 1 }] }, project)
        .error,
    ).toContain('exist');
    expect(
      validateBranch({ fromRound: 1, agentEdits: [{ id: 'agent-1' }] }, project).error,
    ).toContain('must change');
    expect(
      validateBranch({ fromRound: 0, agentEdits: [{ id: 'agent-1', opinion: 2 }] }, project).error,
    ).toBeTruthy();
    expect(
      validateBranch({ fromRound: 0, agentEdits: [{ id: 'agent-1', openness: 0.4 }] }, project)
        .data,
    ).toBeTruthy();
  });
  it('bounds copied rounds below the planned final round and preserves inherit semantics', () => {
    const project = checkpointFixture();
    project.roundCount = 1;
    expect(maxBranchRound(project)).toBe(0);
    const inherited = validateBranch({ fromRound: 0 }, project);
    expect(inherited.data).not.toHaveProperty('intervention');
    expect(validateBranch({ fromRound: 0, intervention: null }, project).data).toHaveProperty(
      'intervention',
      null,
    );
  });
  it('does not silently alter an intervention already present in copied rounds', () => {
    const project = checkpointFixture();
    project.rounds[0]!.intervention = {
      round: 1,
      label: 'Applied synthetic input',
      stance: 0.5,
      strength: 0.2,
    };
    expect(validateBranch({ fromRound: 1, intervention: null }, project).error).toContain(
      'already contain',
    );
    expect(validateBranch({ fromRound: 0, intervention: null }, project).data).toBeTruthy();
  });
  it('humanises only declared changes, without adding causal explanations', () => {
    expect(
      describeChange(
        { kind: 'agent', agentId: 'agent-1', field: 'opinion', from: 0.2, to: 0.4 },
        checkpointFixture(),
      ),
    ).toBe('Test Proxy — inclination: 0.20 → 0.40.');
  });
});

describe('entry inline validation', () => {
  it('reports an empty submission rather than relying on native validation popups', () => {
    const project = projectFixture();
    const result = validateEntry({
      name: '',
      question: '',
      documents: [],
      settings: project.settings,
      workflow: 'guided',
    });
    expect(result.error).toContain('Enter a project name');
    expect(result.error).toContain('Enter a research question');
    expect(result.error).toContain('Attach at least one source document');
    expect(result.data).toBeUndefined();
  });
  it('does not carry an upload error into a new valid submission', () => {
    const project = projectFixture();
    const result = validateEntry({
      name: project.name,
      question: project.question,
      documents: project.documents,
      settings: project.settings,
      workflow: 'guided',
    });
    expect(result.error).toBeUndefined();
    expect(result.data?.workflow).toBe('guided');
  });
});
