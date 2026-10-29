import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Test counts, browser runs and audits are only comparable if they were produced on the runtime CI
// uses. Every file that names the runtime must agree, and the suite refuses to count as evidence
// on any other major version.
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const MAJOR = '24';

describe('the pinned runtime', () => {
  it('is Node 24 in every file that names a version', () => {
    expect(read('.nvmrc').trim()).toBe(MAJOR);
    expect(read('.node-version').trim()).toBe(MAJOR);

    const manifest = JSON.parse(read('package.json')) as { engines: { node: string } };
    expect(manifest.engines.node).toBe('>=24.0.0 <25');
    const lock = JSON.parse(read('package-lock.json')) as {
      packages: Record<string, { engines?: { node?: string } }>;
    };
    expect(lock.packages['']?.engines?.node).toBe(manifest.engines.node);
    expect(read('.npmrc')).toMatch(/^engine-strict=true$/mu);

    const images = [...read('Dockerfile').matchAll(/^FROM node:(\d+)\b/gmu)].map(
      (match) => match[1],
    );
    expect(images.length).toBeGreaterThan(0);
    expect(new Set(images)).toEqual(new Set([MAJOR]));

    const workflow = read('.github/workflows/ci.yml');
    expect(workflow).toMatch(/node-version-file:\s*\.nvmrc/u);
    expect(workflow).not.toMatch(/node-version:\s*\d/u);
  });

  it('is the runtime this suite is running on', () => {
    expect(
      process.versions.node.split('.')[0],
      `Swarm is verified on Node ${MAJOR}; this run used Node ${process.versions.node}`,
    ).toBe(MAJOR);
  });
});
