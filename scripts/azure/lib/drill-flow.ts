import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  commands,
  isPlaceholder,
  isRunningState,
  readApp,
  revisionNamed,
  servingRevisions,
  type AppState,
} from './containerapp.js';
import type { DrillArgs } from './drill-args.js';
import {
  Refusal,
  createRunner,
  guardLive,
  loadTarget,
  scopeOf,
  waitReady,
  type ReleaseDeps,
} from './release-flow.js';
import { summariseSmoke, type StepRecord } from './release-record.js';

/**
 * The rollback drill: a rehearsal of the way back, on the real app, with the same image, BEFORE real data
 * is entrusted to it. It releases a "drill" revision that is a copy of what serves (same image, one extra
 * harmless environment variable), shifts traffic to it, rolls traffic back, and measures: whether the
 * previous revision stayed warm, how long the control plane took to show the rollback, how many readiness
 * polls failed on the way, and whether the smoke test passes after. With --cold it also retires the
 * previous revision and rolls back to it, which is a start and not a switch, and times that.
 *
 * Nothing here has run against Azure. The flow is tested against a fake; the drill itself is an owner
 * action (docs/production/release-process.md), and until the owner has run it and kept the record, nobody
 * may say that rollback works.
 *
 * What it cannot prove: a readiness poll does not say which revision answered, so the drill shows the app
 * stays available through the shift and the rollback and that the control plane agrees where traffic is,
 * not which revision served a given request.
 */

export const DRILL_SCHEMA_VERSION = 1;

export type DrillStatus = 'dry-run' | 'in-progress' | 'passed' | 'failed' | 'aborted';

export interface Criterion {
  id: string;
  title: string;
  passed: boolean;
  detail: string;
}

export interface Measurements {
  baselineSmokePassed: boolean | null;
  drillRevisionReady: boolean | null;
  shift: { polls: number; failed: number } | null;
  previousWarmAfterShift: boolean | null;
  rollback: {
    controlPlaneSeconds: number | null;
    polls: number;
    failed: number;
    previousWarm: boolean | null;
  } | null;
  smokeAfterRollback: boolean | null;
  cleanedUp: boolean | null;
  cold: { readySeconds: number | null; smokePassed: boolean | null } | null;
}

export interface DrillRecord {
  schemaVersion: number;
  drillId: string;
  kind: 'rollback-drill';
  status: DrillStatus;
  startedAt: string;
  finishedAt: string | null;
  target: { resourceGroup: string; app: string };
  thresholds: {
    observeSeconds: number;
    rollbackDeadlineSeconds: number;
    maxFailedPolls: number;
    readyTimeoutMinutes: number;
    cold: boolean;
  };
  lastKnownGood: { revision: string; image: string };
  drillRevision: { name: string; suffix: string };
  measurements: Measurements;
  criteria: Criterion[];
  smoke: ReturnType<typeof summariseSmoke> | null;
  steps: StepRecord[];
  error: string | null;
}

export interface DrillStore {
  write(record: DrillRecord): Promise<string>;
}

export function fileDrillStore(directory: string): DrillStore {
  return {
    async write(record) {
      await mkdir(directory, { recursive: true });
      const path = join(directory, `${record.drillId}.json`);
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporary, path);
      return path;
    },
  };
}

export function memoryDrillStore(): DrillStore & { records: DrillRecord[] } {
  const records: DrillRecord[] = [];
  return {
    records,
    async write(record) {
      const copy = structuredClone(record);
      const index = records.findIndex((existing) => existing.drillId === record.drillId);
      if (index >= 0) records[index] = copy;
      else records.push(copy);
      return `memory:${record.drillId}`;
    },
  };
}

export interface DrillDeps extends Pick<
  ReleaseDeps,
  'az' | 'smoke' | 'health' | 'now' | 'sleep' | 'log' | 'ci'
> {
  store: DrillStore;
}

export interface DrillResult {
  exitCode: 0 | 1;
  status: DrillStatus;
  record: DrillRecord;
  recordPath: string | null;
}

const emptyMeasurements = (): Measurements => ({
  baselineSmokePassed: null,
  drillRevisionReady: null,
  shift: null,
  previousWarmAfterShift: null,
  rollback: null,
  smokeAfterRollback: null,
  cleanedUp: null,
  cold: null,
});

type Thresholds = DrillRecord['thresholds'];

const yesNo = (value: boolean | null): string =>
  value === null ? 'not measured' : value ? 'yes' : 'no';

