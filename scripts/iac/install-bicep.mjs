// Installs the Bicep CLI pinned in scripts/iac/bicep.lock.json, and refuses a file whose size or SHA-256
// differs from the lock. It is the only place these scripts download anything, and the only thing it
// downloads is that one release asset from github.com/Azure/bicep.
//
//   node scripts/iac/install-bicep.mjs                     installs to ~/.local/bin (BICEP_INSTALL_DIR overrides)
//   node scripts/iac/install-bicep.mjs --print-target      prints where it would install, and does nothing else
//
// A matching hash proves the file is the one GitHub holds for that release; it does not prove who built
// it, because Bicep publishes no signature or separate checksum file (see the lock file).
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  chmodSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { LOCK } from './bicep.mjs';

const platform = `${process.platform}-${process.arch}`;
const asset = LOCK.assets[platform];
const directory = process.env.BICEP_INSTALL_DIR ?? join(homedir(), '.local', 'bin');
const target = join(directory, process.platform === 'win32' ? 'bicep.exe' : 'bicep');

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function sha256Of(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

if (!asset) {
  fail(`No pinned Bicep build for ${platform}. Pinned: ${Object.keys(LOCK.assets).join(', ')}.`);
}

if (process.argv.includes('--print-target')) {
  console.log(target);
  process.exit(0);
}

if (existsSync(target) && (await sha256Of(target)) === asset.sha256) {
  console.log(
    `Bicep ${LOCK.version} is already installed at ${target} (checksum matches the lock).`,
  );
  process.exit(0);
}

mkdirSync(directory, { recursive: true });
const partial = `${target}.download`;
const url = `${LOCK.source}${asset.file}`;
console.log(`Downloading ${url}`);

const response = await fetch(url, { redirect: 'follow' });
if (!response.ok || !response.body) fail(`The download failed: HTTP ${response.status}.`);

const hash = createHash('sha256');
let bytes = 0;
const meter = async function* (source) {
  for await (const chunk of source) {
    hash.update(chunk);
    bytes += chunk.length;
    yield chunk;
  }
};
try {
  await pipeline(
    Readable.fromWeb(response.body),
    meter,
    createWriteStream(partial, { mode: 0o755 }),
  );
} catch (error) {
  rmSync(partial, { force: true });
  fail(`The download did not finish: ${error instanceof Error ? error.message : 'unknown error'}.`);
}

const actual = hash.digest('hex');
if (bytes !== asset.bytes || actual !== asset.sha256) {
  rmSync(partial, { force: true });
  fail(
    `Refusing to install: expected ${asset.bytes} bytes with SHA-256 ${asset.sha256}, got ${bytes} bytes with ${actual}. Nothing was installed.`,
  );
}

chmodSync(partial, 0o755);
renameSync(partial, target);
console.log(
  `Installed Bicep ${LOCK.version} to ${target}; size and SHA-256 match scripts/iac/bicep.lock.json.`,
);
if (!(process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').includes(directory)) {
  console.log(`Add ${directory} to PATH, or set BICEP_PATH=${target}.`);
}
