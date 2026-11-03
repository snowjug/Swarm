import {
  COMPARISON_INPUTS_UNRECORDED,
  RESPONSE_CATEGORIES,
  RESPONSE_LABELS,
  UNRECORDED_INPUTS_ADVICE,
  comparisonInputsUnrecorded,
  inputsInWords,
  staleComparisonInputs,
} from '../../../shared/analysis.js';
import {
  BRIEF_SECTION_IDS,
  BRIEF_SIGNAL_NOTICES,
  STATEMENT_ORIGIN_LABELS,
  type BriefLookups,
  type BriefRefs,
  type BriefSectionId,
  type BriefVisuals,
  type DecisionBrief,
} from '../../../shared/brief.js';
import { STAKEHOLDER_CATEGORY_LABELS, TRAIT_KEYS } from '../../../shared/stakeholders.js';
import type { DecisionCanvas } from '../../../shared/decision.js';
import { canvasBlocks } from '../decision/export.js';
import { markdownText } from '../export.js';
import {
  approx,
  decimals,
  oneLine,
  perHundred,
  signed,
  signedPerHundred,
  traitLabel,
} from './text.js';

/**
 * What leaves the brief: Markdown, JSON and a printable page. The Markdown and the page are written
 * from one list of blocks, so they say the same things, and each escapes every piece of text it
 * prints: a name, a quotation or a finding is data, whatever it contains. The page carries no script
 * and loads nothing, and is served with a policy that allows nothing else.
 */

export const NOTICE =
  'Swarm explores possible scenarios. It does not predict the future. Outcome counts are synthetic; other figures are model scores, seeded-run proportions or stated assumptions; none is a measured population rate.';

/** The policy the printable page is served with: nothing may load, run or frame, apart from its own inline style. */
export const BRIEF_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** What the brief was checked against when it was handed over. */
export interface BriefFreshness {
  /** What has changed since the brief was made, or since the comparison it rests on was run. Empty when it is current. */
  changedSince: string[];
  /** The revision of each input as the project holds it at the export, to read beside `brief.inputRevisions`. */
  currentRevisions: Record<string, number>;
  /** `snapshot`: the tables are the data kept with the brief. `current`: drawn from the project as it is at the export. */
  visuals: 'snapshot' | 'current';
}

export interface BriefExportInput {
  brief: DecisionBrief;
  visuals: BriefVisuals | null;
  project: { id: string; name: string };
  exportedAt: string;
  appVersion: string;
  /** Absent when the export was not checked against the project, and then it says nothing about freshness. */
  freshness?: BriefFreshness;
  /** The decision canvas of the comparison the brief is of, worked out at the export: it comes first. Absent when none could be made. */
  canvas?: DecisionCanvas | null;
}

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; anchor?: string }
  | { kind: 'paragraph'; text: string; tone?: 'notice' | 'note' | 'alert'; title?: string }
  | {
      kind: 'statement';
      id: string;
      origin: string;
      reliance: string | null;
      text: string;
      rests: string[];
    }
  | { kind: 'table'; caption: string; headers: string[]; rows: string[][] }
  | { kind: 'facts'; items: [string, string][] };

const RELIANCE_LABELS = {
  high: 'High reliance',
  moderate: 'Moderate reliance',
  low: 'Low reliance',
} as const;

const ORIGIN_LETTERS = { 'system-assumption': 's', model: 'm', user: 'u', evidence: 'e' } as const;

const cell = (value: string | number): string => oneLine(String(value));

const revisionsText = (revisions: Record<string, number>): string =>
  Object.entries(revisions)
    .map(([name, revision]) => `${name} ${revision}`)
    .join('; ') || 'not recorded';

