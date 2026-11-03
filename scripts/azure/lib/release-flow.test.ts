import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APP,
  GROUP,
  LOGIN_SERVER,
  REGISTRY,
  SHA_A,
  SHA_B,
  SUB,
  digestOf,
  fakeAzure,
  fakeGit,
  fakeSmoke,
  newWorld,
  type FakeWorld,
} from './fixtures/fake-containerapp.js';
import { UsageError } from './args.js';
import { parseReleaseArgs } from './release-args.js';
import {
  Refusal,
  parseSchemaVersion,
  runFinalize,
  runPromote,
  runRelease,
  runRollback,
  runStatus,
  type ReleaseDeps,
} from './release-flow.js';
import {
  memoryRecordStore,
  redactEnvironment,
  revisionSuffixFor,
  validateRecord,
} from './release-record.js';

const OLD = `${APP}--r${SHA_A.slice(0, 12)}`;
const NEW = `${APP}--r${SHA_B.slice(0, 12)}`;

const base = [
  'release',
  '--subscription',
  SUB,
  '--resource-group',
  GROUP,
  '--app',
  APP,
  '--registry',
  REGISTRY,
];
const dry = [...base, '--current-schema-version', '9'];
const live = [...dry, '--execute', '--confirm-resource-group', GROUP];

function harness(
  options: { world?: FakeWorld; schema?: number; clean?: boolean; head?: string; ci?: string } = {},
) {
  const fake = fakeAzure(options.world ?? newWorld());
  const store = memoryRecordStore();
  const logs: string[] = [];
  const git = fakeGit({ schema: options.schema, clean: options.clean, head: options.head });
  const health = { ok: true, detail: 'HTTP 200 and the body is ready' };
  const deps: ReleaseDeps = {
    az: fake.az,
    git,
    store,
    smoke: fakeSmoke(fake.world),
    health: async () => health,
    now: () => new Date(fake.world.clock.now),
    sleep: async (milliseconds) => {
      fake.world.clock.now += milliseconds;
    },
    log: (line) => logs.push(line),
    ci: options.ci,
  };
  return { fake, store, logs, deps, git, health };
}

const kinds = (calls: string[][]): string[] =>
  calls.map((call) => {
    if (call[0] === 'acr' && call[1] === 'build') return 'build';
    if (call[0] === 'acr') return 'lock-tag';
    if (call[2] === 'traffic') return 'traffic';
    if (call[1] === 'update') return 'update';
    return String(call[2]);
  });

const run = (words: string[], h: ReturnType<typeof harness>) =>
  runRelease(parseReleaseArgs(words), h.deps);

describe('a dry run is the default', () => {
  it('reads what it needs, changes nothing, writes no record, and prints the exact commands it would run', async () => {
    const h = harness();
    const result = await run(dry, h);

    expect(result).toMatchObject({ exitCode: 0, status: 'dry-run', recordPath: null });
    expect(h.fake.mutations()).toEqual([]);
    expect(h.store.records).toEqual([]);
    expect(h.fake.world.calls.length).toBeGreaterThan(3);
    const text = h.logs.join('\n');
    expect(text).toContain('DRY RUN (nothing will be changed');
    expect(text).toContain(`would run  az acr build --registry ${REGISTRY}`);
    expect(text).toContain('would run  az acr repository update');
    expect(text).toContain('would run  az containerapp update');
    expect(text).toContain(`--revision-suffix r${SHA_B.slice(0, 12)}`);
    expect(text).toContain('would send all traffic');
    expect(h.fake.servingNames()).toEqual([OLD]);
  });
});

