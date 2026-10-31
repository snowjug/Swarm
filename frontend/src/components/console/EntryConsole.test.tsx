import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ExampleScenario } from '../../../../shared/example-scenarios';
import type { AppConfig, ProjectDetail, ProviderConnectivity } from '../../../../shared/types';
import type { UiMode } from '../../lib/mode';
import { POSITIONING_STATEMENT } from '../../lib/product';
import { projectFixture } from '../../test/project';
import { expectNoSecretLikeText, visibleText } from '../../test/provider';
import { EntryConsole } from './EntryConsole';

function configFixture(
  storage?: AppConfig['storage'],
  provider: Partial<AppConfig['provider']> = {},
): AppConfig {
  return {
    version: '0.3.0',
    provider: {
      name: 'none',
      model: null,
      configured: false,
      reason: 'Local engine only. Configure a provider to enable model-assisted runs.',
      auth: 'none',
      ...provider,
    },
    limits: {
      maxDocuments: 5,
      maxDocumentChars: 40_000,
      maxTotalChars: 100_000,
      maxProjects: 100,
      maxQueuedRuns: 3,
      localMaxAgents: 24,
      localMaxRounds: 24,
      modelMaxAgents: 10,
      modelMaxRounds: 10,
      maxPdfBytes: 2_000_000,
      maxPdfPages: 40,
      maxSurveyTargets: 5,
    },
    sourceUrl: null,
    ...(storage ? { storage } : {}),
    capabilities: {
      local: true,
      modelAssisted: provider.configured ?? false,
      fileTypes: ['txt', 'md', 'markdown', 'pdf'],
      pdf: true,
      webRetrieval: false,
      guidedConsole: true,
      surveys: true,
      whatIf: true,
      authentication: 'local-single-user',
    },
  };
}

function render(
  config: AppConfig | null,
  initialProject?: ProjectDetail,
  connectivity?: ProviderConnectivity | null,
): string {
  return renderToStaticMarkup(
    <EntryConsole
      config={config}
      connectivity={connectivity}
      initialProject={initialProject}
      busy={false}
      onSubmit={async () => {}}
      onHistory={() => {}}
    />,
  );
}

describe('entry console storage readiness', () => {
  it('shows the server-reported cloud-sync warning as text', () => {
    const html = render(
      configFixture({
        warning: 'DATA_DIR is inside a OneDrive synchronized folder. <b>Move it.</b>',
      }),
    );
    expect(html).toContain('Data directory is cloud-synchronized');
    expect(html).toContain('DATA_DIR is inside a OneDrive synchronized folder.');
    expect(html).not.toContain('<b>Move it.</b>');
  });

  it.each([
    ['a null warning', configFixture({ warning: null })],
    ['an older server without storage information', configFixture()],
    ['no configuration yet', null],
  ])('does not invent a storage warning for %s', (_label, config) => {
    expect(render(config)).not.toContain('cloud-synchronized');
  });
});

