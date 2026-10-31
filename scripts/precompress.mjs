// Writes a Brotli (.br) and a gzip (.gz) copy beside every text asset of the built frontend, so that
// the server can send the copy a browser asks for as it is (`preCompressed` in backend/src/app.ts)
// instead of sending the JavaScript and the style sheet in full, and without compressing anything
// while a request waits. A copy is kept only if it is smaller than the file, and source maps are left
// alone. Run after `vite build`, which empties the directory first, so no copy outlives its file.
//
//   node scripts/precompress.mjs [directory]     (default: frontend/dist)
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(process.argv[2] ?? join(root, 'frontend', 'dist'));
const TEXT = new Set(['.js', '.css', '.html', '.svg', '.json']);

function* files(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

/** Writes `copy` beside `path` if it is smaller than `original`; otherwise removes a copy left by an earlier run. */
function keep(path, original, copy) {
  if (copy.length < original.length) {
    writeFileSync(path, copy);
    return copy.length;
  }
  rmSync(path, { force: true });
  return null;
}

let isDirectory = false;
try {
  isDirectory = statSync(target).isDirectory();
} catch {
  // reported below
}
if (!isDirectory) {
  console.error(`precompress: ${target} is not a directory. Build the frontend first.`);
  process.exit(1);
}

const rows = [];
// The files are listed before any copy is written or removed, so that a copy left by an earlier run
// and removed by this one is not looked for afterwards.
for (const path of [...files(target)]) {
  if (!TEXT.has(extname(path).toLowerCase())) continue;
  const original = readFileSync(path);
  const brotli = keep(
    `${path}.br`,
    original,
    brotliCompressSync(original, {
      params: {
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: original.length,
      },
    }),
  );
  const gzip = keep(
    `${path}.gz`,
    original,
    gzipSync(original, { level: constants.Z_BEST_COMPRESSION }),
  );
  rows.push({ file: relative(target, path), bytes: original.length, gzip, brotli });
}
if (rows.length === 0) {
  console.error(`precompress: nothing to compress in ${target}.`);
  process.exit(1);
}
for (const { file, bytes, gzip, brotli } of rows) {
  console.log(
    `${file.padEnd(36)} ${String(bytes).padStart(8)} B  gzip ${gzip ?? '-'}  br ${brotli ?? '-'}`,
  );
}