describe('a live run is refused unless it is explicit', () => {
  it('needs --confirm-resource-group, spelled out and equal, before any call is made', async () => {
    for (const words of [
      [...base, '--execute'],
      [...base, '--execute', '--confirm-resource-group', 'rg-other'],
    ]) {
      const h = harness();
      await expect(run(words, h)).rejects.toThrow(Refusal);
      await expect(run(words, h)).rejects.toThrow(/--confirm-resource-group/u);
      expect(h.fake.world.calls).toEqual([]);
    }
  });

  it('is refused from CI, where deploying is not an action anyone may take', async () => {
    const h = harness({ ci: 'true' });
    await expect(run(live, h)).rejects.toThrow(/CI/u);
    expect(h.fake.world.calls).toEqual([]);
    // The dry run is allowed there.
    await expect(run(dry, h)).resolves.toMatchObject({ status: 'dry-run' });
  });

  it.each(['1', 'TRUE', 'yes'])(
    'treats CI=%s as CI too: other systems do not say "true"',
    async (value) => {
      const h = harness({ ci: value });
      await expect(run(live, h)).rejects.toThrow(/CI/u);
      expect(h.fake.world.calls).toEqual([]);
    },
  );

  it.each(['', '0', 'false'])('does not treat CI=%s as CI', async (value) => {
    const h = harness({ ci: value });
    await expect(run(live, h)).resolves.toMatchObject({ status: 'promoted' });
  });

  it.each([
    [
      'a resource group this project did not create',
      (world: FakeWorld) => {
        world.tags = null;
      },
      /not tagged app=swarm-lab/u,
    ],
    [
      'an app in single-revision mode',
      (world: FakeWorld) => {
        world.mode = 'Single';
      },
      /revision mode/u,
    ],
    [
      'traffic that is split, with a release in progress',
      (world: FakeWorld) => {
        world.revisions.set(NEW, { ...world.revisions.get(OLD)!, name: NEW });
        world.traffic = [
          { revisionName: NEW, weight: 10 },
          { revisionName: OLD, weight: 90 },
        ];
      },
      /split or unset/u,
    ],
    [
      'a serving revision that is not running',
      (world: FakeWorld) => {
        world.revisions.get(OLD)!.running = 'Degraded';
      },
      /Degraded/u,
    ],
  ])('refuses %s and changes nothing', async (_name, mutate, message) => {
    const world = newWorld();
    mutate(world);
    const h = harness({ world });
    await expect(run(live, h)).rejects.toThrow(message);
    expect(h.fake.mutations()).toEqual([]);
  });

  it('refuses a dirty working tree and a commit that is not HEAD, when it builds', async () => {
    await expect(run(live, harness({ clean: false }))).rejects.toThrow(/uncommitted changes/u);
    await expect(run([...live, '--commit', SHA_A], harness())).rejects.toThrow(/must be HEAD/u);
  });

  it('refuses a commit this clone does not have, before changing anything', async () => {
    const h = harness();
    h.deps.git.show = async () => {
      throw new Error('fatal: invalid object name');
    };
    await expect(run([...live, '--skip-build'], h)).rejects.toThrow(
      /is that commit in this clone/u,
    );
    expect(h.fake.mutations()).toEqual([]);
  });
});