describe('entry console execution target', () => {
  function modelProject(): ProjectDetail {
    const project = projectFixture();
    project.mode = 'llm';
    project.settings = { ...project.settings, mode: 'llm' };
    return project;
  }
  const configured = (provider: Partial<AppConfig['provider']>) =>
    configFixture(undefined, {
      configured: true,
      reason: 'A provider is configured.',
      ...provider,
    });

  it.each([
    [
      { name: 'azure', model: 'swarm-dev', auth: 'entra' },
      'REAL AZURE AI · swarm-dev · Microsoft Entra ID — no API key',
    ],
    [
      { name: 'openai', model: 'gpt-4.1-mini', auth: 'api-key' },
      'REAL MODEL · OpenAI · gpt-4.1-mini · API key (kept on the server)',
    ],
    [
      { name: 'ollama', model: 'llama3.2', auth: 'none' },
      'REAL MODEL · Ollama (local) · llama3.2 · none',
    ],
  ] as const)(
    'names the provider, model and authentication Model assisted will use (%#)',
    (provider, expected) => {
      const text = visibleText(render(configured(provider), modelProject()));
      expect(text).toContain(`Will run on: ${expected}`);
      expect(text).not.toContain('Model assistance is unavailable');
      expectNoSecretLikeText(text);
    },
  );

  it('never implies a model will run while Local rules is selected, even if one is configured', () => {
    const text = visibleText(
      render(configured({ name: 'azure', model: 'swarm-dev', auth: 'entra' })),
    );
    expect(text).not.toContain('Will run on');
    expect(text).toContain(
      'Lexical graph · deterministic updates · evidence lookup. No model calls.',
    );
  });

  it('keeps the server reason, not a target, when Model assisted is selected but not configured', () => {
    const text = visibleText(render(configFixture(), modelProject()));
    expect(text).toContain(
      'Model assistance is unavailable: Local engine only. Configure a provider to enable model-assisted runs.',
    );
    expect(text).not.toContain('Will run on');
    expect(visibleText(render(null, modelProject()))).toContain(
      'Model assistance is unavailable: Waiting for the local API configuration.',
    );
  });

  it('points at the explicit connection check only when a provider is configured', () => {
    const azure = configured({ name: 'azure', model: 'swarm-dev', auth: 'entra' });
    expect(visibleText(render(azure))).toContain(
      'Configured is not a connectivity check. Real provider errors are shown when a model operation runs. Use Verify connection in the header provider badge',
    );
    expect(visibleText(render(configFixture()))).not.toContain('Verify connection');
  });

  it('agrees with the header badge about connectivity instead of repeating a stale note', () => {
    const azure = configured({ name: 'azure', model: 'swarm-dev', auth: 'entra' });
    const connected = visibleText(render(azure, undefined, 'ok'));
    expect(connected).toContain('Model provider');
    expect(connected).toContain('Connected');
    expect(connected).toContain('A real request has succeeded since the server started');
    expect(connected).not.toContain('Configured is not a connectivity check');

    const failing = visibleText(render(azure, undefined, 'failing'));
    expect(failing).toContain('Failing');
    expect(failing).toContain('The most recent real request failed');

    const unverified = visibleText(render(azure, undefined, 'unverified'));
    expect(unverified).toContain('Configured is not a connectivity check');
    expect(visibleText(render(configFixture(), undefined, 'ok'))).not.toContain('Connected');
  });
});

const example = (id: string, title: string): ExampleScenario => ({
  id,
  title,
  blurb: `A short line about ${title}.`,
  question: `What could happen if ${title} changes?`,
  documents: [
    {
      name: `${id}.md`,
      content: 'Synthetic evidence text, long enough to stand for a document in this test.',
      provenance: { kind: 'sample' },
    },
  ],
});

function renderLanding(
  options: { mode?: UiMode; examples?: readonly ExampleScenario[]; config?: AppConfig | null } = {},
): string {
  return renderToStaticMarkup(
    <EntryConsole
      config={options.config === undefined ? configFixture() : options.config}
      busy={false}
      onSubmit={async () => {}}
      onHistory={() => {}}
      mode={options.mode}
      examples={options.examples}
      demoHistory={{ projects: [], loading: false, error: null }}
      onOpenProject={() => {}}
    />,
  );
}

