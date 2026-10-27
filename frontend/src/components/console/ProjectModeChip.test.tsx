import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ExecutionInfo, ProjectDetail } from '../../../../shared/types';
import { projectFixture } from '../../test/project';
import { visibleText } from '../../test/provider';
import { ConsoleWorkspace } from './ConsoleWorkspace';
import { ProjectModeChip } from './ProjectModeChip';

const execution = (patch: Partial<ExecutionInfo> = {}): ExecutionInfo => ({
  provider: 'azure',
  model: 'gpt-4o-mini',
  modelCalls: 3,
  inputTokens: 120,
  outputTokens: 30,
  ...patch,
});

function modelProject(recorded: ExecutionInfo | null): ProjectDetail {
  const project = projectFixture();
  project.mode = 'llm';
  project.settings = { ...project.settings, mode: 'llm' };
  project.execution = recorded;
  return project;
}

function renderHeader(project: ProjectDetail): string {
  return renderToStaticMarkup(
    <ConsoleWorkspace
      project={project}
      config={null}
      busy={false}
      refreshing={false}
      projects={[]}
      onRun={async () => {}}
      onSave={async () => {}}
      onCancel={async () => {}}
      onRefresh={() => {}}
      onDuplicate={() => {}}
      onSurvey={() => {}}
      onPause={async () => {}}
      onResume={async () => {}}
      onIntervention={async () => {}}
      onBranch={async () => {}}
      onSelectProject={() => {}}
      onCloseComparison={() => {}}
    />,
  );
}

const chipText = (html: string) =>
  visibleText(
    /<span class="mode-pill[^"]*">[\s\S]*?<\/span>(?=\s*<details)/u.exec(html)?.[0] ?? '',
  );

describe('per-project mode chip', () => {
  it('labels a local project LOCAL / RULES MODE in the neutral style', () => {
    const html = renderToStaticMarkup(<ProjectModeChip project={projectFixture()} />);
    expect(visibleText(html)).toBe('LOCAL / RULES MODE');
    expect(html).toContain('class="mode-pill"');
    expect(html).not.toContain('mode-pill-real');
  });

  it('labels an Azure project REAL AZURE AI with its recorded model', () => {
    const html = renderToStaticMarkup(<ProjectModeChip project={modelProject(execution())} />);
    expect(visibleText(html)).toBe('REAL AZURE AI · gpt-4o-mini');
    expect(html).toContain('mode-pill mode-pill-real');
  });

  it.each([
    ['openai', 'gpt-4.1-mini', 'REAL MODEL · OpenAI · gpt-4.1-mini'],
    ['ollama', 'llama3.2', 'REAL MODEL · Ollama (local) · llama3.2'],
  ] as const)(
    'labels a %s project REAL MODEL with the provider and model',
    (provider, model, expected) => {
      const html = renderToStaticMarkup(
        <ProjectModeChip project={modelProject(execution({ provider, model }))} />,
      );
      expect(visibleText(html)).toBe(expected);
    },
  );

  it('never calls a model project local when its execution is not recorded yet', () => {
    const html = renderToStaticMarkup(<ProjectModeChip project={modelProject(null)} />);
    expect(visibleText(html)).toBe('REAL MODEL · provider not recorded yet');
    expect(visibleText(html)).not.toContain('LOCAL');
  });
});

describe('project header provenance', () => {
  it('replaces the muted "Local rules · none" meta line with the chip, keeping the ID summary', () => {
    const html = renderHeader(projectFixture());
    expect(chipText(html)).toBe('LOCAL / RULES MODE');
    expect(html).toContain('<summary>Project 11111111 · usage and full ID</summary>');
    expect(html).not.toContain('Model assisted');
    expect(html).not.toContain('· none');
    expect(html).not.toContain('execution not yet recorded');
    expect(html.indexOf('class="project-provenance"')).toBeLessThan(html.indexOf('<details'));
  });

  it('shows REAL AZURE AI and the model for an Azure project, never "Local rules"', () => {
    const html = renderHeader(modelProject(execution()));
    expect(chipText(html)).toBe('REAL AZURE AI · gpt-4o-mini');
    expect(html).not.toContain('LOCAL / RULES MODE');
    expect(html).not.toContain('Local rules');
  });

  it.each([
    ['openai', 'gpt-4.1', 'REAL MODEL · OpenAI · gpt-4.1'],
    ['ollama', 'llama3.2', 'REAL MODEL · Ollama (local) · llama3.2'],
  ] as const)('shows REAL MODEL for a %s project', (provider, model, expected) => {
    expect(chipText(renderHeader(modelProject(execution({ provider, model }))))).toBe(expected);
  });

  it('keeps the per-project call and token detail', () => {
    const text = visibleText(renderHeader(modelProject(execution())));
    expect(text).toContain('Full project ID: 11111111-1111-4111-8111-111111111111');
    expect(text).toContain('3 real model calls · 120 input / 30 output tokens');
  });

  it('says tokens were not reported instead of printing misleading zeros after real calls', () => {
    const text = visibleText(
      renderHeader(modelProject(execution({ modelCalls: 5, inputTokens: 0, outputTokens: 0 }))),
    );
    expect(text).toContain('5 real model calls · tokens not reported');
    expect(text).not.toContain('0 input / 0 output tokens');
  });

  it('shows plain zeros only when no model call happened', () => {
    const text = visibleText(
      renderHeader(modelProject(execution({ modelCalls: 0, inputTokens: 0, outputTokens: 0 }))),
    );
    expect(text).toContain('0 real model calls · 0 input / 0 output tokens');
    expect(text).not.toContain('tokens not reported');
  });

  it('shows no usage line when nothing was recorded', () => {
    const html = renderHeader(projectFixture());
    expect(html).not.toContain('real model calls');
  });
});