/** What an export says before anything else when what the brief rests on has changed since it was made. */
function outOfDate({ brief, freshness }: BriefExportInput): { title: string; text: string } | null {
  if (!freshness || freshness.changedSince.length === 0) return null;
  const inputs = staleComparisonInputs(freshness.changedSince);
  const unrecorded = comparisonInputsUnrecorded(freshness.changedSince);
  const changed = freshness.changedSince.filter((entry) => entry !== COMPARISON_INPUTS_UNRECORDED);
  const revisions = `It was made from these revisions: ${revisionsText(brief.inputRevisions)}. The project now holds: ${revisionsText(freshness.currentRevisions)}.`;
  const parts = [
    changed.length > 0 ? `Since it was made, this has changed: ${changed.join(', ')}.` : '',
    inputs.length > 0
      ? `The comparison it rests on was run before ${inputsInWords(inputs)} changed, so the brief describes the project as it was. Run the comparison again, then write the brief again.`
      : changed.length > 0
        ? 'Write the brief again to bring it up to date.'
        : '',
    unrecorded
      ? `${UNRECORDED_INPUTS_ADVICE} Run the comparison again, then write the brief again.`
      : '',
    revisions,
  ];
  return {
    title: 'This brief may be out of date.',
    text: parts.filter((part) => part !== '').join(' '),
  };
}

/** Said when the tables cannot be the ones the brief was made with, because none was kept. */
const CURRENT_DATA = {
  title: 'The tables show the project as it is now.',
  text: 'This brief was stored before the data behind its tables was kept with it, so they are drawn from the project’s documents as they are at the export, not as they were when the brief was made.',
};

/** What a table says where the stored analysis kept no per-actor results to add up. */
const NOT_STORED = 'not stored';

/** A mean with its range over the runs, or the mean alone where only that could be worked out. */
function range(
  spread: { mean: number; min: number | null; max: number | null },
  show: (value: number) => string,
): string {
  return spread.min === null || spread.max === null
    ? `${show(spread.mean)} (mean only)`
    : `${show(spread.mean)} (${show(spread.min)} to ${show(spread.max)})`;
}

/** What a statement rests on, in words, with the finding or assumption looked up where it can be. */
function restsOn(refs: BriefRefs, visuals: BriefVisuals | null): string[] {
  const lookups: BriefLookups | null = visuals?.lookups ?? null;
  const lines: string[] = [];
  for (const ref of refs.evidence) {
    lines.push(
      `Evidence (${ref.role}): ${ref.documentName}, passage ${ref.passageId}${ref.quote ? `: “${oneLine(ref.quote)}”` : ''}`,
    );
  }
  for (const id of refs.findingIds) {
    const finding = lookups?.findings.find((entry) => entry.id === id);
    lines.push(
      finding
        ? `Finding ${id}: ${oneLine(finding.statement)} Held in ${finding.holdsIn} of ${finding.of} seeded runs (interval ${decimals(finding.interval.lo)} to ${decimals(finding.interval.hi)}; ${finding.classification}).`
        : `Finding ${id}`,
    );
  }
  for (const id of refs.sensitivityIds) {
    const row = visuals?.sensitivity.find((entry) => entry.id === id);
    lines.push(
      row
        ? `Sensitivity ${id}: ${oneLine(row.label)}; shift ${signed(row.shift)} (standard error ${decimals(row.standardError)}); ${row.classification}.`
        : `Sensitivity ${id}`,
    );
  }
  for (const assumption of refs.assumptions) lines.push(`Assumption: ${oneLine(assumption)}`);
  for (const id of refs.stakeholderIds) {
    lines.push(
      `Stakeholder: ${lookups?.stakeholders.find((entry) => entry.id === id)?.name ?? id}`,
    );
  }
  for (const id of refs.documentIds) {
    const document = lookups?.documents.find((entry) => entry.id === id);
    lines.push(document ? `Document: ${document.name}. ${document.provenance}` : `Document ${id}`);
  }
  for (const id of refs.variantIds) {
    lines.push(
      `Seeded runs of: ${lookups?.variants.find((entry) => entry.id === id)?.label ?? id}`,
    );
  }
  for (const id of refs.critiqueIds) lines.push(`Critique ${id}`);
  return lines;
}

