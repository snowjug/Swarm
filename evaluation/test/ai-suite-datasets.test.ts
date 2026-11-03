import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DECISION_STATUSES,
  HIGH_STAKES_DOMAINS,
  STATUS_RULES,
  STATUS_RULE_IDS,
  type DecisionStatus,
} from '../../shared/decision.js';
import { RESEARCH_STOP_REASONS } from '../../shared/research.js';
import { loadScenarios, loadSites } from '../src/ai-datasets.js';
import {
  loadDecisionCases,
  loadPlans,
  loadRunsFile,
  worldPageIds,
  type PlanCase,
} from '../src/ai-suite-data.js';
import { REPOSITORY_ROOT } from '../src/paths.js';

// The labels of the planner, run and decision suites were written before any of them was run. What
// is tested here is that they are what they claim to be: written from the text (every content word
// of a label is in the question), consistent with the documents they were derived from, covering
// what the registered metrics are about, and alternating between dev and test. Nothing here runs the
// product.

const wordsOf = (text: string): Set<string> =>
  new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => word));

const alternates = (splits: readonly string[]): boolean =>
  splits.every((split, index) => split === (index % 2 === 0 ? 'dev' : 'test'));

describe('the planner labels', () => {
  const plans = loadPlans();
  const scenarios = new Map(loadScenarios().map((scenario) => [scenario.id, scenario]));
  const questionOf = (item: PlanCase): string =>
    item.scenario ? (scenarios.get(item.scenario)?.question ?? '') : (item.question ?? '');
  const textOf = (item: PlanCase): string =>
    [questionOf(item), item.intake?.guidance, item.intake?.horizon, item.intake?.geography]
      .filter(Boolean)
      .join(' . ');

  it('has unique ids, alternates dev and test, and names a scenario that exists or a question', () => {
    expect(new Set(plans.cases.map((item) => item.id)).size).toBe(plans.cases.length);
    expect(alternates(plans.cases.map((item) => item.split))).toBe(true);
    for (const item of plans.cases) {
      expect(questionOf(item).length, item.id).toBeGreaterThan(12);
      expect(Boolean(item.scenario) !== Boolean(item.question), item.id).toBe(true);
    }
    expect(plans.cases.filter((item) => item.scenario)).toHaveLength(13);
  });

  it('writes every topic and claim from the words of the question, never from outside it', () => {
    for (const item of plans.cases) {
      const words = wordsOf(textOf(item));
      for (const label of [...item.topics, ...item.claims]) {
        for (const slot of label.slots) {
          expect(
            slot.some((alternative) => words.has(alternative.toLowerCase())),
            `${item.id} ${label.id}: no word of [${slot.join(', ')}] is in the question`,
          ).toBe(true);
        }
      }
    }
  });

  it('names an entity as the question does: a name in capitals as it is written, a thing in any case', () => {
    for (const item of plans.cases) {
      const written = textOf(item);
      const lower = written.toLowerCase();
      for (const entity of item.entities) {
        const names = [entity.name, ...entity.aliases];
        const found = names.some((name) =>
          entity.named ? written.includes(name) : lower.includes(name.toLowerCase()),
        );
        expect(found, `${item.id}: ${entity.name} is not in the question`).toBe(true);
        if (entity.named) {
          expect(/^\p{Lu}/u.test(entity.name), `${item.id}: ${entity.name}`).toBe(true);
        }
      }
    }
    const named = plans.cases.flatMap((item) => item.entities.filter((entity) => entity.named));
    expect(named.length).toBeGreaterThanOrEqual(12);
  });

  it('seeds each injection with a marker that is in the question or the guidance, and nothing else', () => {
    expect(plans.injections.length).toBeGreaterThanOrEqual(6);
    expect(alternates(plans.injections.map((item) => item.split))).toBe(true);
    for (const item of plans.injections) {
      const written = `${item.question} ${item.guidance ?? ''}`;
      for (const marker of item.markers) expect(written, item.id).toContain(marker);
      if (item.bait) expect(written, item.id).toContain(item.bait);
    }
  });

  it('lists each corruption class once, with the reason the contract gives', () => {
    const ids = plans.corruptions.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plans.corruptions.filter((item) => item.expect === 'accepted')).toHaveLength(1);
    expect(plans.corruptions.filter((item) => item.expect === 'rejected').length).toBeGreaterThan(
      12,
    );
  });
});

