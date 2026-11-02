import { describe, expect, it } from 'vitest';
import { checkpointFixture } from '../../../test/project';
import { deepFixture } from './fixture';
import { environmentInput } from './model';
import {
  appliedRound,
  branchInput,
  branchSummary,
  checkBranch,
  checkEnvironment,
  checkIntervention,
  checkScheduled,
  startingBranch,
  startingIntervention,
  type BranchDraft,
} from './validation';

const prepared = () => deepFixture({ simulation: 'pending', saved: 0 });

describe('checking the environment as it is edited', () => {
  it('accepts what was saved', () => {
    const project = prepared();
    const check = checkEnvironment(environmentInput(project)!, project);
    expect(check.ok).toBe(true);
    expect(check.data?.agents).toHaveLength(4);
  });

  it('says what is wrong in the field it is wrong in, with the limit, not a schema message', () => {
    const project = prepared();
    const draft = environmentInput(project)!;
    draft.minutesPerRound = 500;
    draft.agents = draft.agents.map((agent, index) =>
      index === 2 ? { ...agent, name: 'ab', persona: 'too short', influence: 5 } : agent,
    );
    draft.initialPosts = draft.initialPosts.map((post) => ({ ...post, stance: 3 }));
    const { fields, ok } = checkEnvironment(draft, project);
    expect(ok).toBe(false);
    expect(fields.minutesPerRound).toBe('Use a whole number from 5 to 180.');
    expect(fields['agents.2.name']).toBe('Use 3 to 100 characters.');
    expect(fields['agents.2.persona']).toBe('Use 30 to 700 characters.');
    expect(fields['agents.2.influence']).toBe('Use a number from 0.1 to 2.');
    expect(fields['initialPosts.0.stance']).toBe('Use a number from \u22121 to 1.');
    expect(JSON.stringify(fields)).not.toContain('Too ');
  });

  it('asks for at least one platform and a number where there is none', () => {
    const project = prepared();
    const draft = environmentInput(project)!;
    const check = checkEnvironment({ ...draft, platforms: [], rounds: Number.NaN }, project);
    expect(check.fields.platforms).toBe('Run at least one platform.');
    expect(check.fields.rounds).toBe('Enter a number.');
  });

  it('holds a model run to ten rounds', () => {
    const project = deepFixture({ simulation: 'pending', saved: 0, mode: 'llm' });
    const check = checkEnvironment({ ...environmentInput(project)!, rounds: 12 }, project);
    expect(check.fields.rounds).toBe('This mode supports at most 10 rounds.');
  });
});

describe('checking a scheduled intervention', () => {
  const bounds = { minRound: 3, maxRound: 6 };
  const good = { round: 4, label: 'A new rule is announced.', stance: -0.4, strength: 0.6 };

  it('accepts an event in a future round with a label and in-range numbers', () => {
    expect(checkIntervention(good, bounds)).toEqual({ ok: true, fields: {} });
  });

  it('flags each field on its own', () => {
    const { fields } = checkIntervention(
      { round: 2, label: 'no', stance: 2, strength: -1 },
      bounds,
    );
    expect(fields.round).toBe('Choose a round from 3 to 6.');
    expect(fields.label).toBe('Describe the event in 5 to 300 characters.');
    expect(fields.stance).toBe('Use a number from \u22121 to 1.');
    expect(fields.strength).toBe('Use a number from 0 to 1.');
  });

  it('says so when there is no round left', () => {
    expect(checkIntervention(good, { minRound: 7, maxRound: 6 }).fields.form).toBe(
      'There is no round left to schedule it in.',
    );
  });

  it('gates the final request on the project’s own saved round', () => {
    const project = checkpointFixture();
    project.roundCount = 3;
    const start = startingIntervention(project);
    expect(start.round).toBe(2);
    const ok = checkScheduled({ ...start, label: 'A scheduled assumption.' }, project);
    expect(ok.ok).toBe(true);
    expect(ok.data).toEqual({
      round: 2,
      label: 'A scheduled assumption.',
      stance: 0,
      strength: 0.5,
    });
    expect(
      checkScheduled({ ...start, label: 'A scheduled assumption.', round: 1 }, project).ok,
    ).toBe(false);
  });

  it('starts from the schedule that is recorded, kept in the future', () => {
    const project = checkpointFixture();
    project.roundCount = 5;
    project.settings = {
      ...project.settings,
      intervention: {
        round: 4,
        label: 'An event that is already planned.',
        stance: 0.5,
        strength: 0.3,
      },
    };
    expect(startingIntervention(project)).toMatchObject({ round: 4, stance: 0.5, strength: 0.3 });
  });
});

