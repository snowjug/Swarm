import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'themes.mjs');

// The checker locates the stylesheets from its own path, so each case runs a copy of it in a small tree
// of its own, as the secret scan's tests do. The real tree is checked at the end.

let directory = '';

/** Writes a file into the tree, creating its folders, and returns its path. */
function put(path: string, text: string): string {
  const full = join(directory, ...path.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
  return full;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'swarm-themes-'));
  mkdirSync(join(directory, 'scripts', 'ui'), { recursive: true });
  copyFileSync(script, join(directory, 'scripts', 'ui', 'themes.mjs'));
  put(
    'frontend/src/styles.css',
    ':root {\n  color: var(--t-fg-24282e);\n  background: var(--t-bg-f7f7f5);\n}\n',
  );
  put('frontend/src/styles/entry.css', '.entry {\n  border: 1px solid var(--t-bd-cdd1d5);\n}\n');
  put(
    'frontend/src/components/Chart.tsx',
    'export const Chart = () => <rect fill="var(--chart-1)" />;\n',
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function run(mode: 'tokens' | 'check') {
  const result = spawnSync(
    process.execPath,
    [join(directory, 'scripts', 'ui', 'themes.mjs'), mode],
    {
      encoding: 'utf8',
    },
  );
  return { status: result.status, out: result.stdout.trim(), err: result.stderr.trim() };
}

/** A tree that has been through `tokens`, so that the token file is what the stylesheets need. */
function generated(): void {
  expect(run('tokens').status).toBe(0);
}

describe('the colour-token check', () => {
  it('passes a tree whose colours are all tokens', () => {
    generated();
    expect(run('check')).toMatchObject({ status: 0, out: 'ok' });
  });

  it.each([
    ['a hex colour', '#123456'],
    ['a short hex colour', '#abc'],
    ['an rgba() colour', 'rgba(0, 0, 0, 0.4)'],
    ['an hsl() colour', 'hsl(210 20% 40%)'],
  ])('refuses %s in a stylesheet, and names the file', (_name, literal) => {
    generated();
    put('frontend/src/styles/entry.css', `.entry {\n  color: ${literal};\n}\n`);
    const result = run('check');
    expect(result.status).toBe(1);
    expect(result.err).toContain('entry.css');
    expect(result.err).toContain('colour literal');
  });

  it.each([
    ['a hex colour in a component', 'frontend/src/components/Chart.tsx', "const c = '#53d4b3';\n"],
    [
      'an rgb() colour in a component',
      'frontend/src/components/Chart.tsx',
      "const c = 'rgb(1, 2, 3)';\n",
    ],
    ['a colour in a hook', 'frontend/src/hooks/useColour.ts', "export const colour = '#aabbcc';\n"],
  ])('refuses %s, and names the file', (_name, path, text) => {
    generated();
    put(path, text);
    const result = run('check');
    expect(result.status).toBe(1);
    expect(result.err).toContain(path.split('/').at(-1));
  });

  it('allows the colours of the browser chrome in lib/theme.ts, and anything in a test', () => {
    generated();
    put('frontend/src/lib/theme.ts', "export const THEME_COLOR = { dark: '#1c1f24' };\n");
    put('frontend/src/lib/theme.test.ts', "expect(x).toBe('#1c1f24');\n");
    put('frontend/src/test/palette.ts', "export const white = '#ffffff';\n");
    expect(run('check')).toMatchObject({ status: 0, out: 'ok' });
  });

  it('does not let lib/theme.ts excuse a file of the same name elsewhere', () => {
    generated();
    put('frontend/src/components/theme.ts', "export const c = '#1c1f24';\n");
    expect(run('check').status).toBe(1);
  });

  it('refuses a token file that lacks a token the stylesheets use, until it is regenerated', () => {
    generated();
    put('frontend/src/styles/entry.css', '.entry {\n  border: 1px solid var(--t-bd-123456);\n}\n');
    const stale = run('check');
    expect(stale.status).toBe(1);
    expect(stale.err).toContain('theme-tokens.css');
    generated();
    expect(run('check').status).toBe(0);
  });

  it('refuses a hand-edited derived value, so that a correction is made in theme.css instead', () => {
    generated();
    const tokens = join(directory, 'frontend', 'src', 'styles', 'theme-tokens.css');
    const before = readFileSync(tokens, 'utf8');
    const edited = before.replace(
      /(\[data-theme='dark'\][^}]*--t-fg-24282e: )#[0-9a-f]{6}/u,
      '$1#4a4c4f',
    );
    expect(edited).not.toBe(before);
    writeFileSync(tokens, edited);
    const result = run('check');
    expect(result.status).toBe(1);
    expect(result.err).toContain('theme-tokens.css');
  });
});

describe('the colour tokens of this repository', () => {
  it('leave no colour literal in a stylesheet or a source file, and the token file is what the script writes', () => {
    // Fails with the offending file when someone adds `color: #123456`, or edits a derived value by hand.
    const result = spawnSync(process.execPath, [script, 'check'], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('ok');
    expect(result.status).toBe(0);
  });
});
