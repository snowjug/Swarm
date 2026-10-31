import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';

/**
 * Where a run of the mutation script puts the original of a file it is about to change, and how
 * a later run finds out what an interrupted one left behind.
 *
 * Several clones of the repository can share one scratch folder, and so can several runs. So what a
 * run puts aside is kept in a folder named for the clone it is in (a hash of its canonical path) and
 * for the run itself, a lock lets one run at a time use a clone, and a stray backup is put back only
 * when it is plainly this clone's: its record names this clone, the file is still as the interrupted
 * run left it, and the backup is what the record says it is. Anything else is left where it is, with
 * a message, because overwriting a file that someone has changed is worse than leaving a stray.
 */

const hash = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const digest = z.string().regex(/^[0-9a-f]{64}$/u);

const manifestSchema = z.object({
  version: z.literal(1),
  root: z.string(),
  runId: z.string(),
  pid: z.number().int().positive(),
  startedAt: z.string(),
  /** For each source file the run changed: the hash of the original and of what it was changed to. */
  entries: z.record(z.string(), z.object({ original: digest, mutated: digest })),
});
type Manifest = z.infer<typeof manifestSchema>;

const lockSchema = z.object({
  pid: z.number().int().positive(),
  runId: z.string(),
  root: z.string(),
  startedAt: z.string(),
});

const TOP = 'swarm-mutation-backups';
const LOCK = 'lock';
const PARKED = '.unresolved';

/** The folder that holds everything the runs in one clone put aside. Reading the name creates nothing. */
export function backupHome(scratch: string, root: string): string {
  return join(scratch, TOP, hash(realpathSync(root)).slice(0, 16));
}

