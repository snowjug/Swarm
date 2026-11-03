export type FlowId = 'question' | 'research' | 'people' | 'futures' | 'decision';

export interface FlowStep {
  id: FlowId;
  /** The step, as it is named. */
  name: string;
  /** What fits under a node on a phone. The full name is still what a screen reader is given. */
  short: string;
  /** What Swarm does at this step. It goes after the word "Swarm", which is shown in front of it. */
  swarm: string;
  /** What the person decides at this step. It goes after the word "You". */
  you: string;
}

/**
 * The path from a question to a decision, as a person is told it. Each line says what is done, never what the
 * result is. What it says follows what this server can do: where research is off the second step is about the
 * sources the person attaches, and where constraints are not kept the third is about people alone.
 */
export function flowSteps(options: { research: boolean; constraints: boolean }): FlowStep[] {
  return [
    {
      id: 'question',
      name: 'Question',
      short: 'Question',
      swarm:
        'reads your question and frames the decision: what changes, over what time, compared with what.',
      you: 'write it in plain words, and can correct how it is framed before anything runs.',
    },
    {
      id: 'research',
      name: 'Research',
      short: 'Research',
      swarm: options.research
        ? 'finds and reads public sources, then links each claim to the passage it came from.'
        : 'reads the files and pages you add, then links each claim to the passage it came from.',
      you: options.research
        ? 'can name a site to start from, add your own files, and see every source it used.'
        : 'choose every source. Nothing else is read.',
    },
    {
      id: 'people',
      name: options.constraints ? 'People and constraints' : 'People',
      short: 'People',
      swarm: options.constraints
        ? 'proposes who matters, as synthetic role-based actors, and what constrains the decision.'
        : 'proposes who matters, as synthetic role-based actors. They are not real people.',
      you: 'review, edit and approve them before any simulation runs.',
    },
    {
      id: 'futures',
      name: 'Possible futures',
      short: 'Futures',
      swarm: 'simulates seeded runs of each alternative and sets the paths side by side.',
      you: 'choose the alternatives. The same seed gives the same run, so a result can be repeated.',
    },
    {
      id: 'decision',
      name: 'Decision',
      short: 'Decision',
      swarm:
        'has an independent critic challenge the result, then writes a brief: what is recommended, on which assumptions, and what to validate next.',
      you: 'decide. Swarm never contacts anyone or acts for you.',
    },
  ];
}
