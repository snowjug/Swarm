import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MutationRun, backupHome, unmatchedBackups } from './backups.js';

// Several clones of the repository, and several runs, can share one scratch folder. These tests use
// two clones with different contents in the same relative place, one scratch folder, and runs that
// are interrupted: nothing one does may change a file of the other, and a run may only put back what
// it can show is its own clone's.

const bases: string[] = [];
const base = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'swarm-mutation-test-'));
  bases.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of bases.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const FILE = 'backend/src/auth/guard.ts';
const guard = (owner: string): string =>
  `// ${owner}\nexport const allowed = (role: string): boolean => role === 'owner';\n`;
const mutate = (text: string): string => text.replace("role === 'owner'", 'true');

function clone(parent: string, name: string, text: string): string {
  const root = join(parent, name);
  mkdirSync(join(root, 'backend/src/auth'), { recursive: true });
  writeFileSync(join(root, FILE), text);
  return root;
}
const read = (root: string): string => readFileSync(join(root, FILE), 'utf8');

/** A process id that was in use and has ended, as a run that was killed leaves behind. */
async function endedProcess(): Promise<number> {
  const child = spawn(process.execPath, ['-e', '']);
  await once(child, 'exit');
  return child.pid!;
}

/** A run that changes the file and is then killed outright: its mutation, backup and lock are left. */
async function interrupted(root: string, scratch: string): Promise<{ original: string }> {
  const run = MutationRun.start({ root, scratch, pid: await endedProcess() });
  const original = readFileSync(join(root, FILE));
  const mutated = mutate(original.toString('utf8'));
  run.record(FILE, original, mutated);
  writeFileSync(join(root, FILE), mutated);
  return { original: original.toString('utf8') };
}

const messages = (): { log: (message: string) => void; said: string[] } => {
  const said: string[] = [];
  return { log: (message) => said.push(message), said };
};

describe('two clones that share one scratch folder', () => {
  it('keep their backups apart: a run in one never touches the other, and neither does an interrupted one', async () => {
    const parent = base();
    const scratch = join(parent, 'scratch');
    const a = clone(parent, 'a', guard('clone a'));
    const b = clone(parent, 'b', guard('clone b, with an edit that is not committed'));
    expect(backupHome(scratch, a)).not.toBe(backupHome(scratch, b));

    const { original } = await interrupted(a, scratch);
    const mutatedA = read(a);
    expect(mutatedA).not.toBe(original);
    const before = readdirSync(backupHome(scratch, a));

    // B starts, runs and ends in the same scratch folder, with the same relative path in play.
    const { log, said } = messages();
    const run = MutationRun.start({ root: b, scratch, log });
    expect(read(b)).toBe(guard('clone b, with an edit that is not committed'));
    expect(said).toEqual([]);
    run.release();
    expect(read(b)).toBe(guard('clone b, with an edit that is not committed'));
    expect(read(a)).toBe(mutatedA);
    expect(readdirSync(backupHome(scratch, a))).toEqual(before);

    // A's next run puts A's file back, and only A's.
    const next = messages();
    MutationRun.start({ root: a, scratch, log: next.log }).release();
    expect(read(a)).toBe(original);
    expect(next.said.some((line) => line.startsWith(`Restored ${FILE}`))).toBe(true);
    expect(read(b)).toBe(guard('clone b, with an edit that is not committed'));
  });

  it('are not confused by a backup that an older version of the script left without saying whose it was', async () => {
    const parent = base();
    const scratch = join(parent, 'scratch');
    const a = clone(parent, 'a', guard('clone a'));
    const b = clone(parent, 'b', guard('clone b'));
    // Where the older script put it: one folder for everyone, named for the path alone.
    mkdirSync(join(scratch, 'swarm-mutation-backups'), { recursive: true });
    writeFileSync(
      join(scratch, 'swarm-mutation-backups', encodeURIComponent(FILE)),
      guard('clone a'),
    );

    MutationRun.start({ root: b, scratch }).release();
    expect(read(b)).toBe(guard('clone b'));
    expect(unmatchedBackups(scratch)).toEqual([encodeURIComponent(FILE)]);
    MutationRun.start({ root: a, scratch }).release();
    expect(unmatchedBackups(scratch)).toEqual([encodeURIComponent(FILE)]);
  });

  it('do not put back a record that names another clone, even when it is found in this one’s folder', async () => {
    const parent = base();
    const scratch = join(parent, 'scratch');
    const a = clone(parent, 'a', guard('clone a'));
    const b = clone(parent, 'b', guard('clone b'));
    const { original } = await interrupted(b, scratch);
    const mutatedB = read(b);
    // The scratch folder is copied, or a clone is moved: B's record turns up under A's name.
    mkdirSync(backupHome(scratch, a), { recursive: true });
    const [runDir] = readdirSync(backupHome(scratch, b)).filter((name) => name !== 'lock');
    renameSync(join(backupHome(scratch, b), runDir!), join(backupHome(scratch, a), runDir!));

    const { log, said } = messages();
    MutationRun.start({ root: a, scratch, log }).release();
    expect(said.join('\n')).toContain('made for another clone');
    expect(read(a)).toBe(guard('clone a'));
    expect(read(b)).toBe(mutatedB);
    expect(existsSync(join(backupHome(scratch, a), runDir!))).toBe(true);
    expect(original).toBe(guard('clone b'));
  });
});