describe('a release', () => {
  it('builds, pins the tag, creates the revision dark, proves it, shifts, passes the smoke test and records it', async () => {
    const h = harness();
    const result = await run(live, h);

    expect(result).toMatchObject({ exitCode: 0, status: 'promoted' });
    // The build, the tag lock, the revision and the shift: traffic was already named, so no pin was needed.
    expect(kinds(h.fake.mutations())).toEqual(['build', 'lock-tag', 'update', 'traffic']);
    expect(h.fake.world.traffic).toEqual([
      { revisionName: NEW, weight: 100 },
      { revisionName: OLD, weight: 0 },
    ]);
    // The previous revision is still running: that is what makes rollback instant.
    expect(h.fake.world.revisions.get(OLD)).toMatchObject({
      active: true,
      running: 'Running',
      replicas: 1,
    });
    // The image is identified by digest, and its tag can no longer be moved.
    expect(h.fake.world.images.get(`swarm:${SHA_B}`)).toEqual({
      digest: digestOf(SHA_B),
      locked: true,
    });
    expect(h.fake.world.revisions.get(NEW)?.image).toBe(`${LOGIN_SERVER}/swarm@${digestOf(SHA_B)}`);

    const [record] = h.store.records;
    expect(record).toMatchObject({
      status: 'promoted',
      commit: { sha: SHA_B },
      image: {
        digest: digestOf(SHA_B),
        tag: `swarm:${SHA_B}`,
        tagLocked: true,
        reference: `${LOGIN_SERVER}/swarm@${digestOf(SHA_B)}`,
      },
      revision: { name: NEW, suffix: revisionSuffixFor(SHA_B), trafficWeight: 100 },
      lastKnownGood: { revision: OLD },
      migrations: {
        schemaVersionBefore: 9,
        schemaVersionAfter: 9,
        applied: [],
        restorePointUtc: null,
      },
      smoke: { passed: true },
      warmWindow: { hours: 4 },
    });
    expect(record?.rollback?.command).toContain('azure:release -- rollback');
    expect(record?.steps.map((step) => step.step)).toEqual([
      'build',
      'lock-tag',
      'create-revision',
      'revision-health',
      'shift',
    ]);
    expect(record && validateRecord(record)).toEqual([]);
  });

  it('records the configuration without a single secret', async () => {
    const h = harness();
    await run(live, h);
    const record = h.store.records[0]!;
    const env = Object.fromEntries(record.config.environment.map((entry) => [entry.name, entry]));
    expect(env.PORT).toEqual({ name: 'PORT', value: '3001' });
    expect(env.AUTH_ENTRA_CLIENT_ASSERTION).toEqual({
      name: 'AUTH_ENTRA_CLIENT_ASSERTION',
      value: 'managed-identity',
    });
    expect(env.AUTH_ENTRA_CLIENT_SECRET).toEqual({
      name: 'AUTH_ENTRA_CLIENT_SECRET',
      secretRef: 'auth-entra-client-secret',
    });
    expect(env.APPLICATIONINSIGHTS_CONNECTION_STRING).toEqual({
      name: 'APPLICATIONINSIGHTS_CONNECTION_STRING',
      redacted: true,
    });
    expect(env.SOME_API_KEY).toEqual({ name: 'SOME_API_KEY', redacted: true });
    const text = JSON.stringify(record);
    expect(text).not.toContain('not-a-real-key-value');
    expect(text).not.toContain('InstrumentationKey');
    expect(record.config).toMatchObject({
      cpu: 0.5,
      memory: '1Gi',
      minReplicas: 1,
      maxReplicas: 1,
    });
  });

  it('is idempotent about an image that already exists when asked to skip the build', async () => {
    const h = harness();
    h.fake.world.images.set(`swarm:${SHA_B}`, { digest: digestOf(SHA_B), locked: false });
    const result = await run([...live, '--skip-build', '--commit', SHA_B], h);
    expect(result.status).toBe('promoted');
    expect(kinds(h.fake.mutations())).not.toContain('build');
  });

  it('refuses --skip-build for an image the registry does not hold', async () => {
    await expect(run([...live, '--skip-build'], harness())).rejects.toThrow(/no image swarm:/u);
  });

  it('names no revision that is not there: re-running the same commit reuses its revision', async () => {
    const h = harness();
    await run(live, h);
    // Serving is NEW now; its revision for the same commit already exists.
    h.fake.world.traffic = [{ revisionName: NEW, weight: 100 }];
    const before = h.fake.world.calls.length;
    const result = await run([...live, '--skip-build', '--commit', SHA_B], h);
    expect(result.status).toBe('promoted');
    expect(
      h.fake
        .mutations()
        .slice(before)
        .some((call) => call[1] === 'update'),
    ).toBe(false);
    expect(h.logs.join('\n')).toContain('already exists: reusing it');
  });

  it('pins traffic to the serving revision first when traffic named "the newest revision"', async () => {
    const world = newWorld();
    world.traffic = [{ latestRevision: true, weight: 100 }];
    const h = harness({ world });
    await run(live, h);
    expect(kinds(h.fake.mutations()).slice(0, 4)).toEqual([
      'build',
      'lock-tag',
      'traffic',
      'update',
    ]);
    expect(h.fake.mutations()[2]).toContain(`${OLD}=100`);
  });
});

