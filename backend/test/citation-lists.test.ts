import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { trimmedIds } from '../../shared/citations.js';
import {
  guidedGraphSchema,
  interviewSchema,
  reportChapterSchema,
  reportPlanSchema,
} from '../src/guided/schemas.js';
import { actorDecisionSchema, extractedGraphSchema } from '../src/models/schemas.js';

// Captured from a real model (gpt-4.1-mini on Azure): the chapter's memoryIds exceeded the cap of
// eight and three corrective retries did not stop it, so the whole report stage failed.
describe('trimmedIds', () => {
  const ids = trimmedIds(z.string(), 3);

  it('removes duplicates, keeps the first entries in order, and caps the list', () => {
    expect(ids.parse(['a', 'b', 'a', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c']);
    expect(ids.parse([])).toEqual([]);
  });

  it('still bounds how much is read at all, and enforces a minimum when asked', () => {
    expect(() => ids.parse(Array.from({ length: 25 }, (_, i) => `m${i}`))).toThrow();
    const required = trimmedIds(z.string(), 3, { min: 1 });
    expect(() => required.parse([])).toThrow();
    expect(required.parse(['x'])).toEqual(['x']);
  });

  it('applies the element rule before trimming, so a malformed id is still rejected', () => {
    const passages = trimmedIds(z.string().regex(/^S[1-9]\d*$/u), 2);
    expect(() => passages.parse(['S1', 'source-two'])).toThrow();
    expect(passages.parse(['S1', 'S2', 'S3'])).toEqual(['S1', 'S2']);
  });
});

describe('model-facing citation lists are trimmed rather than fatal', () => {
  const many = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
  const body = 'A chapter body that is long enough to satisfy the minimum length rule.';
  const claim = {
    text: 'The proposal changes the opening hours for the library.',
    kind: 'analytical-conclusion',
    sourceIds: [],
    memoryIds: [],
    quote: null,
  };

  it('keeps a chapter whose citation lists overshoot, with at most the documented number', () => {
    const chapter = reportChapterSchema.parse({
      body,
      sourceIds: many('S', 9),
      memoryIds: many('M-', 15),
      interviewIds: many('I', 5),
      claims: [claim],
    });
    expect(chapter.sourceIds).toHaveLength(5);
    expect(chapter.memoryIds).toHaveLength(8);
    expect(chapter.interviewIds).toHaveLength(2);
  });

  it('keeps an interview and a report plan whose lists overshoot', () => {
    const interview = interviewSchema.parse({
      answer: 'A fictional answer with enough characters to pass.',
      sourceIds: many('S', 8),
      memoryIds: many('M-', 12),
    });
    expect(interview.sourceIds).toHaveLength(5);
    expect(interview.memoryIds).toHaveLength(8);
    expect(
      interviewSchema.parse({ answer: 'A fictional answer with enough characters.', sourceIds: [] })
        .memoryIds,
    ).toEqual([]);
    const plan = reportPlanSchema.parse({
      title: 'A plan title',
      sections: ['One', 'Two', 'Three'],
      evidenceQueries: ['query one'],
      interviewAgentIds: ['agent-1', 'agent-2', 'agent-3'],
      interviewQuestion: 'What changed during the scenario?',
    });
    expect(plan.interviewAgentIds).toEqual(['agent-1', 'agent-2']);
  });

  it('keeps an actor decision that names too many peers or passages', () => {
    const decision = actorDecisionSchema.parse({
      opinion: 0.2,
      type: 'reply',
      content: 'A short reply to what I read.',
      peerIds: many('agent-', 8),
      sourceIds: many('S', 7),
      rationale: 'It matches what I saw.',
      confidence: 0.6,
    });
    expect(decision.peerIds).toHaveLength(5);
    expect(decision.sourceIds).toHaveLength(5);
  });

  it('keeps graph nodes, edges and personas that cite more than five passages', () => {
    const node = (id: string) => ({
      id,
      label: 'A label',
      kind: 'topic',
      summary: 'A summary that is long enough.',
      weight: 0.5,
      sourceIds: many('S', 7),
      quote: 'An exact excerpt of the passage.',
    });
    const graph = extractedGraphSchema.parse({
      nodes: [node('n1'), node('n2')],
      edges: [
        { source: 'n1', target: 'n2', label: 'relates', weight: 0.5, sourceIds: many('S', 7) },
      ],
    });
    expect(graph.nodes[0]?.sourceIds).toHaveLength(5);
    expect(graph.edges[0]?.sourceIds).toHaveLength(5);
    expect(() =>
      guidedGraphSchema.parse({
        nodes: [
          { ...node('n1'), entityType: 'Org', sourceIds: [] },
          { ...node('n2'), entityType: 'Org' },
        ],
        edges: [],
      }),
    ).toThrow();
  });
});
