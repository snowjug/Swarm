import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSOLE_STEPS } from '../../../../shared/guided';
import type { ProjectStatus } from '../../../../shared/types';
import { api, ApiError } from '../../api';
import { createJsonSnapshotExport } from '../../hooks/useJsonSnapshotExport';
import type { JsonSnapshotExportState } from '../../hooks/useJsonSnapshotExport';
import { checkpointFixture, projectFixture } from '../../test/project';
import { ConsoleWorkspace } from './ConsoleWorkspace';
import { JsonSnapshotExportButton, JsonSnapshotExportError } from './JsonSnapshotExport';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setupDownload() {
  const blob = new Blob(['{"snapshot":"persisted"}'], { type: 'application/json' });
  const request = vi.spyOn(api, 'export').mockResolvedValue(blob);
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:json-snapshot');
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
  const append = vi.fn();
  vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { append } });
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 7;
    }),
  );
  const cancelFrame = vi.fn();
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  let state: JsonSnapshotExportState = { pending: false, error: null };
  const onState = vi.fn((next: JsonSnapshotExportState) => {
    state = next;
  });
  const exporter = createJsonSnapshotExport('test-id', onState);
  return {
    blob,
    request,
    createUrl,
    revokeUrl,
    anchor,
    append,
    cancelFrame,
    onState,
    exporter,
    state: () => state,
    flushFrame: () => {
      expect(frame).toBeDefined();
      frame!(0);
    },
  };
}

describe('persisted JSON snapshot download', () => {
  it('exports JSON, clicks exactly one download anchor, and revokes its object URL', async () => {
    const test = setupDownload();
    await test.exporter.download();
    expect(test.request).toHaveBeenCalledExactlyOnceWith(
      'test-id',
      'json',
      expect.any(AbortSignal),
    );
    expect(test.createUrl).toHaveBeenCalledExactlyOnceWith(test.blob);
    expect(test.anchor.download).toBe('swarm-lab-test-id.json');
    expect(test.anchor.href).toBe('blob:json-snapshot');
    expect(test.append).toHaveBeenCalledExactlyOnceWith(test.anchor);
    expect(test.anchor.click).toHaveBeenCalledOnce();
    expect(test.anchor.remove).toHaveBeenCalledOnce();
    expect(test.state()).toEqual({ pending: false, error: null });
    expect(test.revokeUrl).not.toHaveBeenCalled();
    test.flushFrame();
    expect(test.revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:json-snapshot');
    test.exporter.dispose();
    expect(test.revokeUrl).toHaveBeenCalledOnce();
  });
  it('shows the server error in an alert and permits a retry without disabling the console', async () => {
    const test = setupDownload();
    test.request.mockRejectedValueOnce(
      new ApiError('The project was deleted.', 'NOT_FOUND', 'request-404'),
    );
    await test.exporter.download();
    expect(test.state().pending).toBe(false);
    const html = renderToStaticMarkup(<JsonSnapshotExportError error={test.state().error} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('The project was deleted.');
    expect(html).toContain('request-404');
    expect(test.createUrl).not.toHaveBeenCalled();
    expect(test.anchor.click).not.toHaveBeenCalled();
    await test.exporter.download();
    expect(test.request).toHaveBeenCalledTimes(2);
    expect(test.anchor.click).toHaveBeenCalledOnce();
    expect(test.state().error).toBeNull();
    expect(renderToStaticMarkup(<JsonSnapshotExportError error={null} />)).toBe('');
    test.flushFrame();
    test.exporter.dispose();
  });
  it('guards concurrent clicks before a render can disable the button', async () => {
    const test = setupDownload();
    let resolve!: (blob: Blob) => void;
    test.request.mockReturnValue(
      new Promise<Blob>((done) => {
        resolve = done;
      }),
    );
    const first = test.exporter.download();
    const second = test.exporter.download();
    expect(test.state().pending).toBe(true);
    expect(test.request).toHaveBeenCalledOnce();
    resolve(test.blob);
    await Promise.all([first, second]);
    expect(test.anchor.click).toHaveBeenCalledOnce();
    test.flushFrame();
    test.exporter.dispose();
  });
  it('aborts an in-flight export on disposal and does not download or update an unmounted view', async () => {
    const test = setupDownload();
    let resolve!: (blob: Blob) => void;
    test.request.mockReturnValue(
      new Promise<Blob>((done) => {
        resolve = done;
      }),
    );
    const pending = test.exporter.download();
    const signal = test.request.mock.calls[0]![2]!;
    test.exporter.dispose();
    expect(signal.aborted).toBe(true);
    resolve(test.blob);
    await pending;
    expect(test.createUrl).not.toHaveBeenCalled();
    expect(test.onState).toHaveBeenCalledTimes(1);
  });
  it('releases pending object URLs even if unmounted before the next animation frame', async () => {
    const test = setupDownload();
    await test.exporter.download();
    test.exporter.dispose();
    expect(test.cancelFrame).toHaveBeenCalledExactlyOnceWith(7);
    expect(test.revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:json-snapshot');
    test.flushFrame();
    expect(test.revokeUrl).toHaveBeenCalledOnce();
  });
});

describe('JSON header action accessibility and availability', () => {
  function jsonButton(html: string) {
    const matches = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gu)];
    const match = matches.find(
      (item) => item[2]!.replace(/<[^>]*>/gu, '').trim() === 'Export JSON',
    );
    expect(match).toBeDefined();
    return match!;
  }
  it('keeps its exact accessible text and hidden download icon while pending', () => {
    const html = renderToStaticMarkup(
      <JsonSnapshotExportButton pending onExport={async () => {}} />,
    );
    const match = jsonButton(html);
    expect(match[1]).toContain('disabled=""');
    expect(match[1]).toContain('aria-busy="true"');
    expect(match[1]).not.toContain('aria-label=');
    expect(match[2]).toContain('aria-hidden="true"');
  });
  it('ignores the second click of a native double-click, including a fast completed request', () => {
    const onExport = vi.fn().mockResolvedValue(undefined);
    const button = JsonSnapshotExportButton({ pending: false, onExport });
    button.props.onClick({ detail: 1 });
    button.props.onClick({ detail: 2 });
    expect(onExport).toHaveBeenCalledOnce();
  });

  function renderHeader(project = projectFixture()) {
    return renderToStaticMarkup(
      <ConsoleWorkspace
        project={project}
        config={null}
        busy
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
  it.each(CONSOLE_STEPS)(
    'is available in the %s stage, independent of global operation busy state',
    (step) => {
      const project = projectFixture();
      project.console!.activeStep = step;
      const html = renderHeader(project);
      expect(jsonButton(html)[1]).not.toContain('disabled=');
      expect(html.indexOf('Export JSON')).toBeGreaterThan(html.indexOf('Duplicate as guided'));
    },
  );
  it.each(
    (
      [
        'draft',
        'ready',
        'queued',
        'running',
        'completed',
        'failed',
        'cancelled',
      ] satisfies ProjectStatus[]
    ).flatMap((status) => (['guided', 'quick'] as const).map((workflow) => ({ status, workflow }))),
  )('is enabled for $workflow projects with status $status', ({ status, workflow }) => {
    const project = projectFixture();
    project.status = status;
    project.workflow = workflow;
    if (workflow === 'quick') project.console = null;
    expect(jsonButton(renderHeader(project))[1]).not.toContain('disabled=');
  });
  it('is enabled for a paused checkpoint without requiring a completed report', () => {
    expect(jsonButton(renderHeader(checkpointFixture()))[1]).not.toContain('disabled=');
  });
});
