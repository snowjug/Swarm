import type { BriefStatement, DecisionBrief, StatementOrigin } from '../../../shared/brief.js';

/**
 * The wording guard. A simulation explores what could happen under stated assumptions; it does not
 * forecast, and it measures no real population. So nothing the brief says in its own words may
 * predict ("will"), overclaim ("certainly", "guarantee", "proves"), or put a percentage on real
 * people, and anything that sums up the simulation has to say that it is simulated.
 *
 * Text a person, a source or an earlier step supplied is put into a sentence in curly quotation
 * marks (`embed`), and quoted text is theirs and not ours, so it is not checked. The builder runs
 * every statement through these checks as it writes it and withholds one that fails, and the same
 * checks run over a finished brief (`lintBrief`) so that they can be tested on their own.
 */

export type WordingRule = 'prediction' | 'overclaim' | 'percentage' | 'missing-simulated';

export interface WordingIssue {
  rule: WordingRule;
  /** The words that broke the rule. */
  match: string;
  /** Where in the brief they are, so that a person can find them. */
  where: string;
}

const PATTERNS: { rule: Exclude<WordingRule, 'missing-simulated'>; pattern: RegExp }[] = [
  { rule: 'prediction', pattern: /\bwill\b/giu },
  {
    rule: 'overclaim',
    pattern:
      /\b(?:certainly|guarantee[ds]?|guaranteeing|proves?|proven|definitely|undoubtedly|inevitabl[ey])\b/giu,
  },
  // Every number written as a percentage: ours are counts of simulated members and runs, never rates.
  { rule: 'percentage', pattern: /\d[\d.,]*\s*(?:%|per ?cent\b)/giu },
];

/** What sums up, or interprets, the simulation must say so. */
export const SIMULATION_ORIGINS: ReadonlySet<StatementOrigin> = new Set([
  'simulation-aggregation',
  'actor-behavior',
  'model-interpretation',
]);

const QUOTED = /“[^”]*”/gu;

/** The words that are ours: what is left when quoted text is taken out. */
export const ownWords = (text: string): string => text.replace(QUOTED, ' ');

export const mentionsSimulated = (text: string): boolean => /\bsimulated\b/iu.test(ownWords(text));

export function lintText(text: string, where = 'text'): WordingIssue[] {
  const own = ownWords(text);
  return PATTERNS.flatMap(({ rule, pattern }) =>
    [...own.matchAll(pattern)].map((match) => ({ rule, match: match[0], where })),
  );
}

export function lintStatement(
  statement: Pick<BriefStatement, 'text' | 'origin'>,
  where: string,
): WordingIssue[] {
  const issues = lintText(statement.text, where);
  if (SIMULATION_ORIGINS.has(statement.origin) && !mentionsSimulated(statement.text)) {
    issues.push({ rule: 'missing-simulated', match: statement.origin, where });
  }
  return issues;
}

/** Every piece of prose in a brief that is the brief's own. */
export function lintBrief(brief: DecisionBrief): WordingIssue[] {
  const issues: WordingIssue[] = [...lintText(brief.headline, 'headline')];
  if (!mentionsSimulated(brief.headline)) {
    issues.push({ rule: 'missing-simulated', match: 'headline', where: 'headline' });
  }
  for (const section of brief.sections) {
    for (const statement of section.statements) {
      issues.push(...lintStatement(statement, `${section.id}/${statement.id}`));
    }
  }
  for (const recommendation of brief.recommendations) {
    const where = `recommendation/${recommendation.id}`;
    issues.push(
      ...lintText(
        [
          recommendation.text,
          recommendation.horizon,
          recommendation.ownerFunction,
          recommendation.validation,
          ...recommendation.leadingIndicators,
        ].join('\n'),
        where,
      ),
    );
    if (!mentionsSimulated(recommendation.text)) {
      issues.push({ rule: 'missing-simulated', match: 'recommendation', where });
    }
  }
  for (const experiment of brief.validationPlan) {
    issues.push(
      ...lintText(
        [
          experiment.question,
          experiment.method,
          experiment.successSignal,
          experiment.duration,
        ].join('\n'),
        `validation/${experiment.id}`,
      ),
    );
  }
  brief.limitations.forEach((limitation, index) =>
    issues.push(...lintText(limitation, `limitation/${index + 1}`)),
  );
  brief.methodology.notes.forEach((note, index) =>
    issues.push(...lintText(note, `methodology/${index + 1}`)),
  );
  return issues;
}