describe('entry console landing', () => {
  it('leads with the question and the exact statement, under the page’s one h1', () => {
    const html = renderLanding();
    expect(html.match(/<h1[ >]/gu)).toHaveLength(1);
    expect(visibleText(html)).toContain('What could happen if…?');
    expect(visibleText(html)).toContain(POSITIONING_STATEMENT);
    expect(html).toContain('<ol class="pipeline" aria-label="How Swarm works">');
    expect(html.indexOf('landing-heading')).toBeLessThan(html.indexOf('entry-form'));
  });

  it('puts the question first, then the evidence, then the run settings, with the demonstration last', () => {
    const html = renderLanding();
    const order = [
      'id="project-question"',
      'aria-label="Source material"',
      'Run settings',
      'Build Graph',
      'id="demo-workspace-heading"',
    ].map((marker) => html.indexOf(marker));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('keeps every label and button the end-to-end specs use, once each', () => {
    const html = renderLanding();
    for (const label of ['Fictional proxies', 'Rounds / platform', 'Random seed']) {
      expect(html).toContain(`>${label}</label>`);
    }
    expect(html).toContain('>Your what-if question</label>');
    expect(html.match(/type="file"/gu)).toHaveLength(1);
    expect(html.match(/>Load fictional starter input</gu)).toHaveLength(1);
    expect(html.match(/<button[^>]*type="submit"[^>]*>[^]*?Build Graph<\/button>/gu)).toHaveLength(
      1,
    );
    expect(html).toContain('Local rules');
    expect(html).toContain('Model assisted');
  });

  it('does not ask for a project name: it defaults to the start of the question', () => {
    const html = renderLanding();
    expect(html).toContain('>Project name (optional)</label>');
    expect(html).toMatch(/<input id="project-name"(?![^>]*required)/u);
    expect(html).toContain('placeholder="Defaults to the start of your question"');
  });

  it('is safe with no examples: the picker still offers the fictional starter, and nothing is empty', () => {
    const html = renderLanding({ examples: [] });
    expect(visibleText(html)).toContain('Not sure what to ask? Try an example');
    expect(html.match(/class="example-card/gu)).toHaveLength(1);
    expect(html).not.toContain('Use this example');
  });

  it('offers each worked example by its own name, with what its evidence is', () => {
    const html = renderLanding({
      examples: [example('price-change', 'A price change'), example('launch', 'A launch')],
    });
    expect(html).toContain('aria-label="Use this example: A price change"');
    expect(html).toContain('aria-label="Use this example: A launch"');
    expect(visibleText(html)).toContain('A short line about A price change.');
    expect(visibleText(html)).toContain('1 document · sample evidence');
    expect(html.match(/class="example-card/gu)).toHaveLength(3);
  });

  it('shows the readiness and the engine stages closed in Guided, and open in Advanced', () => {
    const guided = renderLanding({ mode: 'guided' });
    const advanced = renderLanding({ mode: 'advanced' });
    expect(guided).toMatch(/<details class="aside-card readiness card">/u);
    expect(guided).toMatch(/<details class="aside-card stage-guide card">/u);
    expect(advanced).toMatch(/<details class="aside-card readiness card" open="">/u);
    expect(advanced).toMatch(/<details class="aside-card stage-guide card" open="">/u);
    // Nothing is taken out of the page in Guided: the same text is there, one click away.
    expect(visibleText(guided)).toContain('Model provider');
    expect(visibleText(guided)).toContain('How the five console stages work');
  });

  it('keeps a cloud-sync warning out of the closed readiness details, where it would be missed', () => {
    const html = renderLanding({ config: configFixture({ warning: 'DATA_DIR is synchronized.' }) });
    expect(html.indexOf('Data directory is cloud-synchronized')).toBeGreaterThan(-1);
    expect(html.indexOf('Data directory is cloud-synchronized')).toBeLessThan(
      html.indexOf('<details class="aside-card readiness'),
    );
  });

  it('renders the web-page evidence seam only where the server says it may fetch pages', () => {
    const withIngestion = { ...configFixture(), urlIngestion: true } as AppConfig;
    expect(() => renderLanding({ config: withIngestion })).not.toThrow();
    expect(renderLanding({ config: withIngestion }).match(/type="file"/gu)).toHaveLength(1);
  });

  it('says where each document came from when it has a provenance, and keeps it on a duplicate', () => {
    const project = projectFixture();
    project.documents = [
      { ...project.documents[0]!, provenance: { kind: 'sample' } },
      { ...project.documents[0]!, id: 'doc-2', name: 'page.md', provenance: { kind: 'url' } },
      { ...project.documents[0]!, id: 'doc-3', name: 'plain.md' },
    ];
    const text = visibleText(render(configFixture(), project));
    expect(text).toContain('sample evidence');
    expect(text).toContain('public web page');
    expect(text.match(/uploaded file|pasted text|historical record/gu)).toBeNull();
  });
});
