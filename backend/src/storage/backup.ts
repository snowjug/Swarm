import {
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  readSync,
  renameSync,
  statSync,
} from 'node:fs';

const CHUNK = 1 << 20;

/** Reads until the buffer is full or the file ends: a read may return less than was asked for. */
function fill(descriptor: number, buffer: Buffer): number {
  let filled = 0;
  while (filled < buffer.length) {
    const read = readSync(descriptor, buffer, filled, buffer.length - filled, null);
    if (read === 0) break;
    filled += read;
  }
  return filled;
}

/** Whether two files hold exactly the same bytes. Compares in blocks, so a large database is not read into memory. */
export function sameBytes(first: string, second: string): boolean {
  if (statSync(first).size !== statSync(second).size) return false;
  const left = openSync(first, 'r');
  const right = openSync(second, 'r');
  try {
    const a = Buffer.allocUnsafe(CHUNK);
    const b = Buffer.allocUnsafe(CHUNK);
    for (;;) {
      const read = fill(left, a);
      if (read !== fill(right, b)) return false;
      if (read === 0) return true;
      if (a.compare(b, 0, read, 0, read) !== 0) return false;
    }
  } finally {
    closeSync(left);
    closeSync(right);
  }
}

/** A name for a copy that is being set aside: `<backup minus .bak>.<when it was last written>.bak`. */
function setAsideName(backup: string): string {
  const stamp = statSync(backup)
    .mtime.toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d+Z$/u, 'Z');
  const stem = backup.replace(/\.bak$/u, '');
  let name = `${stem}.${stamp}.bak`;
  for (let n = 2; existsSync(name); n++) name = `${stem}.${stamp}-${n}.bak`;
  return name;
}

/**
 * Copies a SQLite database file before it is upgraded, and says where the copy is. The copy is
 * `<file>.v<version>.bak`, `version` being the schema it is a copy of, and it is always the copy of
 * the database as it is now.
 *
 * An earlier copy of the same version is left alone when the database has not changed since (an
 * upgrade that failed and rolled back, started again), so a container that restarts in a loop does
 * not fill the disk. When the database has changed (the upgrade was rolled back, the release before
 * ran for a while, and the upgrade was tried again), the earlier copy is out of date and restoring
 * it would lose that work. It is set aside under a name that says when it was last written, never
 * overwritten, and a new copy takes its place.
 */
export function backupBeforeUpgrade(file: string, version: number): string {
  const backup = `${file}.v${version}.bak`;
  if (existsSync(backup)) {
    if (sameBytes(file, backup)) return backup;
    renameSync(backup, setAsideName(backup));
  }
  copyFileSync(file, backup);
  return backup;
}
