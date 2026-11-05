import {
  APP,
  GROUP,
  REGISTRY,
  SHA_A,
  SHA_B,
  SUB,
  fakeAzure,
  fakeGit,
  fakeSmoke,
  newWorld,
  type FakeWorld,
} from './fake-containerapp.js';
import { parseReleaseArgs } from '../release-args.js';
import { runRelease, type ReleaseDeps } from '../release-flow.js';
import { memoryRecordStore } from '../release-record.js';

/** What the release tests share: the revisions the fake world starts with, the arguments, and a wired tool. */
export const OLD = `${APP}--r${SHA_A.slice(0, 12)}`;
export const NEW = `${APP}--r${SHA_B.slice(0, 12)}`;

export const base = [
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
export const dry = [...base, '--current-schema-version', '9'];
export const live = [...dry, '--execute', '--confirm-resource-group', GROUP];

export function harness(
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

export type Harness = ReturnType<typeof harness>;

/** The kind of each mutating call, in the words the tests use. */
export const kinds = (calls: string[][]): string[] =>
  calls.map((call) => {
    if (call[0] === 'acr' && call[1] === 'build') return 'build';
    if (call[0] === 'acr') return 'lock-tag';
    if (call[2] === 'traffic') return 'traffic';
    if (call[1] === 'update') return 'update';
    return String(call[2]);
  });

export const run = (words: string[], h: Harness) => runRelease(parseReleaseArgs(words), h.deps);
