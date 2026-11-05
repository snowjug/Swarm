import {
  commands,
  isHealthyState,
  isRunningState,
  reads,
  revisionNamed,
  servingRevisions,
} from './containerapp.js';
import {
  checkContainerConfig,
  failedChecks,
  isPlaceholderImage,
  type ConfigCheck,
} from './deployed-config.js';
import {
  Refusal,
  createRunner,
  describeChecks,
  guardLive,
  loadTarget,
  parseSchemaVersion,
  persist,
  readImageState,
  scopeOf,
  templateApplyHelp,
  type ReleaseDeps,
  type ReleaseResult,
} from './release-flow.js';
import type { ReleaseArgs } from './release-args.js';
import {
  RECORD_SCHEMA_VERSION,
  redactEnvironment,
  releaseIdFor,
  summariseSmoke,
  type ReleaseRecord,
  type StepRecord,
} from './release-record.js';
import { revisionLogHelp } from './revision-logs.js';

/**
 * The three actions the live pilot needed and the first version of the tool did not have:
 *
 *  - build:  put the image of a commit in the registry, locked, and say how to apply it with the template
 *            (the first real image goes on through the template, which sets the port and the probes).
 *  - record: write the release record of a revision that was made by hand, after proving it from what Azure
 *            says, so that the next release and a rollback have a last known good.
 *  - check:  read-only; fails when a serving revision is not on port 3001 or has no probes.
 */

const MIGRATIONS_FILE = 'backend/src/storage/migrations.ts';

async function loginServerOf(args: ReleaseArgs, deps: ReleaseDeps): Promise<string> {
  const registry = await deps.az.json<{ loginServer?: string }>(
    reads.registry(args.subscription, args.registry),
  );
  if (!registry.loginServer)
    throw new Refusal(
      `Registry "${args.registry}" has no login server in the answer: is the name right?`,
    );
  return registry.loginServer;
}

/** Builds (or reuses) the image of a commit, locks its tag, and says how to put it on the app. */
export async function runBuild(args: ReleaseArgs, deps: ReleaseDeps): Promise<ReleaseResult> {
  guardLive(args, deps);
  const scope = scopeOf(args);
  const { log } = deps;
  const state = await loadTarget(args, deps, { requireMultiple: false });
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
  const loginServer = await loginServerOf(args, deps);
  const steps: StepRecord[] = [];
  const runner = createRunner(args, deps, steps);
  log(
    `${args.execute ? 'LIVE BUILD' : 'DRY RUN (nothing will be changed; add --execute and --confirm-resource-group to run it)'}: image of commit ${sha.slice(0, 12)} in ${args.registry}. No revision is made and no record is written.`,
  );

  const known = await readImageState(deps.az, args.subscription, args.registry, sha);
  const reuse = known !== null && (args.skipBuild || known.locked);
  if (reuse) {
    log(
      `Image swarm:${sha} is already in ${args.registry}${known.locked ? ' and its tag is locked' : ''}: it is reused, not rebuilt.`,
    );
  } else if (!args.skipBuild) {
    await runner.mutate(
      'build',
      commands.acrBuild(scope, args.registry, sha),
      `builds swarm:${sha} in ${args.registry} from the working tree at this commit`,
    );
  }
  let digest = known?.digest ?? '<sha256 digest of the image>';
  let locked = known?.locked === true;
  if (!reuse && (args.execute || args.skipBuild)) {
    const built = await readImageState(deps.az, args.subscription, args.registry, sha);
    if (!built)
      throw new Refusal(
        `The registry has no image swarm:${sha}${args.skipBuild ? ' (--skip-build was given)' : ' after the build'}.`,
      );
    digest = built.digest;
    locked = built.locked;
  }
  if (args.lockTag && !locked) {
    await runner.mutate(
      'lock-tag',
      commands.acrLock(scope, args.registry, sha),
      'makes the tag read-only and undeletable, so the commit hash keeps meaning one image',
    );
    locked = args.execute;
  }

  const reference = `${loginServer}/swarm@${digest}`;
  log(`Image: ${reference}`);
  log(`Tag swarm:${sha} is ${locked ? 'locked' : 'NOT locked (a dry run, or --no-lock-tag)'}.`);
  log(
    `Put it on the app through the template, which sets port 3001, PORT and the three probes (az containerapp update cannot set a probe):\n${templateApplyHelp(args, state, { reference, suffix: `r${sha.slice(0, 12)}`, sha })}`,
  );
  log(
    `Then: npm run azure:release -- record --subscription ${args.subscription} --resource-group ${args.resourceGroup} --app ${args.app} --registry ${args.registry} --commit ${sha} --revision ${args.app}--r${sha.slice(0, 12)} --digest ${digest} --execute --confirm-resource-group ${args.resourceGroup}`,
  );
  return {
    exitCode: 0,
    status: args.execute ? 'inspected' : 'dry-run',
    record: null,
    recordPath: null,
  };
}

