import { createProjectSchema } from '../../shared/types.js';
import { loadConfig } from '../src/config.js';

export const sourceText = [
  'This is a fictional scenario for testing a proposed community transit program.',
  'The City Transit Office proposes a six-month electric bus pilot with lower fares.',
  'Commuters support reliable transit, but some commuters worry about route changes.',
  'Neighborhood groups ask for accessible stops and clear information about the pilot.',
  'Local businesses expect benefits from more visitors and discuss the cost of disruption.',
  'An independent budget group questions funding assumptions and requests public evidence.',
  'The Transit Office will publish service data and invite neighborhood feedback each month.',
  'No survey has measured support. These notes describe proposed actions, not observed outcomes.',
].join('\n');

export function fixtureInput(overrides: Record<string, unknown> = {}) {
  return createProjectSchema.parse({
    name: 'Community transit pilot',
    question: 'How might fictional stakeholders respond to the proposed transit pilot?',
    documents: [{ name: 'transit-notes.md', content: sourceText }],
    settings: { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' },
    ...overrides,
  });
}

export function testConfig(environment: Record<string, string | undefined> = {}) {
  return { ...loadConfig({ LOG_LEVEL: 'silent', ...environment }), databasePath: ':memory:' };
}
