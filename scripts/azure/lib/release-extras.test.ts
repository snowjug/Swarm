import { describe, expect, it } from 'vitest';
import {
  APP,
  GROUP,
  LOGIN_SERVER,
  REAL_PROBES,
  REGISTRY,
  SHA_A,
  SHA_B,
  SUB,
  digestOf,
  newWorld,
  type FakeWorld,
} from './fixtures/fake-containerapp.js';
import { NEW, OLD, harness, kinds, type Harness } from './fixtures/release-harness.js';
import { parseReleaseArgs } from './release-args.js';
import { runBuild, runCheck, runRecord } from './release-extras.js';
import { Refusal, runRollback } from './release-flow.js';
import { validateRecord } from './release-record.js';

const target = ['--subscription', SUB, '--resource-group', GROUP, '--app', APP];
const confirm = ['--execute', '--confirm-resource-group', GROUP];
const recordWords = (...extra: string[]) => [
  'record',
  ...target,
  '--registry',
  REGISTRY,
  '--commit',
  SHA_B,
  '--revision',
  NEW,
  '--digest',
  digestOf(SHA_B),
  ...extra,
];
const buildWords = (...extra: string[]) => ['build', ...target, '--registry', REGISTRY, ...extra];
const checkWords = ['check', ...target];

const record = (words: string[], h: Harness) => runRecord(parseReleaseArgs(words), h.deps);
const check = (h: Harness) => runCheck(parseReleaseArgs(checkWords), h.deps);

/**
 * The live pilot as it was left: the placeholder revision still active at 0%, and a real revision made by
 * hand (az containerapp update with PORT and the ingress corrected, no probes) serving all the traffic.
 */
function handMadeWorld(options: { probes?: boolean } = {}): FakeWorld {
  const world = newWorld({ placeholder: true });
  world.images.set(`swarm:${SHA_B}`, { digest: digestOf(SHA_B), locked: true });
  world.targetPort = 3001;
  world.env.push({ name: 'PORT', value: '3001' }, { name: 'BUILD_SHA', value: SHA_B });
  if (options.probes) world.probes = structuredClone(REAL_PROBES);
  world.revisions.set(NEW, {
    name: NEW,
    active: true,
    image: `${LOGIN_SERVER}/swarm@${digestOf(SHA_B)}`,
    // What the live pilot reports for it: its replica count is at the maximum (min and max are both 1).
    running: 'RunningAtMaxScale',
    health: 'Healthy',
    replicas: 1,
    warmup: 0,
    appHealthy: true,
    createdTime: '2026-11-05T10:37:46Z',
    env: structuredClone(world.env),
    probes: structuredClone(world.probes),
  });
  world.latest = NEW;
  world.traffic = [{ revisionName: NEW, weight: 100 }];
  return world;
}