/**
 * Writes the release record of a revision that was NOT made by this tool, for the next release and for a
 * rollback to read. Nothing is taken on trust: the revision must run, on the image the digest names, which
 * the commit's tag in the registry must name too; it must serve all traffic and be the build the commit
 * says; and the public smoke test must pass. What is wrong with its configuration (a port, a missing
 * probe) is recorded and reported, not hidden, but it does not stop the record: a revision that serves is
 * the last known good whether or not it is configured as it should be.
 */
export async function runRecord(args: ReleaseArgs, deps: ReleaseDeps): Promise<ReleaseResult> {
  guardLive(args, deps);
  const scope = scopeOf(args);
  const { log } = deps;
  const revisionName = args.revision ?? '';
  const digest = args.digest ?? '';
  const sha = (args.commit ?? '').toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(sha))
    throw new Refusal('--commit must be a full 40-character commit hash.');
  const state = await loadTarget(args, deps);
  const loginServer = await loginServerOf(args, deps);

  const revision = revisionNamed(state, revisionName);
  if (!revision)
    throw new Refusal(
      `Revision ${revisionName} does not exist in ${args.app}. Revisions: ${state.revisions.map((one) => one.name).join(', ') || 'none'}.`,
    );
  if (!isRunningState(revision.running) || !isHealthyState(revision.health)) {
    throw new Refusal(
      `Revision ${revisionName} is ${revision.running ?? 'unknown'} / ${revision.health ?? 'unknown'}, not Running and healthy: a revision that does not run is not a last known good.\n${revisionLogHelp(scope, revisionName, state.environmentId)}`,
    );
  }
  if (!revision.image?.includes(digest)) {
    throw new Refusal(
      `Revision ${revisionName} runs ${revision.image ?? 'an image that cannot be read'}, which does not carry the digest ${digest}.`,
    );
  }
  const image = await readImageState(deps.az, args.subscription, args.registry, sha);
  if (!image) throw new Refusal(`${args.registry} has no image swarm:${sha}.`);
  if (image.digest !== digest) {
    throw new Refusal(
      `The tag swarm:${sha} in ${args.registry} is ${image.digest}, not ${digest}: the digest does not belong to that commit.`,
    );
  }
  const serving = servingRevisions(state);
  if (serving.length !== 1 || serving[0]?.name !== revisionName || serving[0].weight !== 100) {
    throw new Refusal(
      `${revisionName} does not serve all the traffic (${serving.map((entry) => `${entry.name}=${entry.weight}`).join(', ') || 'no revision serves'}). A last known good is the revision that serves: record it once it does.`,
    );
  }
  const buildSha = revision.env.find((entry) => entry.name === 'BUILD_SHA')?.value;
  if (typeof buildSha === 'string' && buildSha.toLowerCase() !== sha) {
    throw new Refusal(
      `Revision ${revisionName} says it was built from ${buildSha} (BUILD_SHA), not ${sha}.`,
    );
  }
  let previousImage = '';
  if (args.previous) {
    const previous = revisionNamed(state, args.previous);
    if (!previous || args.previous === revisionName)
      throw new Refusal(
        `--previous ${args.previous} is not another revision of ${args.app}. Revisions: ${state.revisions.map((one) => one.name).join(', ')}.`,
      );
    previousImage = previous.image ?? '';
  }

  let migrationsSource = '';
  try {
    migrationsSource = await deps.git.show(sha, MIGRATIONS_FILE);
  } catch {
    log(
      `Cannot read ${MIGRATIONS_FILE} at ${sha} (is the commit in this clone?): the schema version is recorded as unknown, so the next release will ask for --current-schema-version.`,
    );
  }
  const schemaVersion = migrationsSource ? parseSchemaVersion(migrationsSource) : null;

  const configured: ConfigCheck[] = isPlaceholderImage(revision.image)
    ? []
    : checkContainerConfig({
        image: revision.image,
        targetPort: state.targetPort,
        env: revision.env,
        probes: revision.probes,
      });
  const misconfigured = failedChecks(configured);
  log(`Revision ${revisionName}: running, ${revision.image}, serving all traffic.`);
  log(`Configuration of the revision:\n${describeChecks(configured)}`);
  if (misconfigured.length > 0) {
    log(
      `It is recorded as it is, and the findings above are in the record. Correct them with the template:\n${templateApplyHelp(args, state)}`,
    );
  }

  const now = deps.now();
  const steps: StepRecord[] = [
    {
      step: 'record-by-hand',
      status: 'done',
      at: now.toISOString(),
      detail:
        args.note ??
        'the revision was not made by this tool; it was read from Azure and proved before it was recorded',
    },
    {
      step: 'config-check',
      status: misconfigured.length === 0 ? 'done' : 'failed',
      at: now.toISOString(),
      detail:
        misconfigured.length === 0
          ? 'port 3001, probes set'
          : `not as the template sets it: ${misconfigured.map((check) => check.id).join(', ')}`,
    },
  ];
  const baseUrl = `https://${state.fqdn ?? ''}`;
  if (!args.execute) {
    log(
      `DRY RUN  smoke: would run the pilot smoke test against ${baseUrl}, and refuse to record a revision that fails it`,
    );
    log(
      `DRY RUN  record: would write the release record of ${revisionName} (commit ${sha.slice(0, 12)}, digest ${digest}, schema ${schemaVersion ?? 'unknown'}, last known good ${args.previous ?? 'none'})`,
    );
    return { exitCode: 0, status: 'dry-run', record: null, recordPath: null };
  }
  const report = await deps.smoke(baseUrl);
  if (!report.passed) {
    throw new Refusal(
      `The smoke test FAILED on ${baseUrl}: ${revisionName} is not a last known good, so nothing was recorded.`,
    );
  }
  steps.push({
    step: 'smoke',
    status: 'done',
    at: deps.now().toISOString(),
    detail: `${report.checks.length} checks passed`,
  });

  const record: ReleaseRecord = {
    schemaVersion: RECORD_SCHEMA_VERSION,
    releaseId: releaseIdFor(now, sha),
    origin: 'by-hand',
    status: 'promoted',
    startedAt: now.toISOString(),
    finishedAt: deps.now().toISOString(),
    target: { resourceGroup: args.resourceGroup, app: args.app, registry: args.registry },
    commit: { sha, shortSha: sha.slice(0, 12) },
    image: {
      reference: revision.image ?? `${loginServer}/swarm@${digest}`,
      tag: `swarm:${sha}`,
      digest,
      tagLocked: image.locked,
    },
    revision: {
      name: revisionName,
      suffix: revisionName.startsWith(`${args.app}--`)
        ? revisionName.slice(args.app.length + 2)
        : revisionName,
      trafficWeight: 100,
    },
    lastKnownGood: args.previous
      ? {
          revision: args.previous,
          image: previousImage,
          basis: 'named with --previous when the revision was recorded by hand',
        }
      : null,
    migrations: {
      schemaVersionBefore: null,
      schemaVersionAfter: schemaVersion,
      applied: [],
      acceptedSchemaChange: false,
      restorePointUtc: null,
    },
    config: {
      cpu: state.cpu,
      memory: state.memory,
      minReplicas: state.minReplicas,
      maxReplicas: state.maxReplicas,
      environment: redactEnvironment(revision.env.length > 0 ? revision.env : state.env),
    },
    smoke: summariseSmoke(report),
    warmWindow: null,
    steps,
    rollbacks: [],
    rollback: args.previous
      ? {
          command: `npm run azure:release -- rollback --subscription ${args.subscription} --resource-group ${args.resourceGroup} --app ${args.app} --execute --confirm-resource-group ${args.resourceGroup}`,
        }
      : null,
  };
  const path = await persist(deps, record);
  log(`Recorded: ${revisionName} is the last known good. The record: ${path}`);
  if (!args.previous)
    log(
      'No previous revision was named, so there is nothing to roll back to from this record; the next release will make this revision the one it can go back to.',
    );
  return { exitCode: 0, status: 'promoted', record, recordPath: path };
}

