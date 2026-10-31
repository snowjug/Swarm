import type { ExampleScenario } from '../example-scenarios.js';
import { sampleDocument } from './sample-document.js';

export const copilotInTeams: ExampleScenario = {
  id: 'copilot-in-teams',
  title: 'Copilot in Teams',
  blurb:
    'A default-on assistant in a workplace chat and meetings app: administrators, security reviewers, finance, partners and competitors, with a poll, a pilot and two adoption figures that disagree.',
  question:
    'What could happen if Microsoft integrates Copilot more deeply into Teams and enables additional AI capabilities by default?',
  documents: [
    sampleDocument(
      '01-it-office-brief.md',
      'Illustrative synthetic IT office brief',
      `# IT office brief: assistant features in the chat and meetings app

_Illustrative synthetic brief; figures invented for demonstration; not information from or about any real company._

## Premise

This brief assumes a hypothetical change: Microsoft extends Copilot further into Teams and switches on additional AI capabilities by default, such as meeting recaps, chat thread summaries and suggested replies. The premise is illustrative. It is not an announcement and it does not describe any real plan. The organisation in the brief is invented: a professional-services firm with about 4,200 employees.

## How the firm uses the app today

Teams is the main place for chat and meetings. About 3,900 employees use it in a typical week. Around 350 of them hold an assistant licence that the firm pays for, and everyone else has no assistant. Tenant administrators decide which features are on, and any change goes through a two-week review by the security team and the records manager.

## What has been raised so far

Administrators ask for a separate switch for each new feature and enough notice to test it. The helpdesk lead expects more questions from ordinary users about the new panel and wants a short guide ready on day one. Department managers in client-facing teams like the idea of recaps but are uneasy about clients receiving automatic summaries of calls. Employee representatives have asked whether recaps could end up in performance reviews. The finance team asked whether features that arrive by default would be charged to the firm, and nobody has been able to answer.

Two of the firm's larger clients have their own rules on recording and transcription. The managed-service partner that supports the tenant bills by the hour for configuration work. Some staff work inside a client's tenant on a rival collaboration suite, and a few power users have tried that suite's assistant on the side.

## Status

No decision has been taken. The review board meets in three weeks.
`,
    ),
    sampleDocument(
      '02-admin-poll-summary.md',
      'Illustrative synthetic poll summary',
      `# Poll summary: IT administrators and default-on assistant features

_Illustrative synthetic summary of a poll; figures invented for demonstration; not information from or about any real company._

## About the poll

An invented community forum for administrators of collaboration platforms ran an eight-day poll about assistant features that arrive switched on. It received 212 responses. Respondents chose themselves, so the results describe people who read the forum and not administrators in general. Organisations with more than 5,000 employees are over-represented: 46% of responses came from them, against 19% from organisations with fewer than 500.

## Headline answers

- 44% said they would turn off new assistant features by default until a review was finished.
- 18% said they would leave new features as shipped.
- 38% said it would depend on the feature.
- 37% said their organisation has a written policy for AI use at work.
- The median time respondents gave for reviewing a new tenant-level feature was three weeks.

## What worried respondents most

Staff seeing content through the assistant that they could technically open but would never have found was the first concern for 41%. Recordings and transcripts, including consent from external guests, came first for 23%. Unclear licence cost came first for 17%, and extra questions to the helpdesk for 12%. The remaining 7% named something else.

## Free-text themes (paraphrased)

Several administrators at smaller organisations said they have no security reviewer and would rely on the defaults. Others asked for a staged rollout, starting with volunteers. Some said that users enjoy recaps and would complain loudly if they were taken away. A few noted that competitors ship similar features, and that clients sometimes ask which suite the firm uses.
`,
    ),
    sampleDocument(
      '03-pilot-and-helpdesk-summary.md',
      'Illustrative synthetic pilot and helpdesk summary',
      `# Pilot and helpdesk summary: eight weeks with assistant features switched on

_Illustrative synthetic summary; figures invented for demonstration; not information from or about any real company._

## The pilot

The IT office switched on assistant features for 600 seats in four departments for eight weeks, using temporary licences from the managed-service partner. About a third of the group volunteered, and the managers of the other departments assigned the rest. A seat counted as active in a week if its user opened at least one recap, summary or suggested reply.

- Weekly use of the meeting recap feature reached 41% of pilot seats at the end of the pilot.
- In week two the same figure was 22%.
- Chat thread summaries were used weekly by 19% of pilot seats in week eight.
- Suggested replies reached 11% of pilot seats and fell after week five.
- 38% of pilot users answered the end-of-pilot survey, and their average rating for recaps was 4.9 on a seven-point scale.
- Self-reported time saved had a median of 25 minutes a week. It was not measured independently.

## Helpdesk

Pilot seats raised 1.9 tickets per 100 seats per week, against 1.1 for seats outside the pilot. The most common themes were a recap that missed a decision, questions about who can see a recap, and requests to remove a recap from a meeting with a client. Nine managers asked what to tell guests who wondered whether a meeting was being transcribed.

## What the pilot left out

Recap quality was not compared with a human-written record. No frontline or shift workers were in the group. Nobody tracked what happened to recaps after they were shared.
`,
    ),
    sampleDocument(
      '04-security-and-records-note.md',
      'Illustrative synthetic security and records review note',
      `# Security and records review: points raised about default-on assistant features

_Illustrative synthetic review note; figures invented for demonstration; not information from or about any real company._

## Scope

This is a working note from the firm's security reviewers and its records manager, written after the pilot and before the review board meets. It states concerns. It does not state findings.

## Access and oversharing

The assistant's documentation says it respects each person's existing permissions, and the security reviewers do not dispute that. Their concern is what existing permissions look like in practice. During the pilot, one ticket described a recap that referred to a shared folder the employee had never opened but could read through a broad group. Reviewers counted 14 groups with more than 500 members that still have access to client folders. Tidying those groups was not part of the pilot.

## Records and retention

Recaps and transcripts may count as business records. The records manager asked how long they are kept, whether they fall under legal hold and whether an employee can delete a recap about themselves. The retention schedule has no entry for AI-generated summaries.

## Guests and consent

Clients in some countries need consent before a meeting is transcribed. A recap that runs automatically could mean a transcript exists even when nobody started a recording. Internal auditors asked for a log of when recaps were generated, and the tenant report gives daily counts, not counts per meeting. Some teams already invite stand-alone note-taking tools into calls as guests, and the reviewers cannot see how many.

## Steering by shared content

One reviewer raised the possibility that text planted in a shared document or chat message could steer what the assistant writes in a summary. Nobody at the firm has tested this.

## Regulators and representatives

The data protection officer expects that regulators in some regions would ask how employees are told about AI processing of meetings. Employee representatives have asked for the same information in writing.
`,
    ),
    sampleDocument(
      '05-partner-and-market-notes.md',
      'Illustrative synthetic partner and market notes',
      `# Partner and market notes: what is known and what is not

_Illustrative synthetic notes; figures invented for demonstration; not information from or about any real company._

## A managed-service partner's view

The partner supports about 60 client tenants of different sizes. Its account manager reports that, across its client tenants, 16% turned off new assistant features by default before a review was finished during the last year, and that most of the others left them on and reviewed later. The account manager also reports that weekly use of the meeting recap feature reached 68% of seats in its early-adopter tenants. The partner chose those tenants itself, and most are technology companies. In its experience, few small clients have a written policy for AI use at work.

The partner expects extra billable work in configuration, user guides and training. Its support teams also expect more calls from small customers that have no in-house administrator.

## A note on competitors

An independent analyst wrote a short note for the firm. It says that rival collaboration suites have shipped assistants of their own and that some bundle them into the base price. Resellers of those suites tell customers that their data stays inside the customer's tenant by default. The analyst has no sales data for any of them and calls the competitive picture impressionistic.

## Not covered by this pack

Nobody has measured how much time default-on features save or what they cost across the firm. No licence terms for newly default-on features are in hand, so the finance team cannot say who pays or whether people without a licence would see anything. No regulator or works council has stated a position. No figures exist for frontline and shift workers. There is no record of how external guests reacted to automatic recaps.
`,
    ),
  ],
};
