import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios.js';
import { createProjectSchema } from '../../shared/types.js';
import { detectContradictions } from '../src/grounding/contradictions.js';
import { chunkDocuments } from '../src/knowledge/retrieval.js';
import { suspiciousPassageIds } from '../src/models/injection.js';

const copies = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'docs',
  'demo',
  'scenarios',
);

// Each pack is written so that two of its sources disagree on a figure, and nothing else in it looks
// like a disagreement. The detector reads the text alone: this pins that it finds those and no others.
const CONFLICTS: Record<string, string[]> = {
  'copilot-in-teams': [
    '02-admin-poll-summary.md (44%) | 05-partner-and-market-notes.md (16%)',
    '03-pilot-and-helpdesk-summary.md (41%) | 05-partner-and-market-notes.md (68%)',
  ],
  'regional-price-change': [
    '01-finops-brief.md (38%) | 04-sales-contracts-and-customers-note.md (55%)',
    '03-engineering-migration-note.md (9) | 05-notice-as-relayed-and-gaps.md (4)',
  ],
  'ecommerce-experience': ['01-customer-survey-summary.md (31%) | 03-analytics-summary.md (41%)'],
  'ai-first-support': ['02-ticket-and-handling-summary.md (34%) | 04-case-study-and-gaps.md (62%)'],
  'launch-pricing': [
    '02-funnel-and-pricing-test-summary.md (34%) | 03-sales-support-and-partner-notes.md (60%)',
  ],
};

function passagesOf(example: (typeof EXAMPLE_SCENARIOS)[number]) {
  const project = createProjectSchema.parse({
    name: example.title,
    question: example.question,
    documents: example.documents,
  });
  return chunkDocuments(
    project.documents.map(({ name, content }, index) => ({
      id: `doc-${index + 1}`,
      name,
      content,
    })),
  );
}

describe('the example packs against the evidence layer', () => {
  it('has a list of expected conflicts for every example and no other', () => {
    expect(Object.keys(CONFLICTS).sort()).toEqual(EXAMPLE_SCENARIOS.map(({ id }) => id).sort());
  });

  for (const example of EXAMPLE_SCENARIOS) {
    describe(example.id, () => {
      it('has exactly the source disagreements it was written with', () => {
        const found = detectContradictions(passagesOf(example), new Date('2026-01-01T00:00:00Z'))
          .map((conflict) =>
            [
              `${conflict.left.documentName} (${conflict.leftValue})`,
              `${conflict.right.documentName} (${conflict.rightValue})`,
            ]
              .sort()
              .join(' | '),
          )
          .sort();
        expect(found).toEqual([...(CONFLICTS[example.id] ?? [])].sort());
      });

      it('raises no instruction warning on any passage', () => {
        expect(suspiciousPassageIds(passagesOf(example))).toEqual([]);
      });

      it('has a readable copy of every document, and no copy of anything else', async () => {
        for (const document of example.documents) {
          await expect(document.content).toMatchFileSnapshot(
            join(copies, example.id, document.name),
          );
        }
        const folder = join(copies, example.id);
        expect(existsSync(folder)).toBe(true);
        const expected = [...example.documents.map(({ name }) => name), 'README.md'].sort();
        expect(readdirSync(folder).sort()).toEqual(expected);
      });
    });
  }
});
