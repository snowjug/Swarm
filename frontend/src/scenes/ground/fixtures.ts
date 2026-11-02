/**
 * What the tests of the scene are given to read: a project with two documents, a graph and the engine at a
 * chosen step, the passages the server would list for it, and a ledger with one open conflict and one reviewed.
 */

import type { Ledger } from '../../../../shared/evidence';
import type { EvidenceChunk, ProjectDetail } from '../../../../shared/types';
import { conflictRecord, evidenceRef, ledgerFixture } from '../../test/ledger';
import { projectFixture } from '../../test/project';

export const SAMPLE = [
  'The council counted 412,000 one-way crossings in 2025. Residents may switch to the ferry if fares fall.',
  'The operator recorded 365,000 one-way crossings in 2025. Riders asked for evening services and cheaper tickets.',
];

/** A project with two documents, a graph, and the engine at the given step. */
export function project(
  step: 'pending' | 'queued' | 'running' | 'ready' | 'failed' | 'cancelled' = 'ready',
): ProjectDetail {
  const base = projectFixture();
  base.question = 'What could happen if the ferry fares fall by a third?';
  base.documents = SAMPLE.map((content, index) => ({
    id: `D${index + 1}`,
    name: `0${index + 1}-note.md`,
    content,
    provenance: { kind: 'sample', title: 'Illustrative' },
  }));
  base.graph = {
    method: 'lexical',
    notes: [
      'Local term-frequency extraction: nodes are topics, not verified people or organizations.',
    ],
    nodes: [
      {
        id: 'a',
        label: 'Crossings',
        kind: 'topic',
        summary: 'Frequent term.',
        weight: 1,
        sourceIds: ['S1', 'S2'],
        entityType: 'Topic',
      },
      {
        id: 'b',
        label: 'Fares',
        kind: 'topic',
        summary: 'Frequent term.',
        weight: 0.6,
        sourceIds: ['S1'],
        entityType: 'Topic',
      },
      {
        id: 'c',
        label: 'Riders',
        kind: 'topic',
        summary: 'Frequent term.',
        weight: 0.4,
        sourceIds: ['S2'],
        entityType: 'Topic',
      },
    ],
    edges: [
      { source: 'a', target: 'b', label: 'co-occurs with', weight: 0.7, sourceIds: ['S1'] },
      { source: 'a', target: 'c', label: 'co-occurs with', weight: 0.4, sourceIds: ['S2'] },
    ],
  };
  base.console!.steps.knowledge = step;
  base.console!.ontology = {
    entityTypes: [{ name: 'Topic', description: 'A frequent term.' }],
    relationshipTypes: [{ name: 'co-occurs with', description: 'Share a passage.' }],
  };
  if (step === 'pending') base.graph = null;
  return base;
}

export function passagesOf(source: ProjectDetail): EvidenceChunk[] {
  return source.documents.map((doc, index) => ({
    id: `S${index + 1}`,
    documentId: doc.id,
    documentName: doc.name,
    start: 0,
    end: doc.content.length,
    text: doc.content,
  }));
}

export const twoConflicts = (): Ledger =>
  ledgerFixture({
    claims: [],
    contradictions: [
      conflictRecord({
        id: 'X1',
        leftValue: '412,000',
        rightValue: '365,000',
        left: evidenceRef({
          passageId: 'S1',
          documentId: 'D1',
          documentName: '01-note.md',
          role: 'contradicts',
          quote: 'The council counted 412,000 one-way crossings',
        }),
        right: evidenceRef({
          passageId: 'S2',
          documentId: 'D2',
          documentName: '02-note.md',
          role: 'contradicts',
          quote: 'The operator recorded 365,000 one-way crossings',
        }),
      }),
      conflictRecord({
        id: 'X2',
        status: 'dismissed',
        note: 'Different years.',
        leftValue: '10',
        rightValue: '12',
      }),
    ],
  });
