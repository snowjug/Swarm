import { describe, expect, it } from 'vitest';
import { UsageError } from './args.js';
import { parseDrillArgs } from './drill-args.js';
import {
  evaluateDrill,
  memoryDrillStore,
  runDrill,
  type DrillDeps,
  type Measurements,
} from './drill-flow.js';
import {
  APP,
  DOMAIN,
  GROUP,
  SHA_A,
  SUB,
  fakeAzure,
  fakeSmoke,
  newWorld,
  type FakeWorld,
} from './fixtures/fake-containerapp.js';

const PREVIOUS = `${APP}--r${SHA_A.slice(0, 12)}`;
const PUBLIC_HOST = `${APP}.${DOMAIN}`;

const base = [
  '--subscription',
  SUB,
  '--resource-group',
  GROUP,
  '--app',
  APP,
  '--observe-seconds',
  '10',
];
const live = [...base, '--execute', '--confirm-resource-group', GROUP];

function harness(options: { world?: FakeWorld; ci?: string } = {}) {
  const fake = fakeAzure(options.world ?? newWorld());
  const store = memoryDrillStore();
  const logs: string[] = [];
  const polls = { public: 0, failOn: new Set<number>(), failOwn: false };
  const deps: DrillDeps = {
    az: fake.az,
    store,
    smoke: fakeSmoke(fake.world),
    health: async (host) => {
      if (host === PUBLIC_HOST) {
        polls.public += 1;
        return polls.failOn.has(polls.public)
          ? { ok: false, detail: 'HTTP 503' }
          : { ok: true, detail: 'HTTP 200, ready, database ok' };
      }
      return polls.failOwn
        ? { ok: false, detail: 'HTTP 503' }
        : { ok: true, detail: 'HTTP 200, ready, database ok' };
    },
    now: () => new Date(fake.world.clock.now),
    sleep: async (milliseconds) => {
      fake.world.clock.now += milliseconds;
    },
    log: (line) => logs.push(line),
    ci: options.ci,
  };
  return { fake, store, logs, deps, polls };
}

const kinds = (calls: string[][]): string[] =>
  calls.map((call) => {
    if (call[2] === 'traffic') return 'traffic';
    if (call[1] === 'update') return 'update';
    return String(call[2]);
  });

const run = (words: string[], h: ReturnType<typeof harness>) =>
  runDrill(parseDrillArgs(words), h.deps);

const drillRevision = (h: ReturnType<typeof harness>) =>
  [...h.fake.world.revisions.values()].find((revision) => revision.name.includes('--drill'));

describe('a dry run is the default', () => {
  it('reads, changes nothing, writes nothing, and prints every command the drill would run', async () => {
    const h = harness();
    const result = await run(base, h);

    expect(result).toMatchObject({ exitCode: 0, status: 'dry-run', recordPath: null });
    expect(h.fake.mutations()).toEqual([]);
    expect(h.store.records).toEqual([]);
    const text = h.logs.join('\n');
    expect(text).toContain('DRY RUN of the rollback drill');
    expect(text).toContain('would run  az containerapp update');
    expect(text).toContain('--set-env-vars SWARM_DRILL_ID=drill-');
    expect(text).toContain('would run  az containerapp ingress traffic set');
    expect(text).toContain('would run  az containerapp revision deactivate');
    expect(text).not.toContain('revision activate');
  });

  it('also lists retiring and restarting the previous revision with --cold', async () => {
    const h = harness();
    await run([...base, '--cold'], h);
    const text = h.logs.join('\n');
    expect(text).toContain('would run  az containerapp revision activate');
    expect(h.fake.mutations()).toEqual([]);
  });
});

