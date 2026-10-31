import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { Analysis } from '../../shared/analysis.js';
import { BRIEF_SECTION_IDS, type BriefView } from '../../shared/brief.js';
import type { CritiquesView } from '../../shared/critique.js';
import { EXAMPLE_SCENARIOS, type ExampleScenario } from '../../shared/example-scenarios.js';
import type { ScenarioParseResult } from '../../shared/scenario.js';
import { NO_DIRECTION_NOTICE, changeCanMoveAnyone } from '../../shared/signal.js';
import {
  TRAIT_ORIGINS,
  type ActorsView,
  type StakeholdersView,
} from '../../shared/stakeholders.js';
import { documentInputSchema, type ProjectDetail } from '../../shared/types.js';
import { buildApp } from '../src/app.js';
import { PublicFetcher } from '../src/ingest/url/fetcher.js';
import { testConfig } from './fixtures.js';
import { startServer, type TestServer } from './support/url-server.js';

// What a person does with any "what could happen if...?" question, from the question to the brief,
// through the same routes the pages use, on the real engine and with no model: the three flagship
// examples, the two others, and a question of the person's own. Nothing here knows a domain.

type Application = Awaited<ReturnType<typeof buildApp>>;
const applications: Application[] = [];
const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The condition was not reached in time.');
}

interface Pack {
  title: string;
  question: string;
  documents: ExampleScenario['documents'];
}

const CUSTOM: Pack = {
  title: 'Library late fees',
  question:
    'What could happen if the city library network stops charging late fees on all borrowed items?',
  documents: [
    {
      name: 'council-briefing.md',
      content: `# Briefing for the council committee

_Illustrative synthetic briefing written for a test; the figures are invented._

The city library network is considering an end to late fees on all borrowed items. Library patrons have asked for it for years, and families with children say fines keep them away. The library board expects some books to come back later, and the branch librarians worry about shelves staying empty while items are overdue.

The city council must approve the change, and the finance committee has asked what the fees currently bring in. Fees pay for a small share of the budget; the council's budget office has not yet checked the figure. Volunteers who run the community reading programmes say they would welcome fewer arguments at the desk.

Local bookshops and a neighbouring county library system have not been consulted. A taxpayers' association has said before that it dislikes any change that moves costs onto the general budget.
`,
      provenance: { kind: 'paste' },
    },
    {
      name: 'branch-notes.md',
      content: `# Notes from three branch librarians

_Illustrative synthetic notes written for a test._

Two of the three librarians favour the change but want a way to deal with items that never come back. One says patrons who owe money often stop visiting, and the staff dislike turning people away. The third worries that popular titles will be unavailable for longer, and that patrons will not mind because there is no cost to keeping them.

Patrons who rely on the libraries for computer access are the most affected by blocked accounts. The volunteers say new readers are often the ones who give up first.
`,
      provenance: { kind: 'paste' },
    },
  ],
};

const FLAGSHIPS = EXAMPLE_SCENARIOS.map((example) => example as Pack);

async function world(options: { fetchFrom?: TestServer } = {}) {
  const config = testConfig({
    LOG_LEVEL: 'silent',
    RATE_LIMIT_SCALE: '100',
    ...(options.fetchFrom ? { URL_INGEST_ALLOWED_PORTS: String(options.fetchFrom.port) } : {}),
  });
  const instance = await buildApp({
    config,
    ...(options.fetchFrom ? { urlFetcher: new PublicFetcher({ allowPrivateForTests: true }) } : {}),
  });
  applications.push(instance);
  return instance;
}

interface Journey {
  project: ProjectDetail;
  analysis: Analysis;
  critiques: CritiquesView;
  brief: BriefView;
  stakeholders: StakeholdersView;
  actors: ActorsView;
}

