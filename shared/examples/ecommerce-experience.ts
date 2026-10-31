import type { ExampleScenario } from '../example-scenarios.js';
import { sampleDocument } from './sample-document.js';

export const ecommerceExperience: ExampleScenario = {
  id: 'ecommerce-experience',
  title: 'Online store: delivery and checkout',
  blurb:
    'Delivery fees, the free-delivery threshold and a new checkout for a small online bookshop. A public sandbox page can be added as retrieved evidence; the four documents also work without it.',
  question:
    'How might different users react if this online store changes its delivery fees, free-delivery threshold and checkout flow?',
  urlSuggestion: {
    url: 'https://books.toscrape.com/',
    why: 'A public practice site built for learning web scraping: a catalogue of books with prices in pounds and stock status. It is a sandbox, not a real shop (the page says its prices and ratings were assigned at random), so no real customers are involved. Adding it lets you try the real address input and see retrieved public evidence next to the synthetic documents.',
  },
  documents: [
    sampleDocument(
      '01-customer-survey-summary.md',
      'Illustrative synthetic customer survey summary',
      `# Customer survey summary: delivery and checkout

_Illustrative synthetic summary of a survey; figures invented for demonstration; not information from or about any real company._

## Background

An independent online bookshop (invented) emailed a short survey to customers who had ordered in the previous six months. Today it charges a flat £3.49 for standard delivery and delivers free on orders of £30 or more. Checkout has five steps, and an account is optional. 1,240 people replied, about 10% of those invited. Replies lean towards frequent buyers, so occasional customers are under-represented.

## What people said

- 31% of respondents who had left a basket without buying in the last three months said delivery cost was the main reason.
- 62% said they had added an extra item at least once to reach free delivery.
- 47% said they would accept a higher delivery fee in return for quicker or better-tracked delivery.
- 23% said they would not accept any rise in the free-delivery threshold.
- 18% said they had stopped at the account-creation step at least once.
- 12% said they compare the shop's delivery cost with other sellers before buying.

## Free-text themes (paraphrased)

Gift buyers care more about a delivery date than about the fee. Several people in remote areas said surcharges are common elsewhere and sometimes appear as a surprise at the last step. Students buying course books said a single-title order rarely reaches the threshold. A few regular customers asked for a paid membership with free delivery. Some said a faster checkout would matter more to them than a lower fee, particularly on a phone. One respondent said free delivery above £20 is normal across the market. A handful said they buy from the shop to avoid large marketplaces and would pay a little extra for that reason.

## Limits of the survey

Nobody was asked about the options now under discussion. Replies were collected before the carriers' last price change.
`,
    ),
    sampleDocument(
      '02-support-ticket-themes.md',
      'Illustrative synthetic support ticket themes and operational concerns',
      `# Support ticket themes and operational concerns

_Illustrative synthetic internal note; figures invented for demonstration; not information from or about any real company._

## Where this comes from

The customer support team tagged 2,150 tickets over three months, and the operations manager added comments from the warehouse and the carriers. The team is one lead and four advisers, so tags are quick judgements and some tickets carry two.

## Options under discussion

The marketing manager has proposed raising the free-delivery threshold from £30 to £40, replacing the flat fee with a fee that depends on delivery speed, and moving to a one-page checkout that shows delivery options earlier. Finance has asked for a version that keeps the threshold and adds a paid membership instead. Whether guest checkout stays has not been decided. The options are not mutually exclusive, and nothing is agreed.

## Ticket themes

- Where is my parcel: 38% of tickets.
- Returns and refunds: 17% of tickets.
- Delivery cost surprise at the last step: 14% of tickets.
- Problems creating or recovering an account: 9% of tickets.
- Address errors, including remote-area surcharges not shown in the basket: 7% of tickets.
- Other: 15% of tickets.

## Concerns raised by teams

The support lead expects a short rise in tickets after any change to fees or checkout and has no spare capacity before the autumn peak. Warehouse employees say that orders pushed up to a higher threshold tend to hold more items and take longer to pack. The carriers, which the shop treats as delivery partners, say that fee tiers by speed would need a change to their rate cards, and one has hinted at a surcharge for peak weeks. The payments provider needs notice before a checkout change goes live. The web developer notes that a one-page checkout has not been tested with screen readers or keyboard-only navigation, and the accessibility review that would normally come first has not been scheduled.

Regulators take an interest in charges that appear only on the final page. The operations manager recalls that a local trading-standards office once questioned a neighbouring business about them. The shop has not been contacted.
`,
    ),
    sampleDocument(
      '03-analytics-summary.md',
      'Illustrative synthetic site analytics summary',
      `# Site analytics summary: funnel, order value and exit reasons

_Illustrative synthetic summary; figures invented for demonstration; not information from or about any real company._

## Period and method

The figures cover the last full quarter and come from the shop's web analytics and order system (invented). Visits from staff and known bots are excluded. An exit pop-up appears at checkout when someone moves to leave, and 6% of those shown it answered.

## Funnel

- 412,000 sessions, of which 55% were on desktops, 38% on phones and 7% on tablets.
- 9.1% of sessions added an item to the basket.
- 41% of those baskets reached the first checkout step.
- 52% of people who started checkout completed an order.
- About 8,000 orders, with a median value of £27 and a mean of £31.
- 12% of orders were between £25 and £30, and 17% were between £30 and £35.
- Phone users produced 29% of orders.
- Guest checkout was used for 36% of orders.

## Exit pop-up answers

- 41% of exit pop-up respondents who left a basket without buying said delivery cost was the main reason.
- 22% said they were comparing prices.
- 11% said the account step put them off.
- 26% gave another reason.

## What the analytics cannot show

The system does not record what delivery costs the shop for each order, so margin per order cannot be worked out. People who close the tab never see the pop-up. Nothing explains why some customers do not return after a first order. No version of the proposed checkout has been tested, even internally.
`,
    ),
    sampleDocument(
      '04-competitor-delivery-policies.md',
      'Illustrative synthetic notes on competitor delivery policies',
      `# Competitor delivery policies, noted by the shop's team

_Illustrative synthetic notes; figures invented for demonstration; not information from or about any real company._

The shop's marketing manager collected these notes from public delivery pages over one week. All sellers and figures are invented, and some of the pages may have changed since.

## A large marketplace (invented)

Free delivery above £20 on items the marketplace sells itself; third-party sellers set their own fees. A paid membership gives free next-day delivery on many items. Returns are free for most items.

## A national bookshop chain (invented)

Free delivery above £25 and a flat £2.99 below that, with click-and-collect in its shops at no charge. Delivery takes three to five working days.

## A second independent online bookshop (invented)

Free delivery above £35 and a flat £3.95 below that. A surcharge of £4 applies to addresses in remote areas and is shown on the basket page.

## A specialist academic seller (invented)

Free delivery above £50, with discounted course books for students. It uses a one-page checkout and offers guest checkout.

## What the team could not find out

The notes do not say what these sellers pay their carriers or how often they change thresholds. The team does not know whether the marketplace's free-delivery limit applies to books. One survey respondent said that free delivery above £20 is normal across the market, which is not what these pages show. Carriers that serve the shop also serve some of these sellers, and one carrier's account manager declined to compare rates.
`,
    ),
  ],
};