describe('a live drill is refused unless it is explicit', () => {
  it('needs --confirm-resource-group, spelled out and equal, before any call is made', async () => {
    for (const words of [
      [...base, '--execute'],
      [...base, '--execute', '--confirm-resource-group', 'rg-other'],
    ]) {
      const h = harness();
      await expect(run(words, h)).rejects.toThrow(/--confirm-resource-group rg-swarm-pilot/u);
      expect(h.fake.world.calls).toEqual([]);
    }
  });

  it('is refused from CI', async () => {
    const h = harness({ ci: 'true' });
    await expect(run(live, h)).rejects.toThrow(/Refusing to change Azure from CI/u);
    expect(h.fake.world.calls).toEqual([]);
  });

  it.each([
    [
      'the placeholder is still running',
      (world: FakeWorld) => Object.assign(world, newWorld({ placeholder: true })),
      /placeholder image/u,
    ],
    [
      'traffic is split',
      (world: FakeWorld) => {
        world.traffic = [
          { revisionName: PREVIOUS, weight: 90 },
          { revisionName: PREVIOUS, weight: 10 },
        ];
      },
      /split or unset/u,
    ],
    [
      'another revision is still active',
      (world: FakeWorld) => {
        world.revisions.set(`${APP}--rcccccccccccc`, {
          ...world.revisions.get(PREVIOUS)!,
          name: `${APP}--rcccccccccccc`,
        });
      },
      /Other revisions are still active/u,
    ],
    [
      'the serving revision is not running',
      (world: FakeWorld) => {
        world.revisions.get(PREVIOUS)!.replicas = 0;
      },
      /not Running with a replica/u,
    ],
  ])('stops before changing anything when %s', async (_name, mutate, message) => {
    const world = newWorld();
    mutate(world);
    const h = harness({ world });
    await expect(run(live, h)).rejects.toThrow(message);
    expect(h.fake.mutations()).toEqual([]);
  });
});

describe('a drill', () => {
  it('copies the serving image, shifts to the copy, rolls back, measures, and cleans up', async () => {
    const h = harness();
    const before = h.fake.world.revisions.get(PREVIOUS)!.image;
    const result = await run(live, h);

    expect(result).toMatchObject({ exitCode: 0, status: 'passed' });
    expect(kinds(h.fake.mutations())).toEqual(['update', 'traffic', 'traffic', 'deactivate']);
    const update = h.fake.mutations()[0]!;
    expect(update[update.indexOf('--image') + 1]).toBe(before);
    expect(h.fake.servingNames()).toEqual([PREVIOUS]);
    expect(drillRevision(h)?.active).toBe(false);
    expect(h.fake.world.revisions.get(PREVIOUS)).toMatchObject({
      active: true,
      running: 'Running',
    });

    const record = h.store.records[0]!;
    expect(h.store.records).toHaveLength(1);
    expect(record.status).toBe('passed');
    expect(record.criteria.every((criterion) => criterion.passed)).toBe(true);
    expect(record.criteria.map((criterion) => criterion.id)).toEqual([
      'baseline-smoke',
      'drill-revision-ready',
      'shift-continuity',
      'previous-revision-warm',
      'rollback-time',
      'rollback-continuity',
      'smoke-after-rollback',
      'cleanup',
    ]);
    expect(record.measurements.shift).toEqual({ polls: 10, failed: 0 });
    expect(record.measurements.rollback).toMatchObject({
      polls: 10,
      failed: 0,
      previousWarm: true,
    });
    expect(h.logs.join('\n')).toContain('Drill PASSED');
  });

  it('records nothing that could be a secret: not the application settings, only its own marker', async () => {
    const h = harness();
    await run(live, h);
    const text = JSON.stringify(h.store.records);
    expect(text).not.toContain('not-a-real-key-value');
    expect(text).not.toContain('InstrumentationKey');
    expect(text).not.toContain('postgres://');
    expect(h.fake.mutations()[0]!.join(' ')).toContain('SWARM_DRILL_ID=drill-');
  });

  it('pins traffic first when it named "the newest revision", so the copy takes none', async () => {
    const world = newWorld();
    world.traffic = [{ latestRevision: true, weight: 100 }];
    const h = harness({ world });
    await run(live, h);
    expect(kinds(h.fake.mutations()).slice(0, 2)).toEqual(['traffic', 'update']);
    expect(h.fake.mutations()[0]!.join(' ')).toContain(`--revision-weight ${PREVIOUS}=100`);
  });

  it('stops without changing anything when the smoke test fails before it starts', async () => {
    const world = newWorld();
    world.revisions.get(PREVIOUS)!.appHealthy = false;
    const h = harness({ world });
    const result = await run(live, h);
    expect(result).toMatchObject({ exitCode: 1, status: 'failed' });
    expect(h.fake.mutations()).toEqual([]);
    expect(h.store.records[0]?.error).toMatch(/nothing was changed/u);
  });

  it('fails the drill, and still cleans up, when readiness fails after the rollback', async () => {
    const h = harness();
    // Polls 1-10 follow the shift, 11-20 the rollback.
    for (const poll of [12, 13]) h.polls.failOn.add(poll);
    const result = await run(live, h);

    expect(result).toMatchObject({ exitCode: 1, status: 'failed' });
    const failed = result.record.criteria.filter((criterion) => !criterion.passed);
    expect(failed.map((criterion) => criterion.id)).toEqual(['rollback-continuity']);
    expect(failed[0]?.detail).toBe('2 of 10 failed');
    expect(h.fake.servingNames()).toEqual([PREVIOUS]);
    expect(drillRevision(h)?.active).toBe(false);
    expect(h.logs.join('\n')).toContain('Drill FAILED');
  });

  it('tolerates exactly as many failed polls as it was told to', async () => {
    const h = harness();
    for (const poll of [3, 14, 15]) h.polls.failOn.add(poll);
    const result = await run([...live, '--max-failed-polls', '2'], h);
    expect(result.record.criteria.find((c) => c.id === 'shift-continuity')?.passed).toBe(true);
    expect(result.record.criteria.find((c) => c.id === 'rollback-continuity')?.passed).toBe(true);
    const strict = harness();
    for (const poll of [3]) strict.polls.failOn.add(poll);
    expect(
      (await run(live, strict)).record.criteria.find((c) => c.id === 'shift-continuity')?.passed,
    ).toBe(false);
  });

  it('aborts, moves no traffic and stops the copy when the copy does not start', async () => {
    const world = newWorld();
    world.failNextRevision = true;
    const h = harness({ world });
    const result = await run(live, h);

    expect(result).toMatchObject({ exitCode: 1, status: 'aborted' });
    expect(result.record.error).toMatch(/did not start/u);
    expect(h.fake.servingNames()).toEqual([PREVIOUS]);
    expect(kinds(h.fake.mutations())).toEqual(['update', 'deactivate']);
    expect(h.store.records[0]?.status).toBe('aborted');
  });

  it('aborts and puts traffic back when the copy is not ready on its own address', async () => {
    const h = harness();
    h.polls.failOwn = true;
    const result = await run(live, h);
    expect(result).toMatchObject({ exitCode: 1, status: 'aborted' });
    expect(h.fake.servingNames()).toEqual([PREVIOUS]);
    expect(drillRevision(h)?.active).toBe(false);
  });
});