/** The whole path, one call after another, checking each step as a person would see it. */
async function walk(instance: Application, pack: Pack): Promise<Journey> {
  const { app } = instance;
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
  expect(reading.statusCode, reading.body).toBe(200);
  const { frame, mode } = reading.json() as ScenarioParseResult;
  expect(mode).toBe('rules');
  expect(frame.decision.length).toBeGreaterThan(0);

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
  expect(created.statusCode, created.body).toBe(201);
  const project = created.json() as ProjectDetail;
  const base = `/api/projects/${project.id}`;

  const stored = await app.inject(`${base}/scenario`);
  expect(stored.json().scenario?.decision).toBe(frame.decision);

  const found = await app.inject({
    method: 'POST',
    url: `${base}/stakeholders/discover`,
    payload: { mode: 'rules' },
  });
  expect(found.statusCode, found.body).toBe(201);
  const discovered = found.json() as StakeholdersView;
  expect(discovered.stakeholders?.stakeholders.length).toBeGreaterThanOrEqual(3);

  const approved = await app.inject({
    method: 'POST',
    url: `${base}/stakeholders/approve`,
    payload: { expectedRevision: discovered.revision },
  });
  expect(approved.statusCode, approved.body).toBe(200);
  const stakeholders = approved.json() as StakeholdersView;
  expect(stakeholders.stakeholders?.approvedAt).not.toBeNull();

  const made = await app.inject({
    method: 'POST',
    url: `${base}/actors/generate`,
    payload: {},
  });
  expect(made.statusCode, made.body).toBe(201);
  const actors = made.json() as ActorsView;
  expect(actors.actors?.actors.length).toBeGreaterThanOrEqual(3);

  const started = await app.inject({
    method: 'POST',
    url: `${base}/analysis`,
    payload: { runsPerVariant: 12, baseSeed: 2024, sensitivity: true },
  });
  expect(started.statusCode, started.body).toBe(202);
  const id = (started.json().analysis as Analysis).id;
  const analysis = await until(
    async () => (await app.inject(`${base}/analysis/${id}`)).json().analysis as Analysis,
    (value) => !['running', 'queued'].includes(value.status),
  );
  expect(analysis.status, JSON.stringify(analysis.error)).toBe('completed');

  const review = await app.inject({ method: 'POST', url: `${base}/critiques/run`, payload: {} });
  expect(review.statusCode, review.body).toBeLessThan(300);

  const written = await app.inject({ method: 'POST', url: `${base}/brief`, payload: {} });
  expect(written.statusCode, written.body).toBe(201);

  return {
    project,
    analysis,
    stakeholders,
    actors,
    critiques: review.json() as CritiquesView,
    brief: written.json() as BriefView,
  };
}

function expectDecisionReady(journey: Journey, pack: Pack): void {
  const { analysis, brief, critiques, stakeholders, actors } = journey;
  // Every stakeholder says where it came from, and the cast is the approved list, not another.
  for (const stakeholder of stakeholders.stakeholders?.stakeholders ?? []) {
    expect(stakeholder.name.length).toBeGreaterThan(0);
    expect(stakeholder.evidence.length > 0 || stakeholder.origin !== 'model').toBe(true);
  }
  for (const actor of actors.actors?.actors ?? []) {
    expect(actor.sampleSize).toBeGreaterThanOrEqual(1);
    // Every trait of every actor says where it came from, so that nothing in the cast is unexplained.
    for (const trait of Object.values(actor.traits)) expect(TRAIT_ORIGINS).toContain(trait.origin);
  }

  expect(analysis.variants.length).toBeGreaterThanOrEqual(2);
  expect(analysis.findings.length).toBeGreaterThan(0);
  expect(analysis.fidelity.engine).toBe('rules');
  expect(analysis.cost.modelCalls).toBe(0);
  // The change has someone to move: some actor has a direction of impact, so that the comparison with
  // no change is about the change and not about noise.
  expect(
    analysis.actors.some((actor) => actor.traits.impact.value !== 0),
    NO_DIRECTION_NOTICE,
  ).toBe(true);
  expect(changeCanMoveAnyone(analysis.actors, analysis.config.variants), NO_DIRECTION_NOTICE).toBe(
    true,
  );
  expect(critiques.critiques?.critiques.length).toBeGreaterThan(0);

  const written = brief.brief;
  expect(written?.question).toBe(pack.question);
  expect(written?.analysisId).toBe(analysis.id);
  expect(written?.sections.map((section) => section.id)).toEqual([...BRIEF_SECTION_IDS]);
  expect(written?.headline.length).toBeGreaterThan(20);
  expect(written?.recommendations.length).toBeGreaterThan(0);
  expect(written?.validationPlan.length).toBeGreaterThan(0);
  expect(written?.limitations.length).toBeGreaterThan(0);
  for (const section of written?.sections ?? []) {
    for (const statement of section.statements) expect(statement.origin).toBeTruthy();
  }
  // The brief explores; it does not forecast. It may say that a count is pinned down only loosely
  // ("a wide 95% interval"), which is about how sure the runs are, not a share of people.
  expect(written?.headline).not.toMatch(/\bwill\b/iu);
  expect(written?.headline.replace(/\b95\s*%\s+interval\b/giu, '')).not.toMatch(/\d\s*%/u);
}