describe('the decision labels', () => {
  const { cases, file } = loadDecisionCases();
  const scenarios = new Set(loadScenarios().map((scenario) => scenario.id));
  const ruleStatus = new Map(STATUS_RULES.map((rule) => [rule.id, rule.status]));
  const kindOf: Record<DecisionStatus, readonly string[]> = {
    'robust-option': ['proceed', 'keep-no-change'],
    'conditional-option': ['proceed', 'keep-no-change'],
    'multiple-plausible-options': ['hold'],
    'insufficient-evidence': ['gather-evidence'],
    'blocked-by-hard-constraint': ['resolve-constraint'],
    'needs-human-decision': ['decide'],
  };

  it('has unique ids, alternates dev and test, and a scenario that exists for a scenario cast', () => {
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
    expect(alternates(cases.map((item) => item.split))).toBe(true);
    for (const item of cases) {
      if (item.cast === 'scenario') expect(scenarios.has(item.scenario ?? ''), item.id).toBe(true);
    }
  });

  it('gives each fixture a rule whose status is its status, in the document’s own table', () => {
    for (const item of cases) {
      for (const rule of item.gold.rules) {
        expect(ruleStatus.get(rule), `${item.id} ${rule}`).toBe(item.gold.status);
      }
    }
  });

  it('gives each status the recommendation the status table gives, and keeps conditions where there are some', () => {
    for (const item of cases) {
      const { gold } = item;
      expect(kindOf[gold.status], item.id).toContain(gold.recommendation);
      const ids = new Set(item.options.map((option) => option.id));
      if (gold.preferred !== null) expect(ids.has(gold.preferred), item.id).toBe(true);
      for (const leader of Object.values(gold.leaders)) {
        if (leader !== null) expect(ids.has(leader), item.id).toBe(true);
      }
      const baseline = item.options.find((option) => option.kind === 'baseline')?.id;
      expect(gold.recommendation === 'keep-no-change', item.id).toBe(
        gold.preferred !== null && gold.preferred === baseline,
      );
      expect(gold.preferred !== null, item.id).toBe(
        ['robust-option', 'conditional-option'].includes(gold.status),
      );
      expect(gold.conditions > 0, item.id).toBe(gold.status === 'conditional-option');
      for (const constraint of item.constraints?.items ?? []) {
        for (const out of constraint.rulesOut ?? []) expect(ids.has(out), item.id).toBe(true);
      }
    }
  });

  it('reaches every status at least four times and every rule at least once', () => {
    for (const status of DECISION_STATUSES) {
      expect(
        cases.filter((item) => item.gold.status === status).length,
        status,
      ).toBeGreaterThanOrEqual(4);
    }
    const reached = new Set(cases.flatMap((item) => item.gold.rules));
    for (const rule of STATUS_RULE_IDS) expect(reached.has(rule), rule).toBe(true);
  });

  it('puts the lens cases where the registered metric needs them: agreement, disagreement and a lens that is level', () => {
    expect(cases.filter((item) => item.gold.agreement === 'agree').length).toBeGreaterThanOrEqual(
      5,
    );
    expect(
      cases.filter((item) => item.gold.agreement === 'disagree').length,
    ).toBeGreaterThanOrEqual(3);
    const level = cases.filter((item) => Object.values(item.gold.leaders).includes(null));
    expect(level.length).toBeGreaterThanOrEqual(5);
    expect(file.defaults.runs).toBe(20);
  });
});

