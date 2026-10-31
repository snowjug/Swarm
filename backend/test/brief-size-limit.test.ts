import { afterEach, describe, expect, it } from 'vitest';
import type { Analysis, Variant } from '../../shared/analysis.js';
import { type BriefView, type DecisionBrief } from '../../shared/brief.js';
import {
  FIXTURE_VARIANTS,
  actorFixture,
  actorSetFixture,
  scenarioFixture,
} from '../../shared/lab-fixtures.js';
import type { Actor } from '../../shared/stakeholders.js';
import { buildApp } from '../src/app.js';
import { fixtureInput, testConfig } from './fixtures.js';
import { stubSimulator } from './support/stub-simulator.js';

// A comparison that a person may ask for, in full: the server keeps what fits in a stored document and
// drops the per-actor result of each run when it does not. The brief and its exports must read what was
// kept, and must not read a result that was not kept as an absence of members.

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

const cast = (count: number): Actor[] =>
  Array.from({ length: count }, (_, index) => {
    const actor = actorFixture(
      `group-${String(index).padStart(2, '0')}`,
      index === 0 ? 'competitor' : index === 1 ? 'regulator' : 'cost-bearer',
      index < 3 ? { kind: 'key', size: 1, sampleSize: 1 } : { size: 2_000, sampleSize: 12 },
    );
    actor.traits.influence.value = 1 - index / 100;
    return actor;
  });

const VARIANTS: Variant[] = [
  ...FIXTURE_VARIANTS.slice(0, 2),
  {
    id: 'milder-change',
    label: 'Milder change',
    kind: 'alternative',
    description: 'The same change at lower intensity.',
    round: 2,
    intensity: 0.3,
    impactOverrides: {},
    traitEdits: [],
  },
  {
    id: 'stronger-change',
    label: 'Stronger change',
    kind: 'alternative',
    description: 'The same change at higher intensity.',
    round: 2,
    intensity: 0.95,
    impactOverrides: {},
    traitEdits: [],
  },
];

