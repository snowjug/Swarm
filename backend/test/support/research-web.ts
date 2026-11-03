import { sitePage } from './research-pages.js';
import type { Route } from './research-world.js';

export const HARBOUR = 'https://harbour.example.org';
export const REVIEW = 'https://review.example.net';
export const REGULATOR = 'https://fees.example.gov';

/** A question that the pages of `harbourWeb` bear on, and that no page in it answers outright. */
export const QUESTION = 'What if the harbour authority raises berthing fees for coastal vessels?';

/** The two sentences that give a different figure for the same fee: the one disagreement of the harbour web. */
export const FEE_AUTHORITY =
  'The berthing fee for coastal vessels is 3.40 per metre of hull per day in 2026.';
export const FEE_OPERATORS =
  'Operators report that the berthing fee for coastal vessels is 3.90 per metre of hull per day in 2026.';

const page = (body: string): Route => ({ type: 'text/html', body });

/**
 * A small web, written for these tests: a harbour authority that publishes its berthing fees, a
 * review site whose survey gives a different figure for the same fee, and a regulator's notice. The
 * pages say what the question is about, so that the links to them carry the words of the question,
 * and every figure is invented.
 */
export function harbourWeb(): Record<string, Route> {
  return {
    [`${HARBOUR}/`]: page(
      sitePage({
        title: 'Harbour Authority',
        paragraphs: [
          'The harbour authority runs the quays, the pilots and the berths of the port, and publishes its berthing fees and its rules for coastal vessels and deep-sea vessels each year.',
        ],
        links: [
          ['/berthing-fees', 'Berthing fees for coastal vessels'],
          ['/pilotage-notes', 'Pilotage notes for coastal vessels'],
          [`${REVIEW}/fees-survey`, 'Survey of berthing fees for coastal vessels'],
          ['/about', 'About the authority'],
        ],
      }),
    ),
    [`${HARBOUR}/berthing-fees`]: page(
      sitePage({
        title: 'Berthing fees for 2026',
        paragraphs: [
          'The harbour authority reviews its berthing fees once a year, and the board votes on the schedule at a meeting that is open to the public.',
          FEE_AUTHORITY,
          'Deep-sea vessels pay 5.25 per metre of hull per day, and small craft pay 2.10 per metre of hull per day.',
        ],
        head: '<meta property="article:published_time" content="2026-02-10T09:30:00Z">',
      }),
    ),
    [`${HARBOUR}/pilotage-notes`]: page(
      sitePage({
        title: 'Pilotage notes',
        paragraphs: [
          'Pilotage is charged for each movement of a vessel, inbound or outbound, and the charge for coastal vessels is set by the length of the hull.',
          'Pilots are licensed by the harbour authority, and every pilot must renew the licence after two years of service on the quays.',
        ],
      }),
    ),
    [`${HARBOUR}/about`]: page(
      sitePage({
        title: 'About the authority',
        paragraphs: [
          'The authority was founded to run the port on behalf of the town and its quays.',
        ],
      }),
    ),
    [`${REVIEW}/fees-survey`]: page(
      sitePage({
        title: 'What operators say about berthing fees',
        paragraphs: [
          'A survey of operators asked what they pay to the harbour authority each year for berths, pilots and water at the quay.',
          FEE_OPERATORS,
          'Several operators said they could not plan their routes around a fee that changes every year, and asked for a longer notice period.',
        ],
        head: '<meta property="article:published_time" content="2026-03-02T08:00:00Z">',
      }),
    ),
    [`${REGULATOR}/notice`]: page(
      sitePage({
        title: 'Notice on port charges',
        paragraphs: [
          'The regulator requires every port authority to publish the method it uses to set berthing fees, so that operators can check the figures themselves.',
          'A port authority that changes its berthing fees for coastal vessels must give operators ninety days of notice before the change takes effect.',
        ],
      }),
    ),
  };
}
