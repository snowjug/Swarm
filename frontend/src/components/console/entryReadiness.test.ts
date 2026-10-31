import { describe, expect, it } from 'vitest';
import type { CreateProjectInput } from '../../../../shared/types';
import { entryReadiness } from './entryReadiness';

const document = (name: string, length = 120) => ({
  name,
  content: 'A source sentence that is long enough to count. '.repeat(Math.ceil(length / 48)),
});
const form = (overrides: Partial<CreateProjectInput> = {}): CreateProjectInput => ({
  name: 'A project',
  question: 'What could happen if the library changes its opening hours?',
  workflow: 'guided',
  documents: [document('notes.md')],
  settings: { mode: 'local', agentCount: 12, rounds: 8, seed: 42, network: 'community' },
  ...overrides,
});

describe('where the entry form stands, beside the button that builds', () => {
  it('says that it is ready, and how many documents are attached', () => {
    expect(entryReadiness(form())).toEqual({
      asked: true,
      ready: true,
      text: '1 document attached · ready to build',
    });
    expect(
      entryReadiness(form({ documents: [document('a.md'), document('b.md'), document('c.md')] }))
        .text,
    ).toBe('3 documents attached · ready to build');
  });

  it('asks for a question first, and does not yet keep the bar in reach for one that is too short', () => {
    const state = entryReadiness(form({ question: 'Why?' }));
    expect(state).toEqual({
      asked: false,
      ready: false,
      text: 'Write your question first: 10 characters or more',
    });
    expect(entryReadiness(form({ question: '   ' })).asked).toBe(false);
  });

  it('asks for evidence when there is a question and nothing to build it from', () => {
    expect(entryReadiness(form({ documents: [] }))).toEqual({
      asked: true,
      ready: false,
      text: 'No documents attached yet · attach at least one to build',
    });
  });

  it('never says ready of a form that would be refused', () => {
    expect(entryReadiness(form({ documents: [document('notes.md', 20)] }))).toMatchObject({
      ready: false,
      text: 'Check the attached documents before building',
    });
    expect(entryReadiness(form({ name: 'ab' }))).toMatchObject({
      ready: false,
      text: 'Check the project name before building',
    });
    expect(
      entryReadiness(
        form({
          settings: { mode: 'local', agentCount: 99, rounds: 8, seed: 42, network: 'community' },
        }),
      ),
    ).toMatchObject({ ready: false, text: 'Check the run settings before building' });
  });
});
