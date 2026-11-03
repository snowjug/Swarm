#!/usr/bin/env node
// Runs a command against a PostgreSQL 16 server that lives only as long as the command does, so that
// storage can be tried on the engine a deployment uses without installing one.
//
//   node scripts/db/with-postgres.mjs [--image postgres:16] -- <command> [arguments]
//   node scripts/db/with-postgres.mjs -- npx tsx scripts/db/measure.ts --engine postgres --rtt 0,2,20
//   node scripts/db/with-postgres.mjs -- npx vitest run backend/test/concurrency.test.ts
//
// The server is a Docker container that listens on 127.0.0.1 only, on a port Docker picks, with TLS on
// (a certificate made inside the container for this run, which the command trusts through
// NODE_EXTRA_CA_CERTS) and an empty database that is owned by a role that is not a superuser, which is the
// kind of role a deployment runs as. The command is given:
//
//   SWARM_TEST_POSTGRES_URL  postgres://swarm_app@127.0.0.1:<port>/swarm?sslmode=require
//   PGPASSWORD               made up for this run; in no file, no argument list and no output
//   NODE_EXTRA_CA_CERTS      the server's certificate, the public half
//
// The container, its data and the certificate are removed when the command ends, however it ends.
// Needs `docker` to be usable by the person running this.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const separator = argv.indexOf('--');
const own = separator === -1 ? argv : argv.slice(0, separator);
const command = separator === -1 ? [] : argv.slice(separator + 1);
let image = 'postgres:16';
let usable = command.length > 0;
for (let index = 0; index < own.length; index += 1) {
  if (own[index] === '--image' && own[index + 1]) image = own[++index];
  else usable = false;
}
if (!usable) {
  console.error('usage: with-postgres.mjs [--image postgres:16] -- <command> [arguments]');
  process.exit(2);
}

const name = `swarm-pg-${randomBytes(4).toString('hex')}`;
const adminPassword = randomBytes(18).toString('hex');
const appPassword = randomBytes(18).toString('hex');
// Inside the project, where `data/` is ignored by Git, and not in a shared temporary directory.
mkdirSync(join(root, 'data'), { recursive: true });
const directory = mkdtempSync(join(root, 'data', 'with-postgres-'));

const docker = (args, options = {}) => spawnSync('docker', args, { encoding: 'utf8', ...options });
let removed = false;
const remove = () => {
  if (removed) return;
  removed = true;
  docker(['rm', '-f', '-v', name], { stdio: 'ignore' });
  rmSync(directory, { recursive: true, force: true });
};
process.on('exit', remove);
let child = null;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    child?.kill(signal);
    remove();
    process.exit(130);
  });
}

function fail(message) {
  console.error(message);
  remove();
  process.exit(1);
}

// The key is made inside the container and stays there; only the certificate comes out.
const start = [
  'set -e',
  'cd /var/lib/postgresql',
  'openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 -keyout server.key -out server.crt 2>/dev/null',
  'chown postgres:postgres server.key server.crt',
  'chmod 600 server.key',
  'exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/var/lib/postgresql/server.crt -c ssl_key_file=/var/lib/postgresql/server.key',
].join('\n');
// `-e POSTGRES_PASSWORD` with no value takes it from this process's environment, not from the arguments.
const run = docker(
  [
    'run',
    '--detach',
    '--name',
    name,
    '--publish',
    '127.0.0.1::5432',
    '--shm-size',
    '256m',
    '--env',
    'POSTGRES_USER=swarm_admin',
    '--env',
    'POSTGRES_PASSWORD',
    '--entrypoint',
    'sh',
    image,
    '-c',
    start,
  ],
  { env: { ...process.env, POSTGRES_PASSWORD: adminPassword } },
);
if (run.status !== 0) {
  fail(`Docker could not start ${image}: ${(run.stderr || run.error?.message || '').trim()}`);
}

let ready = false;
for (let attempt = 0; attempt < 240 && !ready; attempt += 1) {
  // Over TCP, which the server only answers once it has finished setting itself up.
  ready =
    docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'swarm_admin', '-d', 'postgres'])
      .status === 0;
  if (!ready) await sleep(500);
}
if (!ready) fail(`${image} did not become ready.`);

const sql = [
  `CREATE ROLE swarm_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${appPassword}';`,
  'CREATE DATABASE swarm OWNER swarm_app;',
].join('\n');
const setup = docker(
  [
    'exec',
    '-i',
    name,
    'psql',
    '-q',
    '-U',
    'swarm_admin',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
  ],
  { input: sql },
);
if (setup.status !== 0) fail('Creating the role and the database failed.');

const asked = (query) =>
  docker(['exec', name, 'psql', '-At', '-U', 'swarm_admin', '-d', 'postgres', '-c', query]);
const tls = asked('SHOW ssl').stdout.trim();
const version = asked('SHOW server_version').stdout.trim();
if (tls !== 'on') fail('The server did not come up with TLS on.');

const certificate = join(directory, 'server.crt');
if (docker(['cp', `${name}:/var/lib/postgresql/server.crt`, certificate]).status !== 0) {
  fail('The certificate could not be copied out of the container.');
}
const published = docker(['port', name, '5432/tcp']).stdout.match(/127\.0\.0\.1:(\d+)/u);
if (!published) fail('The container did not publish its port on 127.0.0.1.');

console.error(
  `PostgreSQL ${version} is up on 127.0.0.1:${published[1]} with TLS, an empty database and a role that is not a superuser.`,
);
child = spawn(command[0], command.slice(1), {
  stdio: 'inherit',
  env: {
    ...process.env,
    SWARM_TEST_POSTGRES_URL: `postgres://swarm_app@127.0.0.1:${published[1]}/swarm?sslmode=require`,
    PGPASSWORD: appPassword,
    NODE_EXTRA_CA_CERTS: certificate,
  },
});
child.on('error', (error) => fail(`${command[0]} could not be run: ${error.message}`));
child.on('exit', (code, signal) => {
  remove();
  process.exit(code ?? (signal ? 1 : 0));
});
