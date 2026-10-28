import { describe, expect, it } from 'vitest';
import { reportPlanSchema } from '../src/guided/schemas.js';

const plan = {
  title: 'Community support in a ferry scenario',
  sections: ['Evidence and assumptions', 'Recorded trajectories', 'Limitations and controls'],
  evidenceQueries: ['ferry timetable'],
  interviewAgentIds: [],
  interviewQuestion: 'How did this fictional discussion unfold?',
};

// Captured from a live run (gpt-4.1-mini on Azure): a chapter was titled "Predicted Future Trends in
// Community Engagement and Support". Swarm explores possible scenarios and does not predict the future,
// so a title that says otherwise is sent back to the model with the reason.
describe('report plan titles never claim a prediction', () => {
  it('accepts honest titles, including words that merely contain "predict"', () => {
    expect(() => reportPlanSchema.parse(plan)).not.toThrow();
    expect(() =>
      reportPlanSchema.parse({
        ...plan,
        sections: [
          'Why polarization is unpredictable',
          'Possible pathways',
          'What the simulation recorded',
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    'Predicted Future Trends in Community Engagement and Support',
    'A forecast for the island',
    'Forecasting winter demand',
    'How to PREDICT support',
    'Predictions',
  ])('rejects the chapter title %j and says why', (title) => {
    const result = reportPlanSchema.safeParse({
      ...plan,
      sections: [plan.sections[0], title, plan.sections[2]],
    });
    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(issue?.path).toEqual(['sections', 1]);
    expect(issue?.message).toContain('must not use the words predict, prediction or forecast');
    expect(issue?.message).toContain('does not predict the future');
  });

  it('applies to the report title as well', () => {
    const result = reportPlanSchema.safeParse({ ...plan, title: 'Predicting ferry support' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['title']);
  });
});
