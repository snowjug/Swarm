import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { testConfig } from './fixtures.js';

const PRECOMPRESS = fileURLToPath(new URL('../../scripts/precompress.mjs', import.meta.url));

const FILES: Record<string, string> = {
  'index.html': `<!doctype html><html lang="en"><head><title>Fixture</title></head><body><div id="root"></div><script type="module" src="/assets/app-1a2b3c.js"></script><!-- ${'padding '.repeat(300)} --></body></html>`,
  'assets/app-1a2b3c.js': 'export const answer = 42;\n'.repeat(400),
  'assets/app-1a2b3c.css': '.rule { color: #123456; margin: 0 auto; }\n'.repeat(200),
  'assets/logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${'<path d="M0 0h32v32H0z"/>'.repeat(60)}</svg>`,
  'assets/data.json': JSON.stringify({ rows: Array.from({ length: 200 }, (_, i) => ({ i })) }),
  'assets/app-1a2b3c.js.map': `{"version":3,"mappings":"${'A'.repeat(3_000)}"}`,
  // Too small to shrink: a copy would be larger than the file.
  'assets/tiny.js': 'a=1;',
};

let root = '';
let dist = '';
const applications: Awaited<ReturnType<typeof buildApp>>[] = [];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'swarm-static-'));
  dist = join(root, 'frontend', 'dist');
  for (const [name, content] of Object.entries(FILES)) {
    const path = join(dist, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  execFileSync(process.execPath, [PRECOMPRESS, dist], { stdio: 'pipe' });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

/** The application, serving the fixture as it would serve `frontend/dist`. */
async function serve() {
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  const instance = await buildApp({ config: testConfig() });
  applications.push(instance);
  return instance.app;
}

const listing = () =>
  [dist, join(dist, 'assets')].flatMap((directory) =>
    readdirSync(directory)
      .filter((name) => name.includes('.'))
      .map((name) => join(directory, name).slice(dist.length + 1))
      .sort(),
  );

describe('scripts/precompress.mjs', () => {
  it('writes a Brotli and a gzip copy of each text asset that shrinks, and of nothing else', () => {
    const files = listing();
    for (const name of ['index.html', 'assets/app-1a2b3c.js', 'assets/app-1a2b3c.css']) {
      expect(files, name).toContain(`${name}.br`);
      expect(files, name).toContain(`${name}.gz`);
    }
    for (const name of ['assets/logo.svg', 'assets/data.json']) {
      expect(files, name).toContain(`${name}.br`);
      expect(files, name).toContain(`${name}.gz`);
    }
    expect(files.filter((name) => name.includes('.map.'))).toEqual([]);
    expect(files.filter((name) => name.startsWith('assets/tiny.js.'))).toEqual([]);
  });

  it('can be run again without compressing its own output', () => {
    const before = listing();
    execFileSync(process.execPath, [PRECOMPRESS, dist], { stdio: 'pipe' });
    expect(listing()).toEqual(before);
  });

  it('fails, saying so, when there is nothing built to compress', () => {
    expect(() =>
      execFileSync(process.execPath, [PRECOMPRESS, join(root, 'missing')], { stdio: 'pipe' }),
    ).toThrow();
  });
});

describe('the built frontend over HTTP', () => {
  const asset = '/assets/app-1a2b3c.js';
  const original = FILES['assets/app-1a2b3c.js']!;

  it.each([
    ['br', 'br', brotliDecompressSync],
    ['gzip', 'gzip', gunzipSync],
    ['gzip, deflate, br', 'br', brotliDecompressSync],
  ])(
    'sends the %s copy to a browser that accepts it, as the same file',
    async (accepted, encoding, decompress) => {
      const app = await serve();
      const response = await app.inject({ url: asset, headers: { 'accept-encoding': accepted } });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-encoding']).toBe(encoding);
      expect(String(response.headers.vary).toLowerCase()).toContain('accept-encoding');
      expect(response.headers['content-type']).toMatch(/^(?:text|application)\/javascript/u);
      expect(Number(response.headers['content-length'])).toBeLessThan(original.length);
      expect(decompress(response.rawPayload).toString()).toBe(original);
    },
  );

  it.each([undefined, 'identity'])(
    'sends the file itself, still varying on the encoding, when the browser asks for %s',
    async (accepted) => {
      const app = await serve();
      const response = await app.inject({
        url: asset,
        headers: accepted ? { 'accept-encoding': accepted } : {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-encoding']).toBeUndefined();
      expect(String(response.headers.vary).toLowerCase()).toContain('accept-encoding');
      expect(response.rawPayload.toString()).toBe(original);
    },
  );

  it('sends a file that would not shrink as it is, whatever the browser accepts', async () => {
    const app = await serve();
    const response = await app.inject({
      url: '/assets/tiny.js',
      headers: { 'accept-encoding': 'br, gzip' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.rawPayload.toString()).toBe(FILES['assets/tiny.js']);
  });

  it('compresses the page too, under the headers it has without compression', async () => {
    const app = await serve();
    const html = { accept: 'text/html' };
    for (const url of ['/', '/projects/some-saved-project']) {
      const plain = await app.inject({ url, headers: html });
      const packed = await app.inject({ url, headers: { ...html, 'accept-encoding': 'br' } });
      expect(packed.statusCode, url).toBe(200);
      expect(packed.headers['content-encoding'], url).toBe('br');
      expect(packed.headers['content-type'], url).toMatch(/^text\/html/u);
      expect(brotliDecompressSync(packed.rawPayload).toString(), url).toBe(FILES['index.html']);
      expect(plain.rawPayload.toString(), url).toBe(FILES['index.html']);
      for (const header of ['cache-control', 'content-security-policy', 'x-content-type-options']) {
        expect(packed.headers[header], `${url} ${header}`).toBeDefined();
        expect(packed.headers[header], `${url} ${header}`).toBe(plain.headers[header]);
      }
    }
  });

  it('keeps the security headers on a compressed asset, as on the file', async () => {
    const app = await serve();
    const plain = await app.inject({ url: asset });
    const packed = await app.inject({ url: asset, headers: { 'accept-encoding': 'br' } });
    for (const header of [
      'content-security-policy',
      'x-content-type-options',
      'cache-control',
      'cross-origin-opener-policy',
      'referrer-policy',
    ]) {
      expect(packed.headers[header], header).toBeDefined();
      expect(packed.headers[header], header).toBe(plain.headers[header]);
    }
  });

  it('still refuses a dotfile', async () => {
    const app = await serve();
    writeFileSync(join(dist, '.secret'), 'x'.repeat(100));
    const dotfile = await app.inject({ url: '/.secret', headers: { 'accept-encoding': 'br' } });
    rmSync(join(dist, '.secret'));
    expect(dotfile.statusCode).toBeGreaterThanOrEqual(400);
    expect(dotfile.body).not.toContain('xxxx');
  });
});