describe('what an interrupted run left behind', () => {
  it('is put back by the next run in the same clone, and leaves nothing behind', async () => {
    const parent = base();
    const scratch = join(parent, 'scratch');
    const root = clone(parent, 'a', guard('clone a'));
    const { original } = await interrupted(root, scratch);
    expect(read(root)).not.toBe(original);

    const { log, said } = messages();
    const run = MutationRun.start({ root, scratch, log });
    expect(read(root)).toBe(original);
    expect(said.join('\n')).toContain(`Restored ${FILE}, which an earlier run had left mutated.`);
    run.release();
    expect(readdirSync(backupHome(scratch, root))).toEqual([]);
  });

  it('is left alone when the file has been changed since, and is kept for someone to look at', async () => {
    const parent = base();
    const scratch = join(parent, 'scratch');
    const root = clone(parent, 'a', guard('clone a'));
    await interrupted(root, scratch);
    const edited = `${read(root)}// edited by hand after the run was killed\n`;
    writeFileSync(join(root, FILE), edited);

    const { log, said } = messages();
    MutationRun.start({ root, scratch, log }).release();
    expect(read(root)).toBe(edited);
    expect(said.join('\n')).toContain('has been changed since');
    expect(
      readdirSync(backupHome(scratch, root)).some((name) => name.endsWith('.unresolved')),
    ).toBe(true);
  });

  it('is left alone when the file has been put back already, and the backup goes', async () => {
    const parent = base();
    const scratch = join(parent, 'scratch');
    const root = clone(parent, 'a', guard('clone a'));
    const { original } = await interrupted(root, scratch);
    writeFileSync(join(root, FILE), original);

    const { log, said } = messages();
    MutationRun.start({ root, scratch, log }).release();
    expect(read(root)).toBe(original);
    expect(said.join('\n')).not.toContain('Restored');
    expect(readdirSync(backupHome(scratch, root))).toEqual([]);
  });

  it('is not put back from a backup that is not what the run recorded', async () => {
    const parent = base();
    const scratch = join(parent, 'scratch');
    const root = clone(parent, 'a', guard('clone a'));
    await interrupted(root, scratch);
    const mutated = read(root);
    const home = backupHome(scratch, root);
    const [runDir] = readdirSync(home).filter((name) => name !== 'lock');
    writeFileSync(join(home, runDir!, encodeURIComponent(FILE)), 'export const planted = true;\n');

    const { log, said } = messages();
    MutationRun.start({ root, scratch, log }).release();
    expect(read(root)).toBe(mutated);
    expect(said.join('\n')).toContain('not what the interrupted run recorded');
  });

  it('is not put back to a path outside the clone', async () => {
    const parent = base();
    const scratch = join(parent, 'scratch');
    const root = clone(parent, 'a', guard('clone a'));
    const outside = join(parent, 'outside.txt');
    writeFileSync(outside, 'not part of any clone\n');
    await interrupted(root, scratch);
    const home = backupHome(scratch, root);
    const [runDir] = readdirSync(home).filter((name) => name !== 'lock');
    const manifestPath = join(home, runDir!, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      entries: Record<string, unknown>;
    };
    manifest.entries = { '../outside.txt': Object.values(manifest.entries)[0] };
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(join(home, runDir!, encodeURIComponent('../outside.txt')), 'planted\n');

    const { log, said } = messages();
    MutationRun.start({ root, scratch, log }).release();
    expect(readFileSync(outside, 'utf8')).toBe('not part of any clone\n');
    expect(said.join('\n')).toContain('not a file of this clone');
  });

  it('is left alone, with a note, when its record cannot be read', async () => {
    const parent = base();
    const scratch = join(parent, 'scratch');
    const root = clone(parent, 'a', guard('clone a'));
    await interrupted(root, scratch);
    const mutated = read(root);
    const home = backupHome(scratch, root);
    const [runDir] = readdirSync(home).filter((name) => name !== 'lock');
    writeFileSync(join(home, runDir!, 'manifest.json'), '{ not json');

    const { log, said } = messages();
    MutationRun.start({ root, scratch, log }).release();
    expect(read(root)).toBe(mutated);
    expect(said.join('\n')).toContain('no record that can be read');
  });
});

