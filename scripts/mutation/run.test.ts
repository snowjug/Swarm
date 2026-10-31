import { spawn, type ChildProcess } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupHome } from './lib/backups.js';
import { ROOT } from './lib/mutants.js';

// The script, as it is run: two clones of a small project, each with its own copy of the script, share
// one scratch folder. One run is killed outright while it has a file mutated. Nothing that another
// clone's run, or a run that only lists, does may change a file or the scratch folder, and the clone
// that was interrupted is put right by its own next run.

const bases: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) {
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  for (const dir of bases.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const RULE = 'return role === 1;';
const rule = (owner: string): string =>
  `// ${owner}\nexport const rule = (role: number): boolean => {\n  ${RULE}\n};\n`;

const mutant = (id: string, test: string) => ({
  id,
  area: 'sign-in',
  claim: `The rule says yes to everyone (${id})`,
  file: 'src/rule.ts',
  find: RULE,
  replace: 'return true;',
  tests: [test],
});

/** A project of a rule and two tests of it, one that fails at once when the rule is mutated and one that takes a long time. */
function clone(parent: string, name: string, owner: string): string {
  const root = join(parent, name);
  for (const directory of ['scripts/mutation/lib', 'src', 'test']) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  for (const file of ['run.ts', 'lib/mutants.ts', 'lib/backups.ts']) {
    copyFileSync(join(ROOT, 'scripts/mutation', file), join(root, 'scripts/mutation', file));
  }
  writeFileSync(
    join(root, 'scripts/mutation/mutants.json'),
    JSON.stringify({
      mutants: [mutant('M1', 'test/fast.test.ts'), mutant('M2', 'test/slow.test.ts')],
    }),
  );
  writeFileSync(join(root, 'src/rule.ts'), rule(owner));
  const header = "import { expect, it } from 'vitest';\nimport { rule } from '../src/rule';\n";
  writeFileSync(
    join(root, 'test/fast.test.ts'),
    `${header}it('says no to anyone else', () => expect(rule(2)).toBe(false));\n`,
  );
  writeFileSync(
    join(root, 'test/slow.test.ts'),
    `${header}it('waits', async () => {\n  await new Promise((resolve) => setTimeout(resolve, 120_000));\n  expect(rule(2)).toBe(false);\n}, 130_000);\n`,
  );
  writeFileSync(join(root, 'package.json'), '{ "type": "module" }');
  writeFileSync(join(root, 'vitest.config.mjs'), 'export default {};\n');
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');
  return root;
}

const script = (root: string, args: string[], scratch: string) =>
  spawn(process.execPath, ['--import', 'tsx', join(root, 'scripts/mutation/run.ts'), ...args], {
    cwd: root,
    env: { ...process.env, TMPDIR: scratch, NO_COLOR: '1' },
    // Its own process group, so that killing it outright takes the test run it started with it.
    detached: true,
  });

interface Finished {
  code: number | null;
  out: string;
}
function finished(child: ChildProcess): Promise<Finished> {
  children.push(child);
  return new Promise((resolve) => {
    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.on('close', (code) => resolve({ code, out }));
  });
}
const runToEnd = (root: string, args: string[], scratch: string) =>
  finished(script(root, args, scratch));

/** Every file under a folder, with what is in it: what a run leaves must be the same, to the byte. */
function snapshot(directory: string): Record<string, string> {
  const found: Record<string, string> = {};
  const walk = (path: string): void => {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full);
      else found[full.slice(directory.length)] = readFileSync(full, 'utf8');
    }
  };
  walk(directory);
  return found;
}

async function until(done: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Gave up waiting for ${what}.`);
}

describe.skipIf(process.platform === 'win32')('npm run mutation:security', () => {
  it('leaves another clone’s files and the scratch folder alone, listing or running, and puts its own clone right after being killed', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'swarm-mutation-run-'));
    bases.push(parent);
    const scratch = join(parent, 'scratch');
    mkdirSync(scratch);
    const a = clone(parent, 'a', 'clone a');
    const b = clone(parent, 'b', 'clone b, with an edit that is not committed');
    const original = {
      a: readFileSync(join(a, 'src/rule.ts'), 'utf8'),
      b: readFileSync(join(b, 'src/rule.ts'), 'utf8'),
    };
    const text = (root: string): string => readFileSync(join(root, 'src/rule.ts'), 'utf8');
    const mutated = (root: string): boolean => text(root).includes('return true;');

    // Clone A is mid-run, with its file mutated and the test running.
    const slow = script(a, ['--only=M2'], scratch);
    const slowEnd = finished(slow);
    await until(() => mutated(a), 'the first run to change its file');
    expect(backupHome(scratch, a)).toContain(scratch);
    const whileRunning = snapshot(scratch);
    expect(Object.keys(whileRunning).some((path) => path.endsWith('manifest.json'))).toBe(true);

    // A second run in A is refused while the first is going, and changes nothing.
    const refused = await runToEnd(a, ['--only=M1'], scratch);
    expect(refused.code).not.toBe(0);
    expect(refused.out).toContain('Another run of the mutation script is using this clone');
    expect(mutated(a)).toBe(true);
    expect(snapshot(scratch)).toEqual(whileRunning);

    // A run in B, in the same scratch folder, goes through and leaves A as it was.
    const other = await runToEnd(b, ['--only=M1'], scratch);
    expect(other.out).toMatch(/M1\s+KILLED/u);
    expect(other.code).toBe(0);
    expect(text(b)).toBe(original.b);
    expect(mutated(a)).toBe(true);

    // A is killed outright, with its file still mutated.
    process.kill(-slow.pid!, 'SIGKILL');
    await slowEnd;
    expect(mutated(a)).toBe(true);
    const afterKill = snapshot(scratch);

    // Listing is read-only, in either clone: no file is put back, made or removed.
    const listedFromB = await runToEnd(b, ['--list'], scratch);
    expect(listedFromB.code).toBe(0);
    expect(listedFromB.out).toContain('M1');
    expect(text(b)).toBe(original.b);
    expect(mutated(a)).toBe(true);
    expect(snapshot(scratch)).toEqual(afterKill);
    const listedFromA = await runToEnd(a, ['--list'], scratch);
    expect(listedFromA.code).toBe(0);
    expect(mutated(a)).toBe(true);
    expect(snapshot(scratch)).toEqual(afterKill);

    // A run in B does not put A's file back, and A's own next run does, before it starts.
    expect((await runToEnd(b, ['--only=M1'], scratch)).code).toBe(0);
    expect(mutated(a)).toBe(true);
    const again = await runToEnd(a, ['--only=M1'], scratch);
    expect(again.out).toContain('Restored src/rule.ts, which an earlier run had left mutated.');
    expect(again.out).toMatch(/M1\s+KILLED/u);
    expect(text(a)).toBe(original.a);
    expect(text(b)).toBe(original.b);
    // Neither clone has anything left in the scratch folder but its own, now empty, folder.
    for (const root of [a, b]) {
      expect(readdirSync(backupHome(scratch, root))).toEqual([]);
    }
  }, 180_000);
});
