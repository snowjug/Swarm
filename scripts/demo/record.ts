// Records the demonstration against a running server that uses a real model, and writes the seed
// that `npm run demo:seed` restores. It spends real model calls (about US$0.30 for the whole
// recording), so it is run on purpose, on a server of its own, and not by the tests.
//
//   AI settings in .env, then:  PORT=3003 DATA_DIR=<a scratch folder> npm start
//   npm run demo:record -- --url http://127.0.0.1:3003
//
// A recording that was interrupted can be finished instead of redone, by naming the experiments
// it had already made (shown in its log, or by GET /api/projects):
//   npm run demo:record -- --url http://127.0.0.1:3003 --base <id> --guarantee <id> --no-notice <id>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEMO_PROJECTS } from '../../shared/demo.js';
import { httpApi } from './lib/api.js';
import { recordDemo } from './lib/record-flow.js';
import { MANIFEST_FILE } from './lib/seed.js';

const PACK = 'larkholm-ferry';

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1]! : fallback;
}

function existing(name: string): string | undefined {
  const value = option(name, '');
  return value === '' ? undefined : value;
}

async function main(): Promise<void> {
  const url = option('url', 'http://127.0.0.1:3003');
  const out = resolve(option('out', 'docs/demo/seed'));
  const catalogue = JSON.parse(readFileSync('docs/demo/demos.json', 'utf8')) as {
    demos: { slug: string; question: string; files: string[] }[];
  };
  const pack = catalogue.demos.find((demo) => demo.slug === PACK);
  if (!pack) throw new Error(`docs/demo/demos.json has no "${PACK}" pack.`);
  const sources = pack.files.map((name) => ({
    name,
    content: readFileSync(join('docs/demo', PACK, name), 'utf8'),
  }));

  const started = Date.now();
  const recording = await recordDemo(httpApi(url), {
    question: pack.question,
    sources,
    resume: {
      ...(existing('base') ? { base: existing('base')! } : {}),
      ...(existing('guarantee') ? { guarantee: existing('guarantee')! } : {}),
      ...(existing('no-notice') ? { noNotice: existing('no-notice')! } : {}),
    },
    log: (line) => console.log(line),
  });

  mkdirSync(out, { recursive: true });
  for (const file of recording.files) {
    writeFileSync(join(out, file.file), `${JSON.stringify(file.snapshot, null, 2)}\n`);
  }
  const manifest = {
    version: 1,
    recordedAt: recording.recordedAt,
    provider: recording.provider,
    model: recording.model,
    usage: recording.usage,
    projects: DEMO_PROJECTS.map((demo) => ({
      id: demo.id,
      slug: demo.slug,
      file: `${demo.slug}.json`,
    })),
    notes: recording.notes,
  };
  writeFileSync(join(out, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`\nRecorded in ${Math.round((Date.now() - started) / 60_000)} minutes.`);
  console.log(
    `Model calls: ${recording.usage.modelCalls}; tokens in/out: ${recording.usage.inputTokens}/${recording.usage.outputTokens}.`,
  );
  for (const note of recording.notes) console.log(`- ${note}`);
  console.log(`Written to ${out}. Read it before committing: it is what the demonstration shows.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
