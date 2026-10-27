import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../../shared/types';
import { EntryConsole } from './EntryConsole';

function configFixture(storage?: AppConfig['storage']): AppConfig {
  return {
    version: '0.3.0',
    provider: {
      name: 'none',
      model: null,
      configured: false,
      reason: 'Local engine only. Configure a provider to enable model-assisted runs.',
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
      modelAssisted: false,
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

function render(config: AppConfig | null): string {
  return renderToStaticMarkup(
    <EntryConsole config={config} busy={false} onSubmit={async () => {}} onHistory={() => {}} />,
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
