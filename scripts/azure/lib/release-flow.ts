import type { AzClient } from './az.js';
import {
  commands,
  isPlaceholder,
  readApp,
  reads,
  revisionNamed,
  servingRevisions,
  type AppState,
  type Scope,
} from './containerapp.js';
import type { SmokeReport } from './pilot-smoke.js';
import type { ReleaseArgs } from './release-args.js';
import {
  RECORD_SCHEMA_VERSION,
  redactEnvironment,
  releaseIdFor,
  revisionSuffixFor,
  summariseSmoke,
  validateRecord,
  type RecordStore,
  type ReleaseRecord,
  type ReleaseStatus,
  type StepRecord,
} from './release-record.js';
import { assessSubscription, type SubscriptionInfo } from './subscription.js';

/**
 * Release and rollback of the hosted pilot, as plain `az containerapp` commands.
 *
 * The model is blue/green. The app runs in multiple-revision mode (infra/pilot): a release creates a NEW
 * revision beside the one that serves, proves it healthy while it takes no traffic, shifts traffic to it,
 * runs the smoke test, and keeps the previous revision running (warm) so that a rollback is a traffic
 * change, not a start. Nothing here has run against Azure: it is tested against a fake `az`.
 *
 * Two safety properties are the point of this file:
 *  - A dry run is the DEFAULT. Reads happen; every command that would change something is only printed.
 *  - A live run needs --execute AND --confirm-resource-group <the group's exact name>, and is refused in CI.
 */

/** A safety condition that stopped the run before anything was changed. */
export class Refusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Refusal';
  }
}

export interface GitPort {
  head(): Promise<string>;
  isClean(): Promise<boolean>;
  show(sha: string, path: string): Promise<string>;
}

export interface ReleaseDeps {
  az: AzClient;
  git: GitPort;
  store: RecordStore;
  /** The pilot smoke test against a public address (scripts/azure/lib/pilot-smoke.ts). */
  smoke: (baseUrl: string) => Promise<SmokeReport>;
  /** GET /api/health/ready on a host. Health routes answer for any Host header. */
  health: (host: string) => Promise<{ ok: boolean; detail: string }>;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  log: (line: string) => void;
  /** process.env.CI: a live run is refused when it is "true". */
  ci: string | undefined;
}

export interface ReleaseResult {
  exitCode: 0 | 1;
  status: ReleaseStatus | 'inspected';
  record: ReleaseRecord | null;
  recordPath: string | null;
}

const MIGRATIONS_FILE = 'backend/src/storage/migrations.ts';
const POLL_MS = 5_000;

/** The highest `version: N` in the MIGRATIONS array of the schema file, or null when it cannot be read. */
export function parseSchemaVersion(source: string): number | null {
  const start = source.indexOf('export const MIGRATIONS');
  if (start < 0) return null;
  const end = source.indexOf('\n];', start);
  const block = source.slice(start, end < 0 ? undefined : end);
  const versions = [...block.matchAll(/^\s{2,}version:\s*(\d+),/gmu)].map((match) =>
    Number(match[1]),
  );
  return versions.length > 0 ? Math.max(...versions) : null;
}

/** What every live action needs to name its target and to be allowed to change it. */
export type LiveTarget = Pick<
  ReleaseArgs,
  | 'subscription'
  | 'resourceGroup'
  | 'app'
  | 'execute'
  | 'confirmResourceGroup'
  | 'allowProductionName'
  | 'readyTimeoutMinutes'
>;

export const scopeOf = (args: LiveTarget): Scope => ({
  subscription: args.subscription,
  resourceGroup: args.resourceGroup,
  app: args.app,
});

/** CI systems differ: GitHub sets "true", others "1". Only an empty value, "0" and "false" mean "not CI". */
const inCi = (value: string | undefined): boolean =>
  value !== undefined && !['', '0', 'false'].includes(value.trim().toLowerCase());