describe('what stops a release from going forward', () => {
  it('rolls traffic back by itself when the smoke test fails, and leaves the bad revision running at 0%', async () => {
    const world = newWorld();
    world.breakNextApp = true;
    const h = harness({ world });
    const result = await run(live, h);

    expect(result).toMatchObject({ exitCode: 1, status: 'rolled-back' });
    expect(h.fake.world.traffic).toEqual([
      { revisionName: OLD, weight: 100 },
      { revisionName: NEW, weight: 0 },
    ]);
    expect(h.fake.world.revisions.get(NEW)?.active).toBe(true);
    expect(h.store.records[0]).toMatchObject({ status: 'rolled-back', smoke: { passed: false } });
    expect(h.logs.join('\n')).toContain('Traffic is back on');
  });

  it('moves no traffic when the new revision does not start, and stops it', async () => {
    const world = newWorld();
    world.failNextRevision = true;
    const h = harness({ world });
    const result = await run(live, h);

    expect(result).toMatchObject({ exitCode: 1, status: 'failed' });
    expect(h.fake.world.traffic).toEqual([{ revisionName: OLD, weight: 100 }]);
    expect(h.fake.world.revisions.get(NEW)?.active).toBe(false);
    expect(kinds(h.fake.mutations())).toEqual(['build', 'lock-tag', 'update', 'deactivate']);
  });

  it('moves no traffic when the new revision is not ready on its own address', async () => {
    const h = harness();
    h.health.ok = false;
    h.health.detail = 'HTTP 503 from /api/health/ready';
    const result = await run(live, h);
    expect(result).toMatchObject({ exitCode: 1, status: 'failed' });
    expect(h.fake.world.traffic).toEqual([{ revisionName: OLD, weight: 100 }]);
    expect(h.logs.join('\n')).toContain('No traffic was moved');
  });

  it('does not wait forever for a revision that never becomes ready', async () => {
    const world = newWorld();
    world.hangNextRevision = true;
    const h = harness({ world });
    const result = await run([...live, '--ready-timeout-minutes', '1'], h);
    expect(result.status).toBe('failed');
    expect(h.logs.join('\n')).toContain('was not running after 1 minutes');
    expect(h.fake.world.traffic).toEqual([{ revisionName: OLD, weight: 100 }]);
    expect(kinds(h.fake.mutations())).toEqual(['build', 'lock-tag', 'update', 'deactivate']);
  });

  it('leaves a failed smoke test alone when told not to roll back, and says how to', async () => {
    const world = newWorld();
    world.breakNextApp = true;
    const h = harness({ world });
    const result = await run([...live, '--no-auto-rollback'], h);
    expect(result.status).toBe('failed');
    expect(h.fake.servingNames()).toEqual([NEW]);
    expect(h.logs.join('\n')).toContain('azure:release -- rollback');
  });
});

describe('schema migrations only go forward', () => {
  it('refuses a release that carries a migration until it is accepted, and then records the restore point', async () => {
    const refused = harness({ schema: 10 });
    await expect(run(live, refused)).rejects.toThrow(/applies schema migration\(s\) 10/u);
    expect(refused.fake.mutations()).toEqual([]);

    const accepted = harness({ schema: 10 });
    const result = await run([...live, '--accept-schema-change'], accepted);
    expect(result.status).toBe('promoted');
    expect(accepted.store.records[0]?.migrations).toMatchObject({
      schemaVersionBefore: 9,
      schemaVersionAfter: 10,
      applied: [10],
      acceptedSchemaChange: true,
      restorePointUtc: new Date(Date.parse('2026-11-03T10:00:00Z')).toISOString(),
    });
  });

  it('refuses a commit whose schema is older than the database, which no build can use', async () => {
    await expect(run(live, harness({ schema: 8 }))).rejects.toThrow(/OLDER than the database/u);
  });

  it('does not guess when the schema before the release is unknown', async () => {
    const withoutVersion = live.filter(
      (word, index) =>
        word !== '--current-schema-version' && live[index - 1] !== '--current-schema-version',
    );
    await expect(run(withoutVersion, harness())).rejects.toThrow(/unknown/u);
    // After one recorded release the version is known, and the next one needs no flag.
    const h = harness();
    await run(live, h);
    h.fake.world.traffic = [{ revisionName: NEW, weight: 100 }];
    h.git.schema = 9;
    const next = await run([...withoutVersion, '--skip-build', '--commit', SHA_B], h);
    expect(next.status).toBe('promoted');
  });

  it('reads the real schema file, so the check follows the code', () => {
    const source = readFileSync(
      new URL('../../../backend/src/storage/migrations.ts', import.meta.url),
      'utf8',
    );
    const counted = [...source.matchAll(/^ {4}version: \d+,/gmu)].length;
    expect(parseSchemaVersion(source)).toBe(counted);
    expect(parseSchemaVersion(source)).toBeGreaterThanOrEqual(9);
    expect(parseSchemaVersion('nothing here')).toBeNull();
  });
});

