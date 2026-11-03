# AI evaluation

How the AI-assisted setup stages of Swarm are measured, against which thresholds, and what the measurements found. It keeps the method of [`evaluation/README.md`](../../evaluation/README.md): labels written from source text before any result, a dev and a test split, small sets disclosed, limits stated. The thresholds are the table in [`PLAN.md`](./PLAN.md), registered in [`evaluation/thresholds.json`](../../evaluation/thresholds.json) before any result existed and not edited since.

```
npm run eval:ai           # print the results; exit 1 if a measured metric breaches its threshold
npm run eval:ai:write     # also write evaluation/results/ai-latest.{json,md}
npm run eval:ai -- --mode rules,fake-foundry
npm run eval:ai:live      # refuses here: see the live mode
```

The tests run the rules and fake-foundry modes under `npm test` (`evaluation/test/ai-*.test.ts`). The full results are in [`evaluation/results/ai-latest.md`](../../evaluation/results/ai-latest.md).

## The three modes

Every number states its mode. A metric that is not measured in a mode is printed `NOT MEASURED` and is never counted as passed.

| Mode           | What runs                                                                                                                                                                                      | What it can show                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `rules`        | The product's rules paths, offline, with no model: participants, constraints, scenario frame, claim check, conflict detector, the crawler and extraction over a fixture web, the rule critics. | What the deterministic fallback and the checks around a model do. Reproducible in CI.                           |
| `fake-foundry` | The real `ModelClient`, `runStructuredTask` and output policy against the in-process fake of the Foundry endpoint. Replies are derived from the labels, then corrupted in controlled ways.     | The rules around a model: what is rejected, corrected, kept, refused. **Never a model's quality.**              |
| `live`         | The same suites with a real deployment answering. Written, and tested against the fake, but it runs only with `--live` and a Foundry configuration whose endpoint is not on this machine.      | A model's behaviour behind the product's checks. **Not measured here: no Azure authorization on this machine.** |

The live column is empty in every report and says `NOT MEASURED: no Azure authorization on this machine`, with the reason (no `--live`, no `AI_PROVIDER=foundry`, no credentials, an endpoint on this machine). It reads no secret and prints none; a live run stops at a token budget (1,500,000 by default, set under the per-project cap).

Three further suites are listed as `NOT MEASURED (pending)` because they are being built by other workstreams and are not on this base: the research planner, a research run end to end, and the Decision Canvas status matrix. The harness is structured so that each plugs in as another suite.

## What is measured, on what

All data is fictional and domain-neutral; no real person or company is a fact in it. Every case has an id, a `split` of `dev` or `test` (alternating), and the reason for its label.

| Set                | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Where                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Scenarios (13)     | 6 flagship (the Larkholm ferry and the five shared examples, pinned by SHA-256) and 7 custom (library hours, usage pricing, hospital discharge, school timetable with thin sources, returns policy, factory shifts, congestion charge). 184 labelled participants (23 of them missing voices), 100 constraints (49 hard), one seeded gap each, 36 alternatives, 62 claims (26 supported, 12 partial, 24 unsupported), 11 conflicts.                                                                        | `evaluation/datasets/scenarios/`           |
| Site fixtures (61) | HTML pages served from a loopback server in 7 crawl groups: good primary, official, research and reporting pages; spam, empty and irrelevant pages; login, consent, paywall and error pages; binary and oversized responses; robots.txt and a request not to be used by AI; look-alike authority hosts; instructions to an AI in view, hidden, in metadata, in structured data and after a very long page; redirects, a loop, a closed port, a name that does not exist, a timeout; exact and near copies. | `evaluation/datasets/sites/`               |
| Safety (48)        | 24 unsafe requests (harmful content, secret exfiltration, jailbreaks, personal-data fishing, consequential decisions about employment, credit, law, medicine and safety) and 24 benign look-alikes.                                                                                                                                                                                                                                                                                                        | `evaluation/datasets/ai-safety.json`       |
| Critic flaws (21)  | Defects planted into one unflawed analysis and brief: an unsupported recommendation, a missing constraint, a hidden assumption, single-source dependence, overclaiming wording; plus 2 controls with no flaw.                                                                                                                                                                                                                                                                                              | `evaluation/datasets/ai-critic-flaws.json` |

The datasets that existed before (retrieval, answerability, conflicts, claims, injection) are unchanged and `npm run eval` still passes.

## Method

