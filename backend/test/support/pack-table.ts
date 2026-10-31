import { createHash } from 'node:crypto';
import { EXAMPLE_SCENARIOS } from '../../../shared/example-scenarios.js';
import type { Stakeholder } from '../../../shared/stakeholders.js';
import { chunkDocuments } from '../../src/knowledge/retrieval.js';
import { parseScenario } from '../../src/scenario/parse.js';
import { discoverStakeholders } from '../../src/stakeholders/discover.js';

/**
 * What reading the text for roles finds on each of the worked examples, worked out by running the real
 * discovery with no model: the same scenario frame and passages a project makes, the same code. The
 * table in docs/stakeholders.md is held to this, so that a change to the reading, the examples or the
 * chunker that changes what is found shows up there instead of leaving the page wrong.
 *
 * To make the table again: `npx tsx backend/test/support/print-pack-table.ts`.
 */

export const PACK_TABLE_HEADER = [
  'Example',
  'Found (key / standard / background)',
  'Cite a quote',
  'Direction (wording / category / unclear)',
  'Key groups, and the others whose direction was read from the wording',
] as const;

const NOW = new Date('2026-03-01T09:00:00.000Z');

const names = (stakeholders: readonly Stakeholder[]): string =>
  stakeholders.length === 0
    ? 'none'
    : stakeholders
        .map((stakeholder) =>
          stakeholder.expectedImpact.origin === 'evidence'
            ? `${stakeholder.name} (${stakeholder.expectedImpact.direction})`
            : stakeholder.name,
        )
        .join(', ');

/** One row of cells for each example, in the order the picker shows them. */
export async function packTableRows(): Promise<string[][]> {
  const rows: string[][] = [];
  for (const pack of EXAMPLE_SCENARIOS) {
    const parsed = await parseScenario({
      question: pack.question,
      documents: pack.documents.map((document) => ({
        name: document.name,
        characters: document.content.length,
      })),
    });
    const passages = chunkDocuments(
      pack.documents.map((document, index) => ({
        id: `D${index + 1}`,
        name: document.name,
        content: document.content,
      })),
    ).map((chunk) => ({
      ...chunk,
      contentHash: createHash('sha256').update(chunk.text).digest('hex'),
    }));
    const set = await discoverStakeholders({
      project: { question: pack.question, graph: null },
      scenario: parsed.frame,
      passages,
      model: null,
      now: () => NOW,
    });
    const live = set.stakeholders.filter((stakeholder) => stakeholder.status !== 'removed');
    const count = (priority: Stakeholder['priority']): number =>
      live.filter((stakeholder) => stakeholder.priority === priority).length;
    const wording = live.filter((stakeholder) => stakeholder.expectedImpact.origin === 'evidence');
    const unclear = live.filter(
      (stakeholder) => stakeholder.expectedImpact.direction === 'unclear',
    );
    const category = live.length - wording.length - unclear.length;
    const key = live.filter((stakeholder) => stakeholder.priority === 'key');
    const keyIds = new Set(key.map((stakeholder) => stakeholder.id));
    const others = wording.filter((stakeholder) => !keyIds.has(stakeholder.id));
    rows.push([
      `\`${pack.id}\``,
      `${live.length} (${count('key')} / ${count('standard')} / ${count('background')})`,
      `${live.filter((stakeholder) => stakeholder.evidence.length > 0).length} of ${live.length}`,
      `${wording.length} / ${category} / ${unclear.length}`,
      `Key: ${names(key)}. Others: ${names(others)}.`,
    ]);
  }
  return rows;
}

/** The table as markdown, the way the page prints it. */
export function packTableMarkdown(rows: readonly string[][]): string {
  const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
  return [
    line(PACK_TABLE_HEADER),
    line(PACK_TABLE_HEADER.map(() => '---')),
    ...rows.map(line),
  ].join('\n');
}