function tablesFor(
  brief: DecisionBrief,
  visuals: BriefVisuals,
): Partial<Record<BriefSectionId, Block[]>> {
  return {
    'evidence-base': [
      {
        kind: 'table',
        caption: 'Evidence map: cited passages for each stakeholder',
        headers: ['Stakeholder', 'Category', 'Supporting', 'Contradicting', 'Documents', 'Gap'],
        rows: visuals.evidenceMap.map((row) => [
          row.name,
          STAKEHOLDER_CATEGORY_LABELS[row.category],
          String(row.supporting),
          String(row.contradicting),
          row.documents.join('; ') || 'none',
          row.gap ? 'No cited support' : '',
        ]),
      },
    ],
    stakeholders: [
      {
        kind: 'table',
        caption: 'Stakeholder map by category',
        headers: [
          'Category',
          'Stakeholder',
          'Priority',
          'Expected effect',
          'Uncertainty',
          'Origin',
        ],
        rows: visuals.stakeholderMap.flatMap((group) =>
          group.stakeholders.map((row) => [
            group.label,
            row.name,
            row.priority,
            row.direction,
            row.uncertainty,
            STATEMENT_ORIGIN_LABELS[row.origin],
          ]),
        ),
      },
    ],
    'reaction-patterns': [
      {
        kind: 'table',
        caption:
          'Share of simulated members in each response, every actor counting equally, in every 100 (mean over the seeded runs)',
        headers: [
          'Variant',
          'Runs',
          ...RESPONSE_CATEGORIES.map((category) => RESPONSE_LABELS[category]),
          'Looking for an alternative or resisting (lowest to highest)',
        ],
        rows: visuals.outcomeDistribution.map((row) => [
          row.label,
          String(row.runs),
          ...row.shares.map((entry) => perHundred(entry.mean)),
          range(row.adverseShare, perHundred),
        ]),
      },
      {
        kind: 'table',
        caption:
          'Counts of simulated members in each response, a mean over the seeded runs. How many members are sampled for each group is a numerical resolution, not a population: the counts depend on it, so no variant is ranked by them',
        headers: [
          'Variant',
          'Simulated members per run (sampled)',
          ...RESPONSE_CATEGORIES.map((category) => RESPONSE_LABELS[category]),
          'Looking for an alternative or resisting (lowest to highest)',
        ],
        rows: visuals.outcomeDistribution.map((row) => [
          row.label,
          row.members === null ? NOT_STORED : String(row.members),
          ...(row.responses?.map((entry) => approx(entry.mean)) ??
            RESPONSE_CATEGORIES.map(() => NOT_STORED)),
          row.adverse === null ? NOT_STORED : range(row.adverse, approx),
        ]),
      },
    ],
    'alternative-outcomes': [
      {
        kind: 'table',
        caption:
          brief.signal === 'clear'
            ? 'Each alternative against the baseline, on the same seeds'
            : brief.signal === 'no-direction'
              ? 'Each alternative against the baseline, on the same seeds (the differences are not read as effects of the change: see the notice at the top)'
              : 'Each alternative against the baseline, on the same seeds (the first row, the proposed change, is not read as an effect of the change: see the notice at the top; every other row is read on its own)',
        headers: [
          'Variant',
          'Share looking for an alternative or resisting, every 100 simulated members, each actor counting equally',
          'Baseline share',
          'Paired difference (standard error)',
          'Paired runs',
          'Higher in',
          'Mean stance',
          'Stance change',
          'Change in sampled members (a resolution, not a population)',
          'Finding',
          'Stability',
        ],
        rows: visuals.scenarioComparison.map((row) => [
          row.label,
          perHundred(row.adverseShare),
          row.baselineAdverseShare === null ? 'no baseline' : perHundred(row.baselineAdverseShare),
          row.shareDelta === null
            ? 'not paired'
            : `${signedPerHundred(row.shareDelta)} (${perHundred(row.shareDeltaError ?? 0)})`,
          String(row.pairedRuns),
          `${row.worseInRuns} of ${row.pairedRuns} runs`,
          signed(row.stanceMean),
          row.stanceDelta === null ? 'not paired' : signed(row.stanceDelta),
          row.adverseDelta === null ? NOT_STORED : signed(row.adverseDelta, 1),
          row.findingId ?? 'none recorded',
          row.classification
            ? `${row.classification}, held in ${row.holdsIn} of ${row.of} runs`
            : 'not stated',
        ]),
      },
    ],
    uncertainty: [
      {
        kind: 'table',
        caption: 'Sensitivity: what moving one assumption did to the outcome, on the same seeds',
        headers: [
          'Assumption moved',
          'Measure',
          'Shift',
          'Standard error',
          'Result',
          'Origin',
          'Evidence',
        ],
        rows: visuals.sensitivity.map((row) => [
          row.label,
          row.metric,
          signed(row.shift),
          decimals(row.standardError),
          row.classification,
          STATEMENT_ORIGIN_LABELS[row.origin],
          row.evidenced ? 'cited' : 'none cited',
        ]),
      },
    ],
    assumptions: [
      {
        kind: 'table',
        caption: 'Assumption register',
        headers: ['Assumption', 'Origin', 'Sensitive', 'Evidenced', 'Effect of moving it'],
        rows: visuals.assumptionRegister.map((row) => [
          row.text,
          STATEMENT_ORIGIN_LABELS[row.origin],
          row.sensitive ? 'yes' : 'no',
          row.evidenced ? 'yes' : 'no',
          row.effect ?? '',
        ]),
      },
    ],
    'technical-appendix': [
      {
        kind: 'table',
        caption: `Trait table: value of every trait of every simulated actor, with its origin (s filled in by Swarm, m proposed by a model, u set by a person, e labelled as resting on evidence); ${brief.methodology.runsPerVariant} seeded runs per variant`,
        headers: [
          'Actor',
          'Kind',
          'Simulated members',
          'Assumed population',
          ...TRAIT_KEYS.map(traitLabel),
        ],
        rows: visuals.traitTable.map((row) => [
          row.name,
          row.kind,
          String(row.members),
          String(row.size),
          ...row.traits.map(
            (trait) => `${decimals(trait.value)} (${ORIGIN_LETTERS[trait.origin]})`,
          ),
        ]),
      },
    ],
  };
}

