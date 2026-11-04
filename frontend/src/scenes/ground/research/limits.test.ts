import { describe, expect, it } from 'vitest';
import { plan } from './fixtures';
import { modelLine } from './model';

describe('what the limits of a run say of the model', () => {
  it('says that a model planned the run, that it was asked and gave no plan that could be used, or that none was asked', () => {
    expect(modelLine({ modelUsed: true, plan: plan({ origin: 'model' }) })).toBe(
      'A model you chose planned what to look for in this run.',
    );
    // Asked is not used: when its reply was refused the rules planned, and the page does not say that the model did.
    expect(modelLine({ modelUsed: true, plan: plan({ origin: 'rules' }) })).toBe(
      'A model you chose was asked to plan this run and did not give a plan that could be used, so rules planned it.',
    );
    expect(modelLine({ modelUsed: false, plan: plan({ origin: 'rules' }) })).toBe(
      'No model was used in this run.',
    );
    expect(modelLine({ modelUsed: false, plan: null })).toBe('No model was used in this run.');
  });
});
