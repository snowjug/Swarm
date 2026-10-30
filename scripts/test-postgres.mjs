/**
 * Runs the unit tests with every in-memory database made a PostgreSQL one (PGlite, which is
 * PostgreSQL compiled to run in this process), so that the same tests that guard the SQLite stores
 * guard the PostgreSQL ones. Arguments go to vitest: `npm run test:postgres -- backend/test/session.test.ts`.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...process.argv.slice(2)],
  { cwd: root, stdio: 'inherit', env: { ...process.env, SWARM_TEST_DATABASE: 'pglite' } },
);
process.exit(result.status ?? 1);