describe('the first release replaces the placeholder', () => {
  it('has nothing to go back to, needs no schema flag, and does not pretend otherwise', async () => {
    const h = harness({ world: newWorld({ placeholder: true }) });
    const result = await runRelease(
      parseReleaseArgs(
        [...live].filter(
          (word, index, all) =>
            word !== '--current-schema-version' && all[index - 1] !== '--current-schema-version',
        ),
      ),
      h.deps,
    );
    expect(result.status).toBe('promoted');
    const [record] = h.store.records;
    expect(record?.lastKnownGood).toBeNull();
    expect(record?.warmWindow).toBeNull();
    expect(record?.rollback).toBeNull();
    expect(record?.migrations.schemaVersionBefore).toBe(0);
    expect(h.logs.join('\n')).toContain('nothing to roll back to');
  });

  it('fails without an automatic rollback when the first smoke test fails', async () => {
    const world = newWorld({ placeholder: true });
    world.breakNextApp = true;
    const h = harness({ world });
    const result = await runRelease(
      parseReleaseArgs(
        live.filter(
          (word, index) =>
            word !== '--current-schema-version' && live[index - 1] !== '--current-schema-version',
        ),
      ),
      h.deps,
    );
    expect(result).toMatchObject({ exitCode: 1, status: 'failed' });
    expect(h.logs.join('\n')).toContain('no automatic rollback is available (first release)');
  });
});

describe('a canary', () => {
  it('stops at the share asked for, and promote finishes it', async () => {
    const h = harness();
    const canary = await run([...live, '--canary-percent', '10'], h);
    expect(canary.status).toBe('canary');
    expect(h.fake.world.traffic).toEqual([
      { revisionName: NEW, weight: 10 },
      { revisionName: OLD, weight: 90 },
    ]);
    expect(h.store.records[0]).toMatchObject({ status: 'canary', revision: { trafficWeight: 10 } });

    const promote = await runPromote(
      parseReleaseArgs([
        'promote',
        '--subscription',
        SUB,
        '--resource-group',
        GROUP,
        '--app',
        APP,
        '--execute',
        '--confirm-resource-group',
        GROUP,
      ]),
      h.deps,
    );
    expect(promote.status).toBe('promoted');
    expect(h.fake.world.traffic).toEqual([
      { revisionName: NEW, weight: 100 },
      { revisionName: OLD, weight: 0 },
    ]);
  });

  it('goes back if the smoke test fails after promotion', async () => {
    const world = newWorld();
    world.breakNextApp = true;
    const h = harness({ world });
    await run([...live, '--canary-percent', '10'], h);
    const promote = await runPromote(
      parseReleaseArgs([
        'promote',
        '--subscription',
        SUB,
        '--resource-group',
        GROUP,
        '--app',
        APP,
        '--execute',
        '--confirm-resource-group',
        GROUP,
      ]),
      h.deps,
    );
    expect(promote).toMatchObject({ exitCode: 1, status: 'rolled-back' });
    expect(h.fake.servingNames()).toEqual([OLD]);
  });

  it('refuses to promote when no canary is in progress', async () => {
    const h = harness();
    await expect(
      runPromote(
        parseReleaseArgs([
          'promote',
          '--subscription',
          SUB,
          '--resource-group',
          GROUP,
          '--app',
          APP,
        ]),
        h.deps,
      ),
    ).rejects.toThrow(/no canary release/u);
  });
});

const rollbackWords = ['rollback', '--subscription', SUB, '--resource-group', GROUP, '--app', APP];
const rollbackLive = [...rollbackWords, '--execute', '--confirm-resource-group', GROUP];