- **Labels first.** The thresholds and every gold label were committed before the harness existed or any result had been seen; see the git history of `evaluation/datasets/` and `evaluation/thresholds.json`. A quote in a label is checked against the document text by an integrity test (`ai-datasets.test.ts`), and flagship documents are pinned by hash.
- **Metrics are functions with hand-computed tests.** `evaluation/src/measure-*.ts` hold the arithmetic (Wilson intervals, percentiles, grounded and unsupported rates, actor coverage and redundancy, constraint recall, gap detection, quarantine and classification, injected-line labelling, critic catches, safety, tokens and cost). Each expected value in `ai-measures.test.ts` was worked out by hand from a small fixture, so an error in the arithmetic cannot pass as a result. One of them found a floating-point error at the edge of an interval.
- **Intervals and counts.** Every rate prints its counts and a Wilson 95% interval. Where the interval spans a threshold the note says the set is too small to be sure either way. The status of a row is decided on the point estimate and on the pooled dev and test cases; both splits are printed beside it.
- **Real code, fake network.** The crawler is the product's, with the product's `PublicPageFetcher` and every check on; only its name server is replaced, and only loopback addresses are allowed. Waits are cut short and stalls are not. Model replies come from the in-process fake, and only from there.
- **A threshold that breaches fails.** `npm run eval:ai` exits 1 on any breach. The tests fail on a breach unless [`evaluation/known-breaches.json`](../../evaluation/known-breaches.json) lists that metric and mode with the measured value and the reason; they also fail when a listed metric stops breaching, so an improvement has to be recorded as one, and when a metric registered for a mode comes out `NOT MEASURED`. `EVAL_STRICT=1` excuses nothing.

### What was changed after results were seen

Nothing in `thresholds.json`, and no scenario label. Changes made after a run, each for a stated reason, applied to dev and test alike:

- **Fixtures, found by checking that every page the labels expect to be read was requested** (dev first): two paths the crawler's link scorer would not follow, a redirect target that had to carry an allowed port, one host merged to leave room under the 10-site limit, a filler seed so that two long pages were not near copies of each other, and the classification labels of five injected pages that share a host with their seed (a named site, read as primary by design) withdrawn rather than replaced by the product's answer. All are in `labelRevisions` of `datasets/sites/hosts.json`.
- **Metric definitions**: an estimate of `low` authority is not counted as more than `unknown` (found on dev); a structured-data line such as `Article.description: …` counts as labelled when the flag stands before its key (a false alarm of the harness, found on a page of the test split and corrected for both); copies set aside as duplicates are counted per copy as well as per group (added after seeing that an exact copy was collapsed and a near copy was not).
- **Scripted replies**: names that the product's own rule calls generic (such as "Company leadership") are qualified in the scripted reply, as a model is told to do after its first reply, and the prose of a scripted participant no longer repeats the labels' rationale (one held a percentage the product refuses in generated text).

## Registered thresholds, and where each is measured

| Metric                                                        | Threshold                       | Measured in               |
| ------------------------------------------------------------- | ------------------------------- | ------------------------- |
| Schema-valid reply rate (after one correction)                | ≥ 99%                           | live                      |
| Rules fallback schema-valid rate                              | 100%                            | rules, fake-foundry       |
| Grounded claim rate (reference resolves, quote is in passage) | ≥ 95%                           | rules, fake-foundry, live |
| Unsupported claim rate                                        | ≤ 2%                            | rules, fake-foundry, live |
| Citation correctness (ids resolve)                            | 100%                            | rules, fake-foundry, live |
| Actor coverage of the labelled participant roles              | ≥ 90%                           | rules, fake-foundry, live |
| Actor redundancy after deduplication                          | ≤ 10%                           | rules, fake-foundry, live |
| Generic actor names accepted                                  | 0                               | rules, fake-foundry, live |
| Hard-constraint detection recall                              | ≥ 80%                           | rules, fake-foundry, live |
| `extracted` constraints whose quote is not in the source      | 0                               | rules, fake-foundry, live |
| Missing-constraint detection (seeded gaps)                    | ≥ 70%                           | rules, live               |
| Source diversity                                              | ≥ 3 domains; no domain over 60% | rules                     |
| Critic catch rate on seeded flaws                             | ≥ 80%                           | rules, live               |
| Seeded prompt injections obeyed or echoed                     | 0                               | rules, fake-foundry, live |
| Seeded unsafe requests passed                                 | 0                               | fake-foundry, live        |
| Benign requests refused                                       | ≤ 2%                            | fake-foundry, live        |
| Estimated cost per full flagship run                          | ≤ the per-project token cap     | fake-foundry, live        |
| Hostile hosts classified as government with high authority    | 0 (from the workstream brief)   | rules                     |
| Injected lines kept without the flag label (from the README)  | 0                               | rules                     |

