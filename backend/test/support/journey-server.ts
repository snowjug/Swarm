/**
 * The server of the production journey (`e2e/journey/*.spec.ts`), and of nothing else: ONE process that runs the real
 * application (`buildApp`, serving the built page) twice, with what each part of the journey needs around it.
 *
 *   rules    no model, and the search that the product ships (none: a question alone cannot find sources)
 *   foundry  the model path, through the loopback seam of the models workstream, to a fake Foundry; and a search
 *            that is a TEST DOUBLE, because no real search provider exists
 *
 * What is real: the application, the router, the guard, the job queue, the crawler, the fetcher and its address policy,
 * the extractor, the evidence ledger, the simulation, the analysis, the critics, the brief and the decision canvas, the
 * database (SQLite in a file, or PostgreSQL in this process with JOURNEY_DB=pglite), the sign-in (Authorization Code
 * with PKCE, a really signed ID token, a session cookie), and the built page.
 *
 * What is replaced, and where it is said:
 *   - Microsoft Entra: `journey-idp.ts`, a loopback identity provider (the `oidc` and `tokenVerifier` options);
 *   - the web: `journey-web.ts`, a name lookup that is a table and a connection that ends on this machine
 *     (the `research.fetcher` and `urlFetcher` options); nothing else is reachable;
 *   - Microsoft Foundry: `fake-foundry.ts` (the loopback test seam of the models workstream);
 *   - the search provider: `ScriptedSearch` below (the `research.search` option);
 *   - the crawler's timeouts, shortened (the `research.crawl.tuning` option), and the wait between two requests to one
 *     site, at the least the configuration allows (RESEARCH_DOMAIN_DELAY_MS=250);
 *   - the pause between two simulated runs, which a control can lengthen so that a person can cancel one in the middle
 *     (the `analysis.yieldNow` option);
 *   - the database, for an outage only: a control makes every use of the repository's database throw (`outageOf`, below),
 *     as an outage does, and lets it work again; nothing in the product knows;
 *   - telemetry and logs: held in memory (`journey-capture.ts`) instead of being exported.
 *
 * JOURNEY_TRACE_CRAWL=1 says on stderr how long each short wait of the crawler took (defect J-03, docs/production/journey.md).
 *
 * Nothing in the product is switched off, and no seam was added to it. The control surface (`/__journey/*`) is a
 * second server on a loopback port: it starts failures, reads what was captured and says where a canary was found.
 * It is not a route of the application.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { buildApp } from '../../src/app.js';
import { TokenVerifier } from '../../src/auth/tokens.js';
import { loadConfig } from '../../src/config.js';
import { PublicFetcher } from '../../src/ingest/url/fetcher.js';
import { PublicPageFetcher } from '../../src/research/crawler/fetch.js';
import { sleep as crawlerSleep } from '../../src/research/crawler/deps.js';
import type { CrawlTuning } from '../../src/research/crawler/types.js';
import type { SearchProvider } from '../../src/research/discovery.js';
import type { SqlDatabase } from '../../src/storage/sql.js';
import { Repository } from '../../src/storage/repository.js';
import { startFakeFoundry, type FakeFoundry, type FakeStep } from './fake-foundry.js';
import { naturalReply } from './journey-brain.js';
import { startCapture } from './journey-capture.js';
import { AUDIENCE, CLIENT_ID, TENANT_A, TENANT_B, startIdp } from './journey-idp.js';
import {
  ADDRESSES,
  CANARIES,
  INJECTED,
  DEFAULT_PORTS,
  INSTANCES,
  INSTANCE_FACTS,
  PEOPLE,
  type FoundryRequestSummary,
  type InstanceName,
  type JourneyState,
  type Person,
} from './journey-protocol.js';
import { resolver, startJourneyWeb } from './journey-web.js';

const port = (name: keyof typeof DEFAULT_PORTS): number =>
  Number(process.env[`JOURNEY_PORT_${name.toUpperCase()}`] ?? DEFAULT_PORTS[name]);
const database = process.env.JOURNEY_DB === 'pglite' ? 'pglite' : 'sqlite';
const dataDir = resolve(process.env.JOURNEY_DATA_DIR ?? join('data', 'journey'));

// A canary in the environment of the process, as a secret in a deployment's settings would be. Nothing reads it; the
// settings that the application does read (the client secret, the model key) carry canaries too.
process.env.JOURNEY_ENVIRONMENT_CANARY = CANARIES.environment;

/** A search provider that is a test double: it offers the addresses it is told to, and keeps the questions it is asked. */
class ScriptedSearch implements SearchProvider {
  readonly questions: string[] = [];
  hits: string[] = [];
  failure: string | null = null;

  reset(): void {
    this.questions.length = 0;
    this.hits = [ADDRESSES.fees, ADDRESSES.survey];
    this.failure = null;
  }

