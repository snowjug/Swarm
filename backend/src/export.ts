import {
  CLAIM_KIND_LABELS,
  SUPPORT_VERDICTS,
  SUPPORT_VERDICT_LABELS,
  type GroundingReview,
} from '../../shared/grounding.js';
import {
  CONTRADICTION_STATUS_LABELS,
  PUBLICATION_STATUS_LABELS,
  REVIEW_RESULT_LABELS,
  STATEMENT_TYPE_LABELS,
  SUPPORT_CLASS_LABELS,
  isOpenConflict,
  type Ledger,
} from '../../shared/evidence.js';
import type { BranchChange } from '../../shared/guided.js';
import type { EvidenceChunk, ProjectDetail } from '../../shared/types.js';
import { AppError } from './errors.js';

function text(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\\`*_[\]{}()#+.!|]/gu, '\\$&');
}

function describeChange(change: BranchChange): string {
  if (change.kind === 'intervention') {
    return change.to
      ? `- Intervention at round ${change.to.round}: ${text(change.to.label)} (assumed stance ${change.to.stance}, strength ${change.to.strength})`
      : '- The scheduled intervention was removed';
  }
  return `- ${change.agentId}: ${change.field} ${text(change.from.toFixed(2))} to ${text(change.to.toFixed(2))}`;
}

function groundingSection(grounding: GroundingReview | undefined): string[] {
  if (!grounding) return [];
  const { counts } = grounding;
  return [
    '## Grounding review',
    '',
    `Checks run: ${grounding.method === 'deterministic+model' ? 'quote, word-overlap and figure checks, plus an independent model check that had to quote real text' : 'quote, word-overlap and figure checks only (the independent model check did not run)'}.`,
    `Statements checked: ${grounding.claims.length}. ${SUPPORT_VERDICTS.map(
      (verdict) => `${SUPPORT_VERDICT_LABELS[verdict]}: ${counts[verdict]}`,
    ).join('; ')}.`,
    '',
    ...grounding.claims.flatMap((claim) => [
      `- ${claim.id} (${text(claim.section)}) [${CLAIM_KIND_LABELS[claim.kind]}; ${SUPPORT_VERDICT_LABELS[claim.verdict]}] ${text(claim.text)}`,
      `  - Why: ${text(claim.reason)}`,
      ...(claim.sourceIds.length ? [`  - Sources: ${claim.sourceIds.join(', ')}`] : []),
      ...(claim.memoryIds.length ? [`  - Synthetic memories: ${claim.memoryIds.join(', ')}`] : []),
      ...(claim.quote ? [`  - Quote: ${text(claim.quote)}`] : []),
    ]),
    '',
    ...(grounding.unverifiedFigures.length
      ? [
          'Figures in chapter text that match neither the cited material nor the recorded simulation (possible invented statistics):',
          '',
          ...grounding.unverifiedFigures.map(
            (entry) => `- ${text(entry.section)}: ${entry.figures.map(text).join(', ')}`,
          ),
          '',
        ]
      : []),
    ...grounding.notes.map((note) => `> ${text(note)}`),
    '',
  ];
}

function ledgerSection(ledger: Ledger | null): string[] {
  if (!ledger) return [];
  const { sufficiency } = ledger;
  const open = ledger.contradictions.filter((conflict) => isOpenConflict(conflict.status));
  const share =
    sufficiency.directlySupportedShare === null
      ? ''
      : ` ${Math.round(sufficiency.directlySupportedShare * 100)}% of the statements that rest on a source are directly supported.`;
  return [
    '## Evidence ledger',
    '',
    '> The chapters above were written by a model. This ledger records how well the sources support each statement in them, and where two sources disagree. A statement is a finding only when a source passage directly supports it.',
    '',
    `Evidence sufficiency: **${sufficiency.level}**.${share}`,
    ...sufficiency.reasons.map((reason) => `- ${text(reason)}`),
    '',
    `### Conflicts between sources (${open.length} open of ${ledger.contradictions.length})`,
    '',
    ...(ledger.contradictions.length
      ? ledger.contradictions.flatMap((conflict) => [
          `- ${conflict.id} [${CONTRADICTION_STATUS_LABELS[conflict.status]}] ${text(conflict.topic)}`,
          `  - ${text(conflict.left.documentName)}, ${conflict.left.passageId}${conflict.leftValue ? ` (${text(conflict.leftValue)})` : ''}: ${text(conflict.left.quote ?? '')}`,
          `  - ${text(conflict.right.documentName)}, ${conflict.right.passageId}${conflict.rightValue ? ` (${text(conflict.rightValue)})` : ''}: ${text(conflict.right.quote ?? '')}`,
          ...(conflict.note ? [`  - Reviewer note: ${text(conflict.note)}`] : []),
        ])
      : ['No conflicts between sources were detected. This is not proof that the sources agree.']),
    '',
    `### Statements (${ledger.claims.length})`,
    '',
    ...ledger.claims.flatMap((claim) => [
      `- ${claim.id} [${STATEMENT_TYPE_LABELS[claim.statementType]}; ${SUPPORT_CLASS_LABELS[claim.supportClass]}; ${PUBLICATION_STATUS_LABELS[claim.publication.status]}; ${REVIEW_RESULT_LABELS[claim.review.result]}] ${text(claim.text)}`,
      ...(claim.publication.qualification
        ? [`  - Must be shown with: ${text(claim.publication.qualification)}`]
        : []),
      ...claim.supporting.map(
        (ref) =>
          `  - Supported by ${text(ref.documentName)}, ${ref.passageId}, characters ${ref.start + 1}-${ref.end}${ref.quote ? `: ${text(ref.quote)}` : ''}`,
      ),
      ...claim.contradicting.map(
        (ref) =>
          `  - Contradicted by ${text(ref.documentName)}, ${ref.passageId}${ref.quote ? `: ${text(ref.quote)}` : ''}`,
      ),
      ...(claim.review.note ? [`  - Reviewer note: ${text(claim.review.note)}`] : []),
    ]),
    '',
  ];
}

