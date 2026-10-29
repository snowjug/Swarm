Gate: key-term coverage >= 0.4, best-passage score >= 0.1

### Retrieval (top four passages)

| split | questions | recall@4 | hit@1 | MRR   | irrelevant returned |
| ----- | --------- | -------- | ----- | ----- | ------------------- |
| dev   | 12        | 100.0%   | 75.0% | 0.861 | 2.167               |
| test  | 12        | 88.9%    | 83.3% | 0.875 | 1.833               |

### Analyst abstention

|                         | false abstain | abstention recall | refused by kind                                                        |
| ----------------------- | ------------- | ----------------- | ---------------------------------------------------------------------- |
| before (always answers) | 0.0%          | 0.0%              | -                                                                      |
| gate, dev               | 0.0%          | 57.1%             | off-topic 2/2, absent-year 2/2, absent-topic 0/1, plausible-absent 0/2 |
| gate, test              | 0.0%          | 85.7%             | off-topic 2/2, absent-year 1/1, absent-topic 2/2, plausible-absent 1/2 |

### Conflicts between sources

|                        | recall | deterministic recall | precision | detected | missed |
| ---------------------- | ------ | -------------------- | --------- | -------- | ------ |
| before (none reported) | 0.0%   | 0.0%                 | -         | 0        | -      |
| detector               | 33.3%  | 50.0%                | 100.0%    | 1        | K2, K3 |

### Statement support (deterministic checks only)

| split | claims | accuracy | unsupported accepted | false alarms | findings contaminated before | after      |
| ----- | ------ | -------- | -------------------- | ------------ | ---------------------------- | ---------- |
| dev   | 11     | 36.4%    | 2 (50.0%)            | 0.0%         | 54.5%                        | 75.0% of 4 |
| test  | 11     | 45.5%    | 1 (25.0%)            | 0.0%         | 54.5%                        | 60.0% of 5 |

### Injection patterns in sources

| samples | precision | recall | direct recall | false positives | missed   |
| ------- | --------- | ------ | ------------- | --------------- | -------- |
| 18      | 100.0%    | 80.0%  | 100.0%        | none            | I09, I10 |