describe('from a question to a decision brief', () => {
  for (const pack of FLAGSHIPS) {
    it(`works end to end for the example "${pack.title}"`, async () => {
      const instance = await world();
      const journey = await walk(instance, pack);
      expectDecisionReady(journey, pack);
    });
  }

  it('works end to end for a question of the person’s own that no example knows', async () => {
    const instance = await world();
    const journey = await walk(instance, CUSTOM);
    expectDecisionReady(journey, CUSTOM);
    // Nothing from any example's world leaks into this one.
    const text = JSON.stringify(journey.brief.brief);
    for (const example of FLAGSHIPS) {
      const own = example.question.slice(0, 40);
      expect(text).not.toContain(own);
    }
  });

  it('can be repeated exactly: the same question, evidence and seed give the same findings', async () => {
    const instance = await world();
    const first = await walk(instance, CUSTOM);
    const second = await walk(await world(), CUSTOM);
    expect(second.analysis.findings.map((finding) => finding.statement)).toEqual(
      first.analysis.findings.map((finding) => finding.statement),
    );
    expect(second.analysis.variants.map((variant) => variant.runs)).toEqual(
      first.analysis.variants.map((variant) => variant.runs),
    );
  });
});

describe('from a public web page to a decision brief', () => {
  const PAGE = `<!doctype html><html><head><title>Delivery and returns | Example Shop</title></head><body>
    <h1>Delivery and returns</h1>
    <p>Customers who buy from the shop pay for standard delivery unless the basket is above a set value.
    Shoppers can return items within thirty days, and the support team answers questions about orders.</p>
    <p>The marketing team plans a seasonal campaign. A rival retailer advertises free delivery on all orders,
    and a payments partner processes every checkout. The warehouse team packs orders each morning.</p>
    </body></html>`;

  const site = (request: IncomingMessage, response: ServerResponse): void => {
    const path = new URL(request.url ?? '/', 'http://x').pathname;
    if (path === '/robots.txt') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      return void response.end('User-agent: *\nAllow: /\n');
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(PAGE);
  };

  it('keeps where a page came from, and uses it as evidence like any other source', async () => {
    const server = await startServer(site);
    servers.push(server);
    const instance = await world({ fetchFrom: server });
    const fetched = await instance.app.inject({
      method: 'POST',
      url: '/api/evidence/url',
      payload: { url: server.url('/shop?token=secret-value#top') },
    });
    expect(fetched.statusCode, fetched.body).toBe(200);
    const page = documentInputSchema.parse(fetched.json().document);
    expect(page.provenance?.kind).toBe('url');
    expect(JSON.stringify(page.provenance)).not.toContain('secret-value');

    const shop = EXAMPLE_SCENARIOS.find((example) => example.id === 'ecommerce-experience')!;
    const pack: Pack = {
      title: shop.title,
      question: shop.question,
      documents: [
        ...shop.documents,
        { name: page.name, content: page.content, provenance: page.provenance! },
      ],
    };
    const journey = await walk(instance, pack);
    expectDecisionReady(journey, pack);
    const sources = JSON.stringify(journey.brief.brief?.sections ?? []);
    expect(sources).toContain(page.name);
  });
});
