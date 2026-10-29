import type { ChatGroundingStatus, EvidenceChunk, ProjectDetail } from '../../../shared/types.js';
import {
  isOpenConflict,
  type Ledger,
  type PublicationStatus,
  type ReviewResult,
  type StatementType,
  type SupportClass,
} from '../../../shared/evidence.js';
import { numbersIn } from '../grounding/text.js';
import { retrieve, tokenize } from '../knowledge/retrieval.js';

/** What an answer must say when the project's own material does not support one. Verbatim. */
export const ABSTENTION_MESSAGE =
  'The available project evidence does not support a confident answer.';

/** Share of a question's content terms that the project's material must contain. */
export const MIN_TERM_COVERAGE = 0.4;
/**
 * The best stemmed lexical match between the question and any passage, memory or report section.
 * Chosen for margin, not recall: on the dev split the lowest score of a question the sources do
 * answer is 0.13, so 0.10 leaves headroom. A refused fair question costs more trust than a
 * borderline question let through, which the model's own abstention and the citation rule still
 * face. See evaluation/README.md.
 */
export const MIN_RETRIEVAL_SCORE = 0.1;

const SUFFIXES = [
  'ization',
  'isation',
  'ations',
  'ation',
  'ments',
  'ment',
  'ings',
  'ing',
  'ness',
  'ers',
  'er',
  'ed',
  'es',
  'al',
  'ly',
  's',
  'e',
];

/**
 * Words that frame a request without naming anything in the project. A question made only of these
 * ("Summarise the main points") is about the project as a whole and is always answerable from it.
 */
const FRAME_WORDS = new Set(
  (
    'summarise summarize summary explain describe tell give show list main key overall general ' +
    'brief briefly please detail details thing things point points happen happened happens ' +
    'result results outcome outcomes mention mentioned regarding concerning whether tell ' +
    'say said think know want need like make made look find found'
  ).split(' '),
);

/**
 * Light stemming so "proposed", "proposal" and "proposes" meet and "passenger" meets "passengers".
 * It only has to make a vocabulary check forgiving; over-matching merely lets a question through to
 * the model, whose answer is checked separately, while under-matching would refuse a fair question.
 */
export function stem(word: string): string {
  let current = word.toLowerCase();
  if (current.length <= 4) return current;
  if (current.endsWith('ies')) current = `${current.slice(0, -3)}y`;
  for (;;) {
    const suffix = SUFFIXES.find(
      (candidate) => current.endsWith(candidate) && current.length - candidate.length >= 4,
    );
    if (!suffix) return current;
    current = current.slice(0, -suffix.length);
  }
}

function contentTerms(text: string): string[] {
  return tokenize(text.replaceAll('-', ' '));
}

function stemmedText(text: string): string {
  return contentTerms(text).map(stem).join(' ');
}

export interface AnswerabilityInput {
  question: string;
  /** Source passages. */
  chunks: readonly EvidenceChunk[];
  /** Other project material a question may legitimately be about: the report, memories, proxies. */
  material: readonly string[];
}

export interface Answerability {
  answerable: boolean;
  /** Share of the question's content terms found in the project's material, 0..1. */
  coverage: number;
  /** Best lexical match between the question and any passage or other material, 0..1. */
  topScore: number;
  missingTerms: string[];
  /** Years the question names that appear nowhere in the project. */
  unmatchedYears: string[];
  reasons: string[];
}

function asPassages(material: readonly string[]): EvidenceChunk[] {
  return material.map((text, index) => ({
    id: `M${index + 1}`,
    documentId: 'material',
    documentName: 'material',
    text,
    start: 0,
    end: text.length,
  }));
}

/**
 * Whether the project holds anything to answer a question with. Deterministic and deliberately
 * simple: a question that names terms or a year the project never mentions cannot be answered from
 * it, and guessing would only produce a fluent invention. This is a gate, not a judge: it runs
 * before any model call, and an answer that passes it is still checked against its citations.
 */
