import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { checkpointFixture } from '../../test/project';
import { CheckpointActions, RestartSimulationDialog } from './CheckpointActions';
import { CheckpointControls } from './CheckpointControls';
import { BranchDialog } from './BranchDialog';

interface ButtonProps {
  children?: ReactNode;
  onClick?: () => void | Promise<void>;
  disabled?: boolean;
}
function buttons(node: ReactNode): ReactElement<ButtonProps>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<ButtonProps>(child)) return [];
    return [...(child.type === 'button' ? [child] : []), ...buttons(child.props.children)];
  });
}
function button(node: ReactNode, label: string) {
  const found = buttons(node).find((element) => renderToStaticMarkup(element).includes(label));
  expect(found, label).toBeDefined();
  return found!;
}
afterEach(() => vi.unstubAllGlobals());

describe('checkpoint controls and their actual request bindings', () => {
  it('renders pause while running and calls POST pause', async () => {
    const project = checkpointFixture();
    project.status = 'running';
    project.console!.steps.simulation = 'running';
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetch);
    const view = CheckpointActions({
      project,
      busy: false,
      onPause: async () => {
        await api.pause(project.id);
      },
      onResume: async () => {},
      onRequestRestart: vi.fn(),
      onBranch: vi.fn(),
    });
    await button(view, 'Pause at last saved round').props.onClick!();
    expect(fetch.mock.calls[0]![0]).toBe(`/api/projects/${project.id}/pause`);
  });
  it('resumes with a JSON resume body and requires an explicit destructive restart confirmation', async () => {
    const project = checkpointFixture();
    const fetch = vi.fn().mockImplementation(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetch);
    const requestRestart = vi.fn();
    const view = CheckpointActions({
      project,
      busy: false,
      onPause: async () => {},
      onResume: async () => {
        await api.resume(project.id);
      },
      onRequestRestart: requestRestart,
      onBranch: vi.fn(),
    });
    await button(view, 'Resume — simulate rounds 2–3').props.onClick!();
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ resume: true });
    await button(view, 'discards 1 saved rounds').props.onClick!();
    expect(requestRestart).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(1);
    const confirmation = RestartSimulationDialog({
      savedRounds: 1,
      busy: false,
      error: null,
      onConfirm: async () => {
        await api.step(project.id, 'simulation');
      },
      onClose: vi.fn(),
    });
    await button(confirmation, 'Discard 1 saved rounds and restart').props.onClick!();
    expect(fetch.mock.calls[1]![0]).toBe(`/api/projects/${project.id}/steps/simulation`);
    expect(fetch.mock.calls[1]![1].body).toBeUndefined();
  });
  it('shows honest paused text and hides controls behind capability detection', () => {
    const props = {
      project: checkpointFixture(),
      busy: false,
      enabled: true,
      onPause: async () => {},
      onResume: async () => {},
      onRestart: async () => {},
      onIntervention: async () => {},
      onBranch: vi.fn(),
    };
    const html = renderToStaticMarkup(<CheckpointControls {...props} />);
    expect(html).toContain('Paused after round 1 of 3');
    expect(html).toContain('saved and resumable');
    expect(html).toContain('never half-saved');
    expect(html).toContain('Resume — simulate rounds 2–3');
    expect(html).toContain('Checkpoint actions');
    expect(html).toContain('Manage saved execution or branch without changing this run.');
    expect(html).toContain('discards 1 saved rounds');
    expect(renderToStaticMarkup(<CheckpointControls {...props} enabled={false} />)).toBe('');
  });
  it.each([
    [2, 6, 'Resume — simulate rounds 3–6'],
    [5, 6, 'Resume — simulate round 6'],
  ])('names only unsaved work after round %i of %i', (currentRound, roundCount, expected) => {
    const project = checkpointFixture();
    project.currentRound = currentRound;
    project.roundCount = roundCount;
    const html = renderToStaticMarkup(
      <CheckpointActions
        project={project}
        busy={false}
        onPause={() => {}}
        onResume={() => {}}
        onRequestRestart={() => {}}
        onBranch={() => {}}
      />,
    );
    expect(html).toContain(expected);
    expect(html).not.toContain('Resume from round');
  });
  it('renders an accessible, bounded branch form with explicit inherit/remove/replace options', () => {
    const html = renderToStaticMarkup(
      <BranchDialog
        project={checkpointFixture()}
        busy={false}
        onSubmit={async () => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('Round 0 — restart from scratch');
    expect(html).toContain('value="1"');
    expect(html).not.toContain('value="2"');
    expect(html).toContain('Inherit the source schedule');
    expect(html).toContain('Remove from the branch');
    expect(html).toContain('Replace with a future intervention');
  });
});
