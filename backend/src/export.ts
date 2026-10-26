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
