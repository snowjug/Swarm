import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { analysisFixture } from '../../../../shared/lab-fixtures';
import { Running } from './Running';

const shown = (status: 'queued' | 'running', cancelling = false) =>
  renderToStaticMarkup(
    <Running
      analysis={analysisFixture({
        status,
        completedAt: null,
        progress: { completedRuns: 0, totalRuns: 20 },
      })}
      perturbations={0}
      cancelling={cancelling}
      trouble={null}
      error={null}
      mayRun
      onCancel={() => undefined}
    />,
  );

describe('the screen of a simulation that has not finished', () => {
  it('says that one which has not begun is waiting, and not that it is running', () => {
    const html = shown('queued');
    expect(html).toContain('Waiting to start');
    expect(html).not.toContain('Running the scenarios');
  });

  it('says that one that is under way is running, with its runs counted as they are saved', () => {
    const html = shown('running');
    expect(html).toContain('Running the scenarios');
    expect(html).toContain('0 of 20 simulated runs');
  });

  it('says that a stop is waiting for the run in progress', () => {
    expect(shown('running', true)).toContain('Stopping after the run in progress');
  });
});