export function guardLive(args: LiveTarget, deps: Pick<ReleaseDeps, 'ci'>): void {
  if (!args.execute) return;
  if (inCi(deps.ci)) {
    throw new Refusal(
      'Refusing to change Azure from CI: deploying and releasing are owner actions (docs/production/release-process.md).',
    );
  }
  if (args.confirmResourceGroup !== args.resourceGroup) {
    throw new Refusal(
      `A live run needs --confirm-resource-group ${args.resourceGroup} (typed out), so that the target is read twice. Without --execute this is a dry run.`,
    );
  }
}

export interface Runner {
  mutate(step: string, argv: readonly string[], detail?: string): Promise<void>;
}

export function createRunner(
  args: Pick<LiveTarget, 'execute'>,
  deps: Pick<ReleaseDeps, 'az' | 'now' | 'log'>,
  steps: StepRecord[],
): Runner {
  return {
    async mutate(step, argv, detail) {
      const command = `az ${argv.join(' ')}`;
      const at = deps.now().toISOString();
      if (!args.execute) {
        steps.push({ step, status: 'planned', command, at, detail });
        deps.log(`DRY RUN  ${step}: would run  ${command}${detail ? `\n         ${detail}` : ''}`);
        return;
      }
      deps.log(`RUN      ${step}: ${command}`);
      try {
        await deps.az.text(argv);
        steps.push({ step, status: 'done', command, at, detail });
      } catch (error) {
        steps.push({
          step,
          status: 'failed',
          command,
          at,
          detail: error instanceof Error ? error.message : 'failed',
        });
        throw error;
      }
    },
  };
}

export async function loadTarget(
  args: LiveTarget,
  deps: Pick<ReleaseDeps, 'az'>,
  options: { requireMultiple: boolean } = { requireMultiple: true },
): Promise<AppState> {
  const subscription = await deps.az.json<SubscriptionInfo>(reads.account(args.subscription));
  const assessment = assessSubscription(subscription, {
    allowProductionNames: args.allowProductionName,
  });
  if (!assessment.ok) throw new Refusal(assessment.problems.join(' '));
  const group = await deps.az.json<{ tags?: Record<string, string> | null }>(
    reads.group(args.subscription, args.resourceGroup),
  );
  if (group.tags?.app !== 'swarm-lab') {
    throw new Refusal(
      `Resource group "${args.resourceGroup}" is not tagged app=swarm-lab, so it is not a group this project created. Nothing was touched.`,
    );
  }
  const state = await readApp(deps.az, scopeOf(args));
  if (options.requireMultiple && state.mode !== 'Multiple') {
    throw new Refusal(
      `The app is in "${state.mode ?? 'unknown'}" revision mode. Releases are blue/green and need multiple-revision mode: apply infra/pilot first (az deployment group create), which sets it.`,
    );
  }
  if (state.provisioningState !== null && state.provisioningState !== 'Succeeded') {
    throw new Refusal(
      `The app is "${state.provisioningState}", not Succeeded: wait for it, or fix it, before releasing.`,
    );
  }
  return state;
}

/** Polls until the revision runs. A failed or degraded revision ends the wait at once. */
export async function waitReady(
  args: LiveTarget,
  deps: Pick<ReleaseDeps, 'az' | 'now' | 'sleep'>,
  revision: string,
): Promise<void> {
  const deadline = deps.now().getTime() + args.readyTimeoutMinutes * 60_000;
  for (;;) {
    const state = await readApp(deps.az, scopeOf(args));
    const found = revisionNamed(state, revision);
    if (
      found?.running === 'Running' &&
      (found.health === 'Healthy' || found.health === null || found.health === 'None')
    )
      return;
    if (
      found &&
      (found.running === 'Failed' || found.running === 'Degraded' || found.health === 'Unhealthy')
    ) {
      throw new Refusal(
        `Revision ${revision} is ${found.running ?? 'unknown'} / ${found.health ?? 'unknown'}: it did not start. Read its console logs.`,
      );
    }
    if (deps.now().getTime() >= deadline) {
      throw new Refusal(
        `Revision ${revision} was not running after ${args.readyTimeoutMinutes} minutes.`,
      );
    }
    await deps.sleep(POLL_MS);
  }
}