describe('check: is the deployed container on port 3001 with its probes?', () => {
  it('passes for a container configured as the template configures it', async () => {
    const h = harness();
    const result = await check(h);
    expect(result).toMatchObject({ exitCode: 0, status: 'inspected' });
    expect(h.logs.join('\n')).toContain('PASSED');
    expect(h.fake.mutations()).toEqual([]);
  });

  it('fails on the live pilot as it was left: port and PORT are right, no probe is set', async () => {
    const h = harness({ world: handMadeWorld() });
    const result = await check(h);
    expect(result.exitCode).toBe(1);
    const text = h.logs.join('\n');
    expect(text).toContain('PASS  The ingress sends traffic to port 3001');
    expect(text).toContain('PASS  The application is told port 3001, or none');
    expect(text).toContain('FAIL  Startup, liveness and readiness probes are set');
    expect(text).toContain('no Startup probe; no Liveness probe; no Readiness probe');
    expect(text).toContain('az containerapp update cannot set probes: apply infra/pilot');
    // It says how: the what-if first, with the environment the app is in and the image that runs, so that the
    // what-if shows the image unchanged.
    expect(text).toContain('export SERVICE_SWARM_RESOURCE_EXISTS=true');
    expect(text).toContain(`export SWARM_CONTAINER_IMAGE=${LOGIN_SERVER}/swarm@${digestOf(SHA_B)}`);
    expect(text).toContain('az deployment group what-if');
    expect(h.fake.mutations()).toEqual([]);
  });

  it('fails when the ingress targets the placeholder port', async () => {
    const world = newWorld();
    world.targetPort = 80;
    const h = harness({ world });
    expect((await check(h)).exitCode).toBe(1);
    expect(h.logs.join('\n')).toContain(
      'The ingress targets port 80, but the application listens on 3001',
    );
  });

  it('fails on the PORT the placeholder left behind, which the application refuses', async () => {
    const world = newWorld();
    world.env.find((entry) => entry.name === 'PORT')!.value = '80';
    world.revisions.get(OLD)!.env.find((entry) => entry.name === 'PORT')!.value = '80';
    const h = harness({ world });
    expect((await check(h)).exitCode).toBe(1);
    expect(h.logs.join('\n')).toContain('Invalid server configuration: PORT');
  });

  it('fails on a probe that asks the wrong route or the wrong port', async () => {
    const world = newWorld();
    for (const probes of [world.probes, world.revisions.get(OLD)!.probes]) {
      probes[2]!.httpGet.path = '/api/health';
      probes[0]!.httpGet.port = 80;
    }
    const h = harness({ world });
    expect((await check(h)).exitCode).toBe(1);
    const text = h.logs.join('\n');
    expect(text).toContain('the Readiness probe asks /api/health, not /api/health/ready');
    expect(text).toContain('the Startup probe uses port 80, not 3001');
  });

  it('checks the newest revision as well as the one that serves', async () => {
    const world = newWorld();
    // A revision made later, which serves nothing yet, with the probes gone.
    world.revisions.set(NEW, {
      ...world.revisions.get(OLD)!,
      name: NEW,
      probes: [],
    });
    world.latest = NEW;
    const h = harness({ world });
    const result = await check(h);
    expect(result.exitCode).toBe(1);
    expect(h.logs.join('\n')).toContain(`${NEW} (0% of traffic, the newest)`);
  });

  it('has nothing to check while the placeholder runs, and says so', async () => {
    const h = harness({ world: newWorld({ placeholder: true }) });
    const result = await check(h);
    expect(result.exitCode).toBe(0);
    expect(h.logs.join('\n')).toContain('placeholder');
  });

  it('fails when no revision receives traffic', async () => {
    const world = newWorld();
    world.traffic = [{ revisionName: OLD, weight: 0 }];
    const h = harness({ world });
    expect((await check(h)).exitCode).toBe(1);
    expect(h.logs.join('\n')).toContain('No revision receives traffic');
  });
});