export function assessAnswerability(input: AnswerabilityInput): Answerability {
  const terms = [...new Set(contentTerms(input.question))].filter((term) => !FRAME_WORDS.has(term));
  const corpusText = [...input.chunks.map((chunk) => chunk.text), ...input.material].join('\n');
  const vocabulary = new Set(contentTerms(corpusText).map(stem));
  const missingTerms = terms.filter((term) => !vocabulary.has(stem(term)));
  const coverage = terms.length === 0 ? 1 : (terms.length - missingTerms.length) / terms.length;
  const known = new Set(numbersIn(corpusText));
  const unmatchedYears = [
    ...new Set(
      (input.question.match(/\b(?:19|20)\d{2}\b/gu) ?? []).filter((year) => !known.has(year)),
    ),
  ];
  // Scored on stemmed text so that "proposals" meets "proposes" and "fare-increase" meets "fare
  // increase"; the retrieval used to cite passages is stricter and is not what gates the question.
  const topScore =
    terms.length === 0
      ? 1
      : (retrieve(
          [...input.chunks, ...asPassages(input.material)].map((passage) => ({
            ...passage,
            text: stemmedText(passage.text),
          })),
          terms.map(stem).join(' '),
          1,
        )[0]?.score ?? 0);

  const reasons: string[] = [];
  if (unmatchedYears.length > 0) {
    reasons.push(
      `The question names ${unmatchedYears.join(', ')}, which the project never mentions.`,
    );
  }
  if (coverage < MIN_TERM_COVERAGE) {
    reasons.push(
      `Only ${Math.round(coverage * 100)}% of the question's key terms appear anywhere in the project.`,
    );
  }
  if (topScore < MIN_RETRIEVAL_SCORE) {
    reasons.push('No passage, memory or report section closely matches the question.');
  }
  return {
    answerable: reasons.length === 0,
    coverage: Number(coverage.toFixed(2)),
    topScore: Number(topScore.toFixed(2)),
    missingTerms,
    unmatchedYears,
    reasons,
  };
}

/** The reply given when the project cannot answer, with what was looked for and what was missing. */
export function abstentionReply(gate: Answerability): string {
  const missing = gate.missingTerms.slice(0, 6);
  return [
    ABSTENTION_MESSAGE,
    ...(missing.length > 0 ? [`Not found in the project: ${missing.join(', ')}.`] : []),
    ...gate.reasons.filter((reason) => !reason.startsWith('Only ')).slice(0, 2),
    'Rephrase the question, or add source material that covers it in a new experiment.',
  ].join('\n\n');
}

/** What the gate found about a question the project covers only in part, so a reader can see it. */
export function partialCoverageNotes(gate: Answerability | null): string[] {
  if (!gate?.answerable || gate.coverage >= 0.75 || gate.missingTerms.length === 0) return [];
  return [`Not found anywhere in the project: ${gate.missingTerms.slice(0, 6).join(', ')}.`];
}

/** Terms the simulation itself uses, so a question about "polarization" is never called off-topic. */
const SIMULATION_TERMS =
  'initial final mean opinion support opposition undecided polarization interactions round rounds ' +
  'simulation scenario proxy proxies intervention influence openness assumption assumptions ' +
  'evidence source sources passage limitation limitations recommendation uncertainty';

/**
 * Everything in the project, other than source passages, that a question may fairly be about: the
 * report, the personas, the graph, the recorded simulation and the follow-ups already asked.
 */
export function projectMaterial(project: ProjectDetail): string[] {
  const material: string[] = [project.name, project.question, SIMULATION_TERMS];
  if (project.report) {
    material.push(
      project.report.title,
      project.report.executiveSummary,
      ...project.report.limitations,
    );
    for (const section of project.report.sections) {
      material.push(`${section.title}\n${section.body}`);
    }
  }
  for (const agent of project.agents) {
    material.push(
      [agent.name, agent.role, agent.persona, ...(agent.goals ?? []), ...(agent.constraints ?? [])]
        .join(' ')
        .slice(0, 1_500),
    );
  }
  for (const node of project.graph?.nodes ?? []) material.push(`${node.label} ${node.summary}`);
  for (const edge of project.graph?.edges ?? []) material.push(edge.label);
  for (const round of project.rounds) {
    for (const action of round.actions) material.push(action.content);
  }
  for (const memory of project.console?.memories ?? []) material.push(memory.text);
  for (const platform of project.console?.platforms ?? []) material.push(platform.label);
  for (const interview of project.console?.interviews ?? []) {
    material.push(interview.question, interview.answer);
  }
  for (const survey of project.console?.surveys ?? []) material.push(survey.question);
  return material;
}

