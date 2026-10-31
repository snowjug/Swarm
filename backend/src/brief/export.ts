import { RESPONSE_CATEGORIES, RESPONSE_LABELS } from '../../../shared/analysis.js';
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
import { markdownText } from '../export.js';
import { approx, decimals, oneLine, signed, traitLabel } from './text.js';

/**
 * What leaves the brief: Markdown, JSON and a printable page. The Markdown and the page are written
 * from one list of blocks, so they say the same things, and each escapes every piece of text it
 * prints: a name, a quotation or a finding is data, whatever it contains. The page carries no script
 * and loads nothing, and is served with a policy that allows nothing else.
 */

export const NOTICE =
  'Swarm explores possible scenarios. It does not predict the future. Every figure here is a count of simulated members or of seeded runs, never a rate in a real population.';

/** The policy the printable page is served with: nothing may load, run or frame, apart from its own inline style. */
export const BRIEF_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export interface BriefExportInput {
  brief: DecisionBrief;
  visuals: BriefVisuals | null;
  project: { id: string; name: string };
  exportedAt: string;
  appVersion: string;
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
        caption: 'Mean number of simulated members ending in each response, over the seeded runs',
        headers: [
          'Variant',
          'Runs',
          'Simulated members per run',
          ...RESPONSE_CATEGORIES.map((category) => RESPONSE_LABELS[category]),
          'Looking for an alternative or resisting (lowest to highest)',
        ],
        rows: visuals.outcomeDistribution.map((row) => [
          row.label,
          String(row.runs),
          String(row.members),
          ...row.responses.map((entry) => approx(entry.mean)),
          `${approx(row.adverse.mean)} (${approx(row.adverse.min)} to ${approx(row.adverse.max)})`,
        ]),
      },
    ],
    'alternative-outcomes': [
      {
        kind: 'table',
        caption:
          brief.signal === 'clear'
            ? 'Each alternative against the baseline, on the same seeds'
            : 'Each alternative against the baseline, on the same seeds (the differences are not read as effects of the change: see the notice at the top)',
        headers: [
          'Variant',
          'Mean adverse members',
          'Baseline mean',
          'Change',
          'Paired runs',
          'More adverse in',
          'Mean stance',
          'Stance change',
          'Finding',
          'Stability',
        ],
        rows: visuals.scenarioComparison.map((row) => [
          row.label,
          approx(row.adverseMean),
          row.baselineAdverseMean === null ? 'no baseline' : approx(row.baselineAdverseMean),
          row.adverseDelta === null ? 'not paired' : signed(row.adverseDelta, 1),
          String(row.pairedRuns),
          `${row.worseInRuns} of ${row.pairedRuns} runs`,
          signed(row.stanceMean),
          row.stanceDelta === null ? 'not paired' : signed(row.stanceDelta),
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
  // Before anything else is read: when the comparison cannot be read as a result, the page says so.
  if (brief.signal !== 'clear') {
    const { title, text } = BRIEF_SIGNAL_NOTICES[brief.signal];
    result.push({ kind: 'paragraph', title, text, tone: 'alert' });
  }
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
        ['Open critiques', String(brief.openCritiques)],
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
          'Follows from findings',
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
        headers: ['Check', 'Tests', 'Question', 'Method', 'Success signal', 'Effort', 'Duration'],
        rows: brief.validationPlan.map((experiment) => [
          experiment.id,
          experiment.targets.join('; '),
          experiment.question,
          experiment.method,
          experiment.successSignal,
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
  const { brief } = input;
  return {
    format: 'swarm-decision-brief',
    schemaVersion: 1,
    notice: NOTICE,
    project: { id: input.project.id, name: input.project.name },
    brief,
    data: input.visuals,
    provenance: {
      generatedAt: brief.generatedAt,
      exportedAt: input.exportedAt,
      appVersion: input.appVersion,
      analysisId: brief.analysisId,
      generatedBy: brief.generatedBy,
      inputRevisions: brief.inputRevisions,
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

const STYLE = `
  :root { color-scheme: light; }
  body { margin: 0; background: #fff; color: #111; font: 11pt/1.5 'Segoe UI', Arial, sans-serif; }
  main { max-width: 52rem; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
  h1 { font-size: 1.7rem; line-height: 1.2; margin: 0 0 .25rem; }
  h2 { font-size: 1.2rem; margin: 2rem 0 .5rem; padding-bottom: .2rem; border-bottom: 2px solid #111; }
  .notice { font-style: italic; margin: 0 0 1rem; }
  .alert { border: 2px solid #111; padding: .5rem .75rem; margin: 0 0 1rem; break-inside: avoid; }
  .note { font-size: .9rem; color: #333; margin: .2rem 0; }
  dl { margin: 1rem 0; display: grid; grid-template-columns: max-content 1fr; gap: .15rem 1rem; font-size: .9rem; }
  dt { font-weight: 700; }
  dd { margin: 0; overflow-wrap: anywhere; }
  ul { padding-left: 1.2rem; }
  li { margin: .5rem 0; }
  .statement { break-inside: avoid; }
  .origin { display: inline-block; border: 1px solid #111; padding: 0 .35rem; font-size: .8rem; font-weight: 700; margin-right: .35rem; }
  .reliance { display: inline-block; border: 1px dashed #111; padding: 0 .35rem; font-size: .8rem; margin-right: .35rem; }
  .id { font-size: .8rem; color: #333; }
  .rests { font-size: .85rem; color: #222; margin: .2rem 0 0; }
  .rests li { margin: .1rem 0; }
  table { border-collapse: collapse; width: 100%; font-size: .8rem; margin: .5rem 0 1rem; }
  caption { text-align: left; font-weight: 700; padding: .3rem 0; }
  th, td { border: 1px solid #111; padding: .25rem .4rem; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  thead th { background: #eee; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  footer { margin-top: 2.5rem; border-top: 1px solid #111; padding-top: .6rem; font-size: .85rem; }
  .print-hint { font-size: .85rem; border: 1px solid #333; padding: .4rem .6rem; }
  @media print { .print-hint { display: none; } main { padding: 0; max-width: none; } h2 { break-after: avoid; } }
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
          `<li class="statement"><span class="origin">${esc(block.origin)}</span>${block.reliance ? `<span class="reliance">${esc(block.reliance)}</span>` : ''}<span class="id">${esc(block.id)}</span> ${esc(block.text)}${block.rests.length > 0 ? `<ul class="rests">${block.rests.map((rest) => `<li>${esc(rest)}</li>`).join('')}</ul>` : ''}</li>`,
        );
        break;
      case 'table':
        body.push(
          `<table><caption>${esc(block.caption)}</caption><thead><tr>${block.headers.map((header) => `<th scope="col">${esc(header)}</th>`).join('')}</tr></thead><tbody>${block.rows
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
