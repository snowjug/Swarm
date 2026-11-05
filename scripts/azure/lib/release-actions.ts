import type { ReleaseArgs } from './release-args.js';
import { runBuild, runCheck, runRecord } from './release-extras.js';
import {
  runFinalize,
  runPromote,
  runRelease,
  runRollback,
  runStatus,
  type ReleaseDeps,
  type ReleaseResult,
} from './release-flow.js';

/** The one entry point of the release tool: which action was asked for, and the flow that runs it. */
export async function runReleaseAction(
  args: ReleaseArgs,
  deps: ReleaseDeps,
): Promise<ReleaseResult> {
  switch (args.action) {
    case 'build':
      return runBuild(args, deps);
    case 'check':
      return runCheck(args, deps);
    case 'record':
      return runRecord(args, deps);
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