/** Case, spacing, wrapping quotes or emphasis marks and a final stop do not change which sentence it is. */
const sentenceKey = (text: string): string =>
  text
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^[\s"'“”‘’`*_]+|[\s"'“”‘’`*_.!]+$/gu, '')
    .toLowerCase();
const ABSTENTION_KEY = sentenceKey(ABSTENTION_MESSAGE);

/**
 * Whether a model's answer is the abstention and nothing else. A reply that merely contains the
 * sentence is an answer: counting it as an abstention would excuse whatever follows the sentence
 * from needing a citation and from the check on its figures.
 */
export function isAbstention(answer: string): boolean {
  return sentenceKey(answer) === ABSTENTION_KEY;
}

/** Least supported first, so a cap on the list never hides the statements a reader most needs to see. */
const SEVERITY: Record<SupportClass, number> = {
  contradicted: 0,
  unsupported: 1,
  'partially-supported': 2,
  'not-checkable': 3,
  'assumption-dependent': 4,
  'simulation-derived': 5,
  'directly-supported': 6,
  'not-applicable': 7,
};

export const MAX_PROMPT_CLAIMS = 40;
const MAX_PROMPT_CLAIM_LENGTH = 220;

/** A report statement as the analyst sees it: what it says, how well it is supported, and where from. */
export interface PromptClaim {
  id: string;
  text: string;
  type: StatementType;
  support: SupportClass;
  shownAs: PublicationStatus;
  reviewed: ReviewResult;
  sources: string[];
}

export function claimsForPrompt(ledger: Ledger, limit = MAX_PROMPT_CLAIMS): PromptClaim[] {
  return [...ledger.claims]
    .sort(
      (a, b) =>
        SEVERITY[a.supportClass] - SEVERITY[b.supportClass] ||
        a.id.localeCompare(b.id, undefined, { numeric: true }),
    )
    .slice(0, limit)
    .map((claim) => ({
      id: claim.id,
      text: claim.text.slice(0, MAX_PROMPT_CLAIM_LENGTH),
      type: claim.statementType,
      support: claim.supportClass,
      shownAs: claim.publication.status,
      reviewed: claim.review.result,
      sources: [...new Set(claim.supporting.map((ref) => ref.passageId))],
    }));
}

/** Open conflicts between sources, reduced to what an answer about them needs. */
export function conflictsForPrompt(ledger: Ledger) {
  return ledger.contradictions
    .filter((conflict) => isOpenConflict(conflict.status))
    .slice(0, 10)
    .map((conflict) => ({
      id: conflict.id,
      status: conflict.status,
      documents: [conflict.left.documentName, conflict.right.documentName],
      figures: [conflict.leftValue, conflict.rightValue],
      passages: [conflict.left.passageId, conflict.right.passageId],
    }));
}

/** Passage, memory and claim identifiers ("S3", "M-community-2-agent-1") are labels, not figures. */
const IDENTIFIER = /\b(?:M-[\w-]+|[A-Z]\d{1,3})\b/gu;

function figuresIn(answer: string): string[] {
  return numbersIn(answer.replace(IDENTIFIER, ' '));
}

export interface AnswerCheckInput {
  answer: string;
  sourceIds: readonly string[];
  memoryIds: readonly string[];
  /** Report statements (evidence-ledger ids) the answer cites. */
  claimIds: readonly string[];
  /** Text of the passages, memories and report statements the answer actually cited. */
  citedText: string;
  /** Figures recorded by the simulation, which an answer may quote. */
  recordedFigures: ReadonlySet<string>;
}

export interface AnswerCheck {
  status: ChatGroundingStatus;
  notes: string[];
}

/**
 * What can be said about an answer without trusting it: whether it abstained, whether it cites
 * anything, and whether its figures appear in what it cited or in what the simulation recorded.
 * A figure only the question supplied does not count, so an answer that accepts a false premise
 * ("yes, the fare rises 17%") is flagged rather than excused. It never changes the answer; it tells
 * the reader how much weight the answer can bear.
 */
export function checkAnswer(input: AnswerCheckInput): AnswerCheck {
  if (isAbstention(input.answer)) {
    return { status: 'abstained', notes: ['The answer says the evidence does not support one.'] };
  }
  const notes: string[] = [];
  const cited = input.sourceIds.length + input.memoryIds.length + input.claimIds.length > 0;
  const allowed = new Set([...numbersIn(input.citedText), ...input.recordedFigures]);
  const unsupported = figuresIn(input.answer).filter((figure) => !allowed.has(figure));
  if (!cited)
    notes.push('This answer cites no source passage, simulation memory or report statement.');
  if (unsupported.length > 0) {
    notes.push(
      `These figures are not in the cited or recorded material: ${unsupported.slice(0, 6).join(', ')}.`,
    );
  }
  if (!cited) return { status: 'uncited', notes };
  return { status: unsupported.length > 0 ? 'caveated' : 'cited', notes };
}
