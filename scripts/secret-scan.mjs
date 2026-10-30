// Credential scan: every blob reachable from any git ref, plus the working tree (untracked files
// included). It prints locations and the PATTERN NAME only, never the matched text, and exits 1 on
// any finding. Strings containing "canary" or "do-not-log" are test canaries (values that tests
// assert are never logged or rendered) and are not findings.
//
//   node scripts/secret-scan.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const patterns = {
  'OpenAI-style key': /\bsk-[A-Za-z0-9_-]{20,}\b/,
  'GitHub token': /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/,
  'GitHub fine-grained token': /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  'AWS access key': /\bAKIA[0-9A-Z]{16}\b/,
  'Slack token': /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  'private key block': /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  'Azure storage key': /AccountKey=[A-Za-z0-9+/=]{40,}/,
  'Azure SAS signature': /[?&]sig=[A-Za-z0-9%+/=]{20,}/,
  'JSON Web Token': /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  'assigned secret':
    /\b(?:api[_-]?key|client[_-]?secret|password|secret)\s*[:=]\s*["'][A-Za-z0-9+/_=-]{16,}["']/i,
};
const CANARY = /canary|do-not-log/i;
// Blobs already in history that hold only fake credentials made up for a test of redaction. History is
// not rewritten, so the blob is named by the start of its hash, which commits to its content: any other
// version of the same file is scanned as usual. Add to this list only for the same reason, and say which.
//   4ddb42a  backend/test/telemetry.test.ts as first committed (98da19d); later versions build the fakes from parts
const ACCEPTED_HISTORY_BLOBS = new Set(['4ddb42a']);
const SKIP_FILE = /(?:^|\/)package-lock\.json$|\.(?:png|jpe?g|gif|ico|woff2?|pdf|sqlite)$/i;
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'data',
  'playwright-report',
  'test-results',
]);
const MAX_BYTES = 2_000_000;

const git = (args) => execFileSync('git', args, { cwd: root, maxBuffer: 1024 * 1024 * 1024 });
const findings = [];

function scan(label, text) {
  for (const [name, expression] of Object.entries(patterns)) {
    const flags = expression.flags.includes('g') ? expression.flags : `${expression.flags}g`;
    for (const match of text.matchAll(new RegExp(expression.source, flags))) {
      if (!CANARY.test(match[0])) {
        findings.push(`${name} :: ${label}`);
        break;
      }
    }
  }
}

// One `git cat-file --batch` process reads every object. Starting two processes per object took
// minutes on a busy machine.
const candidates = new Map();
for (const line of git(['rev-list', '--objects', '--all']).toString('utf8').split('\n')) {
  const [sha, ...rest] = line.split(' ');
  const path = rest.join(' ');
  if (!sha || !path || candidates.has(sha) || SKIP_FILE.test(path)) continue;
  candidates.set(sha, path);
}

let blobs = 0;
if (candidates.size > 0) {
  const objects = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: `${[...candidates.keys()].join('\n')}\n`,
    maxBuffer: 1024 * 1024 * 1024,
  });
  // Each object is "<sha> <type> <size>\n", then <size> bytes, then "\n".
  for (let offset = 0; offset < objects.length;) {
    const lineEnd = objects.indexOf(0x0a, offset);
    const [sha, type, size] = objects.toString('latin1', offset, lineEnd).split(' ');
    if (type === 'missing') {
      offset = lineEnd + 1;
      continue;
    }
    const start = lineEnd + 1;
    const end = start + Number(size);
    offset = end + 1;
    if (type !== 'blob') continue;
    const content = objects.subarray(start, end);
    if (content.length > MAX_BYTES || content.includes(0)) continue;
    blobs += 1;
    if (ACCEPTED_HISTORY_BLOBS.has(sha.slice(0, 7))) continue;
    scan(`history:${candidates.get(sha)}@${sha.slice(0, 7)}`, content.toString('utf8'));
  }
}

let files = 0;
(function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const info = statSync(path);
    if (info.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(name)) walk(path);
      continue;
    }
    const relativePath = relative(root, path).replaceAll('\\', '/');
    if (SKIP_FILE.test(relativePath) || info.size > MAX_BYTES) continue;
    files += 1;
    scan(`worktree:${relativePath}`, readFileSync(path, 'utf8'));
  }
})(root);

const trackedEnvironmentFiles = git(['ls-files'])
  .toString('utf8')
  .split('\n')
  .filter((file) => /(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example'));

console.log(`history blobs scanned: ${blobs}; working-tree files scanned: ${files}`);
console.log(`tracked .env files: ${trackedEnvironmentFiles.length}`);
console.log(`findings: ${findings.length}`);
for (const finding of findings) console.log(`  ${finding}`);
process.exitCode = findings.length > 0 || trackedEnvironmentFiles.length > 0 ? 1 : 0;
