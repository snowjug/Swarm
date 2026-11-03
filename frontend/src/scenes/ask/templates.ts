/**
 * Questions to start from, in the person's own domain: a sentence with blanks in square brackets, no facts and no
 * numbers. Choosing one only fills the box; the person replaces the blanks, and the question that is read is theirs.
 */
export interface Template {
  id: string;
  /** The chip. */
  label: string;
  question: string;
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'ai-adoption',
    label: 'AI adoption',
    question: 'What could happen if [a team] starts using AI tools for [a task or process]?',
  },
  {
    id: 'pricing-change',
    label: 'Pricing change',
    question:
      'What could happen if we change what [a product, service or programme] costs for [a group of people]?',
  },
  {
    id: 'product-launch',
    label: 'Product launch',
    question:
      'What could happen if we launch [a product, service or programme] for [a group of people]?',
  },
  {
    id: 'policy-change',
    label: 'Policy change',
    question: 'What could happen if [an institution or authority] changes its policy on [a topic]?',
  },
  {
    id: 'market-entry',
    label: 'Market entry',
    question: 'What could happen if we enter [a market, region or community] with [an offer]?',
  },
  {
    id: 'operating-model-change',
    label: 'Operating-model change',
    question:
      'What could happen if we change how [a team or function] works, from [today’s way] to [a new way]?',
  },
];

/**
 * What the empty box suggests, in turn: whole questions from different walks of life, so that the first thing said
 * about what to write is not one domain. They are never filled in; they are only shown.
 */
export const PROMPTS: readonly string[] = [
  'What if our city replaces a bus route with an on-demand shuttle?',
  'What if we raise our subscription price and drop the free trial?',
  'What if our team moves customer support to an AI-first model?',
  'What if a clinic moves routine check-ups to video visits?',
  'What if we open a second site in a new region?',
  'What if a school district shortens the school week?',
];

const BLANK = /\[[^\]\n]{1,80}\]/gu;

/** Where the first blank of a question is, to select it: the person's next words replace it. */
export function firstBlank(question: string): [number, number] | null {
  const found = new RegExp(BLANK.source, 'u').exec(question);
  return found ? [found.index, found.index + found[0].length] : null;
}

/** The first blank of a template that is still in the question as it was given, or null once they are all replaced. */
export function leftBlank(question: string, template: string): string | null {
  for (const blank of template.matchAll(BLANK)) {
    if (question.includes(blank[0])) return blank[0];
  }
  return null;
}
