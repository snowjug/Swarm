import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCK, REPO_ROOT } from './bicep.mjs';

// A home folder with nothing in it and a PATH without Bicep: the validation cannot find the CLI.
const EMPTY_HOME = join(REPO_ROOT, 'infra', '.build', 'empty-home');
mkdirSync(EMPTY_HOME, { recursive: true });

function validate(...args: string[]) {
  const environment: Record<string, string> = {
    HOME: EMPTY_HOME,
    USERPROFILE: EMPTY_HOME,
    PATH: process.platform === 'win32' ? (process.env.PATH ?? '') : '/usr/bin:/bin',
  };
  const result = spawnSync(process.execPath, ['scripts/iac/validate.mjs', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: environment,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('npm run iac:validate without the Bicep CLI', () => {
  it('says plainly that it skipped, and never reports a pass, outside CI', () => {
    const { status, output } = validate();
    expect(status).toBe(0);
    expect(output).toContain('SKIP  Bicep CLI is installed');
    expect(output).toContain('RESULT: SKIPPED');
    expect(output).not.toContain('PASSED');
  });

  it('fails in CI and with --strict: a gate that cannot run is not a pass', () => {
    for (const args of [['--strict'], ['--strict', '--json']]) {
      const { status, output } = validate(...args);
      expect(status).toBe(1);
      expect(output).toContain('does not skip');
    }
    const inCi = spawnSync(process.execPath, ['scripts/iac/validate.mjs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { HOME: EMPTY_HOME, USERPROFILE: EMPTY_HOME, PATH: '/usr/bin:/bin', CI: 'true' },
    });
    expect(inCi.status).toBe(1);
  });

  it('reports a machine-readable summary', () => {
    const { output } = validate('--json');
    const summary = JSON.parse(output) as { bicep: unknown; skipped: number; failed: number };
    expect(summary).toMatchObject({ bicep: null, skipped: 1, failed: 0 });
  });
});

describe('the pinned Bicep CLI', () => {
  it('names a version and a 64-character SHA-256 for every platform it installs on', () => {
    expect(LOCK.version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(LOCK.source).toBe(`https://github.com/Azure/bicep/releases/download/v${LOCK.version}/`);
    expect(Object.keys(LOCK.assets)).toEqual(
      expect.arrayContaining(['linux-x64', 'win32-x64', 'darwin-arm64']),
    );
    for (const asset of Object.values(LOCK.assets)) {
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(asset.bytes).toBeGreaterThan(50_000_000);
    }
  });
});
