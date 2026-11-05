import { parseArgs } from 'node:util';
import { UsageError } from './args.js';
import { isGuid } from './subscription.js';

export const RELEASE_ACTIONS = [
  'status',
  'check',
  'build',
  'release',
  'record',
  'promote',
  'rollback',
  'finalize',
] as const;
export type ReleaseAction = (typeof RELEASE_ACTIONS)[number];

export interface ReleaseArgs {
  action: ReleaseAction;
  subscription: string;
  resourceGroup: string;
  app: string;
  registry: string;
  commit: string | undefined;
  skipBuild: boolean;
  lockTag: boolean;
  /** 0 sends the new revision straight to all traffic; 1-50 stops at that share and waits for `promote`. */
  canaryPercent: number;
  warmHours: number;
  readyTimeoutMinutes: number;
  acceptSchemaChange: boolean;
  currentSchemaVersion: number | undefined;
  to: string | undefined;
  force: boolean;
  execute: boolean;
  confirmResourceGroup: string | undefined;
  autoRollback: boolean;
  revisionPrecheck: boolean;
  recordDir: string;
  allowProductionName: boolean;
  /** record: the revision that was made by hand, and the image digest it runs. */
  revision: string | undefined;
  digest: string | undefined;
  /** record: the revision that served before it, which a rollback returns to. Empty: there is none. */
  previous: string | undefined;
  /** record: a few words on how the revision came about. */
  note: string | undefined;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._()-]{0,89}$/u;
const APP = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/u;
const REGISTRY = /^[a-z0-9]{5,50}$/u;
const REVISION = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/u;
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

function whole(value: string | undefined, label: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new UsageError(`--${label} must be a whole number from ${min} to ${max}.`);
  }
  return parsed;
}

export function parseReleaseArgs(argv: readonly string[]): ReleaseArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: true,
      options: {
        subscription: { type: 'string' },
        'resource-group': { type: 'string' },
        app: { type: 'string' },
        registry: { type: 'string' },
        commit: { type: 'string' },
        'skip-build': { type: 'boolean', default: false },
        'no-lock-tag': { type: 'boolean', default: false },
        'canary-percent': { type: 'string', default: '0' },
        'warm-hours': { type: 'string', default: '4' },
        'ready-timeout-minutes': { type: 'string', default: '10' },
        'accept-schema-change': { type: 'boolean', default: false },
        'current-schema-version': { type: 'string' },
        to: { type: 'string' },
        force: { type: 'boolean', default: false },
        execute: { type: 'boolean', default: false },
        'confirm-resource-group': { type: 'string' },
        'no-auto-rollback': { type: 'boolean', default: false },
        'no-revision-precheck': { type: 'boolean', default: false },
        'record-dir': { type: 'string', default: '.azure/releases' },
        'allow-production-name': { type: 'boolean', default: false },
        revision: { type: 'string' },
        digest: { type: 'string' },
        previous: { type: 'string' },
        note: { type: 'string' },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : 'Invalid arguments.');
  }
  const values = parsed.values;
  const [action = 'status', ...extra] = parsed.positionals;
  if (extra.length > 0 || !(RELEASE_ACTIONS as readonly string[]).includes(action)) {
    throw new UsageError(`The first word must be one of: ${RELEASE_ACTIONS.join(', ')}.`);
  }
  // Never fall back to the CLI's default subscription: the target must be a deliberate choice.
  if (!values.subscription || !isGuid(values.subscription)) {
    throw new UsageError(
      '--subscription <guid> is required. The default subscription is never used implicitly.',
    );
  }
  const resourceGroup = values['resource-group'];
  if (!resourceGroup || !NAME.test(resourceGroup))
    throw new UsageError('--resource-group <name> is required.');
  const app = values.app;
  if (!app || !APP.test(app))
    throw new UsageError('--app <container app name> is required (lower case, digits, hyphens).');
  const registry = values.registry;
  if (['release', 'build', 'record'].includes(action) && (!registry || !REGISTRY.test(registry))) {
    throw new UsageError(
      `--registry <registry name> is required to ${action} (5-50 lower-case letters and digits).`,
    );
  }
  if (registry !== undefined && !REGISTRY.test(registry))
    throw new UsageError('--registry is not a valid registry name.');
  if (values.commit !== undefined && !SHA.test(values.commit.toLowerCase())) {
    throw new UsageError(
      '--commit must be a full 40-character commit hash: the image tag is the immutable commit hash.',
    );
  }
  if (values.to !== undefined && !REVISION.test(values.to))
    throw new UsageError('--to must be a revision name.');
  if (action === 'record') {
    if (!values.revision || !REVISION.test(values.revision))
      throw new UsageError('--revision <revision name> is required to record a release.');
    if (!values.digest || !DIGEST.test(values.digest))
      throw new UsageError(
        '--digest sha256:<64 hex digits> is required to record a release: the digest of the image the revision runs.',
      );
    if (!values.commit)
      throw new UsageError(
        '--commit <40-character commit hash> is required to record a release: the commit the image was built from.',
      );
  }
  if (values.revision !== undefined && !REVISION.test(values.revision))
    throw new UsageError('--revision must be a revision name.');
  if (values.digest !== undefined && !DIGEST.test(values.digest))
    throw new UsageError('--digest must be sha256: followed by 64 hex digits.');
  if (values.previous !== undefined && !REVISION.test(values.previous))
    throw new UsageError('--previous must be a revision name.');
  if (values.note !== undefined && (values.note.length > 200 || /[\r\n]/u.test(values.note)))
    throw new UsageError('--note must be one line of at most 200 characters.');
  const current = values['current-schema-version'];
  return {
    action: action as ReleaseAction,
    subscription: values.subscription,
    resourceGroup,
    app,
    registry: registry ?? '',
    commit: values.commit?.toLowerCase(),
    skipBuild: values['skip-build'] ?? false,
    lockTag: !(values['no-lock-tag'] ?? false),
    canaryPercent: whole(values['canary-percent'], 'canary-percent', 0, 50),
    warmHours: whole(values['warm-hours'], 'warm-hours', 1, 168),
    readyTimeoutMinutes: whole(values['ready-timeout-minutes'], 'ready-timeout-minutes', 1, 30),
    acceptSchemaChange: values['accept-schema-change'] ?? false,
    currentSchemaVersion:
      current === undefined ? undefined : whole(current, 'current-schema-version', 0, 10_000),
    to: values.to,
    force: values.force ?? false,
    execute: values.execute ?? false,
    confirmResourceGroup: values['confirm-resource-group'],
    autoRollback: !(values['no-auto-rollback'] ?? false),
    revisionPrecheck: !(values['no-revision-precheck'] ?? false),
    recordDir: values['record-dir'] ?? '.azure/releases',
    allowProductionName: values['allow-production-name'] ?? false,
    revision: values.revision,
    digest: values.digest,
    previous: values.previous,
    note: values.note,
  };
}
