# Research: reading the public web, and researching for a project

`backend/src/research` reads web pages for an automatic research run, and does the run. The crawler
(`crawler/`) and the extractor (`extract/`) are a library: no routes, no storage, no model calls, no UI. The
orchestrator gives it addresses, a budget and a few hints about the question, and gets back the pages it
read, a record of every address it tried, and the reason it stopped. The rest of this folder is that
orchestrator: it plans a run, keeps its record, chooses which pages become sources of a project and adds them
([Automatic research for a project](#automatic-research-for-a-project), below).

One rule sits under all of it: **a model may analyse a source, and a source may never instruct the
system.** Which addresses are fetched, in what order, how often, and when to stop are decided by code, from
the budget and from what pages link to. Nothing a page says, and nothing a model says, changes any of that.

```
backend/src/research/
  crawler/   what is read, in what order, how often, and when to stop (crawl.ts is the loop)
  extract/   one page becomes text with places a reader can point at (extractDocument)
  config.ts, discovery.ts, plan.ts, assess.ts, select.ts, redact.ts, store.ts, pause.ts, run.ts, service.ts
             the run for a project: see "Automatic research for a project"
  index.ts   the public surface; import from here
```

## Calling it

```ts
import { crawl, systemDeps } from '../research/index.js';
import { PdfService } from '../ingest/pdf.js';

const result = await crawl(
  {
    seeds: [{ url: 'https://example.com/fees', discoveredBy: 'user-url' }],
    budget, // a ResearchBudget (shared/research.ts); validated and copied here
    hints: { terms: ['berthing fees'], domains: ['example.com'] },
    sameSiteOnly: false, // true: stay on the sites of the seeds
    signal, // cancel
    pause, // optional: { waitIfPaused(signal) } awaited between fetches
    shouldStop: (state) => null, // optional: see below
  },
  systemDeps({ onEvent, traceId, pdf: new PdfService() }),
);
// result.pages        { source: ResearchSource, document: ExtractedDocument }[]  what was used
// result.sources      ResearchSource[]   every address tried or turned away, with what became of it
// result.stoppedBecause, result.used     why it stopped, and what it spent
```

- `systemDeps()` is the one place that chooses the real clock, real waiting, real randomness and the real
  fetcher (`PublicPageFetcher`). Everything the crawl needs from the outside is in `CrawlDeps`, so a test
  can give it a virtual clock and a fake network (`backend/test/support/research-world.ts`).
- `pdf` is the project's isolated `PdfService`. Without it a PDF is not fetched. It is read one file at a
  time, because the service takes one at a time.
- `shouldStop(state)` is asked before every fetch and after every page. It returns a stop reason or null.
  This is how the orchestrator ends a run for cost (`cost-limit`), enough evidence (`evidence-sufficient`) or
  nothing new (`no-new-signal`): the crawler cannot judge those. `state` is a snapshot; changing it changes
  nothing. If `shouldStop` or the pause gate throws, what is being read is let go of and the error is passed on.
- `crawl` throws only for an invalid budget or for what the caller supplied. A site cannot make it throw:
  whatever happens to an address becomes a record in `result.sources`.
- `discoveredBy` is `user-url`, `user-domain` or `user-added` for addresses a person named (their sites
  count as named, and rank first), `search` for a search provider's answer (not implemented here), `link` for
  what pages link to. `sitemap` is accepted as a value; sitemaps are not read.

## Budget and stops

The budget is `ResearchBudget`. Every limit is checked in code, before each fetch and after each page.

| Stop                 | Who decides  | Meaning                                                                                                                                  |
| -------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `page-limit`         | crawler      | pages are reserved when a fetch starts, so the limit is never passed                                                                     |
| `byte-limit`         | crawler      | the total size is reserved the same way; a page that is larger than what is left stops the crawl, and so does less than 1,000 bytes left |
| `time-limit`         | crawler      | time paused is not counted; what is being read is let go of                                                                              |
| `failure-limit`      | crawler      | more failed requests (each try counts) than `maxFailedRequests`                                                                          |
| `duplicate-limit`    | crawler      | after four pages, more than `maxDuplicateRatio` of fetched pages repeated earlier ones                                                   |
| `domain-limit`       | crawler      | a site (registrable domain, so `a.github.io` and `b.github.io` are two) would pass `maxDomains`                                          |
| `frontier-exhausted` | crawler      | nothing relevant is left to read                                                                                                         |
| `safety-block`       | crawler      | every address that was tried was refused by a safety rule                                                                                |
| `cancelled`          | caller       | the signal was aborted; what is being read is let go of                                                                                  |
| anything else        | `shouldStop` | `evidence-sufficient`, `no-new-signal`, `cost-limit`                                                                                     |

At a stop other than `cancelled` and `time-limit`, reads that have begun are finished (no new retry is
started). `maxDepth` and `maxRedirects` are applied as they are, and `perDomainDelayMs` is the least time
left between the end of one request to a host and the start of the next, **including** robots.txt and the
requests a redirect leads to. One request at a time goes to a host, and at most three hosts are read at once.
A fetcher that ignores being told to stop is not waited for beyond two seconds (and, at a stop that lets reads
finish, the time limit of a request and two seconds).

## What is read first

A best-first queue, ranked by `score.ts` from numbers decided once in that file: a prior for the kind of
source, how much of the question the link's address and words carry, how shallow it is, and penalties
(tracking and session parameters, paging, archives, many parameters). When the question gives terms, a link
that carries none of them is not read, however much the site is worth. Addresses named by a person always
come first. Links on a page that is a login, a paywall or an error, on a page that asks that its links are not
followed (`nofollow`), and **on a page that contains text reading like instructions to an AI** are not
followed. These are never queued: logins, baskets, feeds, search results, share links, calendars,
page 6 onward of a listing, repeating or very deep paths, and files that are not pages.

Two spellings of one page are one address (`urls.ts`: scheme, host case, default port, fragment, tracking and
session parameters, order of parameters, trailing slash, index file, doubled slashes). A page's own claim of a
canonical address is recorded and used only to say a page repeats one that **was read**; it never keeps an
address from being read. The same text anywhere is a repeat (hash); nearly the same text is a repeat only on
the same site, so a page made to look like another cannot stand in for it. The first copy read is the one used.

## What a page becomes

`extractDocument` gives `ExtractedDocument`: text, passages with offsets and heading paths, title,
description, canonical address, language, dates, author (only when the page names one: structured data, a
meta tag, or `rel=author`; never from a byline), Open Graph data, structured data (read as data, never
evaluated), robots meta, links, and a method (`html-main`, `html-page`, `html-all`, `plain-text`, `json`,
`csv`, `pdf`). Navigation, footers, cookie notices, comments, share widgets and related links are left out;
text a page hides from readers (hidden attributes, inline styles that hide it) is left out and said so; text
cut for length says so (`SHORTENED_NOTICE`, `(more rows are not shown)`).

Lines that read like instructions to an AI are **kept as what the page said, labelled where they stand**
(`FLAG_LABEL`), counted in `document.injection`, and marked on the record (`injectionFlagged`). A page that
is mostly such text is set aside. A title, description or author that reads like an instruction is not kept.
Link text that reads like one is dropped before anything sees it.

A page that cannot be used as evidence is set aside, listed, and given a reason: `empty` (including pages
that are scripts), `login-page`, `consent-wall`, `paywall`, `error-page` (including errors that answer 200),
`malformed`, `oversized`, `unsupported-type`, `binary-as-text`, `prompt-injection`. These are deterministic
guesses from the page's text and structure (`quarantine.ts`).

## What happens to an address

| What happened                                                                                                       | Outcome and class                                                                | Tried again | Counts as a failure |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------- | ------------------- |
| refused by a rule of the address (scheme, user name, port, IP written in an odd form, internal name, non-public IP) | `blocked`, `invalid-url` / `blocked-scheme` / `blocked-port` / `blocked-address` | no          | no                  |
| a name that leads to a non-public address                                                                           | `failed`, `dns` ("could not be found")                                           | no          | no                  |
| robots.txt disallows it, or could not be read                                                                       | `blocked`, `robots-disallowed`                                                   | no          | no                  |
| a redirect led somewhere that is refused                                                                            | `blocked`, `redirect-refused`                                                    | no          | no                  |
| asks that AI systems do not use it (`noai`, `noml` in markup or `X-Robots-Tag`)                                     | `blocked`, `robots-disallowed`                                                   | no          | no                  |
| too many redirects                                                                                                  | `failed`, `redirect-refused`                                                     | no          | yes                 |
| 4xx                                                                                                                 | `failed`, `http-status`                                                          | no          | yes                 |
| 408, 425, 429, 500, 502, 503, 504                                                                                   | `failed`, `http-status`                                                          | yes         | yes                 |
| timeout, closed connection                                                                                          | `failed`, `timeout` / `connect`                                                  | yes         | yes                 |
| connection refused, name not found, TLS error                                                                       | `failed`, `connect` / `dns` / `tls`                                              | no          | yes                 |
| larger than the limit, or grew past it when unpacked                                                                | `quarantined`, `too-large` / `decompression-limit`                               | no          | yes                 |
| a type that is not read                                                                                             | `quarantined`, `unsupported-type`                                                | no          | yes                 |
| host left alone after failures                                                                                      | `skipped`, `circuit-open`                                                        | no          | no                  |
| site limit, or a page read since named this address                                                                 | `skipped`                                                                        | no          | no                  |
| stopped                                                                                                             | `skipped`, `cancelled`                                                           | no          | no                  |

Tries: two after the first, waiting 500 ms, 1 s, 2 s... up to 8 s, with a random share taken off from the
injected `random`. A `Retry-After` is waited for up to 10 s and not at all beyond that. A site's
`Crawl-delay` is applied up to 10 s. After three failures in a row a host is left alone for 30 s; then one
request is let through, and its answer closes or reopens the breaker.

## Events (the audit log)

`onEvent` gets `fetch-start`, `fetch-ok`, `fetch-blocked`, `fetch-failed`, `retry`, `robots-decision`,
`redirect`, `quarantine`, `duplicate`, `circuit-open`, `skipped` and `budget-stop`, each with the trace id and
a time from the injected clock. The fields of each kind are a fixed list (`research-events.test.ts` fails on
any other), addresses have credentials, fragments and secret-looking query values taken out, and **no event
carries any text a site wrote**: no title, no link text, no message. `fetch-blocked.resolved` says that a name
was refused because of where it leads; a person is told only that the name was not found, so the answer
cannot be used to learn about a network. A listener that throws, or rejects, does not affect the crawl.

## The network, and who does what

The crawler adds no network code. `PublicPageFetcher` is the evidence fetcher (`ingest/url/fetcher.ts`) under
the crawler's name (`SwarmLab-ResearchCrawler`): robots.txt is always obeyed and cannot be turned off; https
only unless the crawl says otherwise; addresses are vetted before anything is looked up; every answer of the
name lookup must be public or the whole name is refused; the connection is pinned to an address that was
checked; every redirect is vetted again and limited by the budget; sizes are limited before and after
decompression; there is a total time and an idle time; no cookie, credential, referrer or other header of a
person is sent. The crawler vets addresses again before queueing them (including IP addresses written out),
so an address that is refused costs no place and no request.

### Threat model

| Threat                                                                                                                       | Control                                                                                                                                | Tested in                                                   |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| SSRF: private, loopback, link-local, CGNAT, multicast, reserved, unspecified; IPv6, IPv4-mapped, NAT64, 6to4; cloud metadata | address classes checked at name lookup and for IP literals, before connecting                                                          | `research-safety` (a table of addresses), `research-events` |
| odd ways of writing an address: decimal/hex/octal IPs, `127.1`, credentials, backslashes, control characters, very long      | refused by the address policy                                                                                                          | `research-safety`, `research-fetch`                         |
| DNS rebinding                                                                                                                | every request resolves again; any non-public answer refuses the name; connection pinned to the checked address                         | `research-safety`                                           |
| redirects to internal addresses, downgrade to http, loops, chains                                                            | each hop vetted again; `httpsOnly`; hop limit from the budget; robots.txt applies to each hop                                          | `research-safety`, `research-fetch`                         |
| non-web schemes, ports                                                                                                       | refused; only 80/443 unless the deployment allows more                                                                                 | `research-safety`                                           |
| decompression bombs, huge or endless bodies, huge headers                                                                    | limits on the wire and after unpacking, 16 KiB of header                                                                               | `research-limits`                                           |
| slow sites, trickling bodies, hung requests                                                                                  | total and idle time per request; per-crawl time limit; a fetcher that ignores a stop is not waited for                                 | `research-limits`, `research-budget`                        |
| bytes that are not text labelled as text                                                                                     | first bytes sniffed before reading                                                                                                     | `research-quarantine`                                       |
| robots.txt: disallow, allow, own-name group, crawl-delay, 4xx, 5xx, huge                                                     | RFC 9309 behaviour; unreadable forbids the origin; read to 512,000 bytes                                                               | `research-safety`, `research-pacing`, `research-fetch`      |
| link traps, endless sites, calendars, sessions                                                                               | trap rules, dedupe keys, page/depth/domain limits                                                                                      | `research-classify`, `research-limits`                      |
| prompt injection in text, titles, link text, hidden text                                                                     | labelled, never obeyed; mostly-injection pages set aside; links of such pages not followed; no model is involved in any fetch decision | `research-quarantine`, `research-extract`                   |
| a page claiming another as canonical, or copying another                                                                     | canonical claims do not suppress; near copies on other sites are not repeats                                                           | `research-crawl`                                            |
| leaking secrets or page text through logs                                                                                    | field allow-list, redaction, fixed messages                                                                                            | `research-events`                                           |
| a page that is expensive to parse                                                                                            | chunked parsing with depth, node, attribute and time limits (see below)                                                                | `research-extract`                                          |
| misleading words in what a person is shown                                                                                   | every fixed sentence passes the project's wording guard                                                                                | `research-wording`                                          |

## Measured limits and known limits

- A page is parsed in pieces of 8 KiB with a limit of 1.5 s of parsing, 512 levels of depth, 400,000 nodes
  and 64 attributes to an element. Measured on this machine (a busy one, so read these as an order of
  magnitude) on hostile pages of 5 MB (spans, paragraphs, links, table cells, comments, character references)
  that run to the end: 0.7 to 2.4 s in all, and the longest stretch the event loop was held was 183 ms.
  A hundred thousand nested elements, which took a minute to parse without the limits, are cut at 512
  levels at once.
- **Pages whose text is built by scripts are not read.** Nothing is executed; a page that is mostly script is
  set aside as `empty` with a sentence that says so. Text a page keeps in `noscript` is used when the page
  has almost none of its own.
- **PDF** only through the injected `PdfService`: no OCR, no repair, one at a time, with its own limits.
- **Sitemaps are not read**, and `<meta http-equiv="refresh">` is not followed.
- Text hidden by a stylesheet class cannot be told from text that is shown; it is kept, and labelled if it
  reads like an instruction. Text hidden by attributes or inline styles is left out.
- Pages behind a login or a paywall are not read (the crawler has no credentials and keeps no cookies).
- **Classification is an estimate** (`classify.ts`, `reputable-domains.ts`): a government domain, a
  university, a publisher, a news site, a forum, documentation and a named site are recognised from the address
  and, once a page is read, from what its markup says; markup can only lower a page. It says what kind of
  source a page looks like, not that it is right. An address that only has a `docs` folder is `low`.
- `robots.txt` beyond 512,000 bytes is not read (RFC 9309 asks for at least 500 KiB).
- A read that is larger than what is left of the size limit ends the crawl, even when a smaller page could
  still fit.
- The first copy of a text that is read is the one used; the crawler does not weigh which copy is the more
  authoritative.
- A page's text is untrusted data. The orchestrator must treat `document.text` that way too: not as an
  instruction, and not as something to put into a prompt without its labels.

## Automatic research for a project

Everything above is the library. The rest of this folder uses it to do research for a project, as the
**first phase of the job that grounds it**: the existing `knowledge` job. No job kind was added (`jobs.kind`
is a database constraint), so the lease, heartbeat, cancellation, retry and recovery of a run are the queue's.
The record of a run is a `research` artifact of its project, written whole, with the revision it was read
at, so it is stored, revised, exported and deleted with its project on either storage engine and is never
visible to another tenant.

| File           | What it holds                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.ts`    | The `RESEARCH_*` settings, which can only lower the shared ceiling; `clampBudget`, which holds a request to it                                                        |
| `discovery.ts` | `SearchProvider`, and the default that says plainly that none is configured. It never invents a provider and never reads a search page                                |
| `plan.ts`      | `buildResearchPlan`: rules plan with no model; a model's plan must pass the schema and the server's checks (no address, bare public hosts only) or rules plan instead |
| `assess.ts`    | `Assessor`: which pages bear on each claim of the plan, lexically, and when there is enough, or reading adds nothing                                                  |
| `select.ts`    | Which pages become sources (`selectDocuments`) and where each passage sat in its page (`locatePassages`)                                                              |
| `redact.ts`    | What is masked before a page is kept: secrets, emails, phone numbers, card, identity and account numbers (never a figure, a date or a year)                           |
| `store.ts`     | `ResearchStore` and `RunRecorder`: the record, written whole, with a revision check and the job's lease                                                               |
| `pause.ts`     | The in-process pause gate, bounded                                                                                                                                    |
| `run.ts`       | `RunPipeline`: planning, finding, reading, keeping, checking, ending                                                                                                  |
| `service.ts`   | `ResearchService`: what a person may do to a run, and `beforeKnowledge`, which the job calls                                                                          |

### The sequence for a question and nothing else

1. `POST /api/projects` with `documents: []`, `workflow: "guided"` and `research: { auto: true }` creates a
   `draft` project with no document and no passage. (Without `auto`, an empty list is refused as it always was;
   a quick project with no source is refused too, because a quick run has no research phase.)
2. `POST /api/projects/:id/research` writes a `queued` run and queues the `knowledge` step. A run that the
   queue refuses is removed again, so no run waits for a job.
3. The worker takes the job. `GuidedWorkflow` calls `ResearchService.beforeKnowledge` before it builds
   knowledge: it carries out the run that is waiting, or, for a project with no evidence at all, makes one.
4. **Planning.** Rules plan, or, for a project whose person chose a model, the model does, as data: the
   question and the guidance are never instructions. A plan names things to find and **never an address to
   fetch**; a suggested site is a bare public host name that is only shown. Every address in the question is
   replaced by its site's name before it reaches a plan or a search provider.
5. **Finding sources.** `url` and `domain` modes start from what the person named. `discovery` mode needs a
   search provider: with none the run ends `blocked` (`discovery-unconfigured`), says so, and the stage goes
   back to waiting (`pending`, not `failed`) so that a person can name a page or a site, or add sources of their own.
6. **Reading** is the crawler, held to the budget. This server decides two more stops from what has been read
   (`shouldStop`): `evidence-sufficient` and `no-new-signal` (see `assess.ts`), and `cost-limit` and
   `time-limit` (a pause that lasted as long as it may). A person's **finish** stops reading and goes on.
7. **Extracting evidence.** `selectDocuments` chooses up to ten sources, minus those the project holds, within
   200,000 characters, ranked by the estimated authority of the kind of site, how much of the plan a page
   covers, how recent it is (as far as the plan says time matters), whether a person named it, spread over
   sites and kinds, and **keeping both sides of a disagreement**. Furniture and repeated passages are left out,
   secrets are masked, instruction-like lines stay **labelled**. Every page not chosen stays on the run's list
   with the reason. One transaction then appends the documents (`Repository.appendDocuments`: ids and passage
   numbering carry on, nothing already written is touched) and writes the run's record.
8. **Checking conflicts.** The project's own contradiction detector runs over the passages and the run
   records how many touch what was added; the ledger, if one exists, learns of them.
9. **Ready.** The run is `completed` and the job goes on to `buildKnowledge` as it always did.

A run that ends with nothing to use is `blocked` (or `cancelled`, when a person finished before anything was
read) and the stage is held, not failed. A run that fails (a refusal by the model's provider, a search
provider that could not be reached) is `failed` with a code, and the stage is `failed` so that it can be run again.

### Statuses, and why a run stopped

`queued`, `running`, `paused`, `completed`, `cancelled`, `failed`, `blocked`. `stoppedBecause` is one of the
reasons in `RESEARCH_STOP_LABELS` (`shared/research.ts`); the crawler decides `page-limit`, `domain-limit`,
`byte-limit`, `duplicate-limit`, `failure-limit`, `time-limit` and `frontier-exhausted`; this folder decides
`evidence-sufficient`, `no-new-signal`, `cost-limit`, `cancelled` (a person's finish) and
`discovery-unconfigured`. **Sufficiency is a count of pages whose wording overlaps a claim**, not agreement
and not truth; the interface says "bears on", "supports" and "opposes" in that weak sense.

### Pause, finish, cancel, and a server that stops

- **Pause** is a gate in this process that the crawl waits at between fetches. The job keeps its lease while
  paused, so a pause costs no work and loses none. It is bounded (`RESEARCH_MAX_PAUSE_SECONDS`, 300 by
  default): a run left paused ends by itself with what it had read (`time-limit`).
- **Finish early** stops reading and goes on with what was read. **Cancel** ends the job and the run
  (`cancelled`), and leaves no half-written state: sources are appended in one transaction with the record
  of it, after reading has ended and before nothing else can interrupt.
- **A server that stops** puts a run that was cut off back in the queue (`queued`, with a line saying so); the
  next worker carries it out from its start. When the server starts, a run that is not finished and has no job
  is marked ended (`failed`, or `cancelled` if its job was); a run is never left `running`.
- Pause and finish act on a run that **this process** is carrying out; sent to another instance they are
  refused with `409`. Cancel goes through the job and works from any instance.

### Cost and the model

A model is used only for a project whose person chose one and when the provider is configured; the rules path
calls none. The cost limit of a run is an **estimate** from prices an operator entered, enforced before the
call (`MODEL_PRICES`); with no price the cost is "unknown" and said so. `0` means no model is asked.

### Known limits of the orchestration

- **No search provider is built.** Discovery from a question alone ends `blocked`; only the pages and sites a
  person names, and what they link to, are read. `RESEARCH_SEARCH_PROVIDER` accepts only `none`.
- A run starts from one page or one site; more are added one at a time (each is a run). Sources cannot be
  added to a project once its grounding step is ready or running.
- The intake typed at creation is not kept: a research start repeats it in its body, and a project that is
  simply grounded without one gets a discovery run (which ends `blocked` with no search provider).
- Selection and assessment are lexical and deterministic, with fixed weights written in `select.ts` and
  `assess.ts`. They rank what to read and what to keep; they do not say what is right.
- One worker for each process: a run holds it for as long as it takes (the job is held to 15 minutes), and
  nothing shares it fairly between workspaces yet; the queue holds at most three waiting jobs.
- A read of the state (`GET`) may mark an abandoned run as ended: it is how a run that nobody carries out is
  found when no one restarts the server.
- Not pasted text or a file: a person adds those when the project is created. The routes add a page or a site.

## Tests

```
npx vitest run backend/test/research-*.test.ts
```

`research-fetch` (the fetcher's additions), `research-extract`, `research-classify`, `research-crawl`
(ordering, sites, duplicates, records), `research-budget` (each stop, cancelling, pausing, `shouldStop`),
`research-pacing` (delays, robots, retries, the breaker), `research-events`, `research-quarantine`
(each reason, injection, PDF through the real reader, byte sniffing), `research-wording`, and the two that
use real sockets on this machine: `research-safety` and `research-limits`. The crawl tests run on a virtual
clock and a fake network (`support/research-world.ts`), so they do the same things at the same moments on
any machine; the socket tests use loopback servers and a fake name server, never the network. The PDF tests
start the real PDF worker and take a few seconds.

The orchestration is tested in `research-config`, `research-plan` (rules and a model's plan, the checks,
the words), `research-assess`, `research-select` (ranking, limits, repeats, masking, places), `research-store`
(the record and `Repository.appendDocuments`; run it on PGlite too), and, through the whole application with
the real crawler, extractor, job queue and storage, `research-service` (modes, stages, stops, limits,
determinism), `research-service-control` (pause, finish, cancel, two requests, a server that stops),
`research-service-hostile`, `research-service-model` and `research-routes` (who may call what, tenants, CSRF,
rate limits, the audit log). They read a fake web (`support/research-web.ts`) on a virtual clock through the
fetcher seam of `buildApp` (`research: { fetcher, now, crawl }`), which only code can set: no environment
variable or configuration reaches it. **What they do not do**: use the real network, a real search
provider, a real model or Azure; the model is a scripted double that is held to the real schema and checks,
and the real socket fetcher is covered by the crawler's own tests, not driven by these.

```
nice -n 10 npx vitest run backend/test/research-*.test.ts
SWARM_TEST_DATABASE=pglite npx vitest run --testTimeout=240000 backend/test/research-store.test.ts backend/test/research-service*.test.ts backend/test/research-routes.test.ts
```