describe('one run at a time in a clone', () => {
  it('refuses a second run while the first is going, and changes nothing', () => {
    const parent = base();
    const scratch = join(parent, 'scratch');
    const root = clone(parent, 'a', guard('clone a'));
    const first = MutationRun.start({ root, scratch });
    const original = readFileSync(join(root, FILE));
    first.record(FILE, original, mutate(original.toString('utf8')));
    writeFileSync(join(root, FILE), mutate(original.toString('utf8')));
    const held = readdirSync(backupHome(scratch, root)).sort();

    expect(() => MutationRun.start({ root, scratch })).toThrow(/Another run .* using this clone/u);
    expect(readdirSync(backupHome(scratch, root)).sort()).toEqual(held);
    expect(read(root)).toBe(mutate(original.toString('utf8')));

    first.forget(FILE);
    writeFileSync(join(root, FILE), original);
    first.release();
    MutationRun.start({ root, scratch }).release();
  });

  it('takes over the lock of a run that has gone, and of one whose lock cannot be read', async () => {
    const parent = base();
    const scratch = join(parent, 'scratch');
    const root = clone(parent, 'a', guard('clone a'));
    await interrupted(root, scratch);
    const { log, said } = messages();
    MutationRun.start({ root, scratch, log }).release();
    expect(said.join('\n')).toContain('is no longer there');

    mkdirSync(backupHome(scratch, root), { recursive: true });
    writeFileSync(join(backupHome(scratch, root), 'lock'), 'garbage');
    MutationRun.start({ root, scratch }).release();
    expect(existsSync(join(backupHome(scratch, root), 'lock'))).toBe(false);
  });

  it('is not slowed or blocked by a run in another clone', () => {
    const parent = base();
    const scratch = join(parent, 'scratch');
    const a = clone(parent, 'a', guard('clone a'));
    const b = clone(parent, 'b', guard('clone b'));
    const first = MutationRun.start({ root: a, scratch });
    const second = MutationRun.start({ root: b, scratch });
    second.release();
    first.release();
  });
});