describe('record: the release record of a revision that was made by hand', () => {
  it('proves the revision from Azure, runs the smoke test, and writes a record a release can use', async () => {
    const h = harness({ world: handMadeWorld() });
    const result = await record(recordWords(...confirm), h);

    expect(result).toMatchObject({ exitCode: 0, status: 'promoted' });
    const [written] = h.store.records;
    expect(written).toMatchObject({
      origin: 'by-hand',
      status: 'promoted',
      commit: { sha: SHA_B },
      image: {
        digest: digestOf(SHA_B),
        tag: `swarm:${SHA_B}`,
        tagLocked: true,
        reference: `${LOGIN_SERVER}/swarm@${digestOf(SHA_B)}`,
      },
      revision: { name: NEW, trafficWeight: 100 },
      // The placeholder is not a version to return to, so none is named.
      lastKnownGood: null,
      rollback: null,
      // Read from the schema file at that commit, so that the next release needs no --current-schema-version.
      migrations: { schemaVersionBefore: null, schemaVersionAfter: 9, applied: [] },
      smoke: { passed: true },
    });
    expect(written && validateRecord(written)).toEqual([]);
    // What is wrong is written down, not hidden: this revision has no probe.
    expect(written?.steps.map((step) => [step.step, step.status])).toEqual([
      ['record-by-hand', 'done'],
      ['config-check', 'failed'],
      ['smoke', 'done'],
    ]);
    expect(written?.steps[1]?.detail).toContain('probes');
    // Nothing in Azure was changed.
    expect(h.fake.mutations()).toEqual([]);
  });

  it('records no secret: the environment of the revision is redacted as in any record', async () => {
    const h = harness({ world: handMadeWorld() });
    await record(recordWords(...confirm), h);
    const text = JSON.stringify(h.store.records[0]);
    expect(text).not.toContain('not-a-real-key-value');
    expect(text).not.toContain('InstrumentationKey');
  });

  it('is a dry run unless it is told to execute: nothing is written and no smoke test is run', async () => {
    const h = harness({ world: handMadeWorld() });
    const result = await record(recordWords(), h);
    expect(result).toMatchObject({ exitCode: 0, status: 'dry-run', recordPath: null });
    expect(h.store.records).toEqual([]);
    expect(h.logs.join('\n')).toContain('DRY RUN  smoke: would run the pilot smoke test');
  });

  it('gives a rollback its last known good when the previous revision is named', async () => {
    const world = handMadeWorld({ probes: true });
    // The older real revision, kept warm at 0%.
    world.revisions.set(OLD, {
      ...world.revisions.get(NEW)!,
      name: OLD,
      image: `${LOGIN_SERVER}/swarm@${digestOf(SHA_A)}`,
    });
    const h = harness({ world });
    await record(
      recordWords('--previous', OLD, '--note', 'made with az containerapp update', ...confirm),
      h,
    );
    const [written] = h.store.records;
    expect(written?.lastKnownGood).toEqual({
      revision: OLD,
      image: `${LOGIN_SERVER}/swarm@${digestOf(SHA_A)}`,
      basis: 'named with --previous when the revision was recorded by hand',
    });
    expect(written?.rollback?.command).toContain('azure:release -- rollback');
    expect(written?.steps[0]?.detail).toBe('made with az containerapp update');
    expect(written?.steps.find((step) => step.step === 'config-check')?.status).toBe('done');

    // And the rollback reads it: with no --to, traffic goes back to the named revision.
    const back = await runRollback(parseReleaseArgs(['rollback', ...target, ...confirm]), h.deps);
    expect(back.status).toBe('rolled-back');
    expect(h.fake.servingNames()).toEqual([OLD]);
  });

  it.each([
    [
      'a revision that does not exist',
      (world: FakeWorld) => world.revisions.delete(NEW),
      /does not exist/u,
    ],
    [
      'a revision that is not running',
      (world: FakeWorld) => {
        world.revisions.get(NEW)!.running = 'Failed';
      },
      /not Running and healthy/u,
    ],
    [
      'a revision that runs another image than the digest',
      (world: FakeWorld) => {
        world.revisions.get(NEW)!.image = `${LOGIN_SERVER}/swarm@${digestOf(SHA_A)}`;
      },
      /does not carry the digest/u,
    ],
    [
      'a digest that is not the one the commit tag has',
      (world: FakeWorld) => {
        world.images.set(`swarm:${SHA_B}`, { digest: digestOf('another'), locked: true });
      },
      /does not belong to that commit/u,
    ],
    [
      'a commit that has no image',
      (world: FakeWorld) => world.images.delete(`swarm:${SHA_B}`),
      /has no image swarm:/u,
    ],
    [
      'a revision that serves only part of the traffic',
      (world: FakeWorld) => {
        world.traffic = [
          { revisionName: NEW, weight: 50 },
          { revisionName: `${APP}--bootstrap`, weight: 50 },
        ];
      },
      /does not serve all the traffic/u,
    ],
    [
      'a revision built from another commit than the one named',
      (world: FakeWorld) => {
        world.revisions.get(NEW)!.env.find((entry) => entry.name === 'BUILD_SHA')!.value = SHA_A;
      },
      /not built from|says it was built from/u,
    ],
  ])('refuses %s, and writes nothing', async (_name, mutate, message) => {
    const world = handMadeWorld();
    mutate(world);
    const h = harness({ world });
    await expect(record(recordWords(...confirm), h)).rejects.toThrow(message);
    expect(h.store.records).toEqual([]);
    expect(h.fake.mutations()).toEqual([]);
  });

  it('refuses a previous revision that does not exist', async () => {
    const h = harness({ world: handMadeWorld() });
    await expect(
      record(recordWords('--previous', `${APP}--rnotthere0000`, ...confirm), h),
    ).rejects.toThrow(/is not another revision/u);
  });

  it('refuses when the smoke test fails: that revision is not a last known good', async () => {
    const world = handMadeWorld();
    world.revisions.get(NEW)!.appHealthy = false;
    const h = harness({ world });
    await expect(record(recordWords(...confirm), h)).rejects.toThrow(/smoke test FAILED/u);
    expect(h.store.records).toEqual([]);
  });

  it('records an unknown schema version, and says so, when the commit is not in the clone', async () => {
    const h = harness({ world: handMadeWorld() });
    h.deps.git.show = async () => {
      throw new Error('fatal: invalid object name');
    };
    await record(recordWords(...confirm), h);
    expect(h.store.records[0]?.migrations.schemaVersionAfter).toBeNull();
    expect(h.logs.join('\n')).toContain('the schema version is recorded as unknown');
  });

  it('is refused from CI like every other change of the live pilot', async () => {
    const h = harness({ world: handMadeWorld(), ci: 'true' });
    await expect(record(recordWords(...confirm), h)).rejects.toThrow(Refusal);
    expect(h.fake.world.calls).toEqual([]);
  });
});