describe('rollback: one command back to the last known good', () => {
  it('is only a traffic change while the previous revision is warm, and the record shows it', async () => {
    const h = harness();
    await run(live, h);
    const before = h.fake.mutations().length;
    const result = await runRollback(parseReleaseArgs(rollbackLive), h.deps);

    expect(result).toMatchObject({ exitCode: 0, status: 'rolled-back' });
    expect(kinds(h.fake.mutations().slice(before))).toEqual(['traffic']);
    expect(h.fake.world.traffic).toEqual([
      { revisionName: OLD, weight: 100 },
      { revisionName: NEW, weight: 0 },
    ]);
    expect(h.store.records[0]).toMatchObject({ status: 'rolled-back', smoke: { passed: true } });
    expect(h.store.records[0]?.rollbacks).toEqual([
      expect.objectContaining({ to: OLD, smokePassed: true, cold: false }),
    ]);
  });

  it('is a dry run by default', async () => {
    const h = harness();
    await run(live, h);
    const before = h.fake.mutations().length;
    const result = await runRollback(parseReleaseArgs(rollbackWords), h.deps);
    expect(result.status).toBe('dry-run');
    expect(h.fake.mutations()).toHaveLength(before);
    expect(h.fake.servingNames()).toEqual([NEW]);
  });

  it('does nothing when the target already serves, and refuses to guess a target', async () => {
    const h = harness();
    const same = await runRollback(parseReleaseArgs([...rollbackLive, '--to', OLD]), h.deps);
    expect(same.status).toBe('inspected');
    expect(h.fake.mutations()).toEqual([]);
    await expect(runRollback(parseReleaseArgs(rollbackLive), h.deps)).rejects.toThrow(
      /No last known good/u,
    );
  });

  it('refuses a revision that does not exist, and a rollback across a migration until it is accepted', async () => {
    const h = harness({ schema: 10 });
    await expect(
      runRollback(parseReleaseArgs([...rollbackLive, '--to', 'ca-swarm-pilot--nothing']), h.deps),
    ).rejects.toThrow(/does not exist/u);
    await run([...live, '--accept-schema-change'], h);
    await expect(runRollback(parseReleaseArgs(rollbackLive), h.deps)).rejects.toThrow(
      /schema migration\(s\) 10/u,
    );
    const accepted = await runRollback(
      parseReleaseArgs([...rollbackLive, '--accept-schema-change']),
      h.deps,
    );
    expect(accepted.status).toBe('rolled-back');
  });

  it('starts a deactivated revision first, and says that is not instant', async () => {
    const h = harness();
    await run(live, h);
    await runFinalize(
      parseReleaseArgs([
        'finalize',
        '--subscription',
        SUB,
        '--resource-group',
        GROUP,
        '--app',
        APP,
        '--execute',
        '--confirm-resource-group',
        GROUP,
        '--force',
      ]),
      h.deps,
    );
    expect(h.fake.world.revisions.get(OLD)?.active).toBe(false);

    const before = h.fake.mutations().length;
    const result = await runRollback(parseReleaseArgs(rollbackLive), h.deps);
    expect(result.status).toBe('rolled-back');
    expect(kinds(h.fake.mutations().slice(before))).toEqual(['activate', 'traffic']);
    expect(h.store.records[0]?.rollbacks.at(-1)).toMatchObject({ cold: true });
    expect(h.fake.servingNames()).toEqual([OLD]);
  });

  it('exits non-zero when the revision it returns to is not healthy either', async () => {
    const h = harness();
    await run(live, h);
    h.fake.world.revisions.get(OLD)!.appHealthy = false;
    const result = await runRollback(parseReleaseArgs(rollbackLive), h.deps);
    expect(result.exitCode).toBe(1);
    expect(h.logs.join('\n')).toContain('Escalate');
  });
});

describe('finalize retires the previous revision after the warm window', () => {
  const finalizeWords = [
    'finalize',
    '--subscription',
    SUB,
    '--resource-group',
    GROUP,
    '--app',
    APP,
    '--execute',
    '--confirm-resource-group',
    GROUP,
  ];

  it('waits for the window, unless forced, then deactivates it', async () => {
    const h = harness();
    await run(live, h);
    await expect(runFinalize(parseReleaseArgs(finalizeWords), h.deps)).rejects.toThrow(
      /warm window runs until/u,
    );
    expect(h.fake.world.revisions.get(OLD)?.active).toBe(true);

    h.fake.world.clock.now += 4 * 3_600_000 + 1;
    const result = await runFinalize(parseReleaseArgs(finalizeWords), h.deps);
    expect(result.status).toBe('finalized');
    expect(h.fake.world.revisions.get(OLD)).toMatchObject({ active: false, running: 'Stopped' });
    expect(h.store.records[0]?.status).toBe('finalized');
  });

  it('will not retire a revision while it is still serving', async () => {
    const h = harness();
    await run([...live, '--canary-percent', '10'], h);
    await expect(runFinalize(parseReleaseArgs(finalizeWords), h.deps)).rejects.toThrow(
      /no promoted release/u,
    );
  });
});

