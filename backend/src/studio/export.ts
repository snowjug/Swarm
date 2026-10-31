import {
  PUBLICATION_STATUS_LABELS,
  REVIEW_RESULT_LABELS,
  STATEMENT_TYPE_LABELS,
  SUPPORT_CLASS_LABELS,
  type ClaimRecord,
  type EvidenceRef,
} from '../../../shared/evidence.js';
import {
  DECISION_LABELS,
  SECTION_ORIGIN_LABELS,
  STUDIO_STATE_LABELS,
  type StudioSectionView,
  type StudioView,
} from '../../../shared/studio.js';
import { markdownText } from '../export.js';
import { contentHash } from './model.js';

/**
 * What leaves the studio: Markdown, JSON, and a printable decision memo. They are written from the
 * same view the console shows, and they follow the same rule: a statement is called a finding only
 * if the ledger's publication policy says so and the text it was checked against is the text that
 * is there. Text a person wrote is shown as theirs, and as not checked statement by statement.
 */

export const NOTICE = 'Swarm explores possible scenarios. It does not predict the future.';

const RESPONSIBLE_USE =
  'This memo supports a human decision and does not make one. Statements marked as findings are those a source passage directly supports; that shows where a statement came from, not that the source is true. Simulation results come from a model of fictional proxies, not from the real world.';

type StudioDoc = NonNullable<StudioView['document']>;

export interface Exportable {
  view: StudioView & { document: StudioDoc };
  project: { id: string; name: string };
  exportedAt: string;
}

// ---- Which statements may be shown as what

export interface MemoStatement {
  id: string;
  section: string;
  text: string;
  type: string;
  support: string;
  publication: string;
  /** Words that must accompany the statement wherever it is shown. */
  qualification: string | null;
  supporting: EvidenceLine[];
  contradicting: EvidenceLine[];
  reviewed: string;
  reviewNote: string | null;
}

export interface EvidenceLine {
  document: string;
  passage: string;
  quote: string | null;
}

const line = (ref: EvidenceRef): EvidenceLine => ({
  document: ref.documentName,
  passage: ref.passageId,
  quote: ref.quote,
});

function statementOf(claim: ClaimRecord, section: StudioSectionView): MemoStatement {
  return {
    id: claim.id,
    section: section.title,
    text: claim.text,
    type: STATEMENT_TYPE_LABELS[claim.statementType],
    support: SUPPORT_CLASS_LABELS[claim.supportClass],
    publication: PUBLICATION_STATUS_LABELS[claim.publication.status],
    qualification: claim.publication.qualification,
    supporting: claim.supporting.map(line),
    contradicting: claim.contradicting.map(line),
    reviewed: REVIEW_RESULT_LABELS[claim.review.result],
    reviewNote: claim.review.note,
  };
}

export interface Memo {
  title: string;
  question: string;
  status: { label: string; detail: string; approved: boolean };
  summary: { text: string; origin: string; byPerson: boolean };
  /** Directly supported by a source passage, or supported in part and shown with what it lacks. */
  findings: MemoStatement[];
  /** Statements shown with the evidence that goes against them. */
  against: MemoStatement[];
  conflicts: {
    id: string;
    topic: string;
    left: EvidenceLine;
    right: EvidenceLine;
    status: string;
  }[];
  simulated: MemoStatement[];
  hypotheses: MemoStatement[];
  unverified: MemoStatement[];
  assumptions: string[];
  /** What was left out of the lists above, and why, so that the absence is visible. */
  left: {
    notCurrent: { section: string; statements: number }[];
    withheld: number;
    rejected: number;
  };
  sections: {
    id: string;
    title: string;
    origin: string;
    byPerson: boolean;
    locked: boolean;
    checked: boolean;
    body: string;
  }[];
  limitations: string[];
  notes: { section: string; actor: string; at: string; text: string }[];
  record: {
    revision: number;
    contentHash: string;
    stale: boolean;
    approval: { actor: string; at: string; alsoEdited: boolean } | null;
    decisions: { action: string; actor: string; at: string; note: string | null }[];
    exportedAt: string;
  };
  notice: string;
  responsibleUse: string;
}

