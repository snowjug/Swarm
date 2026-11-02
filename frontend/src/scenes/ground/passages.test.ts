import { describe, expect, it } from 'vitest';
import type { EvidenceChunk } from '../../../../shared/types';
import {
  clipAroundQuote,
  comparePassageIds,
  excerptAround,
  findPassage,
  indexPassages,
  locateQuote,
  markWithin,
  passageNumber,
  placePassages,
  plainQuote,
  rangeText,
  segmentDocument,
  uniquePassageIds,
} from './passages';

const passage = (
  id: string,
  documentId: string,
  start: number,
  end: number,
  text = '',
): EvidenceChunk => ({
  id,
  documentId,
  documentName: `${documentId}.md`,
  start,
  end,
  text,
});

describe('passage ids', () => {
  it('are read as numbers, so S2 comes before S10', () => {
    expect(['S10', 'S2', 'S1'].sort(comparePassageIds)).toEqual(['S1', 'S2', 'S10']);
    expect(passageNumber('S12')).toBe(12);
    expect(uniquePassageIds(['S3', 'S1', 'S3', ' S2 '])).toEqual(['S1', 'S2', 'S3']);
  });

  it('are found whatever the case, and an unknown one is simply not found', () => {
    const index = indexPassages([passage('S1', 'D1', 0, 10)]);
    expect(findPassage(index, 's1')?.id).toBe('S1');
    expect(findPassage(index, 'S9')).toBeNull();
    expect(findPassage(null, 'S1')).toBeNull();
  });
});

describe('placePassages', () => {
  it('puts passages that overlap in different lanes, and those that do not in one', () => {
    const overlapping = placePassages(
      [passage('S1', 'D1', 0, 1200), passage('S2', 'D1', 1080, 1987)],
      1987,
    );
    expect(overlapping.lanes).toBe(2);
    expect(overlapping.items.map((item) => item.lane)).toEqual([0, 1]);

    const apart = placePassages([passage('S1', 'D1', 0, 100), passage('S2', 'D1', 100, 200)], 200);
    expect(apart.lanes).toBe(1);
    expect(apart.items[1]?.from).toBeCloseTo(0.5);
  });
});

describe('segmentDocument', () => {
  const content = 'a'.repeat(30) + 'b'.repeat(10) + 'c'.repeat(30);

  it('splits a document where passages begin and end, and says which passages each stretch is in', () => {
    const segments = segmentDocument(content, [
      { id: 'S1', start: 0, end: 40 },
      { id: 'S2', start: 30, end: 70 },
    ]);
    expect(segments.map((segment) => [segment.start, segment.end, segment.passageIds])).toEqual([
      [0, 30, ['S1']],
      [30, 40, ['S1', 'S2']],
      [40, 70, ['S2']],
    ]);
    expect(segments.map((segment) => segment.text).join('')).toBe(content);
  });

  it('marks the words of a quotation inside the passages', () => {
    const segments = segmentDocument(content, [{ id: 'S1', start: 0, end: 70 }], {
      start: 30,
      end: 40,
    });
    expect(segments.filter((segment) => segment.quoted).map((segment) => segment.text)).toEqual([
      'b'.repeat(10),
    ]);
  });

  it('never loses or repeats text when a passage runs past the document', () => {
    const segments = segmentDocument('hello', [{ id: 'S1', start: -4, end: 99 }]);
    expect(segments.map((segment) => segment.text).join('')).toBe('hello');
  });

  it('is empty for an empty document', () => {
    expect(segmentDocument('', [{ id: 'S1', start: 0, end: 4 }])).toEqual([]);
  });
});

describe('locateQuote', () => {
  it('finds a quotation inside its passage, in the document’s own character positions', () => {
    const content = 'xxxx The council counted 412,000 crossings. yyyy';
    const cited = passage('S1', 'D1', 5, 43, content.slice(5, 43));
    const found = locateQuote(content, cited, 'counted 412,000');
    expect(found && content.slice(found.start, found.end)).toBe('counted 412,000');
    expect(locateQuote(content, cited, 'not there')).toBeNull();
    expect(locateQuote(content, cited, null)).toBeNull();
  });
});

describe('clipAroundQuote', () => {
  const words = (n: number, word: string) => Array.from({ length: n }, () => word).join(' ');

  it('keeps the quotation whole and a little either side, and says what was left out', () => {
    const clipped = clipAroundQuote({
      before: words(120, 'before'),
      quote: 'the quoted words',
      after: words(120, 'after'),
    });
    expect(clipped.quote).toBe('the quoted words');
    expect(clipped.cutBefore).toBe(true);
    expect(clipped.cutAfter).toBe(true);
    expect(clipped.before.length).toBeLessThanOrEqual(222);
    expect(clipped.after.length).toBeLessThanOrEqual(222);
    expect(clipped.before.startsWith('before')).toBe(true);
    expect(clipped.after.endsWith('after')).toBe(true);
  });

  it('leaves a short passage whole', () => {
    const clipped = clipAroundQuote({
      before: 'a few words',
      quote: 'quoted',
      after: 'and a few more',
    });
    expect(clipped).toMatchObject({
      before: 'a few words',
      after: 'and a few more',
      cutBefore: false,
      cutAfter: false,
    });
  });
});

describe('words', () => {
  it('writes where a passage is as a reader counts, from 1', () => {
    expect(rangeText({ start: 0, end: 1199 })).toBe('characters 1 to 1,199');
  });

  it('marks a figure in place, and says nothing when it is not there', () => {
    expect(markWithin('about 44% said', '44%')).toEqual({
      before: 'about ',
      match: '44%',
      after: ' said',
    });
    expect(markWithin('about', '44%')).toBeNull();
  });

  it('keeps the words around a figure when a quotation is long', () => {
    const long = `${'word '.repeat(80)}44% said${' word'.repeat(80)}`;
    const cut = excerptAround(long, '44%');
    expect(cut).toContain('44% said');
    expect(cut.length).toBeLessThan(long.length);
    expect(cut.startsWith('…')).toBe(true);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('reads a quotation without the list marker its source line began with, and keeps a hyphen that is a word’s', () => {
    expect(plainQuote('- 44% said it was late')).toBe('44% said it was late');
    expect(plainQuote('• Sellers lose the fee')).toBe('Sellers lose the fee');
    expect(plainQuote('2) Phone users wait')).toBe('Phone users wait');
    expect(plainQuote('Cross-border sellers pay more')).toBe('Cross-border sellers pay more');
    expect(plainQuote('-5% on the fee')).toBe('-5% on the fee');
  });
});
