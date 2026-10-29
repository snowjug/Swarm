# Evaluation

Offline, deterministic checks of the parts of Swarm that decide how far a statement or an answer can be trusted. No model is called, so the results are reproducible and can run in CI. They measure the _rules around_ a model, not a model's quality; the live Azure scenario (`npm run azure:verify`) covers that separately.

```
npm run eval              # print the results
npm run eval -- --write   # also write evaluation/results/latest.{json,md}
npm run eval -- --sweep   # score the abstention gate's thresholds on the dev split
```

`evaluation/test/evaluation.test.ts` runs the same measurements under `npm test` and fails if a metric falls below `thresholds.json`, if a source file no longer matches the text the labels were written against, or if the harness's own arithmetic is wrong.

## What is measured

| Area                      | Question it answers                                                                                                          | Data                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Retrieval                 | Do the top four passages contain what the question needs? (recall@4, hit@1, MRR, irrelevant passages shown)                  | `datasets/retrieval.json` (24)     |
| Analyst abstention        | Does the analyst refuse questions the sources cannot answer, without refusing fair ones?                                     | `datasets/answerability.json` (28) |
| Conflicts between sources | Does the detector report real disagreements between sources, and nothing else?                                               | `datasets/contradictions.json` (3) |
| Statement support         | How often do the deterministic checks rate a statement correctly, and how many unsupported statements are shown as findings? | `datasets/claims.json` (22)        |
| Injection warnings        | Are instructions aimed at an AI flagged in uploaded sources, without flagging look-alike ordinary text?                      | `datasets/injection.json` (18)     |

All questions and statements are about the synthetic Larkholm ferry sources in `docs/demo/larkholm-ferry/`. Each source is pinned by SHA-256 in `src/corpus.ts`; change a source and the evaluation refuses to run until the labels are revisited.

## How it was built, and why you should not over-trust it

- **Labels were written by one person, from the source text, before looking at results.** They were not copied from any detector's output. A conflict a careful reader would flag (K1, K2) was labelled as expected even though the first detector missed it.
- **There is a dev/test split** (alternating questions). Thresholds were chosen on `dev` only. The raw scores of `test` were printed once while choosing a margin, so `test` is a sanity check, not a blind exam.
- **The sets are small and in-domain** (one fictional corpus; 3 conflicts, 18 injection samples). A metric of 100% here means "no failure among these examples", not a general guarantee. Confidence intervals are wide.
- **The author also wrote the rules.** The injection patterns, for example, were extended after seeing which labelled samples they missed, so the improvement is in-sample and is an upper bound.
- **Baselines are structural.** "Before" rows describe behaviour that did not exist at the starting commit (the analyst always answered; no conflict was ever reported). They are not a competing algorithm run on the same data.

## Results

See `results/latest.md` for the full tables. In summary, at the time of writing:

| Area                                  | Before                                                                         | Now                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Analyst abstention                    | always answered (0% refused)                                                   | 0% fair questions refused; refuses 43% (dev) / 86% (test) of unanswerable questions |
| Conflicts between sources             | none reported                                                                  | 1 of 3 found (the figure conflict), 1 of 1 reported was real; 2 missed (see below)  |
| Injection warnings                    | 30% of labelled samples                                                        | 80% (all 8 direct instructions); 0 false alarms on look-alike text; 2 known gaps    |
| Findings that are not fully supported | every statement shown as a finding (6 of 11 per split are not fully supported) | 3 unsupported statements shown as findings, out of the 4 to 5 that pass the checks  |

## What the evaluation shows is still weak

- **Abstention catches what has nothing to do with the sources, with one measured exception** (6 of 7 off-topic and absent-year questions). "What will the weather be like next Tuesday?" is let through because two of its three key terms appear in the project's own report and graph, which the analyst is also allowed to answer from. It does **not** reliably catch a plausible-sounding question whose answer is simply absent ("Which councillors voted against…?"): 1 of 4. Those cases depend on the model declining to answer, and on the rule that an analyst answer must cite a passage. They are measured only in a live model run.
- **A correction to this harness.** The first version showed the gate the sources alone, so it reported 57% (dev) and "always refused" for off-topic questions. The product also shows the gate the report, graph and recorded activity of the run (94 further passages here, from a deterministic local run). Measured the way the product runs it, dev recall is 43% and the weather question is a miss. The threshold floor was lowered from 0.55 to 0.40 for that reason and for no other. A report written by a real model contains other words, so these figures describe the local run.
- **Conflict detection finds figure conflicts stated in comparable words.** It misses a conflict that needs resolving "of these" and "of them" (K2) and a conflict of meaning (K3: "islanders overwhelmingly prefer…" against "71% oppose…"). A model-assisted pass would be needed for these, and is not built. It compares only sentences that one passage holds whole: passages overlap by 120 characters and begin mid-word, so the first and last sentence of a passage can be a cut fragment, and an earlier version reported conflicts between a document and its own fragments (an independent review measured this in about 12% of 200 random self-consistent 6,000-character documents). A sentence longer than the overlap that straddles a cut is held whole by no passage and is therefore not compared. The labelled sources here are all under 1.6 thousand characters, so this harness cannot see the effect; `backend/test/contradictions.test.ts` covers it by cutting a document at 600 offsets.
- **The deterministic support checks are weak on their own** (accuracy 36% dev / 45% test; across both splits they accept 3 of the 8 unsupported statements, because those reuse a source's wording). Word overlap cannot see meaning. In a model run an independent entailment check can lower a verdict, and that is not measured here. Withholding or labelling statements still halves the number of unsupported statements shown as findings (6 to 3 per split), but the _share_ of findings that are unsupported did not improve (55% before, 60% to 75% after), because few statements pass the checks at all.
- **Injection warnings miss obfuscated and non-English instructions.** Warnings are advisory. The structural defences (untrusted text is passed as data, models have no tools, outputs are schema-checked, echoing an embedded payload is rejected) do not depend on detection.
- **Retrieval returns about two irrelevant passages out of four** for each question, because it always returns the top four. Digits are not indexed, so a question that is only a figure ("Where does 58% come from?") leans on its other words.

## Extending it

Add cases to the JSON files with the next free id and a `split`, keep the dev and test halves comparable, and run `npm run eval`. Do not tune a rule against `test`. If a source document changes, re-read every label that mentions it, then update `PINNED_SOURCES`.