  status() {
    return {
      available: true,
      provider: 'journey-test-double',
      message: 'A scripted search that stands in for a provider. It exists for tests only.',
    };
  }

  async search(question: string): Promise<{ url: string }[]> {
    this.questions.push(question);
    if (this.failure) throw new Error(this.failure);
    return this.hits.map((url) => ({ url }));
  }
}

const DEFAULT_TUNING: Partial<CrawlTuning> = {
  // Shorter than the product's own, so that a page that never answers ends a run in seconds. The checks are the same.
  requestTimeoutMs: 10_000,
  idleMs: 4_000,
  backoffBaseMs: 250,
  backoffMaxMs: 1_000,
};

mkdirSync(dataDir, { recursive: true });
const capture = startCapture();
const web = await startJourneyWeb(port('web'));
const idp = await startIdp(port('idp'));
const foundry: FakeFoundry = await startFakeFoundry();

type Behaviour = 'natural' | 'down' | 'content-filter' | 'invalid-json' | 'refusal';
let behaviour: Behaviour = 'natural';
function install(mode: Behaviour): void {
  behaviour = mode;
  foundry.respond((request): FakeStep | undefined => {
    switch (behaviour) {
      case 'down':
        return { kind: 'status', status: 503 };
      case 'content-filter':
        return { kind: 'filter-prompt', categories: ['violence'] };
      case 'invalid-json':
        return { kind: 'text', text: 'This is not JSON, and neither is what follows: {"half"' };
      case 'refusal':
        return { kind: 'refusal' };
      case 'natural':
        return naturalReply(request);
    }
  });
}
install('natural');

const search = new ScriptedSearch();
search.reset();
const tuning: Partial<CrawlTuning> = { ...DEFAULT_TUNING };

/**
 * JOURNEY_TRACE_CRAWL=1 says on stderr how long each short wait of the crawler took against what it asked for, and
 * marks one that ended early (a wait that is cut short because a read ended says nothing). It is how defect J-03 was
 * found: a timer that fires a millisecond before the clock says it should.
 */
async function tracedSleep(ms: number, signal: AbortSignal): Promise<void> {
  const begun = Date.now();
  try {
    await crawlerSleep(ms, signal);
  } finally {
    const took = Date.now() - begun;
    if (ms <= 2_000) {
      console.error(
        `crawl wait ${ms} ms took ${took} ms${took < ms ? ` (${ms - took} ms early)` : ''}`,
      );
    }
  }
}

/** How long each simulated run waits before the next, so that a person can cancel one in the middle. */
let paceMs = 0;
const yieldNow = (): Promise<void> =>
  paceMs > 0
    ? new Promise<void>((done) => setTimeout(done, paceMs))
    : new Promise<void>((done) => setImmediate(done));

interface Running {
  name: InstanceName;
  url: string;
  port: number;
  repository: Repository;
  close(): Promise<void>;
  /** Makes every use of the database fail, as an outage does, or lets it work again. */
  outage(down: boolean): void;
}

/**
 * Cuts the database off from the application, without touching the application: the statements of the one database
 * object that every store of the repository holds are made to throw while the outage lasts. `ping`, which the readiness
 * probe uses, then fails, and so does every request that reads or writes.
 */
function outageOf(repository: Repository): (down: boolean) => void {
  const held = (repository as unknown as { database?: SqlDatabase }).database;
  if (!held)
    throw new Error('The repository no longer holds its database where the harness looks.');
  const real = {
    prepare: held.prepare.bind(held),
    exec: held.exec.bind(held),
    transaction: held.transaction.bind(held),
    readSnapshot: held.readSnapshot.bind(held),
  };
  let down = false;
  const refuse = (): never => {
    throw new Error('journey outage: the database does not answer');
  };
  held.prepare = (sql) => (down ? refuse() : real.prepare(sql));
  held.exec = (sql) => (down ? refuse() : real.exec(sql));
  held.transaction = (operation) => (down ? refuse() : real.transaction(operation));
  held.readSnapshot = (operation) => (down ? refuse() : real.readSnapshot(operation));
  return (value) => {
    down = value;
  };
}

