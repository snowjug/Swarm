import type { BriefSectionId, DecisionBrief, StatementOrigin } from '../../../shared/brief.js';
import type { Critique } from '../../../shared/critique.js';
import { clip, draft, fixed, plural, whole } from './text.js';
import type { Resolved, RoleCritic } from './types.js';

/** Does the wording or the evidence lean one way without saying so? */
const ROLE = 'bias' as const;

/** One-sidedness only says something about a cast of at least this many. */
const MIN_ACTORS = 3;

const CONFIDENT = /\b(?:will|certainly|proves|guarantee[sd]?)\b/giu;
/** "does not guarantee", "no guarantee": a disclaimer, not a promise. */
const NEGATED = /(?:\b(?:not|no|never|cannot|without|nor)|n['’]t)\s+(?:\w+\s+){0,2}$/iu;
const PERCENT = /\d+(?:\.\d+)?\s?(?:%|percent\b|per cent\b)/giu;
/** A figure beside one of these is labelled as coming from the simulation. */
const SIMULATION_MARKER = /simulat|\bruns?\b|interval|seed/iu;
/** Statements that quote a source or state an input may carry a figure of their own. */
const OWN_FIGURES: readonly StatementOrigin[] = [
  'supplied-evidence',
  'retrieved-public-evidence',
  'historical-comparison',
  'user-assumption',
  'system-assumption',
];
const NOT_CHECKED: readonly BriefSectionId[] = ['limitations', 'sources', 'technical-appendix'];

function oneSidedPriors(input: Resolved): Critique[] {
  const actors = input.actors.actors;
  if (actors.length < MIN_ACTORS) return [];
  const values = actors.map((actor) => actor.traits.priorStance.value);
  const favour = values.every((value) => value > 0);
  if (!favour && !values.every((value) => value < 0)) return [];
  return [
    draft(input.now, {
      id: 'bias-one-sided-priors',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: 'minor',
      objection: `Every actor starts ${favour ? 'in favour of' : 'against'} the change, so nobody in the simulation starts from the other side.`,
      basis: [
        `Prior stance across ${actors.length} actors runs from ${fixed(Math.min(...values))} to ${fixed(Math.max(...values))}.`,
      ],
      impact:
        'If this stands, the lean of the outcome may come from how the cast was set up rather than from the scenario; add actors who start neutral or on the other side.',
    }),
  ];
}

function oneSidedImpact(input: Resolved): Critique[] {
  const actors = input.actors.actors;
  if (actors.length < MIN_ACTORS) return [];
  const values = actors.map((actor) => actor.traits.impact.value);
  const benefit = values.every((value) => value > 0);
  if (!benefit && !values.every((value) => value < 0)) return [];
  return [
    draft(input.now, {
      id: 'bias-one-sided-impact',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: 'minor',
      objection: `Every actor is expected to ${benefit ? 'benefit from' : 'be harmed by'} the change, so the scenario is framed as having only one kind of effect.`,
      basis: [
        `Impact across ${actors.length} actors runs from ${fixed(Math.min(...values))} to ${fixed(Math.max(...values))}.`,
      ],
      impact: `If this stands, the framing may decide the outcome; look for who ${benefit ? 'loses' : 'gains'} or is unaffected, and set their impact.`,
    }),
  ];
}

function singleViewpoint(input: Resolved): Critique[] {
  const { cited, citedByDocument } = input.facts;
  if (cited.length < 3 || citedByDocument.size !== 1) return [];
  const only = [...citedByDocument.values()][0];
  const name = only?.[0]?.documentName ?? 'one document';
  return [
    draft(input.now, {
      id: 'bias-single-viewpoint',
      role: ROLE,
      target: whole(input.analysis.id),
      severity: 'minor',
      objection: `All ${cited.length} cited passages come from one document (${name}), so the evidence shows a single point of view.`,
      basis: [
        `Cited passages: ${cited.length}, all from ${name}.`,
        `Documents supplied to the project: ${input.evidenceSummary.documents.length}.`,
      ],
      evidence: cited.slice(0, 3),
      impact:
        'If this stands, every stakeholder assessment reflects how one author saw things; add sources written from other positions.',
    }),
  ];
}

interface Piece {
  where: string;
  text: string;
  origin: StatementOrigin | null;
  /** Whether a figure in it could be mistaken for a real-world rate. */
  figures: boolean;
}

function briefPieces(brief: DecisionBrief): Piece[] {
  return [
    { where: 'the headline', text: brief.headline, origin: null, figures: true },
    ...brief.sections
      .filter((section) => !NOT_CHECKED.includes(section.id))
      .flatMap((section) =>
        section.statements.map((statement) => ({
          where: `statement ${statement.id}`,
          text: statement.text,
          origin: statement.origin,
          figures: true,
        })),
      ),
    // A recommendation may name a figure as an action to take; only its wording is checked.
    ...brief.recommendations.map((recommendation) => ({
      where: `recommendation ${recommendation.id}`,
      text: recommendation.text,
      origin: null,
      figures: false,
    })),
  ];
}

const excerpt = (text: string, index: number, length: number): string =>
  clip(text.slice(Math.max(0, index - 40), index + length + 40), 100);

function confidentWording(input: Resolved): Critique[] {
  if (!input.brief) return [];
  const hits: { where: string; word: string; snippet: string }[] = [];
  for (const piece of briefPieces(input.brief)) {
    for (const match of piece.text.matchAll(CONFIDENT)) {
      if (NEGATED.test(piece.text.slice(Math.max(0, match.index - 30), match.index))) continue;
      hits.push({
        where: piece.where,
        word: match[0].toLowerCase(),
        snippet: excerpt(piece.text, match.index, match[0].length),
      });
    }
  }
  if (hits.length === 0) return [];
  const used = [...new Set(hits.map((hit) => hit.word))].sort();
  return [
    draft(input.now, {
      id: 'bias-confident-wording',
      role: ROLE,
      target: { kind: 'brief', id: 'brief' },
      severity: used.every((word) => word === 'will') ? 'minor' : 'major',
      objection: `The brief uses confident wording (${used.map((word) => `"${word}"`).join(', ')}) in ${plural(hits.length, 'place')}, which reads as a prediction or a promise rather than an exploration of scenarios.`,
      basis: hits.slice(0, 5).map((hit) => `${hit.where}: "${hit.snippet}"`),
      impact:
        'If this stands, a reader could take a simulated outcome for a forecast; reword it as what happened in the simulated runs and under which assumptions.',
    }),
  ];
}

function realWorldPercentages(input: Resolved): Critique[] {
  if (!input.brief) return [];
  const hits: { where: string; snippet: string }[] = [];
  for (const piece of briefPieces(input.brief)) {
    if (!piece.figures || (piece.origin && OWN_FIGURES.includes(piece.origin))) continue;
    if (SIMULATION_MARKER.test(piece.text)) continue;
    for (const match of piece.text.matchAll(PERCENT)) {
      hits.push({ where: piece.where, snippet: excerpt(piece.text, match.index, match[0].length) });
    }
  }
  if (hits.length === 0) return [];
  return [
    draft(input.now, {
      id: 'bias-real-world-percentages',
      role: ROLE,
      target: { kind: 'brief', id: 'brief' },
      severity: 'major',
      objection: `${plural(hits.length, 'percentage')} in the brief ${hits.length === 1 ? 'is' : 'are'} not labelled as simulated, so ${hits.length === 1 ? 'it' : 'they'} could be read as a real-world rate.`,
      basis: hits.slice(0, 5).map((hit) => `${hit.where}: "${hit.snippet}"`),
      impact:
        'If this stands, simulated proportions could be mistaken for measured real-world rates; state counts of simulated actors or runs instead.',
    }),
  ];
}

export const biasCritic: RoleCritic = (input) => [
  ...oneSidedPriors(input),
  ...oneSidedImpact(input),
  ...singleViewpoint(input),
  ...confidentWording(input),
  ...realWorldPercentages(input),
];
