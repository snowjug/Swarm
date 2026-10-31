import type { ExampleScenario } from '../example-scenarios.js';
import { sampleDocument } from './sample-document.js';

export const aiFirstSupport: ExampleScenario = {
  id: 'ai-first-support',
  title: 'AI-first support',
  blurb:
    'An AI assistant takes the first pass at support cases: ticket data, a pilot whose resolution rate is disputed, and concerns from engineers, customers and privacy reviewers.',
  question:
    'What could happen if an AI assistant handles initial troubleshooting before a customer reaches a human support engineer?',
  documents: [
    sampleDocument(
      '01-support-operations-brief.md',
      'Illustrative synthetic support operations brief',
      `# Support operations brief: first-line troubleshooting

_Illustrative synthetic brief; figures invented for demonstration; not information from or about any real company._

## The proposal under discussion

A software company (invented, with about 6,000 customer organisations) is considering letting an AI assistant handle the first stage of troubleshooting. A customer would describe a problem in the support portal or in chat. The assistant would ask questions, suggest steps from the knowledge base and, if it cannot resolve the case or the customer asks, pass it to a human support engineer with a summary. Variants under discussion are an assistant-first route for all customers, an assistant-first route only outside office hours, and assistant suggestions shown to the engineer instead of the customer.

## How support works today

Customers on standard plans use a portal and email. Premium and enterprise customers have response-time commitments and a named customer success manager. Thirty-eight support engineers work across three time zones, and a tier-two team of eleven handles escalations and works with product engineers on defects. The support director owns the budget and reports to the chief operating officer, and the head of product relies on tickets as a source of bug reports.

## What has been said so far

Support engineers want to keep the interesting cases and worry that they would have to undo wrong steps given by the assistant. Team leads ask how handling time and quality would be measured when part of the work is invisible to them. Administrators at larger customers say they want a route to a person that is easy to find. The legal and privacy team asks where transcripts are stored and whether customers paste credentials or personal data into chat. Knowledge-base authors point out that out-of-date articles would be repeated at scale. A reseller partner that provides first-line support for its own clients asks whether it would still be needed. Two competitors advertise instant answers from an assistant on their websites, and a few customers have mentioned this on renewal calls.

## Not decided

Success measures, escalation rules and the budget for the assistant have not been set.
`,
    ),
    sampleDocument(
      '02-ticket-and-handling-summary.md',
      'Illustrative synthetic ticket and handling-time summary',
      `# Ticket and handling-time summary

_Illustrative synthetic brief; figures invented for demonstration; not information from or about any real company._

The figures cover one quarter and come from the ticketing system. Engineers assigned the categories when a case was closed.

## Volume and mix

- 46,000 cases were opened.
- 29% were about access and passwords, 24% about configuration, 17% about integrations, 14% about performance, 9% about billing and 7% about other topics.
- Standard plans opened 71% of cases, and premium and enterprise plans opened 29%.

## Handling

- Median first response was 3.1 hours on standard plans and 38 minutes on premium and enterprise plans.
- 44% of cases were closed at first touch, without escalation.
- 19% were escalated to the tier-two team.
- 8% were reopened within 14 days.
- Customer satisfaction averaged 4.3 out of 5, with 4.6 for access cases and 3.9 for integration cases. Only 11% of customers answered the survey.

## A small pilot

For six weeks an assistant answered first on access and password cases for standard plans, on weekdays and in two of the three time zones, covering 1,900 cases. It resolved 34% of those cases without a human. Engineers judged a sample of 120 of the cases passed to a person, and 22% of them arrived with a usable summary. Reopen rates for the cases the assistant resolved were not tracked.
`,
    ),
    sampleDocument(
      '03-concerns-and-feedback-note.md',
      'Illustrative synthetic concerns and feedback note',
      `# Concerns and feedback note

_Illustrative synthetic brief; figures invented for demonstration; not information from or about any real company._

This note collects points from the pilot debrief, a survey of engineers and customer comments. It reports concerns and does not weigh them.

## From support engineers

Twenty-six of the 38 engineers answered a short survey. Most said the assistant handled routine access cases acceptably. Several said that a wrong suggestion at the first stage costs more time than a case that starts with a person, because the customer arrives frustrated and some steps may already have been tried. Tier-two engineers worry that escalations would become harder on average once simple cases are removed, and that newer engineers would get less practice on easy cases. Some engineers said they would welcome relief from repetitive password cases.

## From customers

Comments during the pilot were mixed. Some customers said answers were quick, and others said they did not want to explain a problem twice. Administrators at three larger customers asked in writing that a route to a person be visible on the first screen. A few customers pasted screenshots that showed email addresses and, in two cases, what looked like an access token.

## Risk and compliance points

The privacy lead notes that chat transcripts are personal data, that retention rules for assistant conversations are not yet defined, and that regulators in some regions may ask how customers are told they are talking to an automated system. Security reviewers want a way to remove tokens from stored transcripts. Customers in regulated sectors may need to know when an automated system is involved, and the compliance team has not yet read the relevant guidance. An employee representative asked how performance measures for engineers would treat cases the assistant handled first. The chat window has not been tested with screen readers, and the assistant was trialled in English only, although about a fifth of cases arrive in other languages.
`,
    ),
    sampleDocument(
      '04-case-study-and-gaps.md',
      'Illustrative synthetic note on a supplier case study and what is missing',
      `# A supplier's case study, and what is missing

_Illustrative synthetic brief; figures invented for demonstration; not information from or about any real company._

## A case study the team was sent

A supplier of support software (invented) sent the team a case study about another company (also invented). The case study says that after an assistant-first rollout the company resolved 62% of cases without a human and that customer satisfaction rose. It describes the cases as mostly password resets and billing questions. It does not say how many cases there were, over how long, how satisfaction was measured or whether customers could opt out. The supplier sells the assistant software.

## How this differs from the pilot

The company's own pilot covered only access cases on standard plans. Customers on premium and enterprise plans, who have response-time commitments, were not included. Cases about integrations, which have the lowest satisfaction today, were not included either.

## Not covered by any source in this pack

There is no data on customers who are not helped by the assistant and give up, because they never open a case. Nobody has measured the cost of a wrong first answer, such as repeated work or a customer data problem caused by a bad step. There is no evidence on whether customers who meet the assistant first renew at the same rate. No data exists for languages other than English. The running cost of the assistant per case has not been quoted. The effect on how new engineers learn the product has not been studied.
`,
    ),
  ],
};