function baseRecord(
  args: ReleaseArgs,
  deps: ReleaseDeps,
  fields: Pick<
    ReleaseRecord,
    'commit' | 'image' | 'revision' | 'lastKnownGood' | 'migrations' | 'config'
  >,
): ReleaseRecord {
  const now = deps.now();
  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    releaseId: releaseIdFor(now, fields.commit.sha),
    status: args.execute ? 'in-progress' : 'dry-run',
    startedAt: now.toISOString(),
    finishedAt: null,
    target: { resourceGroup: args.resourceGroup, app: args.app, registry: args.registry },
    ...fields,
    smoke: null,
    warmWindow: null,
    steps: [],
    rollbacks: [],
    rollback: null,
  };
}

const rollbackCommand = (args: ReleaseArgs): string =>
  `npm run azure:release -- rollback --subscription ${args.subscription} --resource-group ${args.resourceGroup} --app ${args.app} --execute --confirm-resource-group ${args.resourceGroup}`;

async function persist(deps: ReleaseDeps, record: ReleaseRecord): Promise<string> {
  const problems = validateRecord(record);
  if (problems.length > 0)
    throw new Refusal(
      `The release record does not hold together (${problems.join('; ')}); nothing was written.`,
    );
  return deps.store.write(record);
}

export async function runRelease(args: ReleaseArgs, deps: ReleaseDeps): Promise<ReleaseResult> {
  guardLive(args, deps);
  const scope = scopeOf(args);
  const { log } = deps;
  const state = await loadTarget(args, deps);

  // What serves now. A first release replaces the placeholder and has nothing to go back to.
  const placeholder = isPlaceholder(state.image);
  const serving = servingRevisions(state);
  let lastKnownGood: ReleaseRecord['lastKnownGood'] = null;
  if (!placeholder) {
    const only = serving.length === 1 ? serving[0] : undefined;
    if (!only || only.weight !== 100) {
      throw new Refusal(
        `Traffic is split or unset (${serving.map((entry) => `${entry.name}=${entry.weight}`).join(', ') || 'no revision serves'}). Finish or roll back the release in progress first: promote, rollback or finalize.`,
      );
    }
    const running = revisionNamed(state, only.name);
    if (running?.running !== 'Running') {
      throw new Refusal(
        `The revision that serves (${only.name}) is ${running?.running ?? 'not listed'}: fix it before releasing over it.`,
      );
    }
    lastKnownGood = {
      revision: only.name,
      image: running.image ?? state.image ?? '',
      basis: 'it was serving all traffic when this release began',
    };
  }

  // The commit and what it carries.
  const head = await deps.git.head();
  const sha = (args.commit ?? head).toLowerCase();
  if (!args.skipBuild) {
    if (sha !== head)
      throw new Refusal(
        'Building uses the working tree, which is at HEAD: --commit must be HEAD, or pass --skip-build for an image that already exists.',
      );
    if (!(await deps.git.isClean()))
      throw new Refusal(
        'The working tree has uncommitted changes. An image tagged with a commit hash must be built from exactly that commit.',
      );
  }
  let migrationsSource: string;
  try {
    migrationsSource = await deps.git.show(sha, MIGRATIONS_FILE);
  } catch {
    throw new Refusal(
      `Cannot read ${MIGRATIONS_FILE} at commit ${sha}: is that commit in this clone? Fetch it, or release a commit that is.`,
    );
  }
  const targetSchema = parseSchemaVersion(migrationsSource);
  const previous = await deps.store.latest();
  const sameApp =
    previous &&
    previous.target.app === args.app &&
    previous.target.resourceGroup === args.resourceGroup
      ? previous
      : null;
  const before = placeholder
    ? 0
    : (args.currentSchemaVersion ?? sameApp?.migrations.schemaVersionAfter ?? null);
  if (before !== null && targetSchema !== null && targetSchema < before) {
    throw new Refusal(
      `This commit's schema (${targetSchema}) is OLDER than the database's (${before}). Schema migrations only go forward and an older build refuses a newer database (STORAGE_VERSION). Release a newer commit, or restore the database.`,
    );
  }
  const applied =
    before !== null && targetSchema !== null
      ? Array.from({ length: Math.max(0, targetSchema - before) }, (_, index) => before + 1 + index)
      : [];
  const schemaUnknown = before === null || targetSchema === null;
  if ((applied.length > 0 || schemaUnknown) && !placeholder && !args.acceptSchemaChange) {
    throw new Refusal(
      schemaUnknown
        ? 'The database schema version before this release is unknown (no earlier release record, and no --current-schema-version). Whether migrations come with it cannot be told; pass --current-schema-version <n> or --accept-schema-change.'
        : `This release applies schema migration(s) ${applied.join(', ')}. They run when the first new replica starts, are not undone by a rollback, and an older image may refuse the newer schema. Note the restore point (the record writes it), read docs/production/runbook.md, then pass --accept-schema-change.`,
    );
  }

  const suffix = revisionSuffixFor(sha);
  const revisionName = `${args.app}--${suffix}`;
  const registry = await deps.az.json<{ loginServer?: string }>(
    reads.registry(args.subscription, args.registry),
  );
  const loginServer = registry.loginServer;
  if (!loginServer)
    throw new Refusal(
      `Registry "${args.registry}" has no login server in the answer: is the name right?`,
    );

  const record = baseRecord(args, deps, {
    commit: { sha, shortSha: sha.slice(0, 12) },
    image: {
      reference: `${loginServer}/swarm@<digest>`,
      tag: `swarm:${sha}`,
      digest: '',
      tagLocked: false,
    },
    revision: { name: revisionName, suffix, trafficWeight: 0 },
    lastKnownGood,
    migrations: {
      schemaVersionBefore: before,
      schemaVersionAfter: targetSchema,
      applied,
      acceptedSchemaChange: args.acceptSchemaChange,
      restorePointUtc: applied.length > 0 && !placeholder ? deps.now().toISOString() : null,
    },
    config: {
      cpu: state.cpu,
      memory: state.memory,
      minReplicas: state.minReplicas,
      maxReplicas: state.maxReplicas,
      environment: redactEnvironment(state.env),
    },
  });
  record.rollback = lastKnownGood ? { command: rollbackCommand(args) } : null;
  const runner = createRunner(args, deps, record.steps);

  log(
    `${args.execute ? 'LIVE RELEASE' : 'DRY RUN (nothing will be changed; add --execute and --confirm-resource-group to run it)'}: commit ${sha.slice(0, 12)} -> ${args.app} in ${args.resourceGroup}`,
  );
  log(
    lastKnownGood
      ? `Serving now: ${lastKnownGood.revision}. It stays running, at 0% after the shift, as the last known good.`
      : 'First release: the placeholder image is replaced; there is nothing to roll back to.',
  );
  if (applied.length > 0 && !placeholder)
    log(
      `Schema change accepted: migration(s) ${applied.join(', ')}. Point-in-time restore target if needed: ${record.migrations.restorePointUtc}.`,
    );

  // 1. The image: built in the registry, identified by digest, its tag locked.
  if (!args.skipBuild)
    await runner.mutate(
      'build',
      commands.acrBuild(scope, args.registry, sha),
      `builds swarm:${sha} in ${args.registry} from the working tree at this commit`,
    );
  let digest = '<sha256 digest of the image>';
  if (args.execute || args.skipBuild) {
    const missing = new Refusal(
      `The registry has no image swarm:${sha}${args.skipBuild ? ' (--skip-build was given)' : ' after the build'}.`,
    );
    try {
      digest = (await deps.az.text(reads.digest(args.subscription, args.registry, sha))).trim();
    } catch {
      throw missing;
    }
    if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) throw missing;
  }
  const reference = `${loginServer}/swarm@${digest}`;
  record.image = { reference, tag: `swarm:${sha}`, digest, tagLocked: false };
  if (args.lockTag) {
    await runner.mutate(
      'lock-tag',
      commands.acrLock(scope, args.registry, sha),
      'makes the tag read-only and undeletable, so the commit hash keeps meaning one image',
    );
    record.image.tagLocked = args.execute;
  }

  // 2. Pin traffic to the revision that serves, so that creating the new one cannot move any.
  const explicit =
    state.traffic.length === 1 &&
    state.traffic[0]?.revisionName === lastKnownGood?.revision &&
    !state.traffic[0]?.latestRevision;
  if (lastKnownGood && !explicit) {
    await runner.mutate(
      'pin-traffic',
      commands.trafficSet(scope, [{ revision: lastKnownGood.revision, weight: 100 }]),
      'traffic named the newest revision; a new revision would have taken it',
    );
  }

  // 3. The new revision, at no traffic.
  const existing = revisionNamed(state, revisionName);
  if (existing) {
    if (!existing.image?.includes(digest) && args.execute)
      throw new Refusal(
        `Revision ${revisionName} already exists with a different image (${existing.image ?? 'unknown'}).`,
      );
    log(`Revision ${revisionName} already exists: reusing it.`);
  } else {
    await runner.mutate(
      'create-revision',
      commands.update(scope, reference, suffix),
      'creates a revision beside the serving one; with named traffic it takes none',
    );
  }

  if (!args.execute) {
    log(
      `DRY RUN  wait-ready: would wait up to ${args.readyTimeoutMinutes} minutes for ${revisionName} to run`,
    );
    if (args.revisionPrecheck)
      log(
        `DRY RUN  revision-health: would GET https://<${revisionName} address>/api/health/ready, which answers for any Host`,
      );
    log(
      `DRY RUN  shift: would send ${args.canaryPercent > 0 ? `${args.canaryPercent}% (a canary; promote later)` : 'all traffic'} to ${revisionName}${lastKnownGood ? `, ${lastKnownGood.revision} keeping the rest, warm` : ''}`,
    );
    if (args.canaryPercent === 0)
      log(
        'DRY RUN  smoke: would run the pilot smoke test against the public address, and roll back by itself if it fails',
      );
    log(
      'DRY RUN  record: would write the release record (commit, image digest, migrations, configuration, smoke, last known good)',
    );
    return { exitCode: 0, status: 'dry-run', record, recordPath: null };
  }

  // Live from here: write the record first, so that a crash leaves evidence.
  let recordPath = await persist(deps, record);
  const fail = async (
    status: ReleaseStatus,
    message: string,
    deactivateNew: boolean,
  ): Promise<ReleaseResult> => {
    log(message);
    if (deactivateNew) {
      try {
        await runner.mutate(
          'deactivate-new',
          commands.deactivate(scope, revisionName),
          'a failed revision is stopped so that it costs nothing',
        );
      } catch {
        log(`Could not deactivate ${revisionName}: do it by hand.`);
      }
    }
    record.status = status;
    record.finishedAt = deps.now().toISOString();
    recordPath = await persist(deps, record);
    return { exitCode: 1, status, record, recordPath };
  };

  try {
    await waitReady(args, deps, revisionName);
  } catch (error) {
    return fail(
      'failed',
      error instanceof Error ? error.message : 'The new revision did not start.',
      true,
    );
  }

  // 4. The new revision answers on its own address while it still has no traffic.
  const live = await readApp(deps.az, scope);
  const fqdn = revisionNamed(live, revisionName)?.fqdn;
  if (args.revisionPrecheck) {
    if (!fqdn)
      return fail(
        'failed',
        `Revision ${revisionName} reports no address of its own, so it cannot be checked before it takes traffic. Re-run with --no-revision-precheck to rely on the smoke test and the automatic rollback instead.`,
        true,
      );
    const health = await deps.health(fqdn);
    record.steps.push({
      step: 'revision-health',
      status: health.ok ? 'done' : 'failed',
      at: deps.now().toISOString(),
      detail: health.detail,
    });
    if (!health.ok)
      return fail(
        'failed',
        `The new revision is not ready on its own address: ${health.detail}. No traffic was moved.`,
        true,
      );
    log(`Revision health: ${health.detail}`);
  }

  // 5. The shift. A canary stops here, until `promote`.
  const baseUrl = `https://${live.fqdn ?? state.fqdn ?? ''}`;
  if (args.canaryPercent > 0 && lastKnownGood) {
    await runner.mutate(
      'shift-canary',
      commands.trafficSet(scope, [
        { revision: revisionName, weight: args.canaryPercent },
        { revision: lastKnownGood.revision, weight: 100 - args.canaryPercent },
      ]),
    );
    record.revision.trafficWeight = args.canaryPercent;
    record.status = 'canary';
    record.finishedAt = deps.now().toISOString();
    recordPath = await persist(deps, record);
    log(
      `Canary: ${args.canaryPercent}% of traffic is on ${revisionName}. Watch the dashboard, then: promote (all traffic) or rollback.`,
    );
    return { exitCode: 0, status: 'canary', record, recordPath };
  }
  await runner.mutate(
    'shift',
    commands.trafficSet(scope, [
      { revision: revisionName, weight: 100 },
      ...(lastKnownGood ? [{ revision: lastKnownGood.revision, weight: 0 }] : []),
    ]),
  );
  record.revision.trafficWeight = 100;

  // 6. The smoke test, and the way back if it fails.
  const report = await deps.smoke(baseUrl);
  record.smoke = summariseSmoke(report);
  if (!report.passed) {
    if (lastKnownGood && args.autoRollback) {
      await runner.mutate(
        'auto-rollback',
        commands.trafficSet(scope, [
          { revision: lastKnownGood.revision, weight: 100 },
          { revision: revisionName, weight: 0 },
        ]),
        'the smoke test failed: traffic goes back to the last known good',
      );
      record.revision.trafficWeight = 0;
      return fail(
        'rolled-back',
        `The smoke test FAILED on ${revisionName}. Traffic is back on ${lastKnownGood.revision}. The new revision is still running at 0% for diagnosis.`,
        false,
      );
    }
    return fail(
      'failed',
      `The smoke test FAILED and no automatic rollback is available${lastKnownGood ? ' (--no-auto-rollback)' : ' (first release)'}. ${lastKnownGood ? `Roll back: ${record.rollback?.command}` : ''}`,
      false,
    );
  }

  record.status = 'promoted';
  record.finishedAt = deps.now().toISOString();
  record.warmWindow = lastKnownGood
    ? {
        hours: args.warmHours,
        deactivateAfter: new Date(deps.now().getTime() + args.warmHours * 3_600_000).toISOString(),
      }
    : null;
  recordPath = await persist(deps, record);
  log(`Promoted: ${revisionName} serves all traffic and the smoke test passed.`);
  if (lastKnownGood)
    log(
      `${lastKnownGood.revision} stays warm until ${record.warmWindow?.deactivateAfter}; rollback is one command. After that: finalize.`,
    );
  log(`Record: ${recordPath}`);
  return { exitCode: 0, status: 'promoted', record, recordPath };
}