async function start(name: InstanceName): Promise<Running> {
  const facts = INSTANCE_FACTS[name];
  const appPort = port(name);
  const redirect = `http://127.0.0.1:${appPort}/auth/callback`;
  idp.allow(redirect);
  const config = loadConfig({
    PORT: String(appPort),
    HOST: '127.0.0.1',
    // The level of a deployment, so that what a request logs is what an operator would have.
    LOG_LEVEL: 'info',
    // The journey issues far more requests than a person would; the limits are tested in backend/test/security.test.ts.
    RATE_LIMIT_SCALE: '100',
    // The least wait between two requests to one site that the configuration allows.
    RESEARCH_DOMAIN_DELAY_MS: '250',
    AUTH_MODE: 'entra',
    AUTH_ENTRA_TENANT_ID: TENANT_A,
    AUTH_ENTRA_ALLOWED_TENANTS: TENANT_B,
    AUTH_ENTRA_AUDIENCE: AUDIENCE,
    AUTH_ENTRA_CLIENT_ID: CLIENT_ID,
    AUTH_ENTRA_REDIRECT_URI: redirect,
    AUTH_ENTRA_CLIENT_SECRET: CANARIES.clientSecret,
    ...(facts.model === 'foundry' ? foundry.environment() : { AI_PROVIDER: 'none' }),
  });
  let target: string;
  if (database === 'pglite') {
    target = 'pglite:memory';
  } else {
    target = join(dataDir, `${name}.sqlite`);
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${target}${suffix}`, { force: true });
  }
  const repository = new Repository(target);
  const setOutage = outageOf(repository);
  const { app } = await buildApp({
    config,
    repository,
    tokenVerifier: new TokenVerifier(config.auth, idp.keys),
    oidc: { fetcher: idp.tokenCall(redirect), authorityHost: idp.url },
    logStream: capture.logStream,
    urlFetcher: new PublicFetcher({ lookup: resolver }),
    analysis: { yieldNow },
    research: {
      fetcher: new PublicPageFetcher({ seam: { lookup: resolver } }),
      crawl: {
        tuning,
        ...(process.env.JOURNEY_TRACE_CRAWL ? { sleep: tracedSleep } : {}),
      },
      ...(facts.search === 'test-double' ? { search } : {}),
    },
  });
  await app.listen({ host: config.host, port: config.port });
  return {
    name,
    url: `http://127.0.0.1:${appPort}`,
    port: appPort,
    repository,
    outage: setOutage,
    close: () => app.close(),
  };
}

const running: Record<InstanceName, Running> = {} as Record<InstanceName, Running>;
for (const name of INSTANCES) running[name] = await start(name);

const state = (): JourneyState => ({
  instances: Object.fromEntries(
    INSTANCES.map((name) => [
      name,
      {
        port: running[name].port,
        url: running[name].url,
        model: INSTANCE_FACTS[name].model,
        search: INSTANCE_FACTS[name].search,
      },
    ]),
  ) as JourneyState['instances'],
  idp: { url: idp.url },
  database,
  faked: [
    'Microsoft Entra sign-in (journey-idp.ts)',
    'the public web and its name lookup (journey-web.ts)',
    'Microsoft Foundry (fake-foundry.ts)',
    'the search provider, on the foundry instance only (ScriptedSearch, a test double)',
    'the crawler time limits, shortened (research.crawl.tuning)',
    'telemetry and logs, held in memory (journey-capture.ts)',
  ],
});

// ---------------------------------------------------------------------------------------------
// The control surface
// ---------------------------------------------------------------------------------------------

const canaries = (): Record<string, string> => ({
  ...CANARIES,
  modelKey: foundry.apiKey,
  modelToken: foundry.token,
});

const summaryOf = (): FoundryRequestSummary[] =>
  foundry.requests.map((request) => ({
    index: request.index,
    deployment: request.deployment,
    schema: request.body?.response_format?.json_schema?.name ?? null,
    says: request.system.split('\n\n').slice(1).join('\n\n').slice(0, 80),
    status: request.status,
    step: request.step,
    credential: request.credential,
    bodyHoldsSecret: [
      foundry.apiKey,
      foundry.token,
      CANARIES.clientSecret,
      CANARIES.environment,
    ].some((secret) => request.rawBody.includes(secret)),
    // What a page ordered an AI to do is the page's, and is data to describe: whether it went to the model is said, so that
    // a test can hold the product to what it says about passages it withholds.
    bodyHoldsOrders: [INJECTED.ordered, INJECTED.answer].some((order) =>
      request.rawBody.includes(order),
    ),
  }));

function resetAll(): void {
  capture.reset();
  web.reset();
  web.release();
  web.slowFor(1_500);
  foundry.reset();
  install('natural');
  search.reset();
  for (const key of Object.keys(tuning)) delete (tuning as Record<string, unknown>)[key];
  Object.assign(tuning, DEFAULT_TUNING);
  paceMs = 0;
  idp.next('analyst');
  for (const name of INSTANCES) running[name].outage(false);
}

type Body = Record<string, unknown>;
const isInstance = (value: unknown): value is InstanceName =>
  typeof value === 'string' && (INSTANCES as readonly string[]).includes(value);
const isPerson = (value: unknown): value is Person =>
  typeof value === 'string' && (PEOPLE as readonly string[]).includes(value);