/** The pass criteria. Pure, so that the document that states them and the code that applies them agree. */
export function evaluateDrill(measured: Measurements, thresholds: Thresholds): Criterion[] {
  const criteria: Criterion[] = [];
  const add = (id: string, title: string, passed: boolean, detail: string) =>
    criteria.push({ id, title, passed, detail });

  add(
    'baseline-smoke',
    'The smoke test passed on the serving revision before anything was changed',
    measured.baselineSmokePassed === true,
    yesNo(measured.baselineSmokePassed),
  );
  add(
    'drill-revision-ready',
    'The drill revision started and answered readiness on its own address while it had no traffic',
    measured.drillRevisionReady === true,
    yesNo(measured.drillRevisionReady),
  );
  add(
    'shift-continuity',
    `No more than ${thresholds.maxFailedPolls} failed readiness poll(s) in the ${thresholds.observeSeconds} s after traffic moved to the drill revision`,
    measured.shift !== null &&
      measured.shift.polls > 0 &&
      measured.shift.failed <= thresholds.maxFailedPolls,
    measured.shift ? `${measured.shift.failed} of ${measured.shift.polls} failed` : 'not measured',
  );
  const rollback = measured.rollback;
  add(
    'previous-revision-warm',
    'The previous revision stayed active, Running, with at least one replica, after the shift and after the rollback',
    measured.previousWarmAfterShift === true && rollback?.previousWarm === true,
    `after the shift: ${yesNo(measured.previousWarmAfterShift)}; after the rollback: ${yesNo(rollback?.previousWarm ?? null)}`,
  );
  add(
    'rollback-time',
    `The control plane showed the previous revision with 100% of traffic within ${thresholds.rollbackDeadlineSeconds} s of the rollback command being issued`,
    rollback?.controlPlaneSeconds != null &&
      rollback.controlPlaneSeconds <= thresholds.rollbackDeadlineSeconds,
    rollback?.controlPlaneSeconds != null
      ? `${rollback.controlPlaneSeconds} s, command included`
      : 'never showed it',
  );
  add(
    'rollback-continuity',
    `No more than ${thresholds.maxFailedPolls} failed readiness poll(s) in the ${thresholds.observeSeconds} s after the rollback`,
    rollback !== null && rollback.polls > 0 && rollback.failed <= thresholds.maxFailedPolls,
    rollback ? `${rollback.failed} of ${rollback.polls} failed` : 'not measured',
  );
  add(
    'smoke-after-rollback',
    'The smoke test passed after the rollback',
    measured.smokeAfterRollback === true,
    yesNo(measured.smokeAfterRollback),
  );
  add(
    'cleanup',
    'The drill revision was deactivated and the previous revision serves all traffic again',
    measured.cleanedUp === true,
    yesNo(measured.cleanedUp),
  );
  if (thresholds.cold) {
    const cold = measured.cold;
    add(
      'cold-rollback-ready',
      `A deactivated previous revision was started and ran within ${thresholds.readyTimeoutMinutes} min`,
      cold?.readySeconds != null,
      cold?.readySeconds != null ? `${cold.readySeconds} s to Running` : 'it did not run in time',
    );
    add(
      'cold-rollback-smoke',
      'The smoke test passed after the cold rollback',
      cold?.smokePassed === true,
      yesNo(cold?.smokePassed ?? null),
    );
  }
  return criteria;
}

const isWarm = (state: AppState, name: string): boolean => {
  const revision = revisionNamed(state, name);
  return (
    revision !== undefined &&
    revision.active &&
    isRunningState(revision.running) &&
    (revision.replicas ?? 0) >= 1
  );
};

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/** UTC time as YYMMDDHHMMSS: unique to the second, and short enough for a revision name. */
function stamp(now: Date): string {
  return `${pad(now.getUTCFullYear() % 100, 2)}${pad(now.getUTCMonth() + 1, 2)}${pad(now.getUTCDate(), 2)}${pad(now.getUTCHours(), 2)}${pad(now.getUTCMinutes(), 2)}${pad(now.getUTCSeconds(), 2)}`;
}

