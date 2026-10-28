import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A README that drifts from the repository is worse than none. These checks make every command,
// script, variable, link and image in it something that must exist, and keep private identifiers,
// stale placeholders and over-claims out. They deliberately assert no test counts: the numbers in
// the Validation section come from a run and are recorded by hand.
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const readme = read('README.md');
const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
const envExample = read('.env.example');

function docFiles(): string[] {
  const found = ['README.md'];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(join(root, directory))) {
      const path = `${directory}/${entry}`;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (entry.endsWith('.md')) found.push(path);
    }
  };
  walk('docs');
  return found;
}

/** Text outside fenced code blocks. */
function prose(markdown: string): string {
  return markdown.replace(/^```[\s\S]*?^```/gmu, '');
}

function headings(markdown: string): string[] {
  return prose(markdown)
    .split('\n')
    .filter((line) => /^#{1,6} /u.test(line));
}

/** GitHub's anchor for a heading: lower case, punctuation removed, spaces become hyphens. */
function slug(heading: string): string {
  return heading
    .replace(/^#+\s+/u, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/[`*_]/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .replace(/ /gu, '-');
}

describe('README structure', () => {
  it('has the required sections, in order', () => {
    const required = [
      '# Swarm',
      '## What Swarm Does',
      '## Why Swarm',
      '## Key Features',
      '## How It Works',
      '## Architecture',
      '## Real Azure AI',
      '## Quick Start',
      '### Local / Rules Mode',
      '### Real Azure AI Mode',
      '## Demo Workflow',
      '## Validation',
      '## Security',
      '## Known Limitations',
      '## Responsible Use',
      '## Inspiration and Comparison',
      '## Development',
      '## Roadmap',
      '## License',
    ];
    const found = headings(readme);
    let cursor = -1;
    for (const heading of required) {
      const index = found.indexOf(heading);
      expect(index, `missing or out of order: ${heading}`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it('carries the required notice and the prompt-injection statement', () => {
    expect(readme).toContain('Swarm explores possible scenarios. It does not predict the future.');
    expect(readme).toContain(
      'Prompt injection is an active risk and cannot be considered completely solved',
    );
  });

  it('links the parity matrix and the roadmap, and states the license', () => {
    expect(readme).toContain('](./docs/parity-matrix.md)');
    expect(readme).toContain('](./docs/microsoft-product-roadmap.md)');
    expect(readme).toMatch(/AGPL-3\.0/u);
    expect(read('package.json')).toContain('"license": "AGPL-3.0-only"');
  });

  it('has no unfilled placeholder in the Validation section', () => {
    expect(readme).not.toMatch(/@@[A-Z]+@@|\bTBD\b|\bTODO\b|\bFIXME\b/u);
  });
});

describe('README commands and variables exist', () => {
  it('only runs npm scripts that package.json defines, in the README and every doc', () => {
    for (const file of docFiles()) {
      for (const match of read(file).matchAll(/npm(?:\.cmd)?\s+run\s+([a-z0-9:_-]+)/gu)) {
        const name = match[1] ?? '';
        expect(packageJson.scripts, `${file}: npm run ${name}`).toHaveProperty(name);
      }
    }
  });

  it('only names environment variables that .env.example defines', () => {
    const keys = new Set(
      [...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gmu)].map((match) => match[1] ?? ''),
    );
    const blocks = [...readme.matchAll(/^```dotenv\n([\s\S]*?)^```/gmu)].map((m) => m[1] ?? '');
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      for (const line of block.split('\n')) {
        const key = /^([A-Z][A-Z0-9_]+)=/u.exec(line)?.[1];
        if (key) expect(keys, `.env.example lacks ${key}`).toContain(key);
      }
    }
  });

  it('never tells anyone to put a secret in a client variable', () => {
    for (const match of readme.matchAll(/VITE_[A-Z_]*/gu)) {
      expect(match[0]).not.toMatch(/KEY|SECRET|TOKEN|PASSWORD/u);
    }
  });
});

describe('links and images resolve', () => {
  const link = /!?\[[^\]]*\]\(([^)\s]+)\)/gu;

  it('points every relative link at a file that exists, and every anchor at a real heading', () => {
    for (const file of docFiles()) {
      const dir = dirname(join(root, file));
      for (const match of prose(read(file)).matchAll(link)) {
        const target = match[1] ?? '';
        if (/^(?:[a-z][a-z0-9+.-]*:|#)/iu.test(target) && !target.startsWith('#')) continue;
        const [path = '', anchor] = target.split('#');
        const resolved = path === '' ? join(root, file) : resolve(dir, path);
        expect(() => statSync(resolved), `${file}: ${target}`).not.toThrow();
        if (anchor && resolved.endsWith('.md')) {
          const slugs = headings(readFileSync(resolved, 'utf8')).map(slug);
          expect(slugs, `${file}: #${anchor} in ${relative(root, resolved)}`).toContain(anchor);
        }
      }
    }
  });

  it('keeps screenshots small and as PNG files', () => {
    const images = [...readme.matchAll(/!\[[^\]]*\]\((\.\/docs\/assets\/[^)]+)\)/gu)].map(
      (match) => match[1] ?? '',
    );
    expect(images.length).toBeGreaterThanOrEqual(6);
    for (const image of images) {
      expect(image).toMatch(/\.png$/u);
      expect(statSync(join(root, image)).size, image).toBeLessThan(400 * 1024);
    }
  });
});

describe('README keeps private identifiers and over-claims out', () => {
  const sources = [
    ['README.md', readme],
    ['docs/demo/larkholm-ferry/README.md', read('docs/demo/larkholm-ferry/README.md')],
  ] as const;

  it('contains no identifier, endpoint, resource name, path or credential shape', () => {
    const forbidden: [string, RegExp][] = [
      ['a GUID', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu],
      ['an Azure AI host', /\.(?:openai|cognitiveservices|services\.ai)\.azure\.com/iu],
      ['the development resource group', /\brg-swarm/iu],
      ['the deployment name', /swarm-chat/iu],
      ['a local path', /[A-Za-z]:\\Users\\|\/Users\/[a-z]|\/home\/[a-z]/u],
      ['an email address', /[\w.+-]+@[\w-]+\.[\w.-]+/u],
      ['a bearer token or JWT', /\bbearer\s+[a-z0-9._~+/=-]{16,}|eyJ[\w-]{10,}\./iu],
      ['an API key shape', /\bsk-[A-Za-z0-9_-]{20,}/u],
    ];
    for (const [file, text] of sources) {
      for (const [what, pattern] of forbidden) {
        expect(pattern.test(text), `${file} contains ${what}`).toBe(false);
      }
    }
  });

  it('does not use the reference project’s brand', () => {
    for (const [file, text] of sources) expect(text, file).not.toMatch(/mirofish/iu);
  });

  it('makes no claim the evidence does not support', () => {
    const withoutNotice = readme.replace(
      'Swarm explores possible scenarios. It does not predict the future.',
      '',
    );
    const overclaims =
      /\b(?:production[- ]ready|enterprise[- ]ready|fully secure|completely secure|is secure|guarantees?d? (?:accuracy|safety|security|correctness)|(?:100|99)%|predicts? the future|accurate forecasts?|bug[- ]free)\b/iu;
    expect(overclaims.exec(withoutNotice)?.[0] ?? null).toBeNull();
  });
});

describe('the architecture diagram', () => {
  const blocks = [...readme.matchAll(/^```mermaid\n([\s\S]*?)^```/gmu)];
  const diagram = blocks[0]?.[1] ?? '';

  it('is the only diagram, and a flowchart', () => {
    expect(blocks).toHaveLength(1);
    expect(diagram).toMatch(/^flowchart (?:LR|TB|TD|RL|BT)\n/u);
  });

  it('has exactly the five subgraphs, named as specified', () => {
    const titles = [...diagram.matchAll(/^\s*subgraph \w+\["([^"]+)"\]/gmu)].map((m) => m[1]);
    expect(titles).toEqual([
      'User experience',
      'Swarm application',
      'Data and evidence',
      'Model providers',
      'Azure',
    ]);
    const opened = (diagram.match(/^\s*subgraph\b/gmu) ?? []).length;
    const closed = (diagram.match(/^\s*end\s*$/gmu) ?? []).length;
    expect(closed).toBe(opened);
  });

  it('draws only edges between nodes it declares', () => {
    const declared = new Set(
      [...diagram.matchAll(/^\s*(\w+)(?:\[|\(\[)/gmu)].map((match) => match[1] ?? ''),
    );
    const names = [...diagram.matchAll(/^\s*(\w+)\s*(?:<-->|-->|-\.->)/gmu)];
    const targets = [...diagram.matchAll(/(?:-->|-\.->)(?:\|"[^"]*"\|)?\s*(\w+)\s*$/gmu)];
    for (const match of [...names, ...targets]) {
      expect(declared, `undeclared node ${match[1]}`).toContain(match[1]);
    }
  });

  it('shows the boundaries the architecture depends on', () => {
    for (const phrase of [
      'No credentials',
      'or tokens in',
      'rules mode',
      'Azure mode',
      'requested on',
      'Local SQLite',
      'Scheduled',
      'checkpoints',
      'Branches',
      'Run<br/>comparison',
      'grounding review',
    ]) {
      expect(diagram, phrase).toContain(phrase);
    }
    // The browser reaches the application only; it has no edge to Azure.
    expect(diagram).not.toMatch(/Browser\s*(?:<-->|-->)\|?[^\n]*\b(?:Entra|Deployment)\b/u);
    expect(/Provider\s*-->\|"Azure mode: token/u.test(diagram)).toBe(true);
  });

  it('is followed by the exact caption', () => {
    const caption =
      'Current validated architecture. The application and database run locally; Azure hosts the AI model deployment. Planned cloud hosting and managed identity are not shown as implemented components.';
    const after = readme.slice((blocks[0]?.index ?? 0) + (blocks[0]?.[0].length ?? 0));
    expect(after.trimStart().startsWith(caption)).toBe(true);
  });
});
