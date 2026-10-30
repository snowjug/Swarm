import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RETRY_BASE_MS, RETRY_CAP_MS, backoffMs, jobLease } from '../src/storage/jobs.js';
import { Repository } from '../src/storage/repository.js';
import { fixtureInput } from './fixtures.js';

const LEASE = 10_000;

describe('the job queue', () => {
  let clock = 1_000_000;
  let repository: Repository;
  let projectId: string;
  const jobs = () => repository.jobs;
  const queue = (key = 'first-key', extra: { maxAttempts?: number } = {}) =>
    jobs().enqueue({
      id: randomUUID(),
      projectId,
      kind: 'knowledge',
      idempotencyKey: key,
      ...extra,
    }).job;

  beforeEach(() => {
    clock = 1_000_000;
    repository = new Repository(':memory:', {
      now: () => clock,
      retryDelayMs: (attempt) => attempt * 1_000,
    });
    projectId = repository.create(fixtureInput()).id;
  });
  afterEach(() => repository.close());

  describe('queuing', () => {
    it('makes asking twice for the same thing one job, and a different thing another', () => {
      const first = jobs().enqueue({
        id: randomUUID(),
        projectId,
        kind: 'knowledge',
        idempotencyKey: 'same-key',
      });
      const again = jobs().enqueue({
        id: randomUUID(),
        projectId,
        kind: 'knowledge',
        idempotencyKey: 'same-key',
      });
      expect(first.duplicate).toBe(false);
      expect(again.duplicate).toBe(true);
      expect(again.job.id).toBe(first.job.id);
      const other = queue('other-key');
      expect(other.id).not.toBe(first.job.id);
      expect(jobs().recent(projectId)).toHaveLength(2);
      expect(jobs().byIdempotencyKey(projectId, 'same-key')?.id).toBe(first.job.id);
    });

    it('scopes a key to its project, so one project cannot collide with another', () => {
      const other = repository.create(fixtureInput()).id;
      queue('shared-key');
      const second = jobs().enqueue({
        id: randomUUID(),
        projectId: other,
        kind: 'knowledge',
        idempotencyKey: 'shared-key',
      });
      expect(second.duplicate).toBe(false);
    });

    it('starts a job waiting, with no lease and no attempt made', () => {
      const job = queue();
      expect(job).toMatchObject({
        state: 'queued',
        attempt: 0,
        maxAttempts: 3,
        leaseOwner: null,
        cancelRequested: false,
        pauseRequested: false,
        repeat: false,
      });
      expect(jobs().live(projectId)?.id).toBe(job.id);
    });

    it('removes the jobs of a deleted project', () => {
      queue();
      repository.delete(projectId);
      expect(jobs().recent(projectId)).toEqual([]);
      expect(jobs().counts().queued).toBe(0);
    });
  });

  describe('taking a job', () => {
    it('gives a job to one worker only', () => {
      const job = queue();
      const mine = jobs().claim('worker-a', LEASE);
      expect(mine).toMatchObject({
        id: job.id,
        state: 'running',
        attempt: 1,
        leaseOwner: 'worker-a',
        leaseExpiresAt: clock + LEASE,
      });
      expect(jobs().claim('worker-b', LEASE)).toBeNull();
    });

    it('takes the oldest job that is due first, and nothing that is not due yet', () => {
      const first = queue('one-one-one');
      clock += 5;
      const second = queue('two-two-two');
      expect(jobs().claim('worker-a', LEASE)?.id).toBe(first.id);
      expect(jobs().claim('worker-a', LEASE)?.id).toBe(second.id);
      expect(jobs().claim('worker-a', LEASE)).toBeNull();

      const later = queue('three-three');
      expect(jobs().claim('worker-a', LEASE)?.id).toBe(later.id);
      expect(jobs().fail(later.id, 'worker-a', 'MODEL_TIMEOUT', true)).toBe('retrying');
      expect(jobs().hasDue()).toBe(false);
      expect(jobs().claim('worker-b', LEASE)).toBeNull();
      clock += 1_000;
      expect(jobs().hasDue()).toBe(true);
      expect(jobs().claim('worker-b', LEASE)).toMatchObject({ id: later.id, attempt: 2 });
    });
  });

  describe('keeping a lease', () => {
    it('lets a worker that heartbeats keep its job past the first lease', () => {
      const job = queue();
      jobs().claim('worker-a', LEASE);
      clock += 8_000;
      expect(jobs().heartbeat(job.id, 'worker-a', LEASE)).toEqual({
        lost: false,
        cancel: false,
        pause: false,
      });
      clock += 8_000;
      expect(jobs().reap()).toEqual([]);
      expect(jobs().get(job.id)?.state).toBe('running');
    });

    it('hands on the job of a worker that stopped, and refuses that worker everything afterwards', () => {
      const job = queue();
      jobs().claim('worker-a', LEASE);
      clock += LEASE + 1;
      const reaped = jobs().reap();
      expect(reaped.map(({ job: reapedJob, outcome }) => [reapedJob.id, outcome])).toEqual([
        [job.id, 'retrying'],
      ]);
      expect(jobs().get(job.id)).toMatchObject({
        state: 'retrying',
        errorCode: 'LEASE_EXPIRED',
        leaseOwner: null,
        repeat: false,
      });

      clock += 1_000;
      expect(jobs().claim('worker-b', LEASE)).toMatchObject({
        attempt: 2,
        leaseOwner: 'worker-b',
        repeat: true,
      });

      // The first worker comes back: it learns that the job is not its own, and nothing it says counts.
      expect(jobs().heartbeat(job.id, 'worker-a', LEASE)).toEqual({ lost: true });
      expect(jobs().holds(job.id, 'worker-a')).toBe(false);
      expect(jobs().holds(job.id, 'worker-b')).toBe(true);
      expect(jobs().complete(job.id, 'worker-a')).toBe(false);
      expect(jobs().settle(job.id, 'worker-a', 'cancelled', 'RUN_CANCELLED')).toBe(false);
      expect(jobs().fail(job.id, 'worker-a', 'MODEL_TIMEOUT', true)).toBeNull();
      expect(jobs().release(job.id, 'worker-a')).toBe(false);
      expect(jobs().get(job.id)).toMatchObject({ state: 'running', leaseOwner: 'worker-b' });
      expect(jobs().complete(job.id, 'worker-b')).toBe(true);
    });

    it('sets a job aside as poison when it has taken its workers down on every attempt', () => {
      const job = queue('poison-key', { maxAttempts: 2 });
      jobs().claim('worker-a', LEASE);
      clock += LEASE + 1;
      expect(jobs().reap()[0]?.outcome).toBe('retrying');
      clock += 5_000;
      expect(jobs().claim('worker-b', LEASE)?.attempt).toBe(2);
      clock += LEASE + 1;
      const reaped = jobs().reap();
      expect(reaped[0]?.outcome).toBe('failed');
      expect(jobs().get(job.id)).toMatchObject({
        state: 'failed',
        errorCode: 'JOB_POISONED',
        leaseOwner: null,
      });
      expect(jobs().hasDue()).toBe(false);
      expect(jobs().live(projectId)).toBeNull();
    });

    it('does not repeat a job that was allowed one attempt', () => {
      const job = queue('once-only-1', { maxAttempts: 1 });
      jobs().claim('worker-a', LEASE);
      clock += LEASE + 1;
      expect(jobs().reap()[0]?.outcome).toBe('failed');
      expect(jobs().get(job.id)?.errorCode).toBe('JOB_INTERRUPTED');
    });
  });

  describe('retrying', () => {
    it('waits longer each time, never longer than the cap, and spreads the wait', () => {
      expect(backoffMs(1, () => 0)).toBe(RETRY_BASE_MS / 2);
      expect(backoffMs(1, () => 1)).toBe(RETRY_BASE_MS);
      expect(backoffMs(2, () => 1)).toBe(RETRY_BASE_MS * 2);
      expect(backoffMs(3, () => 1)).toBe(RETRY_BASE_MS * 4);
      expect(backoffMs(30, () => 1)).toBe(RETRY_CAP_MS);
      expect(backoffMs(30, () => 0)).toBe(RETRY_CAP_MS / 2);
      expect(backoffMs(2, () => 0.5)).toBeGreaterThan(backoffMs(1, () => 0.5));
      const waits = new Set(Array.from({ length: 20 }, () => backoffMs(4)));
      expect(waits.size).toBeGreaterThan(1);
    });

    it('retries a failure that may pass until the attempts are used up, and ends one that will not', () => {
      const job = queue();
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        expect(jobs().claim('worker-a', LEASE)?.attempt).toBe(attempt);
        expect(jobs().fail(job.id, 'worker-a', 'MODEL_TIMEOUT', true)).toBe('retrying');
        expect(jobs().get(job.id)).toMatchObject({ state: 'retrying', errorCode: 'MODEL_TIMEOUT' });
        clock += 10_000;
      }
      expect(jobs().claim('worker-a', LEASE)?.attempt).toBe(3);
      expect(jobs().fail(job.id, 'worker-a', 'MODEL_TIMEOUT', true)).toBe('failed');
      expect(jobs().get(job.id)).toMatchObject({ state: 'failed', errorCode: 'MODEL_TIMEOUT' });

      const other = queue('other-job-1');
      jobs().claim('worker-a', LEASE);
      expect(jobs().fail(other.id, 'worker-a', 'MODEL_OUTPUT_INVALID', false)).toBe('failed');
    });

    it('does not count a hand-back at shutdown against the attempts, and remembers it was cut off', () => {
      const job = queue();
      jobs().claim('worker-a', LEASE);
      expect(jobs().release(job.id, 'worker-a')).toBe(true);
      expect(jobs().get(job.id)).toMatchObject({
        state: 'queued',
        attempt: 0,
        leaseOwner: null,
        repeat: true,
      });
      expect(jobs().claim('worker-b', LEASE)).toMatchObject({ attempt: 1, repeat: true });
    });
  });

  describe('asking a job to stop', () => {
    it('cancels a job that has not started at once, and tells a running one through its heartbeat', () => {
      const waiting = queue('waiting-job');
      expect(jobs().requestCancel(waiting.id)?.state).toBe('cancelled');

      const running = queue('running-job');
      jobs().claim('worker-a', LEASE);
      expect(jobs().requestCancel(running.id)?.state).toBe('cancelling');
      // Asking again changes nothing.
      expect(jobs().requestCancel(running.id)?.state).toBe('cancelling');
      expect(jobs().live(projectId)?.id).toBe(running.id);
      expect(jobs().heartbeat(running.id, 'worker-a', LEASE)).toEqual({
        lost: false,
        cancel: true,
        pause: false,
      });
      expect(jobs().settle(running.id, 'worker-a', 'cancelled', 'RUN_CANCELLED')).toBe(true);
      expect(jobs().get(running.id)).toMatchObject({ state: 'cancelled', leaseOwner: null });
      expect(jobs().requestCancel(running.id)).toBeNull();
    });

    it('finishes the cancellation of a job whose worker stopped before it could', () => {
      const job = queue();
      jobs().claim('worker-a', LEASE);
      jobs().requestCancel(job.id);
      clock += LEASE + 1;
      expect(jobs().reap()[0]?.outcome).toBe('cancelled');
      expect(jobs().get(job.id)).toMatchObject({ state: 'cancelled', errorCode: 'RUN_CANCELLED' });
    });

    it('pauses a job that has not started at once, and asks a running one to stop at its saved round', () => {
      const waiting = queue('waiting-job');
      expect(jobs().requestPause(waiting.id)?.state).toBe('paused');

      const running = queue('running-job');
      jobs().claim('worker-a', LEASE);
      expect(jobs().requestPause(running.id)?.state).toBe('running');
      expect(jobs().heartbeat(running.id, 'worker-a', LEASE)).toEqual({
        lost: false,
        cancel: false,
        pause: true,
      });
      expect(jobs().settle(running.id, 'worker-a', 'paused', 'RUN_PAUSED')).toBe(true);
      expect(jobs().get(running.id)?.state).toBe('paused');
      expect(jobs().live(projectId)).toBeNull();
    });

    it('records a stage that stopped with saved rounds as partial, not as failed', () => {
      const job = queue();
      jobs().claim('worker-a', LEASE);
      expect(jobs().settle(job.id, 'worker-a', 'partial', 'MODEL_TIMEOUT')).toBe(true);
      expect(jobs().get(job.id)).toMatchObject({ state: 'partial', errorCode: 'MODEL_TIMEOUT' });
    });
  });

  describe('upkeep', () => {
    it('expires a job that waited too long for a worker, and leaves running work alone', () => {
      const running = queue('running-key');
      jobs().claim('worker-a', LEASE);
      clock += 1;
      const waiting = queue('waiting-key');
      clock += 60_000;
      const expired = jobs().expireStale(30_000);
      expect(expired.map((job) => job.id)).toEqual([waiting.id]);
      expect(jobs().get(waiting.id)).toMatchObject({ state: 'expired', errorCode: 'JOB_EXPIRED' });
      expect(jobs().get(running.id)?.state).toBe('running');
    });

    it('counts jobs by state and reports how long the oldest has waited', () => {
      expect(jobs().oldestWaitingMs()).toBeNull();
      queue('first-wait-1');
      clock += 4_000;
      queue('second-wait');
      clock += 1_000;
      expect(jobs().waiting()).toBe(2);
      expect(jobs().oldestWaitingMs()).toBe(5_000);
      jobs().claim('worker-a', LEASE);
      expect(jobs().counts()).toMatchObject({ queued: 1, running: 1, completed: 0 });
    });

    it('removes finished jobs older than the cutoff, and nothing else', () => {
      const done = queue('done-job-key');
      jobs().claim('worker-a', LEASE);
      jobs().complete(done.id, 'worker-a');
      clock += 10_000;
      const waiting = queue('still-waiting');
      expect(jobs().purge(60_000)).toBe(0);
      expect(jobs().purge(5_000)).toBe(1);
      expect(jobs().get(done.id)).toBeNull();
      expect(jobs().get(waiting.id)?.state).toBe('queued');
    });
  });

  describe('fencing a worker that lost its lease', () => {
    it('refuses a write to the project, and to its events, from a job that no longer holds its lease', () => {
      const job = queue();
      jobs().claim('worker-a', LEASE);
      const asWorkerA = { jobId: job.id, owner: 'worker-a' };
      jobLease.run(asWorkerA, () => {
        repository.update(projectId, { progress: 7 });
        repository.addEvent(projectId, 'knowledge', 'Written while the lease is held.');
      });
      expect(repository.get(projectId).progress).toBe(7);

      clock += LEASE + 1;
      jobs().reap();
      jobLease.run(asWorkerA, () => {
        expect(() => repository.update(projectId, { progress: 99 })).toThrowError(
          expect.objectContaining({ code: 'LEASE_LOST' }),
        );
        expect(() => repository.addEvent(projectId, 'knowledge', 'Stale write.')).toThrowError(
          expect.objectContaining({ code: 'LEASE_LOST' }),
        );
      });
      const after = repository.get(projectId);
      expect(after.progress).toBe(7);
      expect(after.events.map((event) => event.message)).not.toContain('Stale write.');

      // Outside any job, writes are not fenced.
      repository.update(projectId, { progress: 8 });
      expect(repository.get(projectId).progress).toBe(8);
    });

    it('refuses a write from a worker that never held the job', () => {
      const job = queue();
      jobs().claim('worker-a', LEASE);
      jobLease.run({ jobId: job.id, owner: 'worker-b' }, () => {
        expect(() => repository.update(projectId, { progress: 50 })).toThrowError(
          expect.objectContaining({ code: 'LEASE_LOST' }),
        );
      });
    });

    it('still lets a worker write while its job is being cancelled, so that it can record the stop', () => {
      const job = queue();
      jobs().claim('worker-a', LEASE);
      jobs().requestCancel(job.id);
      jobLease.run({ jobId: job.id, owner: 'worker-a' }, () => {
        repository.update(projectId, { progress: 12 });
      });
      expect(repository.get(projectId).progress).toBe(12);
    });
  });

  describe('projects with a job', () => {
    it('are not marked failed by a restart, because the queue still owns them', () => {
      repository.update(projectId, { status: 'queued' });
      const job = queue();
      repository.recoverInterrupted();
      expect(repository.get(projectId).status).toBe('queued');
      jobs().claim('worker-a', LEASE);
      jobs().complete(job.id, 'worker-a');
      repository.recoverInterrupted();
      expect(repository.get(projectId).status).toBe('failed');
    });
  });
});