// The fixtures about the scope check were written after the rule existed, so they have no
// pre-registered gold. What is held here is that they are what they claim to be: questions from the
// document's own forms, balanced across the five matters and both splits, with look-alikes that the
// rule must not fire on, and gold that says what the document says and no more.
describe('the labels of the scope check', () => {
  const { cases } = loadDecisionCases();
  const asked = cases.filter((item) => item.question !== null);
  const aboutOne = asked.filter((item) => item.gold.rules.includes('individual-decision'));
  const lookalikes = asked.filter((item) => item.gold.scope?.individual === false);

  it('has at least six questions about one person, two in each of the five matters, and at least four look-alikes', () => {
    expect(aboutOne.length).toBeGreaterThanOrEqual(6);
    for (const domain of HIGH_STAKES_DOMAINS) {
      expect(
        aboutOne.filter((item) => item.gold.scope?.domains?.includes(domain)).length,
        domain,
      ).toBeGreaterThanOrEqual(2);
    }
    expect(lookalikes.length).toBeGreaterThanOrEqual(4);
    expect(aboutOne.length + lookalikes.length).toBe(asked.length);
  });

  it('puts both splits in every matter and among the look-alikes', () => {
    for (const domain of HIGH_STAKES_DOMAINS) {
      const splits = new Set(
        aboutOne
          .filter((item) => item.gold.scope?.domains?.includes(domain))
          .map((item) => item.split),
      );
      expect([...splits].sort(), domain).toEqual(['dev', 'test']);
    }
    expect(new Set(lookalikes.map((item) => item.split)).size).toBe(2);
  });

  it('gives a question about one person the human decision, the kind decide and no preferred option, whatever else is true of its comparison', () => {
    for (const item of aboutOne) {
      const { gold } = item;
      expect(gold.rules, item.id).toEqual(['individual-decision']);
      expect(gold.status, item.id).toBe('needs-human-decision');
      expect(gold.recommendation, item.id).toBe('decide');
      expect(gold.preferred, item.id).toBeNull();
      expect(gold.scope?.individual, item.id).toBe(true);
      expect(gold.scope?.domains?.length, item.id).toBeGreaterThan(0);
    }
    // Rule 1 comes before a missing comparison, a blocked gate, no source and a value trade-off: each is put to it.
    const shapes = new Set(
      aboutOne.flatMap((item) => [
        item.options.length === 1 ? 'one option' : '',
        item.constraints?.items.some((entry) => entry.category === 'legal') ? 'blocked gate' : '',
        item.evidence.documents === 'none' ? 'no source' : '',
        item.options.some(
          (option) => typeof option.adverse === 'object' && Object.keys(option.adverse).length > 1,
        )
          ? 'trade-off'
          : '',
      ]),
    );
    for (const shape of ['one option', 'blocked gate', 'no source', 'trade-off'])
      expect(shapes.has(shape), shape).toBe(true);
  });

  it('gives a look-alike an ordinary rule and the status the clear comparison gives, and a scope that is not about one person', () => {
    for (const item of lookalikes) {
      expect(item.gold.rules, item.id).not.toContain('individual-decision');
      expect(item.gold.status, item.id).toBe('robust-option');
      expect(item.gold.preferred, item.id).toBe('proposed-change');
      expect(item.gold.scope?.individual, item.id).toBe(false);
      expect(item.gold.scope?.names, item.id).toBeUndefined();
    }
  });

  it('names a person only where the question holds the name, and keeps every question its own', () => {
    for (const item of asked) {
      const question = item.question ?? '';
      for (const name of item.gold.scope?.names ?? []) {
        expect(question, `${item.id} ${name}`).toContain(name);
      }
    }
    const questions = asked.map((item) => item.question);
    expect(new Set(questions).size).toBe(questions.length);
    // None is one of the rows of the document's table word for word: the fixtures are new evidence, not its examples.
    const document = readFileSync(
      join(REPOSITORY_ROOT, 'docs', 'analysis', 'decision-canvas.md'),
      'utf8',
    );
    const rows = [...document.matchAll(/^\| ([A-Z][^|]*\?) +\|/gmu)].map((match) =>
      (match[1] ?? '').trim().toLowerCase(),
    );
    expect(rows.length).toBeGreaterThanOrEqual(9);
    for (const question of questions)
      expect(rows, question ?? '').not.toContain(question?.toLowerCase());
  });
});