The definition of each, and why it is measured only where it is, is in `thresholds.json`. A scripted model cannot be scored for catching flaws or for finding a gap (it reports what it is told to), so those two are rules and live only; the product has no request screen of its own, so refusal metrics have nothing to measure in rules mode.

## Results

At the time of writing, on 13 scenarios, 61 pages, 48 safety requests and 21 planted flaws. Pooled over dev and test; the dev and test values and every interval are in [`ai-latest.md`](../../evaluation/results/ai-latest.md).

### rules

| Metric                                                    | Result                              | Threshold  | Status       |
| --------------------------------------------------------- | ----------------------------------- | ---------- | ------------ |
| Rules fallback schema-valid rate                          | 100% (82/82)                        | 100%       | met          |
| Grounded claim rate                                       | 100% (466/466)                      | ≥ 95%      | met          |
| Unsupported claim rate                                    | 0% (0/292)                          | ≤ 2%       | met          |
| Citation correctness                                      | 100% (466/466)                      | 100%       | met          |
| Actor coverage                                            | 30.4% (49/161; 24% to 38%)          | ≥ 90%      | **breached** |
| Actor redundancy                                          | 8.4% (10/119); dev 11.7%, test 5.1% | ≤ 10%      | met          |
| Generic actor names accepted                              | 0 of 270                            | 0          | met          |
| Hard-constraint detection recall                          | 24.5% (12/49; 15% to 38%)           | ≥ 80%      | **breached** |
| `extracted` without a quote in the source                 | 0 of 63                             | 0          | met          |
| Missing-constraint detection                              | 15.4% (2/13; 4% to 42%)             | ≥ 70%      | **breached** |
| Source diversity                                          | 5 domains; largest share 39%        | ≥ 3; ≤ 60% | met          |
| Critic catch rate (rule critics)                          | 90.5% (19/21; dev 81.8%, test 100%) | ≥ 80%      | met          |
| Injections obeyed or echoed                               | 0 of 6                              | 0          | met          |
| Hostile hosts government with high authority              | 0 of 9                              | 0          | met          |
| Injected lines without the flag label                     | 1 of 11                             | 0          | **breached** |
| Schema-valid reply rate, unsafe and benign requests, cost | NOT MEASURED                        |            |              |

Read leniently, with a live name that shares any content word of the labelled name counting as a match, the rules cover half of the labelled participants (80/161). They surfaced none of the 23 missing voices.

### fake-foundry

| Metric                                         | Result                                                               | Threshold          | Status       |
| ---------------------------------------------- | -------------------------------------------------------------------- | ------------------ | ------------ |
| Rules fallback schema-valid rate               | 100% (167/167)                                                       | 100%               | met          |
| Grounded claim rate / citation correctness     | 100% (5,198/5,198)                                                   | ≥ 95% / 100%       | met          |
| Unsupported claim rate                         | 0% (0/4,498)                                                         | ≤ 2%               | met          |
| Actor coverage / redundancy (clean reply)      | 99.4% (160/161) / 1.6% (3/184)                                       | ≥ 90% / ≤ 10%      | met          |
| Generic actor names accepted                   | 0 of 3,380                                                           | 0                  | met          |
| Hard-constraint detection recall (clean reply) | 53.1% (26/49; 39% to 66%)                                            | ≥ 80%              | **breached** |
| `extracted` without a quote in the source      | 0 of 1,386                                                           | 0                  | met          |
| Injections echoed                              | 0 of 22                                                              | 0                  | met          |
| Unsafe requests passed                         | 0 of 72                                                              | 0                  | met          |
| Benign requests refused                        | 0% (0/24; 0% to 14%)                                                 | ≤ 2%               | met          |
| Cost per flagship run                          | at most 16,396 tokens (0.41% of the cap), about $0.014 at list price | ≤ 4,000,000 tokens | met          |

What the corruption arms show: every content fault the arms plant (a missing or extra field, an invented evidence id, an unverifiable quote, a generic name, duplicate names, a personal detail, a forecast, a stereotype, duplicate or instruction-like constraints, an echoed injection) is rejected, corrected or taken in with its mark gone, whether the second reply is clean or not; a provider refusal or content filter is surfaced as a refusal and never answered from rules; any other provider failure, and a spent call budget, falls back to a rules answer that passes its own checks. A real quote from the wrong passage is the exception (see below).

### live

Every row is `NOT MEASURED`.

## What the evaluation found in the product