function lineage(project: ProjectDetail): string[] {
  const branch = project.console?.branch;
  if (!branch) return [];
  return [
    '## Scenario lineage',
    '',
    `Branched from ${text(branch.parentName)} (${branch.parentId}) after round ${branch.fromRound}. Rounds 1-${branch.fromRound} are inherited unchanged from that run; later rounds were simulated under these declared changes:`,
    '',
    ...(branch.changes.length
      ? branch.changes.map(describeChange)
      : ['- No assumption changes were declared.']),
    '',
  ];
}

export function markdownExport(
  project: ProjectDetail,
  chunks: EvidenceChunk[],
  ledger: Ledger | null = null,
): string {
  const report = project.report;
  if (!report)
    throw new AppError(409, 'REPORT_NOT_READY', 'This experiment has no completed report yet.');
  const usedSources = new Set(report.sections.flatMap((section) => section.sourceIds));
  const usedMemories = new Set(report.sections.flatMap((section) => section.memoryIds || []));
  const usedInterviews = new Set(report.sections.flatMap((section) => section.interviewIds || []));
  return [
    `# ${text(report.title)}`,
    '',
    `Engine: ${project.mode === 'local' ? 'Local rules-based (not AI)' : 'Model-assisted'}`,
    `Project: ${project.id}`,
    `Created: ${project.createdAt}`,
    `Seed: ${project.settings.seed}`,
    '',
    '> Synthetic scenario, not a calibrated forecast.',
    '',
    ...lineage(project),
    text(report.executiveSummary),
    '',
    ...report.sections.flatMap((section) => [
      `## ${text(section.title)}`,
      '',
      text(section.body),
      '',
      section.sourceIds.length ? `Sources: ${section.sourceIds.join(', ')}` : '',
      section.memoryIds?.length ? `Synthetic memories: ${section.memoryIds.join(', ')}` : '',
      section.interviewIds?.length
        ? `Fictional interviews: ${section.interviewIds.join(', ')}`
        : '',
      '',
    ]),
    ...(usedMemories.size
      ? [
          '## Synthetic simulation memories (not real-world sources)',
          '',
          ...(project.console?.memories || [])
            .filter((memory) => usedMemories.has(memory.id))
            .flatMap((memory) => [
              `### ${memory.id}: ${memory.platform}, round ${memory.round}`,
              '',
              text(memory.text),
              '',
            ]),
        ]
      : []),
    ...(usedInterviews.size
      ? [
          '## Generated fictional interviews (not real-person statements)',
          '',
          ...(project.console?.interviews || [])
            .filter((interview) => usedInterviews.has(interview.id))
            .flatMap((interview) => [
              `### ${interview.id}: ${interview.agentId}`,
              '',
              text(interview.question),
              '',
              text(interview.answer),
              '',
            ]),
        ]
      : []),
    ...groundingSection(report.grounding),
    ...ledgerSection(ledger),
    '## Limitations',
    '',
    ...report.limitations.map((limitation) => `- ${text(limitation)}`),
    '',
    '## Source passages (untrusted input)',
    '',
    ...chunks
      .filter((chunk) => usedSources.has(chunk.id))
      .flatMap((chunk) => [
        `### ${chunk.id}: ${text(chunk.documentName)} (${chunk.start}-${chunk.end})`,
        '',
        text(chunk.text),
        '',
      ]),
    '---',
    'Swarm Lab | AGPL-3.0-only | Independent implementation inspired by MiroFish.',
    '',
  ].join('\n');
}
