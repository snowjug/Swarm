import { describe, expect, it } from 'vitest';
import { critiqueSchema } from '../../shared/critique.js';
import {
  EVIDENCE_REF_LIMITS,
  MAX_EVIDENCE_QUOTE_CHARS,
  boundEvidenceRef,
  clipQuote,
  clipText,
  type ContradictionRecord,
  type EvidenceRef,
} from '../../shared/evidence.js';
import { evidenceRefSchema } from '../../shared/stakeholders.js';
import type { EvidenceChunk } from '../../shared/types.js';
import { proposedConstraintsSchema } from '../src/constraints/model.js';
import { draft } from '../src/critics/text.js';
import { reconcileConflicts } from '../src/grounding/contradictions.js';
import { findQuote } from '../src/grounding/text.js';
import { verifiedEvidence } from '../src/stakeholders/evidence.js';
import { ref } from './support/critic-world.js';

// A quotation is source text, and source text has no length. The live pilot's independent review failed with
// "critiques.1.evidence.1.quote: Too big: expected string to have <=600 characters" because one "sentence" of a
// source page was a markdown table row of several thousand characters. Everything that builds an evidence
// reference from a source clips it, with a visible ellipsis, to the limits the schemas enforce.

const TABLE_ROW = `| Teams Premium add-on per user per month $12 | ${'webinars | meeting protection | '.repeat(220)}|`;

describe('clipText and clipQuote', () => {
  it('leave text that fits exactly as it is, including its whitespace', () => {
    expect(clipText('a  b\n c', 10)).toBe('a  b\n c');
    expect(clipQuote('A short quote.')).toBe('A short quote.');
    const full = 'x'.repeat(MAX_EVIDENCE_QUOTE_CHARS);
    expect(clipQuote(full)).toBe(full);
  });

  it('cut a table row of 5,000 characters to the limit and say that something was cut', () => {
    expect(TABLE_ROW.length).toBeGreaterThan(5_000);
    const clipped = clipQuote(TABLE_ROW);
    expect(clipped.length).toBeLessThanOrEqual(MAX_EVIDENCE_QUOTE_CHARS);
    expect(clipped.endsWith('…')).toBe(true);
    // It is the start of the row, with its padding collapsed.
    expect(clipped.startsWith('| Teams Premium add-on per user per month $12 |')).toBe(true);
  });

  it('cut at a word when one is close, and in the middle of a long word when none is', () => {
    const words = clipText(`${'word '.repeat(200)}`, 50);
    expect(words).toMatch(/word…$/u);
    expect(words.length).toBeLessThanOrEqual(50);
    const unbroken = clipText('a'.repeat(5_000), 50);
    expect(unbroken).toBe(`${'a'.repeat(49)}…`);
  });

  it('never leaves half of a surrogate pair in front of the ellipsis', () => {
    const emoji = '😀'.repeat(400);
    const clipped = clipText(emoji, 51);
    expect(clipped.length).toBeLessThanOrEqual(51);
    expect(clipped.endsWith('…')).toBe(true);
    expect([...clipped.slice(0, -1)].every((character) => character === '😀')).toBe(true);
  });

  it('is idempotent: a clipped quote is not clipped again', () => {
    const once = clipQuote(TABLE_ROW);
    expect(clipQuote(once)).toBe(once);
  });

  it('keeps a clipped quote checkable: the verbatim check reads the ellipsis as an omission', () => {
    const passage = new Map([['p1', `Intro.\n\n${TABLE_ROW}\n\nOutro.`]]);
    expect(findQuote(clipQuote(TABLE_ROW), passage).found).toBe(true);
  });
});

describe('boundEvidenceRef', () => {
  it('returns the same object when every field fits: nothing is copied or changed', () => {
    const fine = ref('d1', 1);
    expect(boundEvidenceRef(fine)).toBe(fine);
    expect(boundEvidenceRef({ ...fine, quote: null })).toMatchObject({ quote: null });
  });

  it('clips every text field to the schema limit and leaves the rest alone', () => {
    const huge = (length: number) => `x${'y'.repeat(length)}`;
    const bound = boundEvidenceRef({
      passageId: huge(100),
      documentId: huge(300),
      documentName: huge(900),
      start: 12,
      end: 99,
      quote: TABLE_ROW,
      contentHash: huge(500),
      role: 'contradicts',
      conflictId: huge(400),
    });
    expect(bound.passageId.length).toBe(EVIDENCE_REF_LIMITS.passageId);
    expect(bound.documentId.length).toBe(EVIDENCE_REF_LIMITS.documentId);
    expect(bound.documentName.length).toBe(EVIDENCE_REF_LIMITS.documentName);
    expect(bound.quote?.length).toBeLessThanOrEqual(EVIDENCE_REF_LIMITS.quote);
    expect(bound.contentHash.length).toBe(EVIDENCE_REF_LIMITS.contentHash);
    expect(bound.conflictId?.length).toBe(EVIDENCE_REF_LIMITS.conflictId);
    expect([bound.start, bound.end, bound.role]).toEqual([12, 99, 'contradicts']);
    expect(evidenceRefSchema.safeParse(bound).success).toBe(true);
  });

  it('uses the numbers the schema enforces: a field at its limit passes, one more is refused', () => {
    const at = (field: keyof typeof EVIDENCE_REF_LIMITS, extra = 0): EvidenceRef => ({
      ...ref('d1', 1),
      conflictId: 'c1',
      [field]: 'z'.repeat(EVIDENCE_REF_LIMITS[field] + extra),
    });
    for (const field of Object.keys(EVIDENCE_REF_LIMITS) as (keyof typeof EVIDENCE_REF_LIMITS)[]) {
      expect(evidenceRefSchema.safeParse(at(field)).success, `${field} at its limit`).toBe(true);
      expect(evidenceRefSchema.safeParse(at(field, 1)).success, `${field} over`).toBe(false);
      expect(boundEvidenceRef(at(field, 1))[field]?.length, field).toBeLessThanOrEqual(
        EVIDENCE_REF_LIMITS[field],
      );
    }
  });
});

