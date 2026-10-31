import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_TOTAL_RUNS, MAX_VARIANTS, MAX_RUNS_PER_VARIANT } from '../../shared/analysis-plan.js';
import { BRIEF_SECTION_IDS, STATEMENT_ORIGIN_LABELS } from '../../shared/brief.js';
import { CRITIC_ROLES } from '../../shared/critique.js';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios.js';
import { MAX_DOCUMENT_CHARS, MAX_DOCUMENTS, MAX_TOTAL_CHARS } from '../../shared/types.js';

// A README that drifts from the repository is worse than none. These checks make every command,
// script, variable, link and image in it something that must exist, quote the flagship examples and
// the limits from the code, and keep private identifiers, stale placeholders and over-claims out.
// They deliberately assert no test counts: numbers that come from a run are recorded by hand, in
// docs/TESTING.md.
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const readme = read('README.md');
const architecture = read('ARCHITECTURE.md');
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
      '## Quick start',
      '## What Swarm is, and is not',
      '## From a question to a decision',
      '## The four flagship demos',
      '## Evidence and public web pages',
      '## Model modes',
      '## Architecture',
      '## Security',
      '## Testing',
      '## Honest limitations',
      '## Repository map',
      '## More documentation',
      '## Responsible use',
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

  it('leads with a general-purpose platform, and says what it is not', () => {
    const lead = readme.slice(0, readme.indexOf('## What Swarm is, and is not'));
    expect(lead).toMatch(/general-purpose, evidence-grounded platform/u);
    expect(lead).toContain('What could happen if X changes?');
    expect(lead).toMatch(/demonstration packs/u);
    expect(readme).toMatch(/simulated counts under stated assumptions/u);
  });

  it('walks the whole journey, from the question to the validation plan', () => {
    const steps = [
      '**Question**',
      '**Evidence**',
      '**Scenario**',
      '**Stakeholders**',
      '**Synthetic actors**',
      '**Interactions**',
      '**Interventions**',
      '**Second-order effects**',
      '**Alternative outcomes**',
      '**Uncertainty and sensitivity**',
      '**Independent critique**',
      '**Decision-ready analysis**',
      '**Recommendations**',
      '**Real-world validation plan**',
    ];
    let cursor = -1;
    for (const step of steps) {
      const index = readme.indexOf(step, cursor + 1);
      expect(index, `missing or out of order: ${step}`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it('names the ten origins of a brief statement, as the code does', () => {
    for (const label of Object.values(STATEMENT_ORIGIN_LABELS)) {
      expect(readme, label).toContain(`**${label}**`);
    }
    expect(readme).toContain(`${BRIEF_SECTION_IDS.length} sections`);
    expect(readme).toContain('Seven critics');
    expect(CRITIC_ROLES).toHaveLength(7);
  });

  it('quotes the flagship examples and their public page from the code', () => {
    for (const id of ['copilot-in-teams', 'regional-price-change', 'ecommerce-experience']) {
      const example = EXAMPLE_SCENARIOS.find((candidate) => candidate.id === id);
      expect(example, id).toBeDefined();
      expect(readme, `${id}: title`).toContain(example!.title);
      expect(readme, `${id}: question`).toContain(example!.question);
    }
    const shop = EXAMPLE_SCENARIOS.find((candidate) => candidate.id === 'ecommerce-experience');
    expect(readme).toContain(shop!.urlSuggestion!.url);
    expect(readme).toMatch(/Your own question and a public URL/u);
  });

  it('states the limits that the code enforces', () => {
    expect(readme).toContain(`1 to ${MAX_DOCUMENTS} documents`);
    expect(readme).toContain(MAX_DOCUMENT_CHARS.toLocaleString('en-US'));
    expect(readme).toContain(MAX_TOTAL_CHARS.toLocaleString('en-US'));
    expect(readme).toContain(
      `${MAX_VARIANTS} scenarios, ${MAX_RUNS_PER_VARIANT} runs each and ${MAX_TOTAL_RUNS.toLocaleString('en-US')} runs in all`,
    );
  });

  it('says what runs locally, what is deployed in Azure, and what is only proposed', () => {
    for (const phrase of [
      '**On your machine**',
      '**Deployed in Azure**',
      '**Proposed, not built**',
    ]) {
      expect(readme, phrase).toContain(phrase);
    }
  });

  it('shows how to install, run, seed, test, build, scan and demonstrate', () => {
    const commands = [
      'npm ci',
      'npm run dev',
      'npm run build',
      'npm start',
      'npm run demo:seed',
      'npm run demo:journey',
      'npm run check',
      'npm run format:check',
      'npm run test:e2e',
      'npm run test:postgres',
      'npm run scan:secrets',
    ];
    for (const command of commands) expect(readme, command).toContain(command);
  });

  it('links the demo guide, the architecture, the decision record and the parity matrix, and states the license', () => {
    for (const link of [
      '](./docs/demo/README.md)',
      '](./ARCHITECTURE.md)',
      '](./docs/adr/0014-scenario-lab.md)',
      '](./docs/security/url-ingestion.md)',
      '](./docs/parity-matrix.md)',
      '](./docs/microsoft-product-roadmap.md)',
    ]) {
      expect(readme, link).toContain(link);
    }
    expect(readme).toMatch(/AGPL-3\.0/u);
    expect(read('package.json')).toContain('"license": "AGPL-3.0-only"');
  });

  it('has no unfilled placeholder', () => {
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
    expect(images.length).toBeGreaterThanOrEqual(1);
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

const mermaidBlocks = (markdown: string): RegExpExecArray[] => [
  ...markdown.matchAll(/^```mermaid\n([\s\S]*?)^```/gmu),
];

describe('the diagram in the README', () => {
  const blocks = mermaidBlocks(readme);
  const diagram = blocks[0]?.[1] ?? '';

  it('is the only diagram, and a small flowchart', () => {
    expect(blocks).toHaveLength(1);
    expect(diagram).toMatch(/^flowchart (?:LR|TB|TD|RL|BT)\n/u);
    expect(diagram.split('\n').length).toBeLessThan(30);
  });

  it('draws only edges between nodes it declares', () => {
    const declared = new Set(
      [...diagram.matchAll(/^\s*(\w+)(?:\[|\(\[)/gmu)].map((match) => match[1] ?? ''),
    );
    const names = [...diagram.matchAll(/^\s*(\w+)\s*(?:<-->|-->|-\.->)/gmu)];
    const targets = [...diagram.matchAll(/(?:-->|-\.->)(?:\|"[^"]*"\|)?\s*(\w+)\s*$/gmu)];
    expect(names.length).toBeGreaterThan(0);
    for (const match of [...names, ...targets]) {
      expect(declared, `undeclared node ${match[1]}`).toContain(match[1]);
    }
  });

  it('does not draw anything that is only proposed', () => {
    for (const proposed of [
      /container apps?/iu,
      /hosted/iu,
      /managed identity/iu,
      /key ?vault/iu,
    ]) {
      expect(diagram, String(proposed)).not.toMatch(proposed);
    }
  });

  it('keeps the browser away from the model and the web, which only the server may reach', () => {
    expect(diagram).not.toMatch(/Browser\s*(?:<-->|-->|-\.->)\|?[^\n]*\b(?:Model|Web)\b/u);
    expect(diagram).toMatch(/Pages\s*-\.->\|"public pages only"\|\s*Web/u);
  });
});

describe('the system diagram in ARCHITECTURE.md', () => {
  const blocks = mermaidBlocks(architecture);
  const block = blocks.find((candidate) => /^flowchart TB\n/u.test(candidate[1] ?? ''));
  const diagram = block?.[1] ?? '';

  it('is a flowchart, beside the lab flow', () => {
    expect(blocks).toHaveLength(2);
    expect(diagram).toMatch(/^flowchart TB\n/u);
    expect(blocks.some((candidate) => /^flowchart LR\n/u.test(candidate[1] ?? ''))).toBe(true);
  });

  it('has exactly the six subgraphs, named as specified', () => {
    const titles = [...diagram.matchAll(/^\s*subgraph \w+\["([^"]+)"\]/gmu)].map((m) => m[1]);
    expect(titles).toEqual([
      'User experience',
      'Swarm application (runs locally)',
      'Data and evidence',
      'Model providers',
      'Azure (the only deployed component)',
      'Test and observability boundaries',
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

  it('shows every implemented component the architecture depends on', () => {
    for (const component of [
      'User browser',
      'React and TypeScript console',
      'Fastify and TypeScript API',
      'Identity boundary',
      'Authorization and tenant',
      'Evidence ledger',
      'Assumption<br/>register',
      'Scenario graph',
      'Actor runtime',
      'Simulation orchestrator',
      'checkpoints',
      'interventions',
      'Branches from',
      'Run<br/>comparison',
      'Report generation and<br/>grounding review',
      'Analyst chat',
      'Actor chat',
      'Local SQLite',
      'Model-provider',
      'Local rules provider',
      'Azure AI Foundry<br/>provider',
      'Microsoft Entra ID',
      'audit log',
      'JSON export',
      'Report Studio',
      'Durable stage jobs',
      'OpenTelemetry signals',
      'Test and observability boundaries',
      'Scenario lab',
      'Public page reader',
      'Project artifacts',
    ]) {
      expect(diagram, component).toContain(component);
    }
  });

  it('does not draw anything that is only proposed', () => {
    // Update this list, and the diagram, in the change that builds and validates a component. The
    // OpenTelemetry instrumentation is built and tested with in-memory exporters, so it is drawn, as
    // never connected; an Application Insights resource is not, and cannot be drawn.
    for (const proposed of [
      /service ?bus/iu,
      /container apps?/iu,
      /hosted/iu,
      /managed identity/iu,
      /key ?vault/iu,
      /application insights/iu,
      /\bmsal\b/iu,
      /blob/iu,
    ]) {
      expect(diagram, String(proposed)).not.toMatch(proposed);
    }
  });

  it('draws the PostgreSQL adapter as optional and not deployed, and keeps it out of Azure', () => {
    const node = /^\s*Pg\[\((.*)\)\]/mu.exec(diagram)?.[1] ?? '';
    expect(node).toContain('PostgreSQL adapter (optional)');
    expect(node).toContain('none deployed');
    const azure = /^\s*subgraph AZ\[[^\n]*\n([\s\S]*?)^\s*end\s*$/mu.exec(diagram)?.[1] ?? '';
    expect(azure).not.toMatch(/postgres/iu);
  });

  it('keeps the browser away from the model, and the model token on the server', () => {
    // The browser reaches the application only; it has no edge to Azure or to a provider.
    expect(diagram).not.toMatch(
      /(?:Browser|Frontend)\s*(?:<-->|-->|-\.->)\|?[^\n]*\b(?:Entra|Deployment|FoundryProv|Provider)\b/u,
    );
    expect(diagram).toContain('No credentials or tokens in');
    expect(/Provider\s*-->\|"rules mode"\|\s*Rules/u.test(diagram)).toBe(true);
    expect(/Provider\s*-->\|"Azure mode"\|\s*FoundryProv/u.test(diagram)).toBe(true);
    expect(
      /FoundryProv\s*-->\|"Azure mode: token<br\/>requested on the server"\|\s*Entra/u.test(
        diagram,
      ),
    ).toBe(true);
    expect(
      /FoundryProv\s*-->\|"Azure mode: requests<br\/>with the token"\|\s*Deployment/u.test(diagram),
    ).toBe(true);
  });

  it('puts only the model deployment and its identity service in Azure', () => {
    const azure = /^\s*subgraph AZ\[[^\n]*\n([\s\S]*?)^\s*end\s*$/mu.exec(diagram)?.[1] ?? '';
    const nodes = [...azure.matchAll(/^\s*(\w+)\[/gmu)].map((match) => match[1]);
    expect(nodes).toEqual(['Entra', 'Deployment']);
  });

  it('is followed by the exact caption', () => {
    const caption =
      'Current validated architecture. The application and database run locally; Azure hosts the AI model deployment. Planned cloud hosting and managed identity are not shown as implemented components.';
    const after = architecture.slice((block?.index ?? 0) + (block?.[0].length ?? 0));
    expect(after.trimStart().startsWith(caption)).toBe(true);
  });
});
