import { randomUUID } from 'node:crypto';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { artifactSchemas } from '../../../shared/artifacts.js';
import { AppError } from '../../src/errors.js';
import { Repository } from '../../src/storage/repository.js';
import { fixtureInput } from '../fixtures.js';

/**
 * What one competing writer does, and the thread it does it on. A race needs writers that really run
 * at once, so each is a worker thread with a connection of its own; a gate releases them together.
 * `runScenario` is also called directly, in turn, for a database that has only one connection in a
 * process (PGlite), where the same outcomes must hold.
 */
export type Scenario = 'artifact' | 'create' | 'claim' | 'audit';

export interface ArtifactParams {
  projectId: string;
  key: string;
  expectedRevision: number;
  decision: string;
}
export interface CreateParams {
  tenantId: string;
  ownerId: string;
  name: string;
}
export interface ClaimParams {
  owner: string;
}
export interface AuditParams {
  writer: number;
  entries: number;
}

/** The result of one writer: what it won, or the code it was refused with, or what it should not have met. */
export type Outcome = string;

const refusal = (error: unknown): Outcome =>
  error instanceof AppError
    ? error.code
    : `unexpected: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`.slice(
        0,
        200,
      );

export function scenarioDocument(decision: string) {
  return artifactSchemas.scenario.parse({
    decision,
    system: 'A regional service',
    baseline: 'Nothing changes.',
    origin: 'user',
  });
}

export function runScenario(
  repository: Repository,
  scenario: Scenario,
  params: unknown,
): Outcome | { claimed: string[] } {
  try {
    switch (scenario) {
      case 'artifact': {
        const { projectId, key, expectedRevision, decision } = params as ArtifactParams;
        const written = repository.artifacts.put(
          projectId,
          'scenario',
          key,
          scenarioDocument(decision),
          { expectedRevision },
        );
        return `won:${written.revision}`;
      }
      case 'create': {
        const { tenantId, ownerId, name } = params as CreateParams;
        repository.create(fixtureInput({ name }), { owner: { tenantId, ownerId } });
        return 'won';
      }
      case 'claim': {
        const { owner } = params as ClaimParams;
        const claimed: string[] = [];
        for (let job = repository.jobs.claim(owner, 30_000); job;) {
          claimed.push(job.id);
          job = repository.jobs.claim(owner, 30_000);
        }
        return { claimed };
      }
      case 'audit': {
        const { writer, entries } = params as AuditParams;
        for (let index = 0; index < entries; index += 1) {
          repository.audit.record({
            actor: `racer-${writer}`,
            action: 'race.append',
            targetType: 'race',
            targetId: `${writer}-${index}`,
          });
        }
        return 'appended';
      }
    }
  } catch (error) {
    return refusal(error);
  }
}

export const newId = (): string => randomUUID();

if (!isMainThread && parentPort) {
  const port = parentPort;
  const repository = new Repository((workerData as { target: string }).target);
  port.on(
    'message',
    (message: {
      type: string;
      scenario?: Scenario;
      params?: unknown;
      gate?: SharedArrayBuffer;
    }) => {
      if (message.type === 'stop') {
        repository.close();
        port.close();
        return;
      }
      // Armed, then blocked until every writer is: they are released by one write to shared memory.
      port.postMessage({ type: 'armed' });
      Atomics.wait(new Int32Array(message.gate!), 0, 0);
      port.postMessage({
        type: 'result',
        result: runScenario(repository, message.scenario!, message.params),
      });
    },
  );
  port.postMessage({ type: 'ready' });
}
