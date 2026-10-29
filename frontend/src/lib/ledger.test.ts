import { describe, expect, it } from 'vitest';
import { PUBLICATION_STATUSES, SUPPORT_CLASSES, type ClaimRecord } from '../../../shared/evidence';
import type { ChatGroundingStatus } from '../../../shared/types';
import { claimRecord, conflictRecord, evidenceRef, ledgerFixture } from '../test/ledger';
import {
  CHAT_GROUNDING,
  NO_FILTER,
  PUBLICATION_TONE,
  SUPPORT_TONE,
  filterClaims,
  isFilterActive,
  locationText,
  openConflicts,
  publicationCounts,
  splitAtQuote,
  summarise,
  supportCounts,
} from './ledger';

const TONES = new Set(['good', 'caution', 'bad', 'neutral', 'info']);

describe('tones', () => {
  it('give every support class, publication status and chat status a known tone', () => {
    for (const support of SUPPORT_CLASSES) expect(TONES.has(SUPPORT_TONE[support])).toBe(true);
    for (const status of PUBLICATION_STATUSES)
      expect(TONES.has(PUBLICATION_TONE[status])).toBe(true);
    for (const status of ['cited', 'caveated', 'abstained', 'uncited'] as ChatGroundingStatus[]) {
      expect(TONES.has(CHAT_GROUNDING[status].tone)).toBe(true);
      expect(CHAT_GROUNDING[status].label.length).toBeGreaterThan(5);
      expect(CHAT_GROUNDING[status].meaning.length).toBeGreaterThan(20);
    }
  });

  it('never show an unsupported or contradicted statement as good', () => {
    expect(SUPPORT_TONE.unsupported).toBe('bad');
    expect(SUPPORT_TONE.contradicted).toBe('bad');
    expect(SUPPORT_TONE['not-checkable']).not.toBe('good');
    expect(PUBLICATION_TONE.withheld).toBe('bad');
    expect(CHAT_GROUNDING.uncited.tone).toBe('bad');
    expect(CHAT_GROUNDING.abstained.tone).not.toBe('good');
  });
});

describe('filterClaims', () => {
  const claims = ledgerFixture().claims;

  it('returns everything with no filter and nothing is marked active', () => {
    expect(filterClaims(claims, NO_FILTER)).toHaveLength(3);
    expect(isFilterActive(NO_FILTER)).toBe(false);
  });

  it('narrows by support class, by how the statement is shown, and by review state', () => {
    expect(filterClaims(claims, { ...NO_FILTER, support: 'unsupported' }).map((c) => c.id)).toEqual(
      ['C3'],
    );
    expect(
      filterClaims(claims, { ...NO_FILTER, publication: 'labelled-unverified' }).map((c) => c.id),
    ).toEqual(['C2']);
    expect(filterClaims(claims, { ...NO_FILTER, unreviewedOnly: true }).map((c) => c.id)).toEqual([
      'C1',
      'C2',
    ]);
    expect(isFilterActive({ ...NO_FILTER, unreviewedOnly: true })).toBe(true);
  });

  it('combines filters, and returns an empty list rather than failing', () => {
    expect(
      filterClaims(claims, {
        support: 'unsupported',
        publication: 'finding',
        unreviewedOnly: false,
      }),
    ).toEqual([]);
  });
});

describe('counts and summary', () => {
  it('counts only the classes and statuses that occur, in taxonomy order', () => {
    const claims = ledgerFixture().claims;
    expect(supportCounts(claims)).toEqual([
      { support: 'directly-supported', count: 1 },
      { support: 'unsupported', count: 1 },
      { support: 'not-checkable', count: 1 },
    ]);
    expect(publicationCounts(claims).map((entry) => entry.status)).toEqual([
      'finding',
      'labelled-hypothesis',
      'labelled-unverified',
    ]);
  });

  it('summarises findings, labelled statements, reviews and open conflicts', () => {
    const withheld: ClaimRecord = claimRecord({
      id: 'C4',
      publication: { status: 'withheld', qualification: null, reasons: [] },
    });
    const qualified: ClaimRecord = claimRecord({
      id: 'C5',
      publication: { status: 'qualified', qualification: 'Partly.', reasons: [] },
    });
    const ledger = ledgerFixture({
      claims: [...ledgerFixture().claims, withheld, qualified],
      contradictions: [
        conflictRecord({ id: 'X1', status: 'detected' }),
        conflictRecord({ id: 'X2', status: 'confirmed' }),
        conflictRecord({ id: 'X3', status: 'dismissed' }),
        conflictRecord({ id: 'X4', status: 'resolved' }),
      ],
    });
    expect(summarise(ledger)).toEqual({
      statements: 5,
      findings: 2,
      labelled: 2,
      withheld: 1,
      reviewed: 1,
      openConflicts: openConflicts(ledger.contradictions).length,
    });
    expect(openConflicts(ledger.contradictions).map((c) => c.id)).toEqual(['X1', 'X2']);
  });
});

describe('quotations', () => {
  it('splits a passage around the exact quotation', () => {
    expect(splitAtQuote('Before. The quote. After.', 'The quote.')).toEqual({
      before: 'Before. ',
      quote: 'The quote.',
      after: ' After.',
    });
  });

  it('returns null when there is no quotation or it is not in the passage', () => {
    expect(splitAtQuote('Some passage text here.', null)).toBeNull();
    expect(splitAtQuote('Some passage text here.', 'absent words')).toBeNull();
  });

  it('describes where a passage sits, counting characters from one', () => {
    expect(locationText(evidenceRef({ start: 0, end: 120 }))).toBe(
      'council-briefing.md, passage S1, characters 1 to 120',
    );
  });
});