describe('every critic: a critique cannot carry a quotation that its schema refuses', () => {
  const NOW = '2026-10-29T10:00:00.000Z';

  it('draft() bounds the evidence of any rules critic, so a stored conflict with a whole table row cannot break the review', () => {
    const critique = draft(NOW, {
      id: 'evidence-open-conflicts',
      role: 'evidence',
      target: { kind: 'analysis', id: 'analysis-1' },
      severity: 'minor',
      objection: 'The source ledger holds conflicts between sources that nobody has resolved.',
      basis: ['Open conflicts in the ledger: 1.'],
      impact: 'If this stands, a figure in the result is contested.',
      evidence: [ref('d1', 1, { quote: TABLE_ROW }), ref('d2', 1, { quote: TABLE_ROW })],
    });
    for (const evidence of critique.evidence) {
      expect(evidence.quote?.length).toBeLessThanOrEqual(600);
      expect(evidence.quote?.endsWith('…')).toBe(true);
    }
    expect(critiqueSchema.safeParse(critique).success).toBe(true);
  });

  it('a reference that was fine is passed through unchanged', () => {
    const fine = ref('d1', 1);
    const critique = draft(NOW, {
      id: 'x',
      role: 'evidence',
      target: { kind: 'analysis', id: 'analysis-1' },
      severity: 'minor',
      objection: 'An objection of a few words that is long enough.',
      basis: ['One fact.'],
      impact: 'If this stands, something changes.',
      evidence: [fine],
    });
    expect(critique.evidence[0]).toBe(fine);
  });
});

describe('the conflicts a ledger holds', () => {
  const side = (document: string, quote: string): EvidenceRef => ref(document, 1, { quote });
  const conflict = (id: string, left: string, right: string): ContradictionRecord => ({
    id,
    kind: 'numeric',
    topic: 'a figure',
    left: side('d1', left),
    right: side('d2', right),
    leftValue: '12',
    rightValue: '7',
    confidence: 0.8,
    status: 'detected',
    note: null,
    detectedBy: 'deterministic-v1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('are not added again by a new scan because it clips the quote that an older one stored whole', () => {
    const held = [conflict('X1', TABLE_ROW, 'The price is $7 per user per month.')];
    const found = [conflict('X1', clipQuote(TABLE_ROW), 'The price is $7 per user per month.')];
    expect(reconcileConflicts(held, found)).toEqual(held);
  });

  it('still tells two different long rows apart, by what is kept of them', () => {
    const held = [conflict('X1', TABLE_ROW, 'The price is $7 per user per month.')];
    // Two rows that differ only after the limit are, as far as a quotation can say, one pair.
    const sameStart = `${TABLE_ROW.slice(0, -1)}| a cell added at the very end |`;
    expect(
      reconcileConflicts(held, [conflict('X2', sameStart, 'The price is $7 per user per month.')]),
    ).toHaveLength(1);
    // A row that differs within the part that is kept is another pair.
    const other = TABLE_ROW.replace('$12', '$99');
    expect(
      reconcileConflicts(held, [conflict('X2', other, 'The price is $7 per user per month.')]),
    ).toHaveLength(2);
  });
});

describe('a quote that a person or a model supplies for a stakeholder or a constraint', () => {
  const passage: EvidenceChunk = {
    id: 'p1',
    documentId: 'd1',
    documentName: 'Teams Premium.md',
    text: `Pricing\n\n${TABLE_ROW}\n\nNotes`,
    start: 0,
    end: 9_999,
  };

  it('is clipped with an ellipsis when it runs past the limit, and is still found in its passage', () => {
    const verified = verifiedEvidence(new Map([['p1', passage]]), 'p1', TABLE_ROW);
    expect(verified?.shortened).toBe(true);
    const quote = verified?.ref.quote ?? '';
    expect(quote.length).toBeLessThanOrEqual(600);
    expect(quote.endsWith('…')).toBe(true);
    expect(findQuote(quote, new Map([['p1', passage.text]])).found).toBe(true);
    expect(evidenceRefSchema.safeParse(verified?.ref).success).toBe(true);
  });

  it('is clipped in a model reply for constraints instead of making the whole reply unusable', () => {
    const reply = proposedConstraintsSchema.safeParse({
      constraints: [
        {
          category: 'budget',
          statement: 'The add-on costs twelve dollars per user per month.',
          evidence: [{ passageId: 'p1', quote: TABLE_ROW }],
          hardness: 'hard',
        },
      ],
    });
    expect(reply.success, JSON.stringify(reply.error?.issues)).toBe(true);
    const quote = reply.data?.constraints[0]?.evidence[0]?.quote ?? '';
    expect(quote.length).toBeLessThanOrEqual(600);
    expect(quote.endsWith('…')).toBe(true);
  });
});
