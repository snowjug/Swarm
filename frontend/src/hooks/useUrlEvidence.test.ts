import { describe, expect, it } from 'vitest';
import { fetchOnEnter } from './useUrlEvidence';

describe('fetching a public page from the address field', () => {
  const press = (key: string, canFetch: boolean, isComposing = false) => {
    const seen = { prevented: 0, fetched: 0 };
    fetchOnEnter(
      {
        key,
        isComposing,
        preventDefault: () => {
          seen.prevented += 1;
        },
      },
      canFetch,
      () => {
        seen.fetched += 1;
      },
    );
    return seen;
  };

  it('fetches on Enter, and never leaves Enter to submit the form around it', () => {
    expect(press('Enter', true)).toEqual({ prevented: 1, fetched: 1 });
    // Empty, busy or full: nothing is fetched, and the entry form must still not be submitted.
    expect(press('Enter', false)).toEqual({ prevented: 1, fetched: 0 });
    expect(press('a', true)).toEqual({ prevented: 0, fetched: 0 });
  });

  it('does not take the Enter that only confirms an input-method composition for a request', () => {
    expect(press('Enter', true, true)).toEqual({ prevented: 0, fetched: 0 });
  });
});
