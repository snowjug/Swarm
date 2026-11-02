import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { analysisFixture } from '../../../../shared/lab-fixtures';
import { StoryView } from './Pages';

describe('the story of a simulation that kept no run in detail', () => {
  const html = renderToStaticMarkup(
    <StoryView
      analysis={analysisFixture()}
      replay={null}
      onWatch={() => undefined}
      onCompare={() => undefined}
      onReview={() => undefined}
    />,
  );

  it('says that there is nothing to watch and which views are not offered, instead of offering to watch', () => {
    expect(html).not.toContain('Watch it unfold');
    expect(html).toContain(
      'No run was kept in detail, so there is nothing to watch round by round.',
    );
    expect(html).toContain('Live and Network are not offered');
  });

  it('still says that it is not a prediction', () => {
    expect(html).toContain('Not a prediction');
  });
});