function blocks(input: BriefExportInput): Block[] {
  const { brief, visuals } = input;
  const result: Block[] = [
    { kind: 'heading', level: 1, text: `Decision brief: ${input.project.name}` },
    { kind: 'paragraph', text: NOTICE, tone: 'notice' },
  ];
  // Before anything else is read: when what the brief rests on has changed, or its tables are not its own, the page says so.
  const stale = outOfDate(input);
  if (stale) result.push({ kind: 'paragraph', ...stale, tone: 'alert' });
  if (input.freshness?.visuals === 'current') {
    result.push({ kind: 'paragraph', ...CURRENT_DATA, tone: 'alert' });
  }
  // Before anything else is read: when the comparison cannot be read as a result, the page says so.
  if (brief.signal !== 'clear') {
    const { title, text } = BRIEF_SIGNAL_NOTICES[brief.signal];
    result.push({ kind: 'paragraph', title, text, tone: 'alert' });
  }
  // The decision picture comes before the brief’s own account of it, so that a printed page opens on it.
  if (input.canvas) result.push(...canvasBlocks(input.canvas));
  result.push(
    {
      kind: 'facts',
      items: [
        ['Question', brief.question],
        ['Generated', brief.generatedAt],
        ['Exported', input.exportedAt],
        ['Analysis', brief.analysisId],
        [
          'Method',
          brief.generatedBy === 'rules'
            ? 'Assembled by rules from stored data'
            : 'Assembled by rules, with model-worded interpretations',
        ],
        ['Fidelity', brief.fidelity.label],
        ['Critiques not yet closed', String(brief.openCritiques)],
        ['Swarm version', input.appVersion],
      ],
    },
    { kind: 'heading', level: 2, text: 'In short', anchor: 'in-short' },
    { kind: 'paragraph', text: brief.headline },
  );
  const extras = visuals ? tablesFor(brief, visuals) : {};
  BRIEF_SECTION_IDS.forEach((id, index) => {
    const section = brief.sections.find((entry) => entry.id === id);
    if (!section) return;
    result.push({ kind: 'heading', level: 2, text: `${index + 1}. ${section.title}`, anchor: id });
    const statements = section.statements.filter(
      (statement) =>
        !(id === 'recommendations' && statement.id.startsWith('rec-')) &&
        !(id === 'validation-plan' && statement.id.startsWith('val-')),
    );
    for (const statement of statements) {
      result.push({
        kind: 'statement',
        id: statement.id,
        origin: STATEMENT_ORIGIN_LABELS[statement.origin],
        reliance: statement.reliance ? RELIANCE_LABELS[statement.reliance] : null,
        text: statement.text,
        rests: restsOn(statement.refs, visuals),
      });
    }
    if (id === 'recommendations' && brief.recommendations.length > 0) {
      const byId = new Map(section.statements.map((statement) => [statement.id, statement]));
      result.push({
        kind: 'table',
        caption: 'Recommendations, best first',
        headers: [
          'Priority',
          'Recommendation',
          'Origin',
          'Reliance',
          'Impact',
          'Effort',
          'Reversibility',
          'Owner',
          'Horizon',
          'Linked findings',
          'Leading indicators',
          'How to check it first',
        ],
        rows: brief.recommendations.map((recommendation) => {
          const statement = byId.get(recommendation.id);
          return [
            String(recommendation.priority),
            recommendation.text,
            statement ? STATEMENT_ORIGIN_LABELS[statement.origin] : '',
            statement?.reliance ? RELIANCE_LABELS[statement.reliance] : 'not applicable',
            recommendation.impact,
            recommendation.effort,
            recommendation.reversibility,
            recommendation.ownerFunction,
            recommendation.horizon,
            recommendation.linkedFindingIds.join(', '),
            recommendation.leadingIndicators.join('; '),
            recommendation.validation,
          ];
        }),
      });
    }
    if (id === 'validation-plan' && brief.validationPlan.length > 0) {
      result.push({
        kind: 'table',
        caption: 'Validation plan: real-world checks, none of which has been run',
        headers: [
          'Check',
          'Tests',
          'Question',
          'Observe',
          'Compare with',
          'Method',
          'Decision rule (left to you)',
          'Owner',
          'Effort',
          'Duration',
        ],
        rows: brief.validationPlan.map((experiment) => [
          experiment.id,
          experiment.targets.join('; '),
          experiment.question,
          experiment.measure,
          experiment.comparison,
          experiment.method,
          experiment.successSignal,
          experiment.ownerFunction,
          experiment.effort,
          experiment.duration,
        ]),
      });
    }
    result.push(...(extras[id] ?? []));
  });
  result.push(
    { kind: 'heading', level: 2, text: 'How this brief was made', anchor: 'method' },
    {
      kind: 'facts',
      items: [
        ['Seeded runs per variant', String(brief.methodology.runsPerVariant)],
        ['Variants', brief.methodology.variants.join('; ')],
        ['Base seed', String(brief.methodology.baseSeed)],
        ['Rounds', String(brief.methodology.rounds)],
        [
          'Inputs, by revision',
          Object.entries(brief.inputRevisions)
            .map(([name, revision]) => `${name} ${revision}`)
            .join('; ') || 'not recorded',
        ],
      ],
    },
    ...brief.methodology.notes.map((note): Block => ({
      kind: 'paragraph',
      text: note,
      tone: 'note',
    })),
    { kind: 'paragraph', text: NOTICE, tone: 'notice' },
  );
  return result;
}

