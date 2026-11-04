# 0025. Search providers are opt-in APIs that return addresses

Status: Accepted. Built and tested against a fake `fetch`, against real loopback sockets (the key on the wire, a
redirect that is not followed), and through a whole question-only run on the fake web. **Neither provider has been run
in Azure, `brave` has never been run against its real service (there is no key), and what either finds has not been
evaluated.** Nothing is on by default. `wikipedia` was run **once** against the real API from the development
machine (2026-11-04, a synthetic question about harbour fees, through a local server): it offered 6 addresses, 4 pages
were read in 9 seconds with `robots.txt` allowing them, and 2 glossaries were set aside as oversized by the 1.5 MB
limit; the pages were Suez Canal, Dubai and Sentosa, **background that is only loosely about the question**. That
shows that the mechanics hold on the real internet and not that the discovery is good.

## Context

A person may give Swarm only a question. [ADR 0018](./0018-fetching-is-deterministic-code-and-ai-is-advisory.md)
built the crawler, the extractor and the run, and left discovery from a question alone to a provider that was not
chosen: `RESEARCH_SEARCH_PROVIDER` accepted only `none`, and such a run ended `blocked`. That is honest, and it leaves
the first line of the product (question, research, ground, actors, constraints, simulate, compare, decide) broken at its
first arrow wherever no site is named.

A provider is a decision about cost, terms of use and what a question may be sent to, so it is the operator's. But the
choice had nothing to choose from. The constraint that did not change: Swarm never reads the result page of a search
engine (it is not an interface its operator offers for this, and its terms forbid it), and nothing a provider says is
trusted.

## Decision

1. **Two providers, each an API its operator documents for this, and `none` by default.** `wikipedia` is the public
   search of the MediaWiki Action API (`list=search`, the main namespace, English): it needs no key and finds
   background pages, not primary sources. `brave` is the Brave Search web API (`/res/v1/web/search`, the
   `X-Subscription-Token` header): it needs a key and finds pages of the open web. A third provider is a new
   `SearchProvider` and a new value of `SEARCH_PROVIDERS`; the setting still accepts only the names that are built, and
   an unknown name stops the start without repeating it.
2. **A provider is sent a query, and never the question.** `searchTermsOf(plan)` is the names of the plan (a name of
   several words in quotes), then its topics: at most 8 terms, of at most 6 words and 48 characters each, in at most 180
   characters, with no control character and no quote that could end a phrase. A word that is not a name or a topic is
   left out: one of more than 24 characters, one with a digit (but a year, and a short code such as 5G or B2B), one with
   `@`, `/`, `\`, `:`, `=`, `#` or `%`, and one in a script written without spaces (Chinese, Japanese, Thai and the like:
   the planner reads English, and a clause of such a script is the question itself). A term in which the redactor of page
   text finds a secret or a person's contact details, and a term of function words alone, are left out whole. **The question
   is never the fallback:** a plan with no term that can be sent makes no search, and the run says so (it ends `blocked`
   and asks for a site or a source). What is sent out is little, and what a person wrote as a reference number, a key, a
   figure or an address is not in it. The run records, in words, that it asked and with how many names and topics.
3. **A provider is asked for addresses, and nothing else is kept.** A title and a snippet are what a site chose to say
   about itself: they are dropped. An address is kept only if it is HTTPS, has no user name and no password, and is of a
   sensible length; its fragment is removed; duplicates collapse; the count is the one the run asked for. Every kept
   address then goes to the crawler as any other: one that the rules refuse (a private or metadata host, a port, a
   redirect to one) is a source that was **blocked** and never asked for.
4. **The answer is bounded and not followed.** HTTPS (or this machine, for a test double), `redirect: manual` so that a
   key never follows a visitor elsewhere, no cookie, one identifying user agent, a JSON content type, 1 MB at the most
   (declared and counted while read), and `RESEARCH_SEARCH_TIMEOUT_MS`. A cancelled run stops the search and says what
   the run said.
5. **A failure is a class, and a key is not a word anywhere.** `SearchFailure` has a kind and no message of a
   library, no address and no body; a person is told a sentence of ours for the class (the provider refused the search;
   it did not answer in a form that can be used; it could not be reached). The key is held in the provider, put in the one
   header that carries it, and appears in no log line, event, answer, audit row or error. `GET /api/config` says who is
   searching and what it is sent, in the provider's own `message`, and the review shows that before a person goes on.
6. **A hosted start refuses an unsafe provider.** The deployment guard
   ([ADR 0021](./0021-the-deployment-guard.md)) refuses `brave` without a key, a key for a provider that does not use
   it, and any `RESEARCH_SEARCH_ENDPOINT`, which exists only for a test double and would send a key elsewhere. The
   template takes `researchSearchProvider` (`none` by default) and nothing else: a key is a Key Vault secret reference
   (`RESEARCH_SEARCH_API_KEY`), never a parameter, and its endpoint is not a parameter at all.

## Consequences

- The filter is by shape. A secret written as plain words, or the name of a person that the question names (a name is a
  name), is sent, and the review says that names and topics go. It was found by review, with a key, a case number and a
  Chinese question as the examples, that counting terms alone was not minimisation.
- A question alone can now be researched where an owner chooses to, and not otherwise. With `none` nothing changes: the
  run ends `blocked`, makes no request, and says so.
- **The provider sees the names and topics of every question searched**, and for `brave` the owner's account is the one
  that is billed and rate-limited. The review says so. A compromised provider can offer addresses of its choosing, and
  they pass through the crawler's rules and nothing else.
- `wikipedia` offers an encyclopedia's pages (with the references each cites), in English: background for a scenario
  and not the primary sources of a decision. A person is still the one who names a site or adds a source for those.
  Wikimedia's etiquette for its API asks for a user agent with contact information, and the crawler's carries only the
  product's name and version (`SwarmLab-ResearchCrawler/<version> (research; honours robots.txt)`); one run was
  accepted, and sustained use may need a contact address that an operator sets (not built).
- What either provider finds is not evaluated: the evaluation's research runs are on a made-up web and use the
  scripted provider of the harness. The ranking of what is found is the crawler's lexical ranking.
- The terms of use of both APIs, and the rights in what they point to, were not reviewed by counsel
  ([LIMITATIONS](../production/LIMITATIONS.md), A6 and A9).
- One search is made for a run. A second search, a query written by a model, or a provider that is chosen per project
  would each be a new decision.