/** Moves a canary to all traffic, runs the smoke test, and goes back if it fails. */
export async function runPromote(args: ReleaseArgs, deps: ReleaseDeps): Promise<ReleaseResult> {
  guardLive(args, deps);
  const scope = scopeOf(args);
  const state = await loadTarget(args, deps);
  const record = await deps.store.latest();
  if (!record || record.status !== 'canary' || record.target.app !== args.app) {
    throw new Refusal(
      'There is no canary release to promote: the latest record is not a canary for this app.',
    );
  }
  const serving = servingRevisions(state);
  const names = new Set(serving.map((entry) => entry.name));
  if (
    !names.has(record.revision.name) ||
    !record.lastKnownGood ||
    !names.has(record.lastKnownGood.revision) ||
    serving.length !== 2
  ) {
    throw new Refusal(
      `Traffic is not the canary split the record describes (${serving.map((entry) => `${entry.name}=${entry.weight}`).join(', ')}). Look at it with: status.`,
    );
  }
  const runner = createRunner(args, deps, record.steps);
  await runner.mutate(
    'promote',
    commands.trafficSet(scope, [
      { revision: record.revision.name, weight: 100 },
      { revision: record.lastKnownGood.revision, weight: 0 },
    ]),
  );
  if (!args.execute) {
    deps.log('DRY RUN  smoke: would run the pilot smoke test, and roll back by itself if it fails');
    return { exitCode: 0, status: 'dry-run', record, recordPath: null };
  }
  const report = await deps.smoke(`https://${state.fqdn ?? ''}`);
  record.smoke = summariseSmoke(report);
  record.revision.trafficWeight = 100;
  if (!report.passed) {
    await runner.mutate(
      'auto-rollback',
      commands.trafficSet(scope, [
        { revision: record.lastKnownGood.revision, weight: 100 },
        { revision: record.revision.name, weight: 0 },
      ]),
    );
    record.revision.trafficWeight = 0;
    record.status = 'rolled-back';
    record.finishedAt = deps.now().toISOString();
    const path = await persist(deps, record);
    deps.log(
      `The smoke test FAILED after promotion. Traffic is back on ${record.lastKnownGood.revision}.`,
    );
    return { exitCode: 1, status: 'rolled-back', record, recordPath: path };
  }
  record.status = 'promoted';
  record.finishedAt = deps.now().toISOString();
  record.warmWindow = {
    hours: args.warmHours,
    deactivateAfter: new Date(deps.now().getTime() + args.warmHours * 3_600_000).toISOString(),
  };
  const path = await persist(deps, record);
  deps.log(`Promoted: ${record.revision.name} serves all traffic and the smoke test passed.`);
  return { exitCode: 0, status: 'promoted', record, recordPath: path };
}

