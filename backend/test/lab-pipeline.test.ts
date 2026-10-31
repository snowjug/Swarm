import { afterEach, describe, expect, it } from 'vitest';
import type { Analysis } from '../../shared/analysis.js';
import { BRIEF_SECTION_IDS, type BriefView } from '../../shared/brief.js';
import type { CritiquesView } from '../../shared/critique.js';
import { actorSetFixture, scenarioFixture } from '../../shared/lab-fixtures.js';
import { buildApp } from '../src/app.js';
import { fixtureInput, testConfig } from './fixtures.js';

// The comparison of scenarios, the independent review and the decision brief, joined by the real
// simulation engine rather than a stand-in: what one produces is what the next reads.

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The condition was not reached in time.');
}

async function world() {
  const instance = await buildApp({
    config: testConfig({ LOG_LEVEL: 'silent', RATE_LIMIT_SCALE: '50' }),
  });
  applications.push(instance);
  const { app, repository } = instance;
  const project = repository.create(fixtureInput({ workflow: 'guided' }));
  repository.artifacts.put(project.id, 'actors', 'default', actorSetFixture());
  repository.artifacts.put(project.id, 'scenario', 'default', scenarioFixture());
  const base = `/api/projects/${project.id}`;

  const compare = async (payload: object): Promise<Analysis> => {
    const started = await app.inject({ method: 'POST', url: `${base}/analysis`, payload });
    expect(started.statusCode, started.body).toBe(202);
    const id = (started.json().analysis as Analysis).id;
    return until(
      async () => (await app.inject(`${base}/analysis/${id}`)).json().analysis as Analysis,
      (analysis) => !['running', 'queued'].includes(analysis.status),
    );
  };
  return { ...instance, project, base, compare };
}

describe('scenario comparison on the real engine', () => {
  it('compares a baseline with the proposed change and its alternatives, and can be repeated exactly', async () => {
    const { compare } = await world();
    const options = { runsPerVariant: 10, baseSeed: 4242, sensitivity: true };
    const first = await compare(options);
    expect(first.status, JSON.stringify(first.error)).toBe('completed');
    expect(first.variants.length).toBeGreaterThanOrEqual(2);
    for (const variant of first.variants) {
      expect(variant.runs).toHaveLength(10);
      for (const run of variant.runs) {
        expect(run.stanceMean).toBeGreaterThanOrEqual(-1);
        expect(run.stanceMean).toBeLessThanOrEqual(1);
      }
    }
    expect(first.findings.length).toBeGreaterThan(0);
    for (const finding of first.findings) {
      expect(finding.holdsIn).toBeLessThanOrEqual(finding.of);
      expect(finding.statement).toContain('simulated');
    }
    expect(first.sensitivity.length).toBeGreaterThan(0);
    expect(first.fidelity.engine).toBe('rules');
    expect(first.cost.modelCalls).toBe(0);

    const second = await compare(options);
    expect(second.status).toBe('completed');
    expect(second.variants.map((variant) => variant.runs)).toEqual(
      first.variants.map((variant) => variant.runs),
    );
    expect(second.findings.map((finding) => finding.statement)).toEqual(
      first.findings.map((finding) => finding.statement),
    );
  });

  it('refuses, before running anything, a scenario that names an actor who is not in the cast', async () => {
    const { app, base } = await world();
    const refused = await app.inject({
      method: 'POST',
      url: `${base}/analysis`,
      payload: {
        runsPerVariant: 5,
        sensitivity: false,
        variants: [
          {
            id: 'baseline',
            label: 'Baseline',
            kind: 'baseline',
            description: 'Nothing changes.',
            intensity: 0,
            round: 1,
            impactOverrides: {},
            traitEdits: [],
          },
          {
            id: 'broken',
            label: 'Broken',
            kind: 'alternative',
            description: 'Names someone who is not there.',
            intensity: 0.5,
            round: 1,
            impactOverrides: { 'nobody-here': 0.5 },
            traitEdits: [],
          },
        ],
      },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code).toBe('ANALYSIS_INPUT_INVALID');
    expect(refused.body).not.toContain('nobody-here');
    const saved = (await app.inject(`${base}/analysis`)).json().analyses;
    expect(saved).toEqual([]);
  });
});

describe('from a finished comparison to the decision brief', () => {
  it('reviews it independently and writes a brief whose every statement says where it comes from', async () => {
    const { app, base, compare } = await world();
    const analysis = await compare({ runsPerVariant: 10, baseSeed: 77, sensitivity: true });
    expect(analysis.status).toBe('completed');

    const review = await app.inject({ method: 'POST', url: `${base}/critiques/run`, payload: {} });
    expect(review.statusCode, review.body).toBeLessThan(300);
    const critiques = (review.json() as CritiquesView).critiques;
    expect(critiques?.analysisId).toBe(analysis.id);
    expect(critiques?.critiques.length).toBeGreaterThan(0);
    expect(critiques?.mode).toBe('rules');

    const made = await app.inject({ method: 'POST', url: `${base}/brief`, payload: {} });
    expect(made.statusCode, made.body).toBe(201);
    const { brief, visuals } = made.json() as BriefView;
    expect(brief?.analysisId).toBe(analysis.id);
    expect(brief?.sections.map((section) => section.id)).toEqual([...BRIEF_SECTION_IDS]);
    for (const section of brief?.sections ?? []) {
      for (const statement of section.statements) {
        expect(statement.origin, statement.text).toBeTruthy();
      }
    }
    expect(brief?.recommendations.length).toBeGreaterThan(0);
    for (const recommendation of brief?.recommendations ?? []) {
      expect(recommendation.linkedFindingIds.length).toBeGreaterThan(0);
    }
    expect(brief?.validationPlan.length).toBeGreaterThan(0);
    expect(brief?.limitations.length).toBeGreaterThan(0);
    expect(brief?.openCritiques).toBeGreaterThan(0);
    expect(visuals?.scenarioComparison.length).toBeGreaterThan(0);
    expect(visuals?.outcomeDistribution.length).toBeGreaterThan(0);

    for (const format of ['md', 'json', 'html'] as const) {
      const exported = await app.inject(`${base}/brief/export?format=${format}`);
      expect(exported.statusCode, format).toBe(200);
      expect(exported.body.length, format).toBeGreaterThan(500);
    }
    const html = await app.inject(`${base}/brief/export?format=html`);
    expect(html.headers['content-security-policy']).toContain("default-src 'none'");
  });
});