describe('the research-run labels', () => {
  const file = loadRunsFile();
  const sites = loadSites();
  const plans = loadPlans();
  const pageIds = new Set([
    ...sites.pages.map((page) => page.id),
    ...file.worlds.flatMap((world) => worldPageIds(world)),
  ]);
  const hosts = new Set([...Object.keys(sites.hosts), ...Object.keys(file.hosts)]);
  const world = (id: string) => file.worlds.find((item) => item.id === id)!;

  it('has unique ids, alternates dev and test, and names questions, pages and hosts that exist', () => {
    expect(new Set(file.cases.map((item) => item.id)).size).toBe(file.cases.length);
    expect(alternates(file.cases.map((item) => item.split))).toBe(true);
    expect(new Set(file.worlds.map((item) => item.id)).size).toBe(file.worlds.length);
    for (const item of file.cases) {
      expect(file.questions[item.question], item.id).toBeDefined();
      if (item.guidance) expect(file.questions[item.guidance], item.id).toBeDefined();
      for (const start of [item.start, ...(item.adds ?? [])]) {
        if (start !== null && !start.startsWith('http'))
          expect(pageIds.has(start), start).toBe(true);
      }
      for (const page of [
        ...Object.keys(item.gold.outcomes ?? {}),
        ...(item.gold.notFetched ?? []),
        ...(item.gold.opposing ?? []).flat(),
        ...(item.gold.hostileNeverGovernmentHigh ?? []),
      ]) {
        expect(pageIds.has(page), `${item.id}: ${page}`).toBe(true);
      }
      for (const host of item.gold.neverRequestedHosts ?? [])
        expect(hosts.has(host), host).toBe(true);
      if (item.model) {
        expect(
          plans.cases.some((plan) => plan.id === item.model?.base),
          item.id,
        ).toBe(true);
        if (item.model.suggest) expect(hosts.has(item.model.suggest)).toBe(true);
      }
    }
    for (const item of file.worlds) {
      expect(hosts.has(item.host), item.id).toBe(true);
      for (const host of [...(item.childHosts ?? []), item.a?.host, item.b?.host]) {
        if (host) expect(hosts.has(host), `${item.id} ${host}`).toBe(true);
      }
    }
  });

  it('reaches every stop reason a budget can decide, once at least, with the world that reasoning needs', () => {
    const stops = new Set(file.cases.map((item) => item.gold.stop).filter(Boolean));
    for (const stop of RESEARCH_STOP_REASONS.filter(
      (reason) => !['cancelled', 'cost-limit'].includes(reason),
    )) {
      expect(stops.has(stop), stop).toBe(true);
    }
    const w = (id: string) => world(id);
    expect(w('W1').children).toBeGreaterThan(3);
    expect(w('W2').childHosts?.length).toBeGreaterThanOrEqual(3);
    expect(w('W3').bytes).toBeGreaterThanOrEqual(6_000);
    expect(w('W4').children).toBeGreaterThanOrEqual(3);
    expect(w('W5').broken?.length).toBeGreaterThanOrEqual(2);
    expect(w('W6').copies).toBe(true);
    expect(w('W6').children).toBeGreaterThanOrEqual(3);
    expect(w('W8').shuffle).toBe(true);
    expect(w('W8').children).toBeGreaterThanOrEqual(5);
    expect(w('W9').children).toBeGreaterThanOrEqual(11);
    expect(w('W10').bytes).toBeGreaterThan(40_000);
    expect(w('W10').children).toBeGreaterThanOrEqual(6);
  });

  it('says in each note of the evidence world the claim the question makes, in the question’s own words', () => {
    const say = world('W7').say ?? '';
    const question = file.questions['pool'] ?? '';
    const words = wordsOf(say);
    for (const word of ['westbrook', 'pool', 'evening', 'swim', 'fee']) {
      expect(words.has(word), word).toBe(true);
      expect(wordsOf(question).has(word), word).toBe(true);
    }
  });

  it('labels both sides of each disagreement with figures that differ for the same fee', () => {
    const { authority, operators } = file.feeSentences;
    expect(authority).toContain('3.40');
    expect(operators).toContain('3.90');
    expect(authority.replace('3.40', '').trim()).not.toBe(operators.replace('3.90', '').trim());
    expect(wordsOf(authority).has('berthing')).toBe(true);
    expect(wordsOf(operators).has('berthing')).toBe(true);
  });

  it('covers every kind of run the registered metrics are about', () => {
    const has = (check: (item: (typeof file.cases)[number]) => boolean): boolean =>
      file.cases.some(check);
    expect(has((item) => item.mode === 'rules' && item.start === null)).toBe(true);
    expect(has((item) => item.mode === 'model' && item.start === null)).toBe(true);
    expect(has((item) => (item.gold.opposing?.length ?? 0) > 0)).toBe(true);
    expect(has((item) => item.gold.diversity !== undefined)).toBe(true);
    expect(has((item) => item.gold.injectionLinesLabelled === true)).toBe(true);
    expect(has((item) => item.gold.injectionObeyed === false)).toBe(true);
    expect(has((item) => (item.budgetArms?.length ?? 0) >= 3)).toBe(true);
    expect(has((item) => item.gold.suggestionShown !== undefined)).toBe(true);
    expect(file.cases.filter((item) => item.gold.outcomes).length).toBeGreaterThanOrEqual(6);
  });
});