describe('the cold drill', () => {
  it('retires the previous revision, starts it again, times that, and rolls back to it', async () => {
    const h = harness();
    const result = await run([...live, '--cold'], h);

    expect(result).toMatchObject({ exitCode: 0, status: 'passed' });
    expect(kinds(h.fake.mutations())).toEqual([
      'update',
      'traffic',
      'traffic',
      'traffic',
      'deactivate',
      'activate',
      'traffic',
      'deactivate',
    ]);
    expect(h.fake.servingNames()).toEqual([PREVIOUS]);
    expect(result.record.measurements.cold).toMatchObject({ smokePassed: true });
    expect(result.record.measurements.cold?.readySeconds).not.toBeNull();
    expect(result.record.criteria.map((criterion) => criterion.id)).toContain(
      'cold-rollback-ready',
    );
  });

  it('leaves traffic on the copy, running, when the retired revision will not start again', async () => {
    const h = harness();
    // The only activation in a cold drill is of the previous revision.
    const original = h.fake.az.text.bind(h.fake.az);
    h.fake.az.text = async (args) => {
      if (args[1] === 'revision' && args[2] === 'activate') h.fake.world.hangNextActivation = true;
      return original(args);
    };
    const result = await run([...live, '--cold', '--ready-timeout-minutes', '1'], h);

    expect(result).toMatchObject({ exitCode: 1, status: 'failed' });
    expect(result.record.measurements.cold).toMatchObject({ readySeconds: null });
    expect(h.fake.servingNames()).toEqual([drillRevision(h)?.name]);
    expect(drillRevision(h)?.active).toBe(true);
    expect(h.logs.join('\n')).toContain('Could not put things back by itself');
    expect(h.logs.join('\n')).toContain('by hand');
  });
});