describe('status', () => {
  it('reads and prints, and changes nothing', async () => {
    const h = harness();
    await run(live, h);
    const before = h.fake.mutations().length;
    const result = await runStatus(
      parseReleaseArgs(['status', '--subscription', SUB, '--resource-group', GROUP, '--app', APP]),
      h.deps,
    );
    expect(result.status).toBe('inspected');
    expect(h.fake.mutations()).toHaveLength(before);
    const text = h.logs.join('\n');
    expect(text).toContain(`${NEW}: active`);
    expect(text).toContain('Latest record');
  });
});

describe('the release record and its arguments', () => {
  it('redacts by name and by shape, and keeps a secret reference to its name', () => {
    const jwt = ['eyJhbGciOiJub25lIn0', 'eyJzdWIiOiJ4In0', 'c2lnbmF0dXJl'].join('.');
    expect(
      redactEnvironment([
        { name: 'LOG_LEVEL', value: 'info' },
        { name: 'AZURE_OPENAI_API_KEY', value: 'x' },
        { name: 'BANNER', value: `Bearer ${'a'.repeat(20)}` },
        { name: 'HEADER', value: jwt },
        { name: 'URL', value: 'https://user:pw@host/' },
        { name: 'S', secretRef: 'a-secret' },
      ]),
    ).toEqual([
      { name: 'AZURE_OPENAI_API_KEY', redacted: true },
      { name: 'BANNER', redacted: true },
      { name: 'HEADER', redacted: true },
      { name: 'LOG_LEVEL', value: 'info' },
      { name: 'S', secretRef: 'a-secret' },
      { name: 'URL', redacted: true },
    ]);
  });

  it('refuses to write a record that does not hold together', async () => {
    const h = harness();
    await run(live, h);
    const record = structuredClone(h.store.records[0]!);
    expect(validateRecord(record)).toEqual([]);
    expect(validateRecord({ ...record, commit: { sha: 'abc', shortSha: 'abc' } })).toContain(
      'commit.sha is not a full commit hash',
    );
    expect(
      validateRecord({ ...record, image: { ...record.image, tag: 'swarm:latest' } }),
    ).toContain('image.tag is not the commit hash');
    expect(
      validateRecord({
        ...record,
        image: { ...record.image, reference: `${LOGIN_SERVER}/swarm:latest` },
      }),
    ).toContain('image.reference is not pinned by digest');
    const leaking = {
      ...record,
      config: { ...record.config, environment: [{ name: 'X', value: 'postgres://u:secret@h/d' }] },
    };
    expect(validateRecord(leaking)).toContain('a credential-shaped value is in the record');
  });

  it('derives the revision name and the image tag from the commit hash alone', () => {
    expect(revisionSuffixFor(SHA_B)).toBe(`r${'b'.repeat(12)}`);
    expect(`${APP}--${revisionSuffixFor(SHA_B)}`.length).toBeLessThan(54);
  });

  it('requires an explicit subscription and rejects what it does not understand', () => {
    expect(() =>
      parseReleaseArgs([
        'release',
        '--resource-group',
        GROUP,
        '--app',
        APP,
        '--registry',
        REGISTRY,
      ]),
    ).toThrow(UsageError);
    expect(() =>
      parseReleaseArgs(['deploy', '--subscription', SUB, '--resource-group', GROUP, '--app', APP]),
    ).toThrow(UsageError);
    expect(() => parseReleaseArgs([...base, '--commit', 'abc123'])).toThrow(/40-character/u);
    expect(() => parseReleaseArgs([...base, '--canary-percent', '80'])).toThrow(UsageError);
    expect(() => parseReleaseArgs([...base, '--yes'])).toThrow(UsageError);
    expect(parseReleaseArgs(base)).toMatchObject({
      action: 'release',
      execute: false,
      lockTag: true,
      autoRollback: true,
      canaryPercent: 0,
      warmHours: 4,
    });
    expect(
      parseReleaseArgs(['status', '--subscription', SUB, '--resource-group', GROUP, '--app', APP])
        .action,
    ).toBe('status');
  });
});