// ---- Markdown

const md = (value: string): string => markdownText(oneLine(value));

export function briefMarkdown(input: BriefExportInput): string {
  const lines: string[] = [];
  for (const block of blocks(input)) {
    switch (block.kind) {
      case 'heading':
        lines.push('', `${'#'.repeat(block.level)} ${md(block.text)}`, '');
        break;
      case 'paragraph':
        if (block.tone === 'alert') {
          lines.push(`> **${md(block.title ?? '')}** ${md(block.text)}`, '');
        } else {
          lines.push(block.tone === 'notice' ? `> ${md(block.text)}` : md(block.text), '');
        }
        break;
      case 'facts':
        lines.push(...block.items.map(([key, value]) => `- **${md(key)}:** ${md(value)}`), '');
        break;
      case 'statement':
        lines.push(
          `- **${md(block.origin)}${block.reliance ? ` · ${md(block.reliance)}` : ''}** (${md(block.id)}) ${md(block.text)}`,
          ...block.rests.map((rest) => `  - ${md(rest)}`),
        );
        break;
      case 'table':
        lines.push(
          '',
          `**${md(block.caption)}**`,
          '',
          `| ${block.headers.map((header) => md(header)).join(' | ')} |`,
          `| ${block.headers.map(() => '---').join(' | ')} |`,
          ...block.rows.map((row) => `| ${row.map((value) => md(cell(value))).join(' | ')} |`),
          '',
        );
        break;
    }
  }
  return `${lines
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()}\n`;
}

