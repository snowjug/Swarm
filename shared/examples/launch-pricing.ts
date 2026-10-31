import type { ExampleScenario } from '../example-scenarios.js';
import { sampleDocument } from './sample-document.js';

export const launchPricing: ExampleScenario = {
  id: 'launch-pricing',
  title: 'Launch pricing',
  blurb:
    'A higher-priced plan with no free trial: funnel data, a small price test, a disputed share of trial-led customers, and what nobody has measured.',
  question:
    'What could happen if we launch the new plan at a higher price with a free trial removed?',
  documents: [
    sampleDocument(
      '01-launch-brief.md',
      'Illustrative synthetic launch brief',
      `# Launch brief: a new plan at a higher price with no free trial

_Illustrative synthetic brief; figures invented for demonstration; not information from or about any real company._

## The proposal

A software company (invented) that sells a project-planning tool to teams is preparing a new plan. Today new customers choose between a Starter plan and a Team plan at $29 per seat per month, and both come with a 14-day free trial. The proposal is to launch a new plan at $39 per seat per month, with more reporting and admin controls, and to offer no free trial on it. Prospects would get a guided demo and a 30-day money-back period instead. It has not been decided whether the Team plan stays on sale or whether existing customers would move.

## What has been said so far

The head of product owns the plan design and wants the extra reporting priced as a premium. The chief financial officer wants better revenue per customer after a year of slower growth. Marketing managers worry that the free trial is the main way small teams find the product. Sales staff say larger prospects already ask for demos and rarely use the trial. Customer success managers expect existing customers to ask whether their price would rise.

The support team handles trial users at a cost that has not been measured separately. Channel partners who resell the product to small businesses ask for notice and for a margin that still works at the higher price. Procurement teams at larger customers usually compare quotes and look for price locks.

## The market

Analysts who follow this category would notice a price move quickly. Two main competitors sell similar tools, and one offers a permanent free tier.

## Timing

A launch date has been proposed for the start of next quarter. The pricing review meets in four weeks.
`,
    ),
    sampleDocument(
      '02-funnel-and-pricing-test-summary.md',
      'Illustrative synthetic funnel and pricing test summary',
      `# Funnel and pricing test summary

_Illustrative synthetic brief; figures invented for demonstration; not information from or about any real company._

## Funnel over the last four quarters

- There were 12,400 trial starts a year, and 74% came from teams of one to five people.
- 17% of trials converted to a paid plan within 30 days.
- About 6,200 new paid accounts were opened in a year.
- 34% of new paid accounts began with a free trial.
- The average new paid account had 6.4 seats at an effective $27 per seat per month after discounts.
- Annual churn of accounts was 11% on the Team plan and 6% for accounts with more than 20 seats.

## An earlier price test

For six weeks, 8% of new visitors saw the Team plan at $34 instead of $29. That group produced about 110 trial starts. Trial-to-paid conversion was 15.8% at the higher price and 17.0% in the control group. The test was too small to separate that difference from noise, and it was too short to show churn.

## Exit survey

310 trial users who did not convert answered a short survey. Of them, 29% said the price was too high, 33% said the product did not fit their needs, 24% said they were not ready to decide and 14% gave another reason. Answers are self-reported.
`,
    ),
    sampleDocument(
      '03-sales-support-and-partner-notes.md',
      'Illustrative synthetic notes from sales, support and customer success',
      `# Notes from sales, support and customer success

_Illustrative synthetic brief; figures invented for demonstration; not information from or about any real company._

## Sales

The regional sales leads say about 60% of new paid accounts began with a free trial. They add that larger deals often start with a trial run by one champion inside a customer, even when a demo is given later. They worry that a demo-only route would lengthen sales cycles and lean on a team of nine account executives who are already near capacity. Two leads said the guided demo would need a booking system that the company does not have.

## Customer success

Several accounts on annual contracts renew in the quarter of the proposed launch, and the team has been given no guidance on whether their prices would change. One manager noted that Team plan customers have asked for the reporting features for over a year. That could mean demand for the new plan, or a wish to get the features without paying more.

## Support

The support team estimates that trial users raise about three times as many tickets per account as paying accounts do in their first month, mostly about set-up. Removing the trial might reduce that load, or might move the same questions into the first month of a paid plan. Nobody has checked which.

## Partners

Two reselling partners said they would resist a price rise on a product they have already quoted to clients at the current price. A third said that its clients mostly buy the cheapest plan and would not see the new one.
`,
    ),
    sampleDocument(
      '04-market-notes-and-gaps.md',
      'Illustrative synthetic market notes and open questions',
      `# Market notes and open questions

_Illustrative synthetic brief; figures invented for demonstration; not information from or about any real company._

## What the team gathered about competitors

The team reviewed the public pricing pages of three competitors, all invented. Competitor A offers a permanent free tier for up to five users and charges $22 per seat per month for its main paid plan. Competitor B has a 30-day trial and a main plan priced at $35 per user per month. Competitor C sells only through demos and quotes and publishes no prices. An independent analyst note, written for another purpose, says that buyers in this category rarely switch tools within the first two years because of data and training costs. The note adds that evidence for small teams is thin.

## What is not known

The company has never tested a price above $34. There is no evidence on how many existing customers would move to a $39 plan, or leave, if the Team plan were closed to new sign-ups. No data separates customers who would have bought without a trial from those who needed one. Nobody has asked procurement teams at larger customers how a change in trial policy would affect their approval process. The effect on accounts that come through partners has not been modelled. There is no figure for what the 14-day trial costs the company in support and infrastructure.
`,
    ),
  ],
};