describe('the pass criteria', () => {
  const thresholds = {
    observeSeconds: 45,
    rollbackDeadlineSeconds: 60,
    maxFailedPolls: 0,
    readyTimeoutMinutes: 10,
    cold: false,
  };
  const good: Measurements = {
    baselineSmokePassed: true,
    drillRevisionReady: true,
    shift: { polls: 45, failed: 0 },
    previousWarmAfterShift: true,
    rollback: { controlPlaneSeconds: 12, polls: 45, failed: 0, previousWarm: true },
    smokeAfterRollback: true,
    cleanedUp: true,
    cold: null,
  };

  it('passes a complete, clean measurement, and fails everything that was not measured', () => {
    expect(evaluateDrill(good, thresholds).every((criterion) => criterion.passed)).toBe(true);
    const nothing = evaluateDrill(
      {
        baselineSmokePassed: null,
        drillRevisionReady: null,
        shift: null,
        previousWarmAfterShift: null,
        rollback: null,
        smokeAfterRollback: null,
        cleanedUp: null,
        cold: null,
      },
      thresholds,
    );
    expect(nothing.every((criterion) => !criterion.passed)).toBe(true);
    expect(
      nothing.every(
        (criterion) =>
          /not measured|never showed|no$/u.test(criterion.detail) ||
          criterion.detail.includes('not measured'),
      ),
    ).toBe(true);
  });

  it('applies the deadline inclusively and the failed-poll limit exactly', () => {
    const at = (seconds: number | null) =>
      evaluateDrill(
        {
          ...good,
          rollback: { controlPlaneSeconds: seconds, polls: 45, failed: 0, previousWarm: true },
        },
        thresholds,
      ).find((criterion) => criterion.id === 'rollback-time')?.passed;
    expect(at(60)).toBe(true);
    expect(at(61)).toBe(false);
    expect(at(null)).toBe(false);
    const withFailures = (failed: number, maxFailedPolls: number) =>
      evaluateDrill(
        { ...good, rollback: { controlPlaneSeconds: 1, polls: 45, failed, previousWarm: true } },
        { ...thresholds, maxFailedPolls },
      ).find((criterion) => criterion.id === 'rollback-continuity')?.passed;
    expect(withFailures(0, 0)).toBe(true);
    expect(withFailures(1, 0)).toBe(false);
    expect(withFailures(3, 3)).toBe(true);
  });

  it('adds the cold criteria only when the cold drill was asked for', () => {
    const ids = (cold: boolean) =>
      evaluateDrill(
        { ...good, cold: { readySeconds: 40, smokePassed: true } },
        { ...thresholds, cold },
      ).map((criterion) => criterion.id);
    expect(ids(false)).not.toContain('cold-rollback-ready');
    expect(ids(true)).toEqual(
      expect.arrayContaining(['cold-rollback-ready', 'cold-rollback-smoke']),
    );
  });
});

describe('the drill arguments', () => {
  it('require an explicit subscription and group and app, and bound every number', () => {
    expect(() => parseDrillArgs([])).toThrow(UsageError);
    expect(() =>
      parseDrillArgs(['--subscription', 'default', '--resource-group', GROUP, '--app', APP]),
    ).toThrow(/guid/u);
    expect(() => parseDrillArgs([...base, '--observe-seconds', '5'])).toThrow(/10 to 600/u);
    expect(() => parseDrillArgs([...base.slice(0, 6), '--max-failed-polls', '99'])).toThrow(
      UsageError,
    );
    expect(() => parseDrillArgs([...base, 'extra'])).toThrow(UsageError);
    expect(parseDrillArgs(base.slice(0, 6))).toMatchObject({
      execute: false,
      cold: false,
      observeSeconds: 45,
      rollbackDeadlineSeconds: 60,
      maxFailedPolls: 0,
      recordDir: '.azure/drills',
    });
  });
});