// ---- JSON

/** The brief as data, with the numbers its tables are drawn from and where it came from. */
export function briefJson(input: BriefExportInput): unknown {
  const { brief, freshness } = input;
  const stale = outOfDate(input);
  return {
    format: 'swarm-decision-brief',
    schemaVersion: 1,
    notice: NOTICE,
    // Present only when the brief has been checked against the project; `null` says it still describes it.
    ...(freshness
      ? {
          warning: stale ? `${stale.title} ${stale.text}` : null,
          changedSince: freshness.changedSince,
        }
      : {}),
    project: { id: input.project.id, name: input.project.name },
    // The decision picture, first: the same data the page draws it from. `null` when none could be made.
    canvas: input.canvas ?? null,
    brief,
    data: input.visuals,
    provenance: {
      generatedAt: brief.generatedAt,
      exportedAt: input.exportedAt,
      appVersion: input.appVersion,
      analysisId: brief.analysisId,
      generatedBy: brief.generatedBy,
      inputRevisions: brief.inputRevisions,
      ...(freshness
        ? { currentRevisions: freshness.currentRevisions, dataFrom: freshness.visuals }
        : {}),
    },
  };
}

// ---- HTML: the printable page

const esc = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

// A document to be read and handed on, not a dump of the record: the answer first, the paper's own typefaces (the
// page may load nothing), what each statement rests on beside it and quiet, and the one deliberate box, the caveat.
const STYLE = `
  :root { color-scheme: light; --ink: #17171c; --soft: #4b4b57; --faint: #6e6e7a; --rule: #dcdce4; }
  body { margin: 0; background: #fff; color: var(--ink); font: 1.0625rem/1.62 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
  main { max-width: 54rem; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
  h1, h2 { font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Charter, Georgia, serif; font-weight: 500; letter-spacing: -.01em; text-wrap: balance; }
  h1 { font-size: 2.5rem; line-height: 1.08; margin: 0 0 1rem; }
  h2 { font-size: 1.55rem; line-height: 1.2; margin: 3rem 0 .9rem; padding-top: 1.1rem; border-top: 1px solid var(--rule); }
  main > p { max-width: 42rem; }
  .notice { font-style: italic; color: var(--soft); margin: 0 0 1.5rem; padding-left: .9rem; border-left: 3px solid var(--rule); }
  .alert { border: 2px solid #111; padding: .65rem .9rem; margin: 0 0 1.25rem; break-inside: avoid; }
  .note { font-size: .9rem; color: var(--soft); margin: .3rem 0; }
  dl { margin: 1.25rem 0 1.5rem; display: grid; grid-template-columns: max-content 1fr; gap: .3rem 1.25rem; font-size: .9rem; }
  dt { font-weight: 600; color: var(--soft); }
  dd { margin: 0; overflow-wrap: anywhere; }
  main > dl:first-of-type { display: block; font-size: .82rem; color: var(--soft); }
  main > dl:first-of-type dt, main > dl:first-of-type dd { display: inline; }
  main > dl:first-of-type dd { margin: 0 1.1rem 0 .3rem; }
  main > dl:first-of-type dt:first-of-type { display: block; font-size: .72rem; letter-spacing: .12em; text-transform: uppercase; color: var(--faint); margin-bottom: .2rem; }
  main > dl:first-of-type dd:first-of-type { display: block; margin: 0 0 1.1rem; max-width: 40rem; font: 1.45rem/1.3 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Charter, Georgia, serif; color: var(--ink); }
  ul { padding-left: 1.2rem; }
  li { margin: .5rem 0; }
  .statements { list-style: none; padding: 0; margin: 0; }
  .statement { display: flex; flex-wrap: wrap; align-items: baseline; gap: .1rem .6rem; margin: 1.35rem 0; break-inside: avoid; }
  .origin { order: 1; font-size: .7rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--soft); }
  .reliance { order: 2; font-size: .7rem; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
  .reliance::before { content: '/'; margin-right: .6rem; color: var(--rule); }
  .id { order: 3; margin-left: auto; font: .7rem ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--faint); }
  .text { order: 4; flex: 1 1 100%; max-width: 42rem; }
  .rests { order: 5; flex: 1 1 100%; list-style: none; max-width: 42rem; margin: .35rem 0 0; padding: 0 0 0 .85rem; border-left: 2px solid var(--rule); font-size: .86rem; color: var(--soft); }
  .rests li { margin: .2rem 0; }
  table { border-collapse: collapse; width: 100%; font-size: .8rem; line-height: 1.45; margin: .75rem 0 1.75rem; }
  caption { text-align: left; font-weight: 650; font-size: .92rem; padding: 0 0 .6rem; }
  th, td { border: 0; border-bottom: 1px solid var(--rule); padding: .5rem .7rem .5rem 0; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  thead th { font-size: .74rem; font-weight: 650; color: var(--soft); border-bottom: 1.5px solid var(--ink); overflow-wrap: break-word; hyphens: auto; }
  table:not(.wide) th, table:not(.wide) td { min-width: 4.5rem; }
  .wide thead th { overflow-wrap: anywhere; }
  tbody th { font-weight: 600; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  footer { margin-top: 3.5rem; border-top: 1px solid var(--rule); padding-top: .9rem; font-size: .82rem; color: var(--soft); max-width: 42rem; }
  .print-hint { font-size: .8rem; color: var(--faint); margin: 0 0 1.5rem; }
  @media print { body { font-size: 10pt; line-height: 1.45; } .print-hint { display: none; } main { padding: 0; max-width: none; } h1 { font-size: 22pt; margin-bottom: 8pt; } h2 { font-size: 14pt; margin: 16pt 0 6pt; padding-top: 8pt; break-after: avoid; } .statement { margin: .8rem 0; } .rests li { margin: .1rem 0; } table { font-size: 7.5pt; margin: 6pt 0 12pt; } th, td { padding: .3rem .5rem .3rem 0; } footer { margin-top: 18pt; } }
  @page { margin: 16mm; }
`;