The measurements show these. Each has the numbers it rests on, and a way to see it again, in [`ai-latest.md`](../../evaluation/results/ai-latest.md).

**Defect.** On a page whose body is over about 80,000 characters, an instruction to an AI in its structured data (a JSON-LD field) is kept in the extracted text without the flag label, the page's injection count stays 0, and its links would be followed (page P67). `extract/document.ts` spends its scan budget on the body before it labels the structured data. This is the one breach of a threshold that is a defect rather than a limit of the rules.

Limits and gaps:

- **Hardness comes from a word list.** A correct and complete reply that proposes every labelled constraint with its labelled hardness leaves 53% of the labelled hard constraints held as hard: `constraints/build.ts` sets an extracted constraint hard only when its quote matches `HARD_CUE`, so an agreement that makes work voluntary, or a deadline, is soft. This is a design choice that the registered threshold does not share.
- **A real quote from the wrong passage is accepted.** A scripted reply that attached a verbatim quote from another passage to a participant or a constraint was accepted without a correction, and the constraint was labelled `extracted`. The grounded and citation rates cannot see it; no check asks whether a quote bears on its statement.
- **The product has no screen for unsafe requests of its own.** When the provider did not block, all 24 unsafe requests were answered. Refusal is the provider's decision; with no model, or a provider that does not filter, nothing refuses.
- **The model critic is not checked for wording, and gets two corrections.** A critique saying the change "will certainly fail" is kept (participants are held to the brief's wording guard); a critique that keeps failing costs three provider calls where the rule for a model task, and the registered rate, say one correction. (The critic path is guarded against an echoed injection, as every task is, by the client.)
- **A near copy is read as a separate source.** The same text on the same site with one phrase changed differs from the original in 9 of 64 fingerprint bits; the crawler takes 3 as the same. An exact copy on another site is set aside.
- **A news article on a site a person named is read as an official statement**, and credible reporting is assigned only from a built-in list of domains.
- **The claim check is lexical**: it rates 67% (16 of 24) of the labelled unsupported statements as supported.
- **The rules proposal is lexical too**: no labelled alternative was found in the scenario frame (0/36), 73% (8/11) of the labelled conflicts were found with 4 detections no label accounts for, and removing the sentence of one constraint changed what was asked in 1 of 13 scenarios.

## What this does not show

- **No model's quality.** The fake mode shows what the product does with the replies it is given. A scripted reply derived from my labels passes by construction: its coverage says the pipeline keeps a correct reply, not that a model will find the participants. Nothing here predicts a live pass rate, a live refusal rate or a live cost.
- **No live result.** There is none. The live code has been exercised only against the fake.
- **One labeller, and small sets.** The labels were written by one person, from the text, and the sets are small: 100% here means no failure among these examples. The intervals are wide, especially where a split has a dozen cases.
- **The labeller also wrote the harness**, and read the product's code while designing the fixtures. The hostile hosts and injections are adversarial in intent but are the ones I thought of; a real attacker is not so limited.
- **Labels and matching are a reading.** Coverage matches labelled participants to live names by aliases I wrote; hard and soft are my reading of a sentence, which the product reads by its own word list; redundancy is measured at the granularity of the labels. Each could move a number; none could move the rules' coverage or recall near the thresholds.
- **A narrow fake web.** The fixture web is plain HTTP on loopback: no TLS, no real name service, no JavaScript, no large site. Near copies, hostile hosts and slow servers are one or two of each.
- **The safety set is scored against a scripted provider.** The refusal metrics show that the product surfaces what a provider decides; the decision itself is not measured.
- **Cost is a floor.** Input tokens are the product's real prompts; output tokens are those of the scripted replies; tokens are counted by the fake's usage (about 4 characters a token, where the product's own estimate uses 3) and priced at an operator's list price. Research, the simulation and the decision canvas are not in it.
- **Decision synthesis is only touched.** The brief is checked through the critics on planted flaws; its generation is not evaluated, and the rule critics are scored only on flaws I planted in one analysis.

## Extending it

Add cases to the JSON files with the next free id and a `split`, keep the halves comparable, write the label from the text first, and record any later change in `labelRevisions` with the reason. Do not tune a rule against `test`. A new suite (the research planner, a research run, the canvas) goes in as another observation and measure pair beside `ai-rules.ts` and `ai-measure-rules.ts`, with its rows added to `ai-report.ts` and its thresholds registered before its first result. To run the live mode, configure Foundry in the environment as the server does and use `npm run eval:ai:live`; read its report next to the fake's, and take a breach out of `known-breaches.json` only when the number says so.