/**
 * One command back: traffic to the last known good revision (the one the latest release record names, or
 * the one given with --to), then the smoke test. A revision that was deactivated is activated first, which
 * is a start, not an instant switch.
 */
export async function runRollback(args: ReleaseArgs, deps: ReleaseDeps): Promise<ReleaseResult> {
  guardLive(args, deps);
  const scope = scopeOf(args);
  const state = await loadTarget(args, deps);
  const record = await deps.store.latest();
  const mine =
    record && record.target.app === args.app && record.target.resourceGroup === args.resourceGroup
      ? record
      : null;
  const target = args.to ?? mine?.lastKnownGood?.revision;
  if (!target) {
    throw new Refusal(
      `No last known good revision is recorded. Name one with --to <revision>. Revisions: ${state.revisions.map((revision) => `${revision.name}${revision.active ? '' : ' (inactive)'}`).join(', ') || 'none'}.`,
    );
  }
  const revision = revisionNamed(state, target);
  if (!revision) throw new Refusal(`Revision ${target} does not exist in ${args.app}.`);
  const serving = servingRevisions(state);
  if (serving.length === 1 && serving[0]?.name === target && serving[0].weight === 100) {
    deps.log(`${target} already serves all traffic: nothing to do.`);
    return { exitCode: 0, status: 'inspected', record: mine, recordPath: null };
  }
  if (
    mine &&
    mine.migrations.applied.length > 0 &&
    !args.acceptSchemaChange &&
    args.to === undefined
  ) {
    throw new Refusal(
      `The release being rolled back applied schema migration(s) ${mine.migrations.applied.join(', ')}. The previous image may refuse the newer schema when it restarts (STORAGE_VERSION). Switching traffic can still work while ${target} stays up. Pass --accept-schema-change to proceed, or restore the database first (docs/production/runbook.md; restore point ${mine.migrations.restorePointUtc ?? 'unknown'}).`,
    );
  }

  const steps: StepRecord[] = mine?.steps ?? [];
  const runner = createRunner(args, deps, steps);
  const cold = !revision.active;
  if (cold) {
    await runner.mutate(
      'activate-target',
      commands.activate(scope, target),
      `${target} was deactivated: this STARTS it, so the rollback is not instant`,
    );
    if (args.execute) await waitReady(args, deps, target);
  }
  await runner.mutate(
    'rollback',
    commands.trafficSet(scope, [
      { revision: target, weight: 100 },
      ...serving
        .filter((entry) => entry.name !== target)
        .map((entry) => ({ revision: entry.name, weight: 0 })),
    ]),
    `traffic goes back to ${target}`,
  );
  if (!args.execute) {
    deps.log('DRY RUN  smoke: would run the pilot smoke test against the public address');
    return { exitCode: 0, status: 'dry-run', record: mine, recordPath: null };
  }

  const report = await deps.smoke(`https://${state.fqdn ?? ''}`);
  const entry = {
    at: deps.now().toISOString(),
    to: target,
    basis: args.to ? 'named with --to' : 'the last known good in the release record',
    smokePassed: report.passed,
    reason: 'rollback',
    cold,
  };
  deps.log(
    report.passed
      ? `Rolled back to ${target}; the smoke test passed.`
      : `Traffic is on ${target}, but the smoke test FAILED: the previous revision is not healthy either. Escalate (docs/production/runbook.md).`,
  );
  let path: string | null = null;
  if (mine) {
    mine.status = 'rolled-back';
    mine.finishedAt = deps.now().toISOString();
    mine.smoke = summariseSmoke(report);
    mine.rollbacks = [...(mine.rollbacks ?? []), entry];
    path = await deps.store.write(mine);
  }
  return { exitCode: report.passed ? 0 : 1, status: 'rolled-back', record: mine, recordPath: path };
}