export async function runDrill(args: DrillArgs, deps: DrillDeps): Promise<DrillResult> {
  guardLive(args, deps);
  const scope = scopeOf(args);
  const { log } = deps;
  const state = await loadTarget(args, deps);

  if (isPlaceholder(state.image)) {
    throw new Refusal(
      'The app still runs the placeholder image: there is no release to roll back from. Release first, then drill.',
    );
  }
  const serving = servingRevisions(state);
  const only = serving.length === 1 ? serving[0] : undefined;
  if (!only || only.weight !== 100) {
    throw new Refusal(
      `Traffic is split or unset (${serving.map((entry) => `${entry.name}=${entry.weight}`).join(', ') || 'no revision serves'}). A drill needs one revision serving everything: finish or roll back the release in progress first.`,
    );
  }
  const previousName = only.name;
  const others = state.revisions.filter(
    (revision) => revision.active && revision.name !== previousName,
  );
  if (others.length > 0) {
    throw new Refusal(
      `Other revisions are still active (${others.map((revision) => revision.name).join(', ')}). Finalize or deactivate them first, so the drill adds exactly one more revision and the number of job runners is known.`,
    );
  }
  if (!isWarm(state, previousName)) {
    throw new Refusal(
      `The revision that serves (${previousName}) is not Running with a replica: fix it before a drill.`,
    );
  }
  const image = revisionNamed(state, previousName)?.image ?? state.image;
  if (!image) throw new Refusal('The serving revision reports no image, so it cannot be copied.');
  if (!state.fqdn) throw new Refusal('The app reports no public address to measure.');

  const now = deps.now();
  const suffix = `drill${stamp(now)}`;
  const drillName = `${args.app}--${suffix}`;
  if (revisionNamed(state, drillName)) {
    throw new Refusal(`Revision ${drillName} already exists: wait a second and run again.`);
  }
  const drillId = `drill-${now
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d+Z$/u, 'Z')}`;
  const publicUrl = `https://${state.fqdn}`;

  const record: DrillRecord = {
    schemaVersion: DRILL_SCHEMA_VERSION,
    drillId,
    kind: 'rollback-drill',
    status: args.execute ? 'in-progress' : 'dry-run',
    startedAt: now.toISOString(),
    finishedAt: null,
    target: { resourceGroup: args.resourceGroup, app: args.app },
    thresholds: {
      observeSeconds: args.observeSeconds,
      rollbackDeadlineSeconds: args.rollbackDeadlineSeconds,
      maxFailedPolls: args.maxFailedPolls,
      readyTimeoutMinutes: args.readyTimeoutMinutes,
      cold: args.cold,
    },
    lastKnownGood: { revision: previousName, image },
    drillRevision: { name: drillName, suffix },
    measurements: emptyMeasurements(),
    criteria: [],
    smoke: null,
    steps: [],
    error: null,
  };
  const runner = createRunner(args, deps, record.steps);
  const note = (step: string, detail: string, status: StepRecord['status'] = 'done') =>
    record.steps.push({ step, status, at: deps.now().toISOString(), detail });

  log(
    `${args.execute ? 'LIVE ROLLBACK DRILL' : 'DRY RUN of the rollback drill (nothing will be changed; add --execute and --confirm-resource-group to run it)'}: ${args.app} in ${args.resourceGroup}`,
  );
  log(
    `Serving now: ${previousName}. The drill copies its image into ${drillName}, shifts to it, and rolls back.`,
  );

  const explicit =
    state.traffic.length === 1 &&
    state.traffic[0]?.revisionName === previousName &&
    !state.traffic[0]?.latestRevision;
  const pin = async () => {
    if (explicit) return;
    await runner.mutate(
      'pin-traffic',
      commands.trafficSet(scope, [{ revision: previousName, weight: 100 }]),
      'traffic named the newest revision; the drill revision would have taken it',
    );
  };
  const createDrill = () =>
    runner.mutate(
      'create-drill-revision',
      commands.update(scope, image, suffix, [`SWARM_DRILL_ID=${drillId}`]),
      'the same image with one extra environment variable that the application does not read',
    );
  const toDrill = () =>
    runner.mutate(
      'shift-to-drill',
      commands.trafficSet(scope, [
        { revision: drillName, weight: 100 },
        { revision: previousName, weight: 0 },
      ]),
    );
  const toPrevious = (detail?: string) =>
    runner.mutate(
      'rollback',
      commands.trafficSet(scope, [
        { revision: previousName, weight: 100 },
        { revision: drillName, weight: 0 },
      ]),
      detail,
    );

  if (!args.execute) {
    log('DRY RUN  baseline: would run the smoke test on the serving revision; stops if it fails');
    await pin();
    await createDrill();
    log(`DRY RUN  wait-ready: would wait up to ${args.readyTimeoutMinutes} min for ${drillName}`);
    log(`DRY RUN  own-address: would GET /api/health/ready on ${drillName}'s own address`);
    await toDrill();
    log(`DRY RUN  observe: would poll readiness once a second for ${args.observeSeconds} s`);
    await toPrevious();
    log(
      `DRY RUN  measure: would time how long the control plane takes to show ${previousName} at 100% (limit ${args.rollbackDeadlineSeconds} s), poll readiness for ${args.observeSeconds} s, and run the smoke test`,
    );
    if (args.cold) {
      await toDrill();
      await runner.mutate(
        'retire-previous',
        commands.deactivate(scope, previousName),
        'simulates "finalize": the previous revision stops',
      );
      await runner.mutate(
        'cold-activate',
        commands.activate(scope, previousName),
        'a start, not a switch: this is the slow way back, and it is timed',
      );
      log(
        `DRY RUN  cold-ready: would wait for ${previousName} to run, then roll back and run the smoke test`,
      );
    }
    await runner.mutate(
      'cleanup',
      commands.deactivate(scope, drillName),
      'the drill revision stops',
    );
    log('DRY RUN  record: would write the drill record with each criterion and its measurement');
    return { exitCode: 0, status: 'dry-run', record, recordPath: null };
  }

  let recordPath = await deps.store.write(record);
  let drillCreated = false;
  const finish = async (status: DrillStatus, error: string | null): Promise<DrillResult> => {
    record.status = status;
    record.error = error;
    record.finishedAt = deps.now().toISOString();
    record.criteria = evaluateDrill(record.measurements, record.thresholds);
    recordPath = await deps.store.write(record);
    return { exitCode: status === 'passed' ? 0 : 1, status, record, recordPath };
  };

  /** Puts things back as they were, as far as it safely can, and says so when it cannot. */
  const restore = async (why: 'cleanup' | 'abort') => {
    if (!drillCreated) return;
    try {
      let current = await readApp(deps.az, scope);
      if (!isWarm(current, previousName)) {
        if (revisionNamed(current, previousName)?.active === false) {
          await runner.mutate(
            'restore-activate-previous',
            commands.activate(scope, previousName),
            `${previousName} had been retired by the drill`,
          );
        }
        await waitReady({ ...args, readyTimeoutMinutes: 2 }, deps, previousName);
        current = await readApp(deps.az, scope);
      }
      const nowServing = servingRevisions(current);
      if (!(nowServing.length === 1 && nowServing[0]?.name === previousName)) {
        await toPrevious(`puts traffic back on ${previousName}`);
      }
      if (revisionNamed(current, drillName)?.active) {
        await runner.mutate('cleanup', commands.deactivate(scope, drillName));
      }
      log(
        `${why === 'abort' ? 'Restored' : 'Cleaned up'}: ${previousName} serves all traffic and ${drillName} is stopped.`,
      );
    } catch (error) {
      log(
        `Could not put things back by itself (${error instanceof Error ? error.message : 'unknown'}). Traffic was left where it is. ${drillName} is the drill revision, a copy of ${previousName}: put traffic back on ${previousName} and deactivate ${drillName} by hand (az containerapp ingress traffic set, az containerapp revision deactivate), after checking with "npm run azure:release -- status".`,
      );
    }
  };

  const observe = async (host: string): Promise<{ polls: number; failed: number }> => {
    let failed = 0;
    let first: string | null = null;
    for (let second = 0; second < args.observeSeconds; second += 1) {
      const verdict = await deps.health(host);
      if (!verdict.ok) {
        failed += 1;
        first ??= verdict.detail;
      }
      await deps.sleep(1000);
    }
    if (first)
      log(`Readiness polls failed: ${failed} of ${args.observeSeconds} (first: ${first}).`);
    return { polls: args.observeSeconds, failed };
  };

  try {
    // 1. The baseline: the drill measures a change, so it needs a healthy "before".
    const baseline = await deps.smoke(publicUrl);
    record.measurements.baselineSmokePassed = baseline.passed;
    record.smoke = summariseSmoke(baseline);
    note(
      'baseline-smoke',
      baseline.passed ? 'passed' : 'FAILED',
      baseline.passed ? 'done' : 'failed',
    );
    if (!baseline.passed) {
      return await finish(
        'failed',
        'The smoke test fails before the drill changes anything: nothing was changed. Fix that first.',
      );
    }

    // 2. A copy of what serves, beside it, with no traffic.
    await pin();
    drillCreated = true;
    await createDrill();
    await waitReady(args, deps, drillName);
    const afterCreate = await readApp(deps.az, scope);
    const drillAddress = revisionNamed(afterCreate, drillName)?.fqdn;
    const own = drillAddress
      ? await deps.health(drillAddress)
      : { ok: false, detail: 'the revision reports no address of its own' };
    record.measurements.drillRevisionReady = own.ok;
    note('drill-revision-health', own.detail, own.ok ? 'done' : 'failed');
    if (!own.ok)
      throw new Refusal(`The drill revision is not ready on its own address: ${own.detail}.`);

    // 3. The shift, as a release would do it.
    await toDrill();
    record.measurements.shift = await observe(state.fqdn);
    record.measurements.previousWarmAfterShift = isWarm(
      await readApp(deps.az, scope),
      previousName,
    );

    // 4. The way back, timed from before the command is issued.
    const startedAt = deps.now().getTime();
    await toPrevious(`traffic goes back to ${previousName}`);
    let controlPlaneSeconds: number | null = null;
    for (;;) {
      const current = await readApp(deps.az, scope);
      const nowServing = servingRevisions(current);
      if (
        nowServing.length === 1 &&
        nowServing[0]?.name === previousName &&
        nowServing[0].weight === 100
      ) {
        controlPlaneSeconds = Math.round((deps.now().getTime() - startedAt) / 1000);
        break;
      }
      if (deps.now().getTime() - startedAt > args.rollbackDeadlineSeconds * 1000) break;
      await deps.sleep(1000);
    }
    const afterRollback = await observe(state.fqdn);
    const warmNow = isWarm(await readApp(deps.az, scope), previousName);
    record.measurements.rollback = {
      controlPlaneSeconds,
      polls: afterRollback.polls,
      failed: afterRollback.failed,
      previousWarm: warmNow,
    };
    const smoke = await deps.smoke(publicUrl);
    record.measurements.smokeAfterRollback = smoke.passed;
    record.smoke = summariseSmoke(smoke);
    note(
      'smoke-after-rollback',
      smoke.passed ? 'passed' : 'FAILED',
      smoke.passed ? 'done' : 'failed',
    );

    // 5. The slow way back, when asked: the previous revision is retired, then started again.
    if (args.cold) {
      await toDrill();
      await runner.mutate(
        'retire-previous',
        commands.deactivate(scope, previousName),
        'simulates "finalize": the previous revision stops',
      );
      const coldStart = deps.now().getTime();
      await runner.mutate(
        'cold-activate',
        commands.activate(scope, previousName),
        'a start, not a switch: this is the slow way back, and it is timed',
      );
      let readySeconds: number | null = null;
      try {
        await waitReady(args, deps, previousName);
        readySeconds = Math.round((deps.now().getTime() - coldStart) / 1000);
      } catch {
        log(`${previousName} did not run within ${args.readyTimeoutMinutes} minutes.`);
      }
      record.measurements.cold = { readySeconds, smokePassed: null };
      if (readySeconds !== null) {
        await toPrevious(`traffic goes back to ${previousName}, started cold`);
        const coldSmoke = await deps.smoke(publicUrl);
        record.measurements.cold.smokePassed = coldSmoke.passed;
        note(
          'cold-smoke',
          coldSmoke.passed ? 'passed' : 'FAILED',
          coldSmoke.passed ? 'done' : 'failed',
        );
      }
    }

    // 6. Clean up, and read back that everything is where it started.
    await restore('cleanup');
    const final = await readApp(deps.az, scope);
    const finalServing = servingRevisions(final);
    record.measurements.cleanedUp =
      finalServing.length === 1 &&
      finalServing[0]?.name === previousName &&
      finalServing[0].weight === 100 &&
      revisionNamed(final, drillName)?.active !== true;

    const criteria = evaluateDrill(record.measurements, record.thresholds);
    const passed = criteria.every((criterion) => criterion.passed);
    for (const criterion of criteria)
      log(
        `${criterion.passed ? 'PASS' : 'FAIL'}  ${criterion.id}: ${criterion.title} (${criterion.detail})`,
      );
    const result = await finish(passed ? 'passed' : 'failed', null);
    log(
      passed
        ? `Drill PASSED. Keep the record: ${result.recordPath}. A passing drill says this deployment's rollback worked once, on this date, with this image; it is not a guarantee.`
        : `Drill FAILED: read the criteria above and the record ${result.recordPath}. Do not entrust real data to this deployment until a drill passes.`,
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The drill stopped unexpectedly.';
    log(`The drill stopped: ${message}`);
    await restore('abort');
    const final = await finish('aborted', message);
    log(`Record: ${final.recordPath}`);
    return final;
  }
}
