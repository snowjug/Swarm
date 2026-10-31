import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupBeforeUpgrade, sameBytes } from '../src/storage/backup.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function workDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'swarm-backup-'));
  directories.push(directory);
  return directory;
}
const filesIn = (directory: string): string[] => readdirSync(directory).sort();

describe('comparing two files', () => {
  it('says whether every byte is the same, however large the files are', () => {
    const directory = workDirectory();
    const a = join(directory, 'a');
    const b = join(directory, 'b');
    // More than one block, so that the comparison has to carry on past the first.
    const big = Buffer.alloc((1 << 20) * 2 + 17, 7);
    writeFileSync(a, big);
    writeFileSync(b, big);
    expect(sameBytes(a, b)).toBe(true);

    // One byte different, in the last block.
    const changed = Buffer.from(big);
    changed[changed.length - 1] = 8;
    writeFileSync(b, changed);
    expect(sameBytes(a, b)).toBe(false);

    // One byte different, in the first block, and in the middle.
    const first = Buffer.from(big);
    first[0] = 1;
    writeFileSync(b, first);
    expect(sameBytes(a, b)).toBe(false);
    const middle = Buffer.from(big);
    middle[1 << 20] = 1;
    writeFileSync(b, middle);
    expect(sameBytes(a, b)).toBe(false);

    // A different length is different even when one is the start of the other.
    writeFileSync(b, big.subarray(0, big.length - 1));
    expect(sameBytes(a, b)).toBe(false);
  });

  it('treats two empty files as the same', () => {
    const directory = workDirectory();
    writeFileSync(join(directory, 'a'), '');
    writeFileSync(join(directory, 'b'), '');
    expect(sameBytes(join(directory, 'a'), join(directory, 'b'))).toBe(true);
  });
});

describe('the copy taken before an upgrade', () => {
  it('is a copy of the file named for the version it is a copy of', () => {
    const directory = workDirectory();
    const file = join(directory, 'swarm.sqlite');
    writeFileSync(file, 'version four');
    const backup = backupBeforeUpgrade(file, 4);
    expect(backup).toBe(`${file}.v4.bak`);
    expect(readFileSync(backup, 'utf8')).toBe('version four');
    expect(readFileSync(file, 'utf8')).toBe('version four');
  });

  it('is kept as it is when the file has not changed since, however often it is asked for', () => {
    const directory = workDirectory();
    const file = join(directory, 'swarm.sqlite');
    writeFileSync(file, 'same');
    const first = backupBeforeUpgrade(file, 4);
    for (let tries = 0; tries < 4; tries++) expect(backupBeforeUpgrade(file, 4)).toBe(first);
    expect(filesIn(directory)).toEqual(['swarm.sqlite', 'swarm.sqlite.v4.bak']);
  });

  it('sets the older copy aside under the time it was last written, and takes a new one', () => {
    const directory = workDirectory();
    const file = join(directory, 'swarm.sqlite');
    writeFileSync(file, 'old data');
    const first = backupBeforeUpgrade(file, 4);
    utimesSync(first, new Date('2026-03-04T05:06:07Z'), new Date('2026-03-04T05:06:07Z'));

    writeFileSync(file, 'old data and more');
    const second = backupBeforeUpgrade(file, 4);

    expect(second).toBe(first);
    expect(readFileSync(second, 'utf8')).toBe('old data and more');
    expect(filesIn(directory)).toEqual([
      'swarm.sqlite',
      'swarm.sqlite.v4.20260304T050607Z.bak',
      'swarm.sqlite.v4.bak',
    ]);
    expect(readFileSync(join(directory, 'swarm.sqlite.v4.20260304T050607Z.bak'), 'utf8')).toBe(
      'old data',
    );
  });

  it('never overwrites a copy that was set aside, even when two share a second', () => {
    const directory = workDirectory();
    const file = join(directory, 'swarm.sqlite');
    const when = new Date('2026-03-04T05:06:07Z');
    const versions = ['one', 'two', 'three'];
    for (const [index, content] of versions.entries()) {
      writeFileSync(file, content);
      const backup = backupBeforeUpgrade(file, 4);
      if (index < versions.length - 1) utimesSync(backup, when, when);
    }
    const aside = filesIn(directory).filter((name) => /\d{8}T\d{6}Z/u.test(name));
    expect(aside).toEqual([
      'swarm.sqlite.v4.20260304T050607Z-2.bak',
      'swarm.sqlite.v4.20260304T050607Z.bak',
    ]);
    const contents = aside.map((name) => readFileSync(join(directory, name), 'utf8')).sort();
    expect(contents).toEqual(['one', 'two']);
    expect(readFileSync(`${file}.v4.bak`, 'utf8')).toBe('three');
    expect(existsSync(`${file}.v4.bak`)).toBe(true);
  });

  it('keeps a separate copy for each version', () => {
    const directory = workDirectory();
    const file = join(directory, 'swarm.sqlite');
    writeFileSync(file, 'four');
    backupBeforeUpgrade(file, 4);
    writeFileSync(file, 'five');
    backupBeforeUpgrade(file, 5);
    expect(filesIn(directory)).toEqual([
      'swarm.sqlite',
      'swarm.sqlite.v4.bak',
      'swarm.sqlite.v5.bak',
    ]);
    expect(readFileSync(`${file}.v4.bak`, 'utf8')).toBe('four');
    expect(readFileSync(`${file}.v5.bak`, 'utf8')).toBe('five');
  });
});