export function briefHtml(input: BriefExportInput): string {
  const body: string[] = [
    `<p class="print-hint">To print this brief or save it as a PDF, use your browser's Print command (Ctrl+P).</p>`,
  ];
  let open = false;
  const closeList = (): void => {
    if (open) body.push('</ul>');
    open = false;
  };
  for (const block of blocks(input)) {
    if (block.kind !== 'statement') closeList();
    switch (block.kind) {
      case 'heading':
        body.push(
          `<h${block.level}${block.anchor ? ` id="${esc(block.anchor)}"` : ''}>${esc(block.text)}</h${block.level}>`,
        );
        break;
      case 'paragraph':
        body.push(
          `<p${block.tone ? ` class="${block.tone}"` : ''}>${block.title ? `<strong>${esc(block.title)}</strong> ` : ''}${esc(block.text)}</p>`,
        );
        break;
      case 'facts':
        body.push(
          `<dl>${block.items.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>`,
        );
        break;
      case 'statement':
        if (!open) body.push('<ul class="statements">');
        open = true;
        body.push(
          `<li class="statement"><span class="origin">${esc(block.origin)}</span>${block.reliance ? `<span class="reliance">${esc(block.reliance)}</span>` : ''}<span class="id">${esc(block.id)}</span><span class="text">${esc(block.text)}</span>${block.rests.length > 0 ? `<ul class="rests">${block.rests.map((rest) => `<li>${esc(rest)}</li>`).join('')}</ul>` : ''}</li>`,
        );
        break;
      case 'table':
        body.push(
          `<table${block.headers.length > 7 ? ' class="wide"' : ''}><caption>${esc(block.caption)}</caption><thead><tr>${block.headers.map((header) => `<th scope="col">${esc(header)}</th>`).join('')}</tr></thead><tbody>${block.rows
            .map(
              (row) =>
                `<tr>${row.map((value, index) => (index === 0 ? `<th scope="row">${esc(cell(value))}</th>` : `<td>${esc(cell(value))}</td>`)).join('')}</tr>`,
            )
            .join('')}</tbody></table>`,
        );
        break;
    }
  }
  closeList();
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n<title>${esc(input.project.name)}: decision brief</title>\n<style>${STYLE}</style>\n</head>\n<body>\n<main>\n${body.join('\n')}\n<footer><p>${esc(NOTICE)}</p></footer>\n</main>\n</body>\n</html>\n`;
}
