// Restores the demonstration into the local database, so that it can be reset before a
// presentation. It only ever touches the three demonstration experiments; everything else in the
// database is left as it is. Running it again returns the demonstration to its recorded state:
// anything added during a rehearsal (a branch, a question, an edit) is replaced.
//
//   npm run demo:seed                  restore, or reset
//   npm run demo:seed -- --dry-run     check the files and say what would change
//   npm run demo:seed -- --remove      delete the demonstration experiments
//
// A server that signs people in (AUTH_MODE=entra) has no "local" workspace, so there the
// workspace must be named: --tenant <id> --owner <id>.
import { resolve } from 'node:path';
import { loadConfig } from '../../backend/src/config.js';
import { Repository, type Owner } from '../../backend/src/storage/repository.js';
import { readSeed, removeDemo, seedDemo } from './lib/seed.js';

const flag = (name: string): boolean => process.argv.includes(`--${name}`);
function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function main(): void {
  const config = loadConfig(process.env);
  const directory = resolve(option('dir') ?? 'docs/demo/seed');
  const tenant = option('tenant');
  const ownerId = option('owner');
  if (config.auth.mode === 'entra' && (!tenant || !ownerId)) {
    throw new Error(
      'This server signs people in, so there is no local workspace to restore into. Name one: --tenant <id> --owner <id>.',
    );
  }
  const owner: Owner | undefined = tenant && ownerId ? { tenantId: tenant, ownerId } : undefined;

  const repository = new Repository(config.databasePath);
  try {
    if (flag('remove')) {
      const removed = removeDemo(repository, owner, 'demo-seed');
      console.log(
        removed.length === 0
          ? 'The demonstration was not there.'
          : `Removed ${removed.length} demonstration experiment(s).`,
      );
      return;
    }
    const { manifest } = readSeed(directory);
    const lines = seedDemo(repository, {
      directory,
      dryRun: flag('dry-run'),
      actor: 'demo-seed',
      ...(owner ? { owner } : {}),
    });
    console.log(flag('dry-run') ? 'Dry run: nothing was written.' : 'Demonstration restored.');
    for (const line of lines) {
      console.log(
        `  ${line.outcome.padEnd(13)} ${line.slug.padEnd(20)} ${line.id}  ${line.status}, ${line.messages} message(s)`,
      );
    }
    const provider = config.provider;
    if (manifest.provider !== provider.name || manifest.model !== provider.model) {
      console.log(
        `\nNote: this was recorded with ${manifest.provider} "${manifest.model}"; this server uses ${provider.name} "${provider.model}". Everything can be read and exported, but asking the analyst or an actor a new question is refused until the same model is configured, because the answers would otherwise mix two models.`,
      );
    }
  } finally {
    repository.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