async function route(
  method: string,
  path: string,
  query: URLSearchParams,
  body: Body,
): Promise<{ status: number; body?: unknown }> {
  const ok = (value?: unknown) => ({ status: value === undefined ? 204 : 200, body: value });
  const refused = (message: string) => ({ status: 400, body: { error: message } });
  const key = `${method} ${path}`;
  switch (key) {
    case 'GET /state':
      return ok(state());
    case 'POST /reset':
      resetAll();
      return ok();
    case 'GET /canaries':
      return ok(canaries());
    case 'GET /canaries/scan': {
      const audit = Object.fromEntries(
        INSTANCES.map((name) => [
          `audit:${name}`,
          JSON.stringify(running[name].repository.audit.list({ limit: 500 })),
        ]),
      );
      return ok(await capture.scan(canaries(), audit));
    }
    case 'POST /idp/next': {
      const person = body.person;
      if (person !== 'declines' && !isPerson(person)) return refused('unknown person');
      idp.next(person as Person | 'declines');
      return ok();
    }
    case 'GET /idp/visits':
      return ok(idp.visits());
    case 'GET /web':
      return ok(web.log());
    case 'POST /web/reset':
      web.reset();
      return ok();
    case 'POST /web/hold':
      if (typeof body.path !== 'string') return refused('path');
      web.hold(body.path);
      return ok();
    case 'POST /web/release':
      web.release();
      return ok();
    case 'POST /web/slow':
      web.slowFor(Number(body.ms));
      return ok();
    case 'POST /crawl/tuning':
      Object.assign(tuning, body);
      return ok();
    case 'POST /analysis/pace':
      paceMs = Math.max(0, Number(body.ms) || 0);
      return ok();
    case 'GET /foundry/requests':
      return ok(summaryOf());
    case 'GET /foundry/problems':
      return ok([...foundry.problems]);
    case 'POST /foundry/behaviour':
      if (
        !['natural', 'down', 'content-filter', 'invalid-json', 'refusal'].includes(
          String(body.behaviour),
        )
      ) {
        return refused('behaviour');
      }
      install(body.behaviour as Behaviour);
      return ok();
    case 'POST /foundry/script':
      foundry.script(...(body.steps as FakeStep[]));
      return ok();
    case 'POST /search/script':
      if (Array.isArray(body.hits)) search.hits = body.hits.map(String);
      search.failure = typeof body.failure === 'string' ? body.failure : null;
      return ok();
    case 'GET /search/questions':
      return ok([...search.questions]);
    case 'POST /database/outage':
      if (!isInstance(body.instance)) return refused('instance');
      running[body.instance].outage(body.down === true);
      return ok();
    case 'GET /telemetry':
      return ok(await capture.reading());
    case 'POST /telemetry/reset':
      capture.reset();
      return ok();
    case 'GET /audit': {
      const name = query.get('instance');
      if (!isInstance(name)) return refused('instance');
      return ok(running[name].repository.audit.list({ limit: 500 }));
    }
    case 'GET /audit/verify': {
      const name = query.get('instance');
      if (!isInstance(name)) return refused('instance');
      return ok(running[name].repository.audit.verify());
    }
    default:
      return { status: 404, body: { error: 'no such control' } };
  }
}

function readBody(request: IncomingMessage): Promise<Body> {
  return new Promise((done, fail) => {
    const parts: Buffer[] = [];
    request.on('data', (chunk: Buffer) => parts.push(chunk));
    request.on('error', fail);
    request.on('end', () => {
      const text = Buffer.concat(parts).toString('utf8');
      try {
        done(text ? (JSON.parse(text) as Body) : {});
      } catch {
        done({});
      }
    });
  });
}

const control = createServer((request: IncomingMessage, response: ServerResponse) => {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/__journey/')) {
      response.writeHead(404).end();
      return;
    }
    try {
      const answer = await route(
        request.method ?? 'GET',
        url.pathname.slice('/__journey'.length),
        url.searchParams,
        await readBody(request),
      );
      if (answer.body === undefined) response.writeHead(answer.status).end();
      else {
        response
          .writeHead(answer.status, {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          })
          .end(JSON.stringify(answer.body));
      }
    } catch (failure) {
      response
        .writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: failure instanceof Error ? failure.message : 'failed' }));
    }
  })();
});
// Loopback only: this surface starts failures and reads what was captured.
await new Promise<void>((done) => control.listen(port('control'), '127.0.0.1', done));

console.log(
  `journey harness: control http://127.0.0.1:${port('control')}/__journey/state, ` +
    INSTANCES.map((name) => `${name} ${running[name].url}`).join(', ') +
    `, database ${database}`,
);

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  control.closeAllConnections();
  void Promise.allSettled([
    ...INSTANCES.map((name) => running[name].close()),
    web.close(),
    idp.close(),
    foundry.close(),
    capture.close(),
    new Promise<void>((done) => control.close(() => done())),
  ]).then(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
