import { afterEach, describe, expect, it } from 'vitest';
import type { Analysis } from '../../shared/analysis.js';
import type { BriefView, DecisionBrief } from '../../shared/brief.js';
import { EXAMPLE_SCENARIOS } from '../../shared/example-scenarios.js';
import type { ScenarioParseResult } from '../../shared/scenario.js';
import type { StakeholdersView } from '../../shared/stakeholders.js';
import { documentInputSchema, type ProjectDetail } from '../../shared/types.js';
import { buildApp } from '../src/app.js';
import { testConfig } from './fixtures.js';

// What the brief says for the example packs on the real engine, in rules mode: the decision a client
// reads first, the advice on the actors the runs name, and a plan of checks that belongs to the pack.

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 3_000; attempt += 1) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The condition was not reached in time.');
}

interface Journey {
  analysis: Analysis;
  brief: DecisionBrief;
}

async function walk(packId: string): Promise<Journey> {
  const pack = EXAMPLE_SCENARIOS.find((example) => example.id === packId)!;
  const instance = await buildApp({
    config: testConfig({ LOG_LEVEL: 'silent', RATE_LIMIT_SCALE: '100' }),
  });
  applications.push(instance);
  const { app } = instance;
  const ok = (response: { statusCode: number; body: string }, step: string) =>
    expect(response.statusCode, `${step}: ${response.body.slice(0, 300)}`).toBeLessThan(300);

  const reading = await app.inject({
    method: 'POST',
    url: '/api/scenario/parse',
    payload: {
      question: pack.question,
      documents: pack.documents.map((document) => ({
        name: document.name,
        characters: document.content.length,
      })),
    },
  });
  ok(reading, 'parse');
  const { frame } = reading.json() as ScenarioParseResult;
  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: {
      name: pack.title,
      question: pack.question,
      workflow: 'guided',
      documents: pack.documents.map((document) => documentInputSchema.parse(document)),
      scenario: frame,
      settings: { mode: 'local', agentCount: 6, rounds: 4, seed: 42, network: 'community' },
    },
  });
  ok(created, 'create');
  const base = `/api/projects/${(created.json() as ProjectDetail).id}`;

  const found = await app.inject({
    method: 'POST',
    url: `${base}/stakeholders/discover`,
    payload: { mode: 'rules' },
  });
  ok(found, 'discover');
  const approved = await app.inject({
    method: 'POST',
    url: `${base}/stakeholders/approve`,
    payload: { expectedRevision: (found.json() as StakeholdersView).revision },
  });
  ok(approved, 'approve');
  ok(await app.inject({ method: 'POST', url: `${base}/actors/generate`, payload: {} }), 'actors');
  const started = await app.inject({
    method: 'POST',
    url: `${base}/analysis`,
    payload: { runsPerVariant: 12, baseSeed: 2024, sensitivity: true },
  });
  ok(started, 'analysis');
  const id = (started.json().analysis as Analysis).id;
  const analysis = await until(
    async () => (await app.inject(`${base}/analysis/${id}`)).json().analysis as Analysis,
    (value) => !['running', 'queued'].includes(value.status),
  );
  expect(analysis.status, JSON.stringify(analysis.error)).toBe('completed');
  ok(await app.inject({ method: 'POST', url: `${base}/critiques/run`, payload: {} }), 'critiques');
  const written = await app.inject({ method: 'POST', url: `${base}/brief`, payload: {} });
  ok(written, 'brief');
  return { analysis, brief: (written.json() as BriefView).brief! };
}

const statements = (brief: DecisionBrief) =>
  brief.sections.flatMap((section) => section.statements);

