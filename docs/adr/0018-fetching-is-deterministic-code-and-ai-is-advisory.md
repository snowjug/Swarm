# 0018. Fetching is deterministic code, and AI is advisory

Status: Accepted. Built. The crawler, the extractor and the run are tested on real loopback sockets with a fake
name server and on a fake web with a virtual clock, and measured on the evaluation's crawler arms. **Not run on
the real internet.** No search provider is on by default; two opt-in ones were added later
([ADR 0025](./0025-search-providers-are-opt-in-apis-that-return-addresses.md)).

## Context

[Reading one public page](../security/url-ingestion.md) was already guarded: a person names an address and the
server vets it, connects to a checked address only, obeys robots.txt and extracts text without running the
page. Automatic research reads many pages that a person did not name one by one, and a model may plan it. Two
things make that dangerous. A crawler that an AI steers is a way to make a server fetch what an attacker wants,
including from inside a network, at the attacker's pace. And every page is untrusted text that a model will
read next, and a small model will sometimes obey an instruction inside it ([ARCHITECTURE](../../ARCHITECTURE.md#provider-layer)).

## Decision

1. **A model may analyse a source, and a source may never instruct the system.** Which addresses are fetched,
   how often, and when to stop are decided by code, from the budget and from what pages link to. A model never
   supplies an address.
2. **One fetcher.** The crawler is the evidence fetcher of the one-page route under the crawler's own name
   (`SwarmLab-ResearchCrawler`), so it adds no network code. robots.txt is always obeyed and cannot be turned
   off; pages are read over https unless the crawl says otherwise (a pilot or production deployment refuses the
   switches that would allow plain HTTP, a loopback or a private address); addresses are vetted before anything
   is looked up; every answer of a name lookup must be public or the whole name is refused; the connection is
   pinned to the address that was checked; every redirect is vetted again and limited; sizes are limited before
   and after decompression; there is a total and an idle time; and no cookie, credential or referrer is sent.
3. **A name that leads inside a network is answered as a name that does not exist.** The class, the sentence,
   the record, the event, the retries, the effect on the host's breaker and the reason for stopping are the same,
   wherever the name is met (as an address, as the target of a redirect or as the place robots.txt is sent to), so
   that nobody can use the crawler to learn what a network holds. What it was goes to one hook for the server's own
   security log, and is never forwarded to a person, a response or telemetry.
4. **A plan names things to find, never an address.** Rules or a model write it; its schema and the server's
   checks refuse an address, a suggested site is a bare public host name that is only shown, and every address in
   the question is replaced by its site's name before the question reaches a plan. The topics, names and kinds of
   source in a plan rank the links the crawler has already found. They do not add one.
5. **Where it starts is what a person named.** An address, a site or a source a person added, and what those
   pages link to. A search provider is an interface with a default that says plainly that none is configured:
   a question with no page or site ends `blocked`, and `RESEARCH_SEARCH_PROVIDER` was `none` only, until
   [ADR 0025](./0025-search-providers-are-opt-in-apis-that-return-addresses.md) added two opt-in ones.
6. **Hostile text is labelled and never obeyed.** A line that reads like an instruction to an AI is kept as
   what the page said, labelled where it stands, counted and marked on the record. A page that is mostly such
   text is set aside, and the links of a page that has any are not followed. A title, description, author or
   link text that reads like an instruction is not kept.
7. **Choosing is lexical and deterministic.** Which pages become sources is ranked by numbers written once in
   `select.ts`, from the estimated authority of the kind of site, how much of the plan a page covers, how recent
   it is, whether a person named it, spread over sites, and keeping both sides of a disagreement. Whether there is
   enough is a count of pages whose wording overlaps a claim. Neither says what is right.
8. **The budget is enforced before each fetch and after each page.** Pages and bytes are reserved when a fetch
   starts, so a limit is never passed. The `RESEARCH_*` settings can only lower the ceilings, and a hosted
   deployment reads port 443 only unless told otherwise.

## Consequences

- Discovery is weak. With no search provider (the default), only what a person names and what it links to is read,
  and a question alone finds nothing.
- A model's plan still changes what is read first, because its topics rank links. It cannot change what may
  be fetched, how much, or from where.
- A plan can still carry words that it should not. The evaluation's planner suite found that an instruction
  written in the question is copied into the rules' plan as a claim to check and a topic (5 of 5 labelled cases),
  and that a model's plan which obeys one is accepted when the echo guard does not know its wording (4 of 74
  corrupted replies). The plan holds no address and the fetch decisions are code, so nothing is fetched because
  of it, but the text is carried and the defect is not fixed
  ([LIMITATIONS](../production/LIMITATIONS.md), A12).
- Which kind of site a page is (government, a university, a publisher, documentation, discussion) is an
  estimate from lists that people extend by hand. A name that nobody vouched for is `unclassified`, and a
  government whose suffix is not on the list is too.
- Pages whose text is made by scripts, pages behind a login, scanned PDFs and sitemaps are not read.
- It is slow by design: one request at a time to a host, at most three hosts at once, at least a second between
  requests to one host by default, retries with waits, and a breaker on a host that keeps failing.
- A page's text stays untrusted wherever it goes next. The constraints reader neither reads nor shows a model
  a passage that is addressed to an AI or that research set aside, and the participants' set records which
  passages carry such text.

## Evidence

`backend/test/research-safety.test.ts` (a table of address forms, redirects, rebinding and the two ways a name
can fail, on real sockets with a fake name server), `research-fetch`, `research-limits` (bombs, trickling bodies
and a parse that is held to a work budget), `research-pacing` (delays, robots.txt, retries, the breaker),
`research-quarantine` (each reason, instruction text, PDFs through the real reader), `research-extract`,
`research-events` (an allow-list of fields, and no text a site wrote), `research-classify`, `research-crawl`,
`research-budget`, `research-select`, `research-assess`, `research-plan` (the checks on a model's plan),
`research-wording` and `research-service-hostile` (the whole application against hostile pages). The
threat model is the table in [backend/src/research/README.md](../../backend/src/research/README.md#threat-model).

In the evaluation's rules mode (`npm run eval:ai`, 3 November 2026) no hostile host was classified as a
government with high authority (0 of 9), no injected line was kept without its label (0 of 8), and no seeded
prompt injection was obeyed or echoed (0 of 6 in the rules mode, and 0 of 22 scripted replies against the fake
Foundry that repeated what an injected page asked for). The sets are small and written by the author
([docs/production/evaluation.md](../production/evaluation.md)).
