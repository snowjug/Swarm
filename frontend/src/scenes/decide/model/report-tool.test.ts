import { describe, expect, it } from 'vitest';
import type { ProjectDetail } from '../../../../../shared/types';
import { modelReportFixture } from '../../../test/grounding';
import { projectFixture } from '../../../test/project';
import { reportTool } from './report-tool';

/** A guided project whose deep dive has finished, so that a report could be written from it. */
function finished(): ProjectDetail {
  const project = projectFixture();
  project.status = 'ready';
  for (const step of ['knowledge', 'environment', 'simulation'] as const)
    project.console!.steps[step] = 'ready';
  return project;
}

function written(): ProjectDetail {
  const project = finished();
  project.status = 'completed';
  project.console!.steps.report = 'ready';
  project.report = modelReportFixture();
  return project;
}

describe('what the tools offer for the detailed report', () => {
  it('offers the studio only for a report that is written', () => {
    expect(reportTool(written(), true)).toBe('edit');
    // A reviewer works on the written report too, whatever else the role may not do.
    expect(reportTool(written(), false)).toBe('edit');
  });

  it('offers to write a report that is not written, wherever the deep dive stands', () => {
    expect(reportTool(finished(), true), 'the deep dive has finished').toBe('write');
    expect(reportTool(projectFixture(), true), 'the deep dive has not been run').toBe('write');
  });

  it('offers nothing to a role that cannot write it, and nothing for a record that cannot make one', () => {
    expect(reportTool(finished(), false)).toBe('none');
    expect(reportTool(projectFixture(), false)).toBe('none');
    const quick = projectFixture();
    quick.workflow = 'quick';
    expect(reportTool(quick, true)).toBe('none');
  });

  it('leads to the report while it is being written, and to what was kept when it stopped part-way', () => {
    const writing = finished();
    writing.status = 'running';
    writing.console!.steps.report = 'running';
    expect(reportTool(writing, true)).toBe('read');
    expect(reportTool(writing, false)).toBe('read');

    const partial = finished();
    partial.status = 'failed';
    partial.console!.steps.report = 'failed';
    partial.report = modelReportFixture(undefined, ['Chapter one']);
    expect(reportTool(partial, false)).toBe('read');
  });

  it('offers to write again a report that stopped before anything was kept', () => {
    const stopped = finished();
    stopped.status = 'failed';
    stopped.console!.steps.report = 'failed';
    expect(reportTool(stopped, true)).toBe('write');
    expect(reportTool(stopped, false)).toBe('none');
  });
});
