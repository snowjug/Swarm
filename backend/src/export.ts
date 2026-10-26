import type { EvidenceChunk, ProjectDetail } from '../../shared/types.js';
import { AppError } from './errors.js';

function text(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\\`*_[\]{}()#+.!|]/gu, '\\$&');
}

export function markdownExport(project: ProjectDetail, chunks: EvidenceChunk[]): string {
  const report = project.report;
  if (!report)
    throw new AppError(409, 'REPORT_NOT_READY', 'This experiment has no completed report yet.');
  const usedSources = new Set(report.sections.flatMap((section) => section.sourceIds));
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
    text(report.executiveSummary),
    '',
    ...report.sections.flatMap((section) => [
      `## ${text(section.title)}`,
      '',
      text(section.body),
      '',
      section.sourceIds.length ? `Sources: ${section.sourceIds.join(', ')}` : '',
      '',
    ]),
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