function statusOf(view: Exportable['view']): Memo['status'] {
  const doc = view.document;
  const state = doc.state;
  if (state === 'approved') {
    // An approval stands only for the text it was given on; nothing can change it while approved,
    // so a mismatch means something is wrong, and the memo says so instead of claiming approval.
    const current = doc.approval !== null && doc.approval.contentHash === contentHash(doc.sections);
    return current
      ? {
          label: 'APPROVED',
          detail: 'A reviewer approved this text. The record at the end says who and when.',
          approved: true,
        }
      : {
          label: 'APPROVAL NOT CURRENT',
          detail: 'The text no longer matches what was approved. Do not rely on the approval.',
          approved: false,
        };
  }
  return {
    label: state === 'in-review' ? 'IN REVIEW: NOT APPROVED' : 'DRAFT: NOT APPROVED',
    detail:
      state === 'in-review'
        ? 'A reviewer has not decided yet.'
        : `This report is ${STUDIO_STATE_LABELS[state].toLowerCase()}. Nobody has approved it.`,
    approved: false,
  };
}

/** The memo as data. Pure: the HTML and the Markdown are drawn from it, so they cannot disagree. */
export function buildMemo(input: Exportable): Memo {
  const { view, exportedAt } = input;
  const doc = view.document;
  const memo: Memo = {
    title: view.report?.title ?? input.project.name,
    question: view.report?.question ?? '',
    status: statusOf(view),
    summary: { text: '', origin: '', byPerson: false },
    findings: [],
    against: [],
    conflicts: view.conflicts.map((conflict) => ({
      id: conflict.id,
      topic: conflict.topic,
      left: line(conflict.left),
      right: line(conflict.right),
      status: conflict.status === 'confirmed' ? 'Confirmed conflict' : 'Possible conflict',
    })),
    simulated: [],
    hypotheses: [],
    unverified: [],
    assumptions: view.assumptions.map((assumption) => assumption.statement),
    left: { notCurrent: [], withheld: 0, rejected: 0 },
    sections: [],
    limitations: [],
    notes: [],
    record: {
      revision: doc.revision,
      contentHash: contentHash(doc.sections),
      stale: view.stale,
      approval: doc.approval
        ? { actor: doc.approval.actor, at: doc.approval.at, alsoEdited: doc.approval.alsoEdited }
        : null,
      decisions: doc.decisions.map((decision) => ({
        action: DECISION_LABELS[decision.action],
        actor: decision.actor,
        at: decision.at,
        note: decision.note,
      })),
      exportedAt,
    },
    notice: NOTICE,
    responsibleUse: RESPONSIBLE_USE,
  };

  for (const section of doc.sections) {
    const byPerson = section.origin !== 'generated';
    memo.sections.push({
      id: section.id,
      title: section.title,
      origin: SECTION_ORIGIN_LABELS[section.origin],
      byPerson,
      locked: section.locked !== null,
      checked: section.statementsCurrent,
      body: section.body,
    });
    if (section.kind === 'summary') {
      memo.summary = {
        text: section.body,
        origin: SECTION_ORIGIN_LABELS[section.origin],
        byPerson,
      };
    }
    if (section.kind === 'limitations') {
      memo.limitations = section.body.split('\n').filter((entry) => entry.trim());
    }
    for (const note of section.notes) {
      memo.notes.push({ section: section.title, actor: note.actor, at: note.at, text: note.text });
    }
    if (section.statements.length === 0) continue;
    if (!section.statementsCurrent) {
      // The statements describe an earlier text. They are not shown as describing this one.
      memo.left.notCurrent.push({ section: section.title, statements: section.statements.length });
      continue;
    }
    for (const claim of section.statements) {
      const statement = statementOf(claim, section);
      if (claim.review.result === 'rejected') {
        memo.left.rejected += 1;
        continue;
      }
      switch (claim.publication.status) {
        case 'finding':
        case 'qualified':
          memo.findings.push(statement);
          break;
        case 'contradiction-shown':
          memo.against.push(statement);
          break;
        case 'labelled-simulation':
          memo.simulated.push(statement);
          break;
        case 'labelled-hypothesis':
          memo.hypotheses.push(statement);
          break;
        case 'labelled-unverified':
          memo.unverified.push(statement);
          break;
        case 'input':
          memo.assumptions.push(claim.text);
          break;
        case 'withheld':
          memo.left.withheld += 1;
          break;
      }
    }
  }
  return memo;
}

// ---- HTML: the printable memo

const esc = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const paragraphs = (value: string): string =>
  value
    .split(/\n{2,}/u)
    .filter((part) => part.trim())
    .map((part) => `<p>${esc(part.trim()).replaceAll('\n', '<br>')}</p>`)
    .join('');

function evidenceHtml(label: string, lines: EvidenceLine[]): string {
  return lines
    .map(
      (entry) =>
        `<li>${esc(label)} ${esc(entry.document)}, ${esc(entry.passage)}${entry.quote ? `: <q>${esc(entry.quote)}</q>` : ''}</li>`,
    )
    .join('');
}