/**
 * Read-only: is every revision that serves, and the newest one, configured as the template configures a
 * real image (ingress on 3001, PORT 3001 or unset, the three probes)? Exit code 1 when one is not.
 */
export async function runCheck(args: ReleaseArgs, deps: ReleaseDeps): Promise<ReleaseResult> {
  const { log } = deps;
  const state = await loadTarget(args, deps, { requireMultiple: false });
  if (isPlaceholderImage(state.image)) {
    log(
      `${args.app} runs the placeholder image, which listens on port 80 and has no probes: there is nothing to check until the first real image is on it.`,
    );
    return { exitCode: 0, status: 'inspected', record: null, recordPath: null };
  }
  const serving = servingRevisions(state);
  const names = [
    ...new Set([
      ...serving.map((entry) => entry.name),
      ...(state.latestRevisionName ? [state.latestRevisionName] : []),
    ]),
  ];
  if (serving.length === 0) log('No revision receives traffic.');
  let failed = serving.length === 0;
  for (const name of names) {
    const revision = revisionNamed(state, name);
    const weight = serving.find((entry) => entry.name === name)?.weight ?? 0;
    const checks = checkContainerConfig({
      image: revision?.image ?? null,
      targetPort: state.targetPort,
      env: revision?.env ?? [],
      probes: revision?.probes ?? [],
    });
    log(
      `${name} (${weight}% of traffic${name === state.latestRevisionName ? ', the newest' : ''}):\n${describeChecks(checks)}`,
    );
    if (failedChecks(checks).length > 0) failed = true;
  }
  if (failed) {
    log(
      `FAILED: the deployed configuration is not the one the template sets.\n${templateApplyHelp(args, state)}`,
    );
  } else {
    log(
      'PASSED: the ingress is on port 3001 and the probes are set. The container is not asked whether it answers; the smoke test does that.',
    );
  }
  return { exitCode: failed ? 1 : 0, status: 'inspected', record: null, recordPath: null };
}
