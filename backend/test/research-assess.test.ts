import { describe, expect, it } from 'vitest';
import { evidenceAssessmentSchema } from '../../shared/research.js';
import { Assessor, SATURATED_MIN_PAGES, SUFFICIENT_MIN_PAGES } from '../src/research/assess.js';
import { prose } from './support/research-pages.js';
import { pageOf } from './support/research-synthetic.js';
import { FEE_AUTHORITY, FEE_OPERATORS } from './support/research-web.js';

const NOW = () => new Date(Date.UTC(2026, 5, 1));

const claim = (id: string, statement: string) => ({ id, statement, why: '' });
const RAISE = claim('c1', 'The harbour authority raises berthing fees for coastal vessels');
const NOTICE = claim(
  'c2',
  'Operators must receive ninety days of notice before a change in the fees',
);
const FEE = claim('c3', FEE_AUTHORITY.replace(/\.$/u, ''));

const RAISES =
  'The harbour authority raises berthing fees for coastal vessels at the start of the year.';
const NOTICES =
  'Operators must receive ninety days of notice before a change in the fees takes effect.';

/** A page of words found nowhere else, so that it adds a great deal to what has been read. */
const novel = (number: number) =>
  pageOf(number, [
    Array.from({ length: 40 }, (_, index) => `term${number}x${index}`).join(' ') +
      ' make up a page of its own.',
  ]);

describe('what the pages that were read say about the claims of the plan', () => {
  it('counts a passage as bearing on a claim when it holds most of the words of the claim', () => {
    const assessor = new Assessor({ claimsToVerify: [RAISE] }, NOW);
    assessor.take([
      pageOf(1, [RAISES]),
      // Each passage holds a few of the claim's words and none holds most of them.
      pageOf(2, ['The harbour authority publishes notices.', 'Berthing fees apply to vessels.']),
      pageOf(3, ['The weather was fine.']),
    ]);
    expect(assessor.assessments()).toEqual([
      {
        claimId: 'c1',
        supporting: 1,
        opposing: 0,
        sourceIds: ['rs-0000000001'],
        status: 'supported',
      },
    ]);
    expect(assessor.pages).toBe(3);
  });

  it('counts a passage that gives a different figure for the same measure as opposing, never as supporting', () => {
    const assessor = new Assessor({ claimsToVerify: [FEE] }, NOW);
    assessor.take([pageOf(1, [FEE_OPERATORS])]);
    expect(assessor.assessments()).toEqual([
      {
        claimId: 'c3',
        supporting: 0,
        opposing: 1,
        sourceIds: ['rs-0000000001'],
        status: 'opposed',
      },
    ]);
    expect([...assessor.opposingSources()]).toEqual(['rs-0000000001']);
  });

  it('says a claim is contested when pages take both sides, and names every page that bears on it', () => {
    const assessor = new Assessor({ claimsToVerify: [FEE] }, NOW);
    assessor.take([pageOf(1, [FEE_OPERATORS]), pageOf(2, [FEE_AUTHORITY]), pageOf(3, prose(1))]);
    const [assessment] = assessor.assessments();
    expect(assessment).toMatchObject({ supporting: 1, opposing: 1, status: 'contested' });
    expect([...(assessment?.sourceIds ?? [])].sort()).toEqual(['rs-0000000001', 'rs-0000000002']);
    expect([...assessor.opposingSources()]).toEqual(['rs-0000000001']);
  });

  it('leaves a claim unassessed while nothing bears on it, and holds to the schema of an assessment', () => {
    const assessor = new Assessor({ claimsToVerify: [RAISE, NOTICE] }, NOW);
    assessor.take([pageOf(1, prose(2))]);
    const assessments = assessor.assessments();
    expect(assessments.map((assessment) => assessment.status)).toEqual([
      'unassessed',
      'unassessed',
    ]);
    for (const assessment of assessments)
      expect(evidenceAssessmentSchema.parse(assessment)).toEqual(assessment);
  });

  it('takes in a page once, however often it is shown, and reads only what is new at the end of the list', () => {
    const pages = [pageOf(1, [RAISES]), pageOf(2, [RAISES]), pageOf(2, [RAISES])];
    const assessor = new Assessor({ claimsToVerify: [RAISE] }, NOW);
    assessor.take(pages.slice(0, 1));
    assessor.take(pages.slice(0, 1));
    expect(assessor.pages).toBe(1);
    assessor.take(pages);
    assessor.take(pages);
    expect(assessor.pages).toBe(2);
    expect(assessor.assessments()[0]).toMatchObject({ supporting: 2 });
  });
});