function statementsHtml(statements: MemoStatement[], empty: string): string {
  if (statements.length === 0) return `<p class="none">${esc(empty)}</p>`;
  return `<ul class="statements">${statements
    .map(
      (statement) =>
        `<li><p><span class="id">${esc(statement.id)}</span> ${esc(statement.text)}</p>` +
        `<p class="meta">${esc(statement.type)}; ${esc(statement.support)}; ${esc(statement.publication)}; ${esc(statement.reviewed)}. In: ${esc(statement.section)}.</p>` +
        (statement.qualification
          ? `<p class="qualification"><strong>Must be read with:</strong> ${esc(statement.qualification)}</p>`
          : '') +
        (statement.reviewNote
          ? `<p class="meta">Reviewer note: ${esc(statement.reviewNote)}</p>`
          : '') +
        (statement.supporting.length || statement.contradicting.length
          ? `<ul class="evidence">${evidenceHtml('Supported by', statement.supporting)}${evidenceHtml('Contradicted by', statement.contradicting)}</ul>`
          : '') +
        '</li>',
    )
    .join('')}</ul>`;
}

const STYLE = `
  :root { color-scheme: light; }
  body { margin: 0; background: #fff; color: #111; font: 11pt/1.5 'Segoe UI', Arial, sans-serif; }
  main { max-width: 46rem; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
  h1 { font-size: 1.7rem; line-height: 1.2; margin: 0 0 .25rem; }
  h2 { font-size: 1.2rem; margin: 2rem 0 .5rem; padding-bottom: .2rem; border-bottom: 2px solid #111; }
  h3 { font-size: 1rem; margin: 1.25rem 0 .25rem; }
  .notice { font-style: italic; margin: 0 0 1rem; }
  .status { border: 3px solid #111; padding: .6rem .8rem; margin: 1rem 0; }
  .status strong { display: block; font-size: 1.1rem; letter-spacing: .04em; }
  .status.open { border-style: dashed; }
  .meta { font-size: .85rem; color: #333; margin: .1rem 0; }
  .none { color: #333; font-style: italic; }
  .id { font-weight: 700; }
  .qualification { border-left: 4px solid #111; padding-left: .6rem; margin: .3rem 0; }
  ul { padding-left: 1.2rem; }
  li { margin: .5rem 0; }
  .evidence { font-size: .85rem; margin: .2rem 0 0; }
  q { font-style: italic; }
  .hash { font-family: Consolas, monospace; word-break: break-all; font-size: .8rem; }
  .by-person { border-left: 4px double #111; padding-left: .6rem; }
  footer { margin-top: 2.5rem; border-top: 1px solid #111; padding-top: .6rem; font-size: .85rem; }
  .print-hint { font-size: .85rem; border: 1px solid #333; padding: .4rem .6rem; }
  @media print { .print-hint { display: none; } main { padding: 0; max-width: none; } h2 { break-after: avoid; } li { break-inside: avoid; } }
  @page { margin: 18mm; }
`;

/**
 * The memo as a page to print. One file, no script and no external resource, and every piece of text
 * in it is escaped: the page is served with a policy that allows nothing else, and does not rely on
 * it. A status that is not APPROVED is stated at the top and in a dashed border, so a printout of a
 * draft cannot be taken for a decision.
 */