/** After the warm window: deactivate the previous revision, which stops it and its job runner. */
export async function runFinalize(args: ReleaseArgs, deps: ReleaseDeps): Promise<ReleaseResult> {
  guardLive(args, deps);
  const scope = scopeOf(args);
  const state = await loadTarget(args, deps);
  const record = await deps.store.latest();
  if (
    !record ||
    record.status !== 'promoted' ||
    record.target.app !== args.app ||
    !record.lastKnownGood
  ) {
    throw new Refusal('There is no promoted release with a previous revision to retire.');
  }
  const previous = record.lastKnownGood.revision;
  const serving = servingRevisions(state);
  if (serving.length !== 1 || serving[0]?.name !== record.revision.name) {
    throw new Refusal(
      `${record.revision.name} is not the only revision serving (${serving.map((entry) => `${entry.name}=${entry.weight}`).join(', ')}): not retiring ${previous}.`,
    );
  }
  const due = record.warmWindow ? new Date(record.warmWindow.deactivateAfter).getTime() : 0;
  if (deps.now().getTime() < due && !args.force) {
    throw new Refusal(
      `The warm window runs until ${record.warmWindow?.deactivateAfter}: ${previous} is the rollback target until then. Pass --force to retire it now.`,
    );
  }
  const runner = createRunner(args, deps, record.steps);
  await runner.mutate(
    'deactivate-previous',
    commands.deactivate(scope, previous),
    `${previous} stops; a rollback to it then needs a start (activate), not just a traffic change`,
  );
  if (!args.execute) return { exitCode: 0, status: 'dry-run', record, recordPath: null };
  record.status = 'finalized';
  record.finishedAt = deps.now().toISOString();
  const path = await persist(deps, record);
  deps.log(`${previous} is deactivated. The record: ${path}`);
  return { exitCode: 0, status: 'finalized', record, recordPath: path };
}

