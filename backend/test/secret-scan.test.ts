import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// The scanner is a gate, so it is tested the way a gate has to be: by planting what it exists to
// find and seeing it found, and by seeing a clean repository pass. The tokens are assembled at run
// time so that this file does not itself contain anything the scanner would flag.
const script = fileURLToPath(new URL('../../scripts/secret-scan.mjs', import.meta.url));
const githubToken = ['gh', 'p_', 'Ab12'.repeat(10)].join('');
const sasQuery = ['?sv=2024-01-01', '&sig=', 'Zm9vYmFy'.repeat(4)].join('');

interface Repository {
  dir: string;
  git: (...args: string[]) => string;
  write: (path: string, content: string | Buffer) => void;
  commit: (message: string) => void;
}

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function repository(): Repository {
  const dir = mkdtempSync(join(tmpdir(), 'swarm-scan-'));
  directories.push(dir);
  const git = (...args: string[]): string =>
    execFileSync(
      'git',
      [
        '-C',
        dir,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.test',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  git('init', '--quiet', '--initial-branch=main');
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(script, join(dir, 'scripts', 'secret-scan.mjs'));
  return {
    dir,
    git,
    write: (path, content) => {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), content);
    },
    commit: (message) => {
      git('add', '--all');
      git('commit', '--quiet', '-m', message);
    },
  };
}

function scan(directory: string): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [join(directory, 'scripts', 'secret-scan.mjs')], {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (error) {
    const failure = error as { status: number; stdout: string };
    return { code: failure.status, output: failure.stdout };
  }
}

const findings = (output: string): string[] =>
  output.split('\n').filter((line) => line.startsWith('  '));

// Each case starts a git repository and a Node process, which is slow only when the machine is.
describe('the credential scan', { timeout: 120_000 }, () => {
  it('passes a repository with nothing to find, and says how much it read', () => {
    const repo = repository();
    repo.write('notes.md', '# Notes\nNothing here.\n');
    repo.write('.env.example', 'API_KEY=\n');
    repo.commit('first');
    const { code, output } = scan(repo.dir);
    expect(output).toContain('findings: 0');
    expect(output).toContain('tracked .env files: 0');
    expect(output).toMatch(/history blobs scanned: 3; working-tree files scanned: 3/u);
    expect(code).toBe(0);
  });

  it('finds a credential that was committed and later deleted, because history keeps it', () => {
    const repo = repository();
    repo.write('leak.txt', `token ${githubToken}\n`);
    repo.commit('add');
    repo.git('rm', '--quiet', 'leak.txt');
    repo.commit('remove');
    const { code, output } = scan(repo.dir);
    expect(code).toBe(1);
    expect(findings(output)).toEqual([
      expect.stringMatching(/^ {2}GitHub token :: history:leak\.txt@/u),
    ]);
    expect(output).not.toContain(githubToken);
  });

  it('finds a credential on a branch that was never merged', () => {
    const repo = repository();
    repo.write('a.txt', 'fine\n');
    repo.commit('base');
    repo.git('checkout', '--quiet', '-b', 'side');
    repo.write('side.txt', `${githubToken}\n`);
    repo.commit('side');
    repo.git('checkout', '--quiet', 'main');
    const { code, output } = scan(repo.dir);
    expect(code).toBe(1);
    expect(output).toMatch(/GitHub token :: history:side\.txt@/u);
  });

  it('finds a credential in a file that was never committed, by pattern name only', () => {
    const repo = repository();
    repo.write('a.txt', 'fine\n');
    repo.commit('base');
    repo.write('notes.txt', `https://example.test/blob${sasQuery}\n`);
    const { code, output } = scan(repo.dir);
    expect(code).toBe(1);
    expect(findings(output)).toEqual(['  Azure SAS signature :: worktree:notes.txt']);
    expect(output).not.toContain('Zm9vYmFy');
  });

  it('fails when a .env file is tracked, and not for .env.example', () => {
    const repo = repository();
    repo.write('.env', 'LOG_LEVEL=info\n');
    repo.commit('env');
    const { code, output } = scan(repo.dir);
    expect(code).toBe(1);
    expect(output).toContain('tracked .env files: 1');
  });

  it('does not treat a marked test canary as a finding, and ignores binary content in history', () => {
    const repo = repository();
    repo.write('canary.txt', `${['gh', 'p_', 'canary'.repeat(7)].join('')}\n`);
    repo.write('blob.bin', Buffer.concat([Buffer.from(githubToken), Buffer.from([0, 1, 2])]));
    repo.commit('canary');
    // Only the history copy is under test: the working-tree walk reads every file it finds.
    rmSync(join(repo.dir, 'blob.bin'));
    const { code, output } = scan(repo.dir);
    expect(output).toContain('findings: 0');
    expect(code).toBe(0);
  });

  it('reads every object exactly: empty, binary, CRLF and non-ASCII files around the ones it must find', () => {
    const repo = repository();
    const pathOf = (index: number): string =>
      `${String.fromCharCode(97 + (index % 6))}/f${String(index).padStart(2, '0')}.txt`;
    const planted = new Set([7, 23, 41].map(pathOf));
    for (let index = 0; index < 60; index += 1) {
      const path = pathOf(index);
      const kind = index % 5;
      const body =
        kind === 0
          ? ''
          : kind === 1
            ? Buffer.from([0, 255, 10, 13, 0, index])
            : kind === 2
              ? `line one\r\nline two ${index}\r\n\r\n`
              : kind === 3
                ? `naïve café — ${index}\n`
                : `plain ${index}\n`;
      repo.write(path, planted.has(path) ? `file ${index}\n${githubToken}\ny\n` : body);
      if (index % 20 === 19) repo.commit(`batch ${index}`);
    }
    const { code, output } = scan(repo.dir);
    expect(code).toBe(1);
    const historyPaths = findings(output)
      .map((line) => /history:([^@]+)@/u.exec(line)?.[1])
      .filter((path): path is string => path !== undefined)
      .sort();
    expect(historyPaths).toEqual([...planted].sort());
  });
});
