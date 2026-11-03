/**
 * The server for the end-to-end journey of automatic research (`e2e/lab/research-journey.spec.ts`), and for nothing
 * else.
 *
 * It is the real application (`buildApp`, serving the built page) in rules mode, with its data in memory, and with one
 * difference: the web that research can reach, which is the fixture web of `research-fixture-web.ts`. A page is read by
 * the real crawler and the real fetcher with every check they have; only the name lookup and the route to the fixture
 * hosts are replaced, as a network lab replaces DNS and routing. Nothing in the application is switched off, and there
 * is no setting that does that.
 */
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { PublicFetcher } from '../../src/ingest/url/fetcher.js';
import { PublicPageFetcher } from '../../src/research/index.js';
import { Repository } from '../../src/storage/repository.js';
import { resolver, startFixtureWeb } from './research-fixture-web.js';

const port = Number(process.env.RESEARCH_E2E_PORT ?? 3119);
const fixturePort = Number(process.env.RESEARCH_E2E_FIXTURE_PORT ?? 3120);

const web = await startFixtureWeb(fixturePort);
const config = loadConfig({
  PORT: String(port),
  HOST: '127.0.0.1',
  LOG_LEVEL: 'warn',
  RATE_LIMIT_SCALE: '100',
  AI_PROVIDER: 'none',
});
// How research reaches the web is the application's test hook, `research.fetcher`: the crawler's own fetcher, with the
// name lookup of this lab. Passed as a value, so that this file builds before the hook exists in the application.
const options = {
  config,
  repository: new Repository(':memory:'),
  urlFetcher: new PublicFetcher({ lookup: resolver }),
  research: { fetcher: new PublicPageFetcher({ seam: { lookup: resolver } }) },
};
const { app } = await buildApp(options);
await app.listen({ host: config.host, port: config.port });

const stop = () => {
  void app
    .close()
    .then(() => web.close())
    .then(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