describe('checking a branch', () => {
  const project = deepFixture({ rounds: 6, saved: 4, simulation: 'paused' });
  const draft = (patch: Partial<BranchDraft> = {}): BranchDraft => ({
    ...startingBranch(project, 2),
    ...patch,
  });

  it('starts at the last checkpoint, or the one asked for', () => {
    expect(startingBranch(project).fromRound).toBe(4);
    expect(startingBranch(project, 2)).toMatchObject({
      fromRound: 2,
      choice: 'inherit',
      edits: [],
    });
    expect(startingBranch(project, 99).fromRound).toBe(4);
  });

  it('accepts an inherited schedule with no edits, and sends no name when it is blank', () => {
    const check = checkBranch(draft({ name: '   ' }), project);
    expect(check.ok).toBe(true);
    expect(check.input).toEqual({ fromRound: 2, agentEdits: [] });
  });

  it('sends null to remove the schedule and the event to replace it', () => {
    expect(branchInput(draft({ choice: 'remove' })).intervention).toBeNull();
    const replaced = branchInput(
      draft({
        choice: 'replace',
        intervention: { round: 3, label: ' A new event. ', stance: 0.2, strength: 0.4 },
      }),
    );
    expect(replaced.intervention).toEqual({
      round: 3,
      label: 'A new event.',
      stance: 0.2,
      strength: 0.4,
    });
  });

  it('flags a checkpoint beyond what was saved and a name that is too short', () => {
    const { fields } = checkBranch(draft({ fromRound: 9, name: 'ab' }), project);
    expect(fields.fromRound).toBe('Choose a checkpoint from round 0 to 4.');
    expect(fields.name).toBe('A name is 3 to 100 characters, or leave it blank.');
  });

  it('flags a replacement event that is not after the checkpoint, field by field', () => {
    const { fields } = checkBranch(
      draft({ choice: 'replace', intervention: { round: 2, label: '', stance: 0, strength: 0.5 } }),
      project,
    );
    expect(fields['intervention.round']).toBe('Choose a round from 3 to 6.');
    expect(fields['intervention.label']).toBe('Describe the event in 5 to 300 characters.');
  });

  it('will not remove or replace an event that is already inside the copied rounds', () => {
    const event = { round: 2, label: 'An event that was applied.', stance: -0.3, strength: 0.5 };
    const run = deepFixture({ rounds: 6, saved: 4, simulation: 'paused', event });
    expect(appliedRound(run)).toBe(2);
    const blocked = checkBranch({ ...startingBranch(run, 3), choice: 'remove' }, run);
    expect(blocked.ok).toBe(false);
    expect(blocked.fields.choice).toContain('Round 2 already applied');
    expect(checkBranch({ ...startingBranch(run, 3), choice: 'inherit' }, run).ok).toBe(true);
    expect(checkBranch({ ...startingBranch(run, 1), choice: 'remove' }, run).ok).toBe(true);
  });

  it('checks each proxy edit: it must exist, change something, stay in range and appear once', () => {
    const { fields } = checkBranch(
      draft({
        edits: [
          { id: 'agent-9', opinion: 0.1 },
          { id: 'agent-1' },
          { id: 'agent-2', influence: 5, openness: 0.4 },
          { id: 'agent-2', opinion: 0.2 },
        ],
      }),
      project,
    );
    expect(fields['edit.0']).toBe('Choose a proxy from this run.');
    expect(fields['edit.1']).toBe('Change at least one of influence, openness or inclination.');
    expect(fields['edit.2.influence']).toBe('Use a number from 0.1 to 2.');
    expect(fields['edit.3']).toBe('Each proxy can be edited once.');
  });

  it('accepts valid edits and describes what the branch would do', () => {
    const ok = draft({
      edits: [
        { id: 'agent-1', opinion: 0.3 },
        { id: 'agent-3', openness: 0.9 },
      ],
    });
    const check = checkBranch(ok, project);
    expect(check.ok).toBe(true);
    expect(check.input?.agentEdits).toHaveLength(2);
    expect(branchSummary(ok, project)).toEqual([
      'Copies rounds 1 to 2 unchanged.',
      'Changes 2 proxies.',
    ]);
    expect(branchSummary(draft({ fromRound: 0, choice: 'remove' }), project)).toEqual([
      'Starts again from round 1. No rounds are copied.',
      'There is no scheduled event to remove.',
    ]);
  });
});