async function world() {
  const instance = await buildApp({
    config: testConfig({ LOG_LEVEL: 'silent', RATE_LIMIT_SCALE: '50' }),
    analysis: { simulator: stubSimulator },
  });
  applications.push(instance);
  const { app, repository } = instance;
  const project = repository.create(fixtureInput({ workflow: 'guided' }));
  repository.artifacts.put(project.id, 'actors', 'default', {
    ...actorSetFixture(),
    actors: cast(14),
    relations: [],
  });
  repository.artifacts.put(project.id, 'scenario', 'default', scenarioFixture());
  const base = `/api/projects/${project.id}`;

  const analyse = async (runsPerVariant: number): Promise<Analysis> => {
    const started = await app.inject({
      method: 'POST',
      url: `${base}/analysis`,
      payload: { runsPerVariant, baseSeed: 77, variants: VARIANTS, sensitivity: false },
    });
    expect(started.statusCode, started.body).toBe(202);
    const id = (started.json().analysis as Analysis).id;
    for (let attempt = 0; attempt < 3_000; attempt += 1) {
      const analysis = (await app.inject(`${base}/analysis/${id}`)).json().analysis as Analysis;
      if (!['running', 'queued'].includes(analysis.status)) return analysis;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('The comparison did not finish in time.');
  };
  const briefOf = async (analysisId: string): Promise<BriefView> => {
    const review = await app.inject({ method: 'POST', url: `${base}/critiques/run`, payload: {} });
    expect(review.statusCode, review.body).toBeLessThan(300);
    const made = await app.inject({
      method: 'POST',
      url: `${base}/brief`,
      payload: { analysisId },
    });
    expect(made.statusCode, made.body).toBe(201);
    return made.json() as BriefView;
  };
  const exported = async (format: 'md' | 'json' | 'html'): Promise<string> => {
    const response = await app.inject(`${base}/brief/export?format=${format}`);
    expect(response.statusCode, format).toBe(200);
    return response.body;
  };
  return { ...instance, project, base, analyse, briefOf, exported };
}

const statementsOf = (brief: DecisionBrief) =>
  brief.sections.flatMap((section) => section.statements);
const everyText = (brief: DecisionBrief): string =>
  [brief.headline, ...statementsOf(brief).map((statement) => statement.text)].join('\n');

// The old brief said "of 0 simulated members each, about 0 simulated members ended up…" here.
const NO_MEMBERS = /\b0 simulated members\b|\bits 0 simulated\b|\babout 0 simulated\b/u;
const LEAD =
  /the mean share of simulated members looking for an alternative or resisting was about (\d+(?:\.\d+)?) in 100 under “Proposed change” against (\d+(?:\.\d+)?) in 100 under “No change”/u;

describe('a comparison of the largest size a person may ask for', () => {
  it('has its per-run detail dropped to fit, and still gives the brief what was kept', async () => {
    const small = await world();
    const fits = await small.analyse(100);
    const large = await (await world()).analyse(200);
    expect(fits.variants[0]?.runs[0]?.byActor).toHaveLength(14);
    expect(large.variants.length).toBe(4);
    for (const result of large.variants) {
      expect(result.runs[0]?.byActor).toEqual([]);
      expect(result.actors).toHaveLength(14);
    }
    expect(large.fidelity.caveats.join(' ')).toContain('were not stored');
  }, 120_000);

  it('reports the retained per-group totals, never zero simulated members, and agrees with the same analysis that fits', async () => {
    const kept = await world();
    const whole = await kept.analyse(100);
    const wholeBrief = (await kept.briefOf(whole.id)).brief!;

    const dropped = await world();
    const analysis = await dropped.analyse(200);
    expect(analysis.variants[0]?.runs[0]?.byActor).toEqual([]);
    const view = await dropped.briefOf(analysis.id);
    const brief = view.brief!;
    const text = everyText(brief);

    expect(text).not.toMatch(NO_MEMBERS);
    expect(brief.headline).toMatch(LEAD);
    const leadOf = (headline: string) => {
      const match = LEAD.exec(headline)!;
      return { change: Number(match[1]), baseline: Number(match[2]) };
    };
    const [now, then] = [leadOf(brief.headline), leadOf(wholeBrief.headline)];
    expect(Math.abs(now.change - then.change)).toBeLessThan(3);
    expect(Math.abs(now.baseline - then.baseline)).toBeLessThan(3);
    expect(now.change).toBeGreaterThan(now.baseline);
    expect(brief.headline).toContain('higher under the change in 200 of 200 paired runs');

    // The groups are read from the totals: the shares are there, and no per-group paired count is invented.
    const groups = statementsOf(brief).filter((statement) => statement.origin === 'actor-behavior');
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.map((statement) => statement.text).join('\n')).not.toContain('paired');
    expect(text).toContain('the per-run results were not stored');
    expect(text).toMatch(/about [1-9]\d*(?:\.\d+)? more of its 12 simulated members/u);

    // Advice names the group once, and rests on the change that is proposed.
    const advice = brief.recommendations.map((recommendation) => recommendation.text);
    expect(
      advice.filter((entry) => entry.startsWith('Prepare a response to how “Group 00”')),
    ).toHaveLength(1);
    expect(advice.some((entry) => /Mitigate or stage the change for “Group/u.test(entry))).toBe(
      true,
    );
    expect(advice.join('\n')).not.toMatch(/under “(?:Milder|Stronger) change” than under/u);
    expect(
      (
        brief.sections.find((section) => section.id === 'executive-answer')?.statements[1]?.text ??
        ''
      ).match(/“Group 00”/gu),
    ).toHaveLength(1);
  }, 120_000);

  it('says the same in the Markdown, the page and the data', async () => {
    const { analyse, briefOf, exported } = await world();
    const analysis = await analyse(200);
    expect(analysis.variants[0]?.runs[0]?.byActor).toEqual([]);
    const { brief } = await briefOf(analysis.id);

    const markdown = await exported('md');
    const html = await exported('html');
    for (const [format, body] of [
      ['md', markdown],
      ['html', html],
    ] as const) {
      expect(body, format).not.toMatch(NO_MEMBERS);
      expect(body, format).not.toMatch(/\b(?:NaN|undefined)\b/u);
      expect(body, format).toContain('none is a measured population rate');
      expect(body, format).toContain('the per-run results were not stored');
    }
    expect(markdown.replace(/\\(.)/gu, '$1')).toContain(brief!.headline);
    expect(markdown).toContain('how many members were sampled for each group');

    const data = JSON.parse(await exported('json')) as {
      brief: DecisionBrief;
      data: BriefView['visuals'];
    };
    expect(data.brief.headline).toBe(brief!.headline);
    const outcomes = data.data?.outcomeDistribution ?? [];
    expect(outcomes).toHaveLength(4);
    for (const row of outcomes) {
      expect(row.perRun).toBe(false);
      expect(row.members).toBe(135);
      expect(row.adverse?.min).toBeNull();
      expect(row.adverseShare.mean).toBeGreaterThanOrEqual(0);
      expect(row.shares.reduce((total, entry) => total + entry.mean, 0)).toBeCloseTo(1, 1);
    }
    const comparison = data.data?.scenarioComparison.find(
      (row) => row.variantId === 'proposed-change',
    );
    expect(comparison?.members).toBe(135);
    expect(comparison?.shareDelta).toBeGreaterThan(0.3);
    expect(comparison?.adverseDelta).toBeGreaterThan(0);
  }, 120_000);
});