describe('when there is enough', () => {
  it('is enough when every claim has two pages bearing on it, and not before three pages have been read', () => {
    const assessor = new Assessor({ claimsToVerify: [RAISE, NOTICE] }, NOW);
    assessor.take([pageOf(1, [RAISES]), pageOf(2, [RAISES, NOTICES])]);
    expect(SUFFICIENT_MIN_PAGES).toBe(3);
    expect(assessor.sufficient()).toBe(false);
    assessor.take([pageOf(1, [RAISES]), pageOf(2, [RAISES, NOTICES]), pageOf(3, [NOTICES])]);
    expect(assessor.sufficient()).toBe(true);
  });

  it('is not enough while one claim has a single page, however many pages were read', () => {
    const assessor = new Assessor({ claimsToVerify: [RAISE, NOTICE] }, NOW);
    assessor.take([
      pageOf(1, [RAISES]),
      pageOf(2, [RAISES]),
      pageOf(3, [RAISES]),
      pageOf(4, [NOTICES]),
      pageOf(5, prose(3)),
    ]);
    expect(assessor.sufficient()).toBe(false);
  });

  it('counts a page that takes the other side as evidence that bears on the claim', () => {
    const assessor = new Assessor({ claimsToVerify: [FEE] }, NOW);
    assessor.take([pageOf(1, [FEE_AUTHORITY]), pageOf(2, [FEE_OPERATORS]), pageOf(3, prose(4))]);
    expect(assessor.sufficient()).toBe(true);
  });

  it('is never enough for a plan with no claim to check', () => {
    const assessor = new Assessor({ claimsToVerify: [] }, NOW);
    assessor.take([1, 2, 3, 4, 5].map((n) => pageOf(n, [RAISES])));
    expect(assessor.sufficient()).toBe(false);
    expect(assessor.assessments()).toEqual([]);
    expect(assessor.opposingSources().size).toBe(0);
  });
});

describe('when reading adds nothing', () => {
  it('is saturated when the last three pages added next to no new words, after at least four pages', () => {
    const text = prose(5, 3);
    const assessor = new Assessor({ claimsToVerify: [] }, NOW);
    assessor.take([1, 2, 3].map((n) => pageOf(n, text)));
    expect(assessor.saturated()).toBe(false);
    expect(SATURATED_MIN_PAGES).toBe(4);
    assessor.take([1, 2, 3, 4].map((n) => pageOf(n, text)));
    expect(assessor.saturated()).toBe(true);
  });

  it('is not saturated while pages keep bringing words that were not seen before', () => {
    const assessor = new Assessor({ claimsToVerify: [] }, NOW);
    assessor.take([1, 2, 3, 4, 5, 6].map(novel));
    expect(assessor.saturated()).toBe(false);
  });

  it('is not saturated by a page that adds something after pages that added nothing', () => {
    const text = prose(6, 3);
    const same = [1, 2, 3, 4].map((n) => pageOf(n, text));
    const assessor = new Assessor({ claimsToVerify: [] }, NOW);
    assessor.take(same);
    expect(assessor.saturated()).toBe(true);
    assessor.take([...same, novel(5)]);
    expect(assessor.saturated()).toBe(false);
  });
});