describe('record: its arguments', () => {
  it.each([
    [
      ['record', ...target, '--registry', REGISTRY, '--commit', SHA_B, '--digest', digestOf(SHA_B)],
      /--revision/u,
    ],
    [
      ['record', ...target, '--registry', REGISTRY, '--commit', SHA_B, '--revision', NEW],
      /--digest/u,
    ],
    [
      ['record', ...target, '--registry', REGISTRY, '--revision', NEW, '--digest', digestOf(SHA_B)],
      /--commit/u,
    ],
    [recordWords('--digest', 'sha256:short'), /--digest/u],
    [
      ['record', ...target, '--commit', SHA_B, '--revision', NEW, '--digest', digestOf(SHA_B)],
      /--registry/u,
    ],
    [recordWords('--note', 'two\nlines'), /--note/u],
  ])('refuses %j', (words, message) => {
    expect(() => parseReleaseArgs(words)).toThrow(message);
  });
});

describe('build: the image of a commit, locked, and how to put it on the app', () => {
  it('is a dry run by default: it changes nothing and prints the commands', async () => {
    const h = harness({ world: newWorld({ placeholder: true }) });
    const result = await runBuild(parseReleaseArgs(buildWords()), h.deps);
    expect(result).toMatchObject({ exitCode: 0, status: 'dry-run', record: null });
    expect(h.fake.mutations()).toEqual([]);
    expect(h.store.records).toEqual([]);
    expect(h.logs.join('\n')).toContain(`would run  az acr build --registry ${REGISTRY}`);
  });

  it('builds, locks the tag, and prints the image and the template command that puts it on the app', async () => {
    const h = harness({ world: newWorld({ placeholder: true }) });
    const result = await runBuild(parseReleaseArgs(buildWords(...confirm)), h.deps);
    expect(result.exitCode).toBe(0);
    expect(kinds(h.fake.mutations())).toEqual(['build', 'lock-tag']);
    expect(h.fake.world.images.get(`swarm:${SHA_B}`)).toEqual({
      digest: digestOf(SHA_B),
      locked: true,
    });
    const text = h.logs.join('\n');
    const reference = `${LOGIN_SERVER}/swarm@${digestOf(SHA_B)}`;
    expect(text).toContain(`Image: ${reference}`);
    expect(text).toContain('export SERVICE_SWARM_RESOURCE_EXISTS=true');
    expect(text).toContain(`export SWARM_CONTAINER_IMAGE=${reference}`);
    expect(text).toContain(`export SWARM_REVISION_SUFFIX=r${SHA_B.slice(0, 12)}`);
    expect(text).toContain(`export SWARM_BUILD_SHA=${SHA_B}`);
    expect(text).toMatch(
      /export SWARM_EXISTING_CONTAINER_APPS_ENVIRONMENT_ID=\/subscriptions\/.*\/managedEnvironments\/cae-swarm-pilot/u,
    );
    expect(text).toContain('az deployment group what-if');
    expect(text).toContain(`azure:release -- record`);
    expect(text).toContain(`--digest ${digestOf(SHA_B)}`);
    // No revision was made and nothing was recorded: it is the template that puts the image on the app.
    expect(h.store.records).toEqual([]);
    expect(h.fake.world.revisions.size).toBe(1);
  });

  it('reuses a locked image instead of rebuilding it: a locked tag cannot be rebuilt', async () => {
    const h = harness({ world: newWorld({ placeholder: true }) });
    h.fake.world.images.set(`swarm:${SHA_B}`, { digest: digestOf(SHA_B), locked: true });
    await runBuild(parseReleaseArgs(buildWords(...confirm)), h.deps);
    expect(h.fake.mutations()).toEqual([]);
    expect(h.logs.join('\n')).toContain('is reused, not rebuilt');
    expect(h.logs.join('\n')).toContain(`Image: ${LOGIN_SERVER}/swarm@${digestOf(SHA_B)}`);
  });

  it('refuses a working tree with uncommitted changes, and a commit that is not HEAD', async () => {
    await expect(
      runBuild(parseReleaseArgs(buildWords(...confirm)), harness({ clean: false }).deps),
    ).rejects.toThrow(/uncommitted changes/u);
    await expect(
      runBuild(parseReleaseArgs(buildWords('--commit', SHA_A, ...confirm)), harness().deps),
    ).rejects.toThrow(/must be HEAD/u);
  });
});