describe('the brief for an example in which a competitor answers the change', () => {
  it('leads with the paired share and names the actor to prepare a response to', async () => {
    const { analysis, brief } = await walk('regional-price-change');

    // The lead is the engine's own measure, every group counting equally, not a count of members.
    expect(brief.headline).toMatch(
      /the mean share of simulated members looking for an alternative or resisting was about \d+(?:\.\d+)? in 100 under/u,
    );
    expect(brief.headline).not.toMatch(/\d\s?%/u);
    expect(brief.headline).not.toMatch(/about \d+ simulated members ended up/u);
    const answer = brief.sections.find((section) => section.id === 'executive-answer')!;
    expect(answer.statements[0]?.text).toMatch(/^Decision evaluated/u);
    expect(answer.statements[1]?.text).toMatch(/^Recommendation/u);
    expect(answer.statements[2]?.text).toContain('counting each of the');
    expect(answer.statements[2]?.origin).toBe('simulation-aggregation');

    // A competitor's counter-move that holds in most seeded runs is linked to the competitor.
    const events = analysis.findings.filter((finding) => finding.kind === 'second-order-event');
    const countered = events.find(
      (finding) =>
        finding.actorId !== null &&
        finding.statement.includes('counter-move') &&
        (finding.classification === 'repeatable' || finding.classification === 'mostly-repeatable'),
    );
    expect(countered, JSON.stringify(events.map((finding) => finding.statement))).toBeDefined();
    const actor = analysis.actors.find((entry) => entry.id === countered!.actorId)!;
    const prepare = brief.recommendations.find((recommendation) =>
      recommendation.text.startsWith(`Prepare a response to how “${actor.name}”`),
    );
    expect(
      prepare,
      brief.recommendations.map((recommendation) => recommendation.text).join('\n'),
    ).toBeDefined();
    expect(prepare?.text).toMatch(
      /In \d+ of \d+ seeded runs, a simulated "counter-move" event by/u,
    );
    expect(prepare?.linkedFindingIds).toContain(countered!.id);
    const statement = statements(brief).find((entry) => entry.text === prepare?.text);
    expect(statement?.origin).toBe('simulation-aggregation');
    expect(statement?.refs.findingIds).toContain(countered!.id);
    expect(statement?.refs.stakeholderIds).toContain(actor.stakeholderId);
  }, 180_000);
});

describe('the validation plan', () => {
  it('belongs to its pack: two packs get different checks, each in the pack’s own groups and measures', async () => {
    const regional = (await walk('regional-price-change')).brief;
    const support = (await walk('ai-first-support')).brief;
    // Repeating the run is the one check that is the same everywhere, and only when the headline needs it.
    const own = (brief: DecisionBrief) =>
      brief.validationPlan
        .filter((check) => !check.question.startsWith('Does the unstable result hold'))
        .map((check) => check.question);
    expect(own(regional).length).toBeGreaterThanOrEqual(2);
    expect(own(support).length).toBeGreaterThanOrEqual(2);
    expect(own(regional).filter((question) => own(support).includes(question))).toEqual([]);
    const names = (brief: DecisionBrief) => own(brief).join(' ');
    expect(names(regional)).toContain('price of a particular cloud service');
    expect(names(support)).not.toContain('price of a particular cloud service');
    for (const [brief, pack] of [
      [regional, EXAMPLE_SCENARIOS.find((example) => example.id === 'regional-price-change')!],
      [support, EXAMPLE_SCENARIOS.find((example) => example.id === 'ai-first-support')!],
    ] as const) {
      for (const check of brief.validationPlan) {
        // What to observe, what to compare it with, how long, who owns it, and a rule left for the person to set.
        expect(check.measure.length, check.id).toBeGreaterThan(20);
        expect(check.comparison.length, check.id).toBeGreaterThan(10);
        expect(check.ownerFunction.length, check.id).toBeGreaterThan(2);
        expect(check.duration, check.id).toMatch(/\d|day/u);
        expect(check.successSignal, check.id).toMatch(/before the check starts|beforehand/iu);
        // Nothing asks the world to match a number the simulation made up.
        const words = [
          check.question,
          check.measure,
          check.comparison,
          check.method,
          check.successSignal,
        ].join(' ');
        expect(words, check.id).not.toMatch(
          /\bstrength \d|-1 to 1|in line with the simulated|match the simulated/iu,
        );
      }
      // The plan is not the one generic check for every pack.
      const generic = brief.validationPlan.filter((check) =>
        check.question.startsWith('Does the unstable result hold'),
      );
      expect(generic.length, pack.id).toBeLessThanOrEqual(1);
    }
  }, 300_000);
});
