import { describe, expect, it } from 'vitest';
import { critiqueFixture, setFixture, viewFixture } from '../../test/critics';
import { reviewStatus } from './reviewStatus';

describe('where the independent review stands, in a few words', () => {
  it('says nothing until the review has been read, and says when it could not be', () => {
    expect(reviewStatus(null)).toBeNull();
    expect(reviewStatus(null, true)).toBe('could not be read');
  });

  it('says that it has not been run, or that there is nothing yet to run it on', () => {
    expect(reviewStatus(viewFixture({ critiques: null }))).toBe('not run yet');
    expect(reviewStatus(viewFixture({ critiques: null, analysis: null }))).toBe(
      'no analysis to review yet',
    );
  });

  it('counts what is not yet closed the way the brief does: anything that has not been accepted', () => {
    const critiques = ['open', 'responded', 'disputed', 'accepted'].map((status, index) =>
      critiqueFixture({ id: `c${index}`, status: status as 'open' }),
    );
    expect(reviewStatus(viewFixture({ critiques: setFixture(critiques) }))).toBe(
      '3 not yet closed',
    );
    expect(
      reviewStatus(
        viewFixture({ critiques: setFixture(critiques.filter((c) => c.status === 'open')) }),
      ),
    ).toBe('1 not yet closed');
  });

  it('says when everything is closed, and when nothing was raised', () => {
    const accepted = [critiqueFixture({ id: 'a', status: 'accepted' })];
    expect(reviewStatus(viewFixture({ critiques: setFixture(accepted) }))).toBe('all 1 closed');
    expect(reviewStatus(viewFixture({ critiques: setFixture([]) }))).toBe('no criticism raised');
  });

  it('says when the review is of an earlier analysis', () => {
    const stale = viewFixture({
      critiques: setFixture([critiqueFixture()], { analysisId: 'analysis-0' }),
    });
    expect(reviewStatus(stale)).toBe('1 not yet closed, of an earlier analysis');
  });
});
