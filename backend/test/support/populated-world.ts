import type { GroundingReview } from '../../../shared/grounding.js';
import { buildApp } from '../../src/app.js';
import { LedgerService } from '../../src/grounding/service.js';
import type { Repository } from '../../src/storage/repository.js';
import { StudioService } from '../../src/studio/service.js';
import { fixtureInput, testConfig } from '../fixtures.js';

export type Instance = Awaited<ReturnType<typeof buildApp>>;

const statement = (id: string, text: string, kind: 'source-fact' | 'ai-hypothesis') => ({
  id,
  section: 'Findings',
  text,
  kind,
  sourceIds: kind === 'source-fact' ? ['S1'] : [],
  memoryIds: [],
  quote: null,
  verdict: kind === 'source-fact' ? ('supported' as const) : ('unchecked' as const),
  checks: { quote: null, overlap: 0.9, numbers: null, entailment: null },
  reason: 'Checked against the cited passage.',
});

const grounding: GroundingReview = {
  checkedAt: '2026-01-01T00:00:00.000Z',
  method: 'deterministic',
  claims: [
    statement('C1', 'Neighborhood groups ask for accessible stops.', 'source-fact'),
    statement('C2', 'Residents may switch to transit if fares fall.', 'ai-hypothesis'),
  ],
  counts: { supported: 1, partial: 0, unsupported: 0, contradicted: 0, unchecked: 1 },
  unverifiedFigures: [],
  notes: [],
};

/**
 * A database with a little of everything in it: a finished guided experiment with a conversation, a
 * ledger and a report a person has edited, a workspace member, and a second project. The application
 * that wrote it is pushed on to `applications`, for the caller to close.
 */
export async function populated(applications: Instance[]): Promise<Repository> {
  const instance = await buildApp({ config: testConfig() });
  applications.push(instance);
  const { repository, jobs, interaction } = instance;
  const created = repository.create(fixtureInput({ workflow: 'guided' }));
  for (const step of ['knowledge', 'environment', 'simulation', 'report'] as const) {
    jobs.enqueueStep(created.id, step);
    await jobs.idle();
  }
  // Give the report a grounding review, so that the ledger has statements to hold.
  const report = repository.get(created.id).report!;
  repository.update(created.id, { report: { ...report, grounding } });
  new LedgerService(repository).get(created.id);
  // A person has worked on the report: a document with an edit, so that it has something to carry.
  const studio = new StudioService(repository, new LedgerService(repository));
  studio.start(created.id, { confirm: false }, 'local-user');
  studio.editSection(
    created.id,
    'summary',
    { body: 'A summary as a person wrote it.', expectedVersion: 1, reason: null },
    'local-user',
  );
  await interaction.reply(
    created.id,
    'report',
    'What do the sources say about transit?',
    new AbortController().signal,
  );
  repository.members.setWorkspaceMember({
    tenantId: 'local',
    principalId: 'colleague-1',
    role: 'admin',
    actor: { id: 'local-user', workspaceRole: 'owner' },
  });
  repository.create(fixtureInput({ name: 'A second experiment' }));
  return repository;
}
