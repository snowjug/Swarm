import { parseArgs } from 'node:util';
import { UsageError } from './args.js';
import type { LiveTarget } from './release-flow.js';
import { isGuid } from './subscription.js';

export interface DrillArgs extends LiveTarget {
  /** Also rehearse the slow path: retire the previous revision, then roll back to it (a start, not a switch). */
  cold: boolean;
  /** How long readiness is polled, once a second, after the shift and again after the rollback. */
  observeSeconds: number;
  /** The most seconds the rollback may take to show on the control plane and on the public address. */
  rollbackDeadlineSeconds: number;
  /** Failed readiness polls tolerated in each observation window. */
  maxFailedPolls: number;
  recordDir: string;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._()-]{0,89}$/u;
const APP = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/u;

function whole(value: string | undefined, label: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new UsageError(`--${label} must be a whole number from ${min} to ${max}.`);
  }
  return parsed;
}

export function parseDrillArgs(argv: readonly string[]): DrillArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        subscription: { type: 'string' },
        'resource-group': { type: 'string' },
        app: { type: 'string' },
        cold: { type: 'boolean', default: false },
        'observe-seconds': { type: 'string', default: '45' },
        'rollback-deadline-seconds': { type: 'string', default: '60' },
        'max-failed-polls': { type: 'string', default: '0' },
        'ready-timeout-minutes': { type: 'string', default: '10' },
        execute: { type: 'boolean', default: false },
        'confirm-resource-group': { type: 'string' },
        'record-dir': { type: 'string', default: '.azure/drills' },
        'allow-production-name': { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : 'Invalid arguments.');
  }
  const values = parsed.values;
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
  return {
    subscription: values.subscription,
    resourceGroup,
    app,
    cold: values.cold ?? false,
    observeSeconds: whole(values['observe-seconds'], 'observe-seconds', 10, 600),
    rollbackDeadlineSeconds: whole(
      values['rollback-deadline-seconds'],
      'rollback-deadline-seconds',
      5,
      600,
    ),
    maxFailedPolls: whole(values['max-failed-polls'], 'max-failed-polls', 0, 20),
    readyTimeoutMinutes: whole(values['ready-timeout-minutes'], 'ready-timeout-minutes', 1, 30),
    execute: values.execute ?? false,
    confirmResourceGroup: values['confirm-resource-group'],
    recordDir: values['record-dir'] ?? '.azure/drills',
    allowProductionName: values['allow-production-name'] ?? false,
  };
}