/** Read-only: the revisions, who serves, and what the latest release record says. */
export async function runStatus(args: ReleaseArgs, deps: ReleaseDeps): Promise<ReleaseResult> {
  const state = await loadTarget(args, deps, { requireMultiple: false });
  const record = await deps.store.latest();
  deps.log(`App ${args.app}: ${state.mode} revisions, image ${state.image ?? 'unknown'}.`);
  for (const revision of state.revisions) {
    deps.log(
      `  ${revision.name}: ${revision.active ? 'active' : 'inactive'}, ${revision.running ?? '?'}/${revision.health ?? '?'}, ${revision.trafficWeight}% traffic, ${revision.replicas ?? '?'} replica(s)`,
    );
  }
  deps.log(
    record
      ? `Latest record ${record.releaseId}: ${record.status}, commit ${record.commit.shortSha}, schema ${record.migrations.schemaVersionAfter ?? '?'}, last known good ${record.lastKnownGood?.revision ?? 'none'}.`
      : 'No release record yet.',
  );
  return { exitCode: 0, status: 'inspected', record, recordPath: null };
}

export async function runReleaseAction(
  args: ReleaseArgs,
  deps: ReleaseDeps,
): Promise<ReleaseResult> {
  switch (args.action) {
    case 'release':
      return runRelease(args, deps);
    case 'promote':
      return runPromote(args, deps);
    case 'rollback':
      return runRollback(args, deps);
    case 'finalize':
      return runFinalize(args, deps);
    case 'status':
      return runStatus(args, deps);
  }
}