export function memoHtml(memo: Memo): string {
  const record = memo.record;
  const body = [
    `<p class="print-hint">To print this memo or save it as a PDF, use your browser's Print command (Ctrl+P).</p>`,
    `<h1>${esc(memo.title)}</h1>`,
    `<p class="notice">${esc(memo.notice)}</p>`,
    `<div class="status${memo.status.approved ? '' : ' open'}" role="note"><strong>${esc(memo.status.label)}</strong>${esc(memo.status.detail)}${record.stale ? ' The generated report this was made from has since been replaced.' : ''}</div>`,
    `<h2>Decision question</h2>${paragraphs(memo.question)}`,
    `<h2>Summary</h2>` +
      `<p class="meta">${esc(memo.summary.origin)}${memo.summary.byPerson ? '. Written by a person; not checked statement by statement.' : ''}</p>` +
      `<div${memo.summary.byPerson ? ' class="by-person"' : ''}>${paragraphs(memo.summary.text)}</div>`,
    `<h2>What the sources support</h2>` +
      statementsHtml(
        memo.findings,
        'No statement in this report is directly supported by a source passage. Do not treat anything below as established by the sources.',
      ),
    `<h2>Evidence against</h2>` +
      statementsHtml(memo.against, 'No statement is shown with contradicting evidence.') +
      (memo.conflicts.length
        ? `<h3>Open conflicts between sources</h3><ul>${memo.conflicts
            .map(
              (conflict) =>
                `<li><strong>${esc(conflict.id)}</strong> ${esc(conflict.status)}: ${esc(conflict.topic)}<ul class="evidence"><li>${esc(conflict.left.document)}, ${esc(conflict.left.passage)}${conflict.left.quote ? `: <q>${esc(conflict.left.quote)}</q>` : ''}</li><li>${esc(conflict.right.document)}, ${esc(conflict.right.passage)}${conflict.right.quote ? `: <q>${esc(conflict.right.quote)}</q>` : ''}</li></ul></li>`,
            )
            .join('')}</ul>`
        : '<p class="none">No open conflicts between sources were detected. That is not proof the sources agree.</p>'),
    `<h2>Simulation results (not real-world evidence)</h2>` +
      statementsHtml(memo.simulated, 'No simulation result is listed.'),
    `<h2>Hypotheses and statements that are not verified</h2>` +
      statementsHtml([...memo.hypotheses, ...memo.unverified], 'None.'),
    `<h2>Assumptions this analysis rests on</h2>` +
      (memo.assumptions.length
        ? `<ul>${memo.assumptions.map((assumption) => `<li>${esc(assumption)}</li>`).join('')}</ul>`
        : '<p class="none">None are listed.</p>'),
    memo.left.notCurrent.length || memo.left.withheld || memo.left.rejected
      ? `<h2>Left out of the lists above</h2><ul>${[
          ...memo.left.notCurrent.map(
            (entry) =>
              `<li>${esc(entry.section)}: its text was changed after its ${entry.statements} statement(s) were checked, so they are not listed as findings.</li>`,
          ),
          memo.left.withheld
            ? `<li>${memo.left.withheld} statement(s) were withheld by the publication policy.</li>`
            : '',
          memo.left.rejected
            ? `<li>${memo.left.rejected} statement(s) were rejected by a reviewer.</li>`
            : '',
        ].join('')}</ul>`
      : '',
    `<h2>The report as written</h2>` +
      memo.sections
        .map(
          (section) =>
            `<h3>${esc(section.title)}</h3><p class="meta">${esc(section.origin)}${section.locked ? '; locked' : ''}${section.byPerson ? '; not checked statement by statement' : ''}</p><div${section.byPerson ? ' class="by-person"' : ''}>${paragraphs(section.body)}</div>`,
        )
        .join(''),
    memo.notes.length
      ? `<h2>Reviewer notes</h2><ul>${memo.notes
          .map(
            (note) =>
              `<li>${esc(note.section)}, ${esc(note.at)}, ${esc(note.actor)}: ${esc(note.text)}</li>`,
          )
          .join('')}</ul>`
      : '',
    `<h2>Record</h2><ul>` +
      `<li>Document revision ${record.revision}. Content hash (SHA-256): <span class="hash">${esc(record.contentHash)}</span></li>` +
      (record.approval
        ? `<li>Approved by ${esc(record.approval.actor)} at ${esc(record.approval.at)}.${record.approval.alsoEdited ? ' The approver also wrote part of this text.' : ''}</li>`
        : '<li>Not approved.</li>') +
      record.decisions
        .map(
          (decision) =>
            `<li>${esc(decision.action)}, ${esc(decision.at)}, ${esc(decision.actor)}${decision.note ? `: ${esc(decision.note)}` : ''}</li>`,
        )
        .join('') +
      `<li>Exported ${esc(record.exportedAt)}.</li></ul>`,
    `<footer><p>${esc(memo.responsibleUse)}</p></footer>`,
  ].join('\n');
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n<title>${esc(memo.title)}: decision memo</title>\n<style>${STYLE}</style>\n</head>\n<body>\n<main>\n${body}\n</main>\n</body>\n</html>\n`;
}

/** The policy served with the memo: nothing may load, run or frame, apart from its own inline style. */
export const MEMO_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// ---- Markdown

const md = markdownText;

function statementMarkdown(statement: MemoStatement): string[] {
  return [
    `- ${statement.id} [${md(statement.type)}; ${md(statement.support)}; ${md(statement.publication)}; ${md(statement.reviewed)}] ${md(statement.text)}`,
    ...(statement.qualification ? [`  - Must be read with: ${md(statement.qualification)}`] : []),
    ...(statement.reviewNote ? [`  - Reviewer note: ${md(statement.reviewNote)}`] : []),
    ...statement.supporting.map(
      (entry) =>
        `  - Supported by ${md(entry.document)}, ${entry.passage}${entry.quote ? `: ${md(entry.quote)}` : ''}`,
    ),
    ...statement.contradicting.map(
      (entry) =>
        `  - Contradicted by ${md(entry.document)}, ${entry.passage}${entry.quote ? `: ${md(entry.quote)}` : ''}`,
    ),
  ];
}

const listOrNone = (statements: MemoStatement[], none: string): string[] =>
  statements.length ? statements.flatMap(statementMarkdown) : [none];

/** The whole document: every section as it stands, with its statements, notes and the record. */
export function studioMarkdown(input: Exportable): string {
  const { view } = input;
  const doc = view.document;
  const memo = buildMemo(input);
  return [
    `# ${md(memo.title)}`,
    '',
    `> ${NOTICE}`,
    '',
    `**Status:** ${memo.status.label}. ${md(memo.status.detail)}${view.stale ? ' The generated report this was made from has since been replaced.' : ''}`,
    '',
    `**Decision question:** ${md(memo.question)}`,
    '',
    ...doc.sections.flatMap((section) => {
      const memoSection = memo.sections.find((entry) => entry.id === section.id)!;
      return [
        `## ${md(section.title)}`,
        '',
        `*${memoSection.origin}${section.locked ? '; locked' : ''}${memoSection.byPerson ? '; not checked statement by statement' : ''}; version ${section.version}.*`,
        '',
        ...section.body.split('\n').map((entry) => md(entry)),
        '',
        ...(section.kind === 'chapter'
          ? [
              section.statementsCurrent
                ? '### Statements checked against this text'
                : '### Statements checked against an earlier text of this section (they do not describe the text above)',
              '',
              ...(section.statements.length
                ? section.statements.flatMap((claim) =>
                    statementMarkdown(statementOf(claim, section)),
                  )
                : ['None.']),
              '',
            ]
          : []),
        ...(section.notes.length
          ? [
              '### Reviewer notes',
              '',
              ...section.notes.map((note) => `- ${note.at}, ${md(note.actor)}: ${md(note.text)}`),
              '',
            ]
          : []),
      ];
    }),
    '## What the sources support',
    '',
    ...listOrNone(
      memo.findings,
      'No statement in this report is directly supported by a source passage.',
    ),
    '',
    '## Evidence against',
    '',
    ...listOrNone(memo.against, 'No statement is shown with contradicting evidence.'),
    ...memo.conflicts.flatMap((conflict) => [
      `- ${conflict.id} [${conflict.status}] ${md(conflict.topic)}`,
      `  - ${md(conflict.left.document)}, ${conflict.left.passage}${conflict.left.quote ? `: ${md(conflict.left.quote)}` : ''}`,
      `  - ${md(conflict.right.document)}, ${conflict.right.passage}${conflict.right.quote ? `: ${md(conflict.right.quote)}` : ''}`,
    ]),
    '',
    '## Simulation results (not real-world evidence)',
    '',
    ...listOrNone(memo.simulated, 'None.'),
    '',
    '## Hypotheses and statements that are not verified',
    '',
    ...listOrNone([...memo.hypotheses, ...memo.unverified], 'None.'),
    '',
    '## Assumptions',
    '',
    ...(memo.assumptions.length ? memo.assumptions.map((entry) => `- ${md(entry)}`) : ['None.']),
    '',
    '## Record',
    '',
    `- Document revision ${memo.record.revision}; content hash (SHA-256) ${memo.record.contentHash}.`,
    memo.record.approval
      ? `- Approved by ${md(memo.record.approval.actor)} at ${memo.record.approval.at}.${memo.record.approval.alsoEdited ? ' The approver also wrote part of this text.' : ''}`
      : '- Not approved.',
    ...memo.record.decisions.map(
      (decision) =>
        `- ${md(decision.action)}, ${decision.at}, ${md(decision.actor)}${decision.note ? `: ${md(decision.note)}` : ''}`,
    ),
    `- Exported ${memo.record.exportedAt}.`,
    '',
    `> ${md(RESPONSIBLE_USE)}`,
    '',
  ].join('\n');
}

// ---- JSON

/** The document with its evidence, for another tool to read. Versions and notes are included whole. */
export function studioJson(input: Exportable): unknown {
  const { view } = input;
  const memo = buildMemo(input);
  return {
    format: 'swarm-report-studio',
    schemaVersion: 1,
    exportedAt: input.exportedAt,
    notice: NOTICE,
    project: { id: input.project.id, name: input.project.name },
    status: memo.status,
    stale: view.stale,
    document: view.document,
    evidence: { passages: view.passages, memories: view.memories },
    assumptions: view.assumptions,
    openConflicts: view.conflicts,
    record: memo.record,
    responsibleUse: RESPONSIBLE_USE,
  };
}
