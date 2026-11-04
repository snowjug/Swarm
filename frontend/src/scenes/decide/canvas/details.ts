/** The detail below the first viewport: what each part is called, and what it holds. */

export type DetailId =
  | 'status'
  | 'lenses'
  | 'recommendation'
  | 'assumptions'
  | 'changes'
  | 'constraints'
  | 'actors'
  | 'validation'
  | 'evidence'
  | 'review'
  | 'approvals'
  | 'labels';

export const DETAILS: readonly { id: DetailId; title: string; lead: string }[] = [
  { id: 'status', title: 'Why this status', lead: 'The rules, the reasons and the conditions.' },
  {
    id: 'lenses',
    title: 'How the options compare',
    lead: 'Each option on each lens, and where the lenses disagree.',
  },
  {
    id: 'recommendation',
    title: 'The recommendation in full',
    lead: 'What it says, for whom, under what, and what is missing.',
  },
  {
    id: 'assumptions',
    title: 'Critical assumptions in full',
    lead: 'What the answer rests on, and which assumptions the simulation moved to see whether they could reverse it.',
  },
  {
    id: 'changes',
    title: 'Everything that could change the result',
    lead: 'Every counterfactual view, what else was tried, and the moves that hold under all of them.',
  },
  {
    id: 'constraints',
    title: 'Constraints in full',
    lead: 'Hard and soft, where each came from, and whether the simulation ran it.',
  },
  {
    id: 'actors',
    title: 'Who moves in full',
    lead: 'Every simulated role, where it ends up and why.',
  },
  {
    id: 'validation',
    title: 'The validation plan and when to stop',
    lead: 'What to check in the real world before acting, and when to stop and rethink.',
  },
  {
    id: 'evidence',
    title: 'What this rests on',
    lead: 'The sources, how far the simulation can be relied on, timing, risks and how each option was set up.',
  },
  {
    id: 'review',
    title: 'What the independent review challenged',
    lead: 'The objections of the critics, with their severity.',
  },
  {
    id: 'approvals',
    title: 'Human approval, and what Swarm does not do',
    lead: 'Who has to agree, and the limits of this picture.',
  },
  {
    id: 'labels',
    title: 'What the labels mean',
    lead: 'Every statement says what kind of statement it is.',
  },
];