/** Backups left in the scratch folder by a version of the script that did not say which clone they were for. */
export function unmatchedBackups(scratch: string): string[] {
  const top = join(scratch, TOP);
  if (!existsSync(top)) return [];
  return readdirSync(top).filter((name) => !statSync(join(top, name)).isDirectory());
}

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // The process is there, and belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** Where a file the manifest names would be written, or null when that is not a file inside the clone. */
function insideClone(root: string, file: string): string | null {
  if (file === '' || file.includes('\0')) return null;
  const target = resolve(root, file);
  const from = relative(root, target);
  return from === '' || from.startsWith('..') || isAbsolute(from) ? null : target;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeAtomically(path: string, content: string): void {
  const next = `${path}.next`;
  writeFileSync(next, content);
  renameSync(next, path);
}

/**
 * Puts back what an interrupted run left mutated in this clone. Only runs that are no longer there are
 * passed to it: the caller holds the lock.
 */
export function restoreStrays(
  home: string,
  root: string,
  log: (message: string) => void = console.warn,
): void {
  for (const name of readdirSync(home)) {
    const dir = join(home, name);
    if (name === LOCK || name.endsWith(PARKED) || !statSync(dir).isDirectory()) continue;
    const parsed = manifestSchema.safeParse(readJson(join(dir, 'manifest.json')));
    if (!parsed.success) {
      log(`Left ${dir} alone: it has no record that can be read of what it holds.`);
      renameSync(dir, `${dir}${PARKED}`);
      continue;
    }
    const manifest = parsed.data;
    if (manifest.root !== root) {
      log(`Left ${dir} alone: it was made for another clone (${manifest.root}), not this one.`);
      continue;
    }
    let settled = true;
    for (const [file, entry] of Object.entries(manifest.entries)) {
      const target = insideClone(root, file);
      const backup = join(dir, encodeURIComponent(file));
      if (target === null) {
        log(`Refused to restore ${file}: it is not a file of this clone.`);
        settled = false;
        continue;
      }
      if (!existsSync(target)) {
        log(`Left ${file} alone: it is no longer there.`);
        settled = false;
        continue;
      }
      const present = hash(readFileSync(target));
      if (present === entry.original) {
        rmSync(backup, { force: true });
        continue;
      }
      if (present !== entry.mutated) {
        log(
          `Left ${file} alone: it has been changed since the run that mutated it was interrupted.`,
        );
        settled = false;
        continue;
      }
      const original = existsSync(backup) ? readFileSync(backup) : null;
      if (original === null || hash(original) !== entry.original) {
        log(`Left ${file} alone: its backup is not what the interrupted run recorded.`);
        settled = false;
        continue;
      }
      writeFileSync(target, original);
      rmSync(backup, { force: true });
      log(`Restored ${file}, which an earlier run had left mutated.`);
    }
    if (settled) rmSync(dir, { recursive: true, force: true });
    else renameSync(dir, `${dir}${PARKED}`);
  }
}

export interface StartOptions {
  /** The clone the run changes files in. */
  root: string;
  /** Where backups are kept, shared by every clone on the machine. */
  scratch: string;
  /** The process that owns the run. Only a test says anything else. */
  pid?: number;
  isRunning?: (pid: number) => boolean;
  log?: (message: string) => void;
}

/** One run of the mutation script in one clone: it holds the clone's lock and the backups it makes. */
export class MutationRun {
  readonly id = randomUUID();
  private readonly dir: string;
  private readonly lock: string;
  private manifest: Manifest;

  private constructor(
    private readonly home: string,
    private readonly root: string,
    pid: number,
  ) {
    this.dir = join(home, this.id);
    this.lock = join(home, LOCK);
    this.manifest = {
      version: 1,
      root,
      runId: this.id,
      pid,
      startedAt: new Date().toISOString(),
      entries: {},
    };
  }

  /**
   * Takes the clone's lock, which fails while another run in it is going, and then puts back whatever
   * a run that is no longer there left mutated.
   */
  static start(options: StartOptions): MutationRun {
    const root = realpathSync(options.root);
    const home = backupHome(options.scratch, root);
    const pid = options.pid ?? process.pid;
    const alive = options.isRunning ?? isRunning;
    const log = options.log ?? console.warn;
    mkdirSync(home, { recursive: true });
    const run = new MutationRun(home, root, pid);
    const lock = { pid, runId: run.id, root, startedAt: run.manifest.startedAt };
    for (let attempt = 0; ; attempt += 1) {
      try {
        writeFileSync(run.lock, JSON.stringify(lock), { flag: 'wx' });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= 2) throw error;
        const held = lockSchema.safeParse(readJson(run.lock));
        if (held.success && alive(held.data.pid)) {
          throw new Error(
            `Another run of the mutation script is using this clone (process ${held.data.pid}, started ${held.data.startedAt}). ` +
              `Wait for it to finish; if none is running, delete ${run.lock}.`,
          );
        }
        log(
          `A run that was using this clone${held.success ? ` (process ${held.data.pid})` : ''} is no longer there.`,
        );
        rmSync(run.lock, { force: true });
      }
    }
    try {
      restoreStrays(home, root, log);
      mkdirSync(run.dir);
      run.save();
    } catch (error) {
      run.release();
      throw error;
    }
    return run;
  }

  private save(): void {
    writeAtomically(join(this.dir, 'manifest.json'), JSON.stringify(this.manifest, null, 2));
  }

  /** Puts the original of a file aside, and records what it is about to be changed to. Call before changing it. */
  record(file: string, original: Buffer, mutated: string | Buffer): void {
    if (insideClone(this.root, file) === null) {
      throw new Error(`${file} is not a file of this clone.`);
    }
    writeFileSync(join(this.dir, encodeURIComponent(file)), original);
    this.manifest.entries[file] = { original: hash(original), mutated: hash(mutated) };
    this.save();
  }

  /** The file is as it was: its backup is not needed. */
  forget(file: string): void {
    delete this.manifest.entries[file];
    this.save();
    rmSync(join(this.dir, encodeURIComponent(file)), { force: true });
  }

  /** Ends the run: its backups go, and the clone is free for another run. Call only when nothing is mutated. */
  release(): void {
    rmSync(this.dir, { recursive: true, force: true });
    const held = lockSchema.safeParse(readJson(this.lock));
    if (held.success && held.data.runId === this.id) rmSync(this.lock, { force: true });
  }
}
