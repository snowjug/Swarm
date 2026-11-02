import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'colours.mjs');

// The checker locates the sources from its own path, so each case runs a copy of it in a small tree of its own.
// The real tree is checked at the end.

let directory = '';

function put(path: string, text: string): string {
  const full = join(directory, ...path.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
  return full;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'swarm-colours-'));
  mkdirSync(join(directory, 'scripts', 'ui'), { recursive: true });
  copyFileSync(script, join(directory, 'scripts', 'ui', 'colours.mjs'));
  put(
    'frontend/src/design/tokens.css',
    ':root {\n  --ink: #13151f;\n  --glass: rgb(255 255 255 / 0.6);\n  --aura: oklch(0.8 0.1 275);\n}\n',
  );
  put(
    'frontend/src/scenes/map/map.css',
    '.sw-map {\n  color: var(--ink);\n  background: color-mix(in oklab, var(--accent) 20%, white);\n}\n',
  );
  put(
    'frontend/src/scenes/map/Map.tsx',
    'export const Map = () => <rect fill="currentColor" style={{ stroke: \'var(--ink-3)\' }} />;\n',
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function run() {
  const result = spawnSync(
    process.execPath,
    [join(directory, 'scripts', 'ui', 'colours.mjs'), 'check'],
    { encoding: 'utf8' },
  );
  return { status: result.status, out: result.stdout.trim(), err: result.stderr.trim() };
}

describe('the colour check', () => {
  it('passes a tree whose colours are tokens, named colours and mixes of them, with the literals in the token file', () => {
    expect(run()).toMatchObject({ status: 0, out: 'ok' });
  });

  it.each([
    ['a hex colour', '#123456'],
    ['a short hex colour', '#abc'],
    ['an rgba() colour', 'rgba(0, 0, 0, 0.4)'],
    ['an rgb() colour', 'rgb(1 2 3 / 0.5)'],
    ['an hsl() colour', 'hsl(210 20% 40%)'],
    ['an oklch() colour', 'oklch(0.5 0.1 200)'],
  ])('refuses %s in a stylesheet, and names the file', (_name, literal) => {
    put('frontend/src/scenes/map/map.css', `.sw-map {\n  color: ${literal};\n}\n`);
    const result = run();
    expect(result.status).toBe(1);
    expect(result.err).toContain('map.css');
    expect(result.err).toContain('colour literal');
  });

  it('refuses a colour in a component or a hook, and names the file', () => {
    put('frontend/src/scenes/map/Map.tsx', "const c = '#53d4b3';\n");
    put('frontend/src/hooks/useColour.ts', "export const colour = 'rgb(1, 2, 3)';\n");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.err).toContain('Map.tsx');
    expect(result.err).toContain('useColour.ts');
  });

  it('is not fooled by a hash that is not a colour, a comment, or a test', () => {
    put(
      'frontend/src/scenes/map/map.css',
      '/* was #fff before the redesign */\n.sw-map a[href^="#abc"] {\n  color: var(--ink);\n}\n#main-content {\n  outline: 0;\n}\n',
    );
    put(
      'frontend/src/scenes/map/Map.tsx',
      "// the old colour was #123456\nexport const href = '/page#section';\n",
    );
    put('frontend/src/scenes/map/Map.test.tsx', "expect(x).toBe('#123456');\n");
    put('frontend/src/test/palette.ts', "export const white = '#ffffff';\n");
    expect(run()).toMatchObject({ status: 0, out: 'ok' });
  });

  it('allows the colours of the browser chrome in lib/theme.ts, and nowhere else', () => {
    put('frontend/src/lib/theme.ts', "export const THEME_COLOR = { dark: '#0a0b10' };\n");
    expect(run().status).toBe(0);
    put('frontend/src/components/theme.ts', "export const c = '#0a0b10';\n");
    put('frontend/src/scenes/theme.ts', "export const c = '#0a0b10';\n");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.err).toContain('scenes/theme.ts');
  });
});

describe('the colours of this repository', () => {
  it('are tokens everywhere but the token file', () => {
    const result = spawnSync(process.execPath, [script, 'check'], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('ok');
    expect(result.status).toBe(0);
  });
});
