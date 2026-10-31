import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const mutantSchema = z.object({
  id: z.string().regex(/^[MSPJTRABU][0-9]{1,3}$/u),
  area: z.enum([
    'membership',
    'sign-in',
    'storage',
    'jobs',
    'telemetry',
    'studio',
    'analyst',
    'budget',
    'access',
  ]),
  /** What would be wrong if the rule were not there, in one sentence. */
  claim: z.string().min(10).max(200),
  /** Relative to the repository root, with forward slashes. */
  file: z.string().regex(/^[A-Za-z0-9_./-]+$/u),
  /** Exact source text that must occur once in the file. Line breaks are written as \n. */
  find: z.string().min(1),
  replace: z.string(),
  /** Test files that must fail with the mutation in place. */
  tests: z.array(z.string().regex(/^[A-Za-z0-9_./-]+\.test\.tsx?$/u)).min(1),
});

export type Mutant = z.infer<typeof mutantSchema>;

const fileSchema = z.object({ mutants: z.array(mutantSchema).min(1) }).passthrough();

export function loadMutants(root = ROOT): Mutant[] {
  const parsed = fileSchema.parse(
    JSON.parse(readFileSync(resolve(root, 'scripts', 'mutation', 'mutants.json'), 'utf8')),
  );
  const seen = new Set<string>();
  for (const { id } of parsed.mutants) {
    if (seen.has(id)) throw new Error(`Mutant ${id} is listed twice.`);
    seen.add(id);
  }
  return parsed.mutants;
}

const lf = (text: string): string => text.replace(/\r\n/gu, '\n');

const RELATIVE_IMPORT = /(?:from|import)\s+['"](\.{1,2}\/[^'"]+)['"]/gu;

function resolveImport(from: string, specifier: string): string | null {
  const target = resolve(dirname(from), specifier);
  const stem = target.replace(/\.js$/u, '');
  for (const candidate of [`${stem}.ts`, `${stem}.tsx`, `${target}.ts`, `${target}.tsx`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every repository file a test can reach through relative imports, itself included. */
export function reachableFrom(entry: string, root = ROOT): Set<string> {
  const seen = new Set<string>();
  const queue = [resolve(root, entry)];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(RELATIVE_IMPORT)) {
      const next = resolveImport(file, match[1]!);
      if (next) queue.push(next);
    }
  }
  return seen;
}

/** How many times `needle` occurs in `text`, ignoring which line ending either uses. */
export function occurrences(text: string, needle: string): number {
  const haystack = lf(text);
  const wanted = lf(needle);
  let count = 0;
  for (let at = haystack.indexOf(wanted); at >= 0; at = haystack.indexOf(wanted, at + 1)) count++;
  return count;
}

/** The source with the mutation applied, in the file's own line endings. Throws unless it applies once. */
export function applyMutant(
  source: string,
  mutant: Pick<Mutant, 'id' | 'find' | 'replace'>,
): string {
  const count = occurrences(source, mutant.find);
  if (count !== 1) {
    throw new Error(`Mutant ${mutant.id}: the text to replace occurs ${count} times, not once.`);
  }
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const toFile = (text: string) => lf(text).replace(/\n/gu, eol);
  return source.replace(toFile(mutant.find), () => toFile(mutant.replace));
}

/** Problems that would make the list rot: a missing file, a missing test, text that no longer applies. */
export function problemsWith(mutants: Mutant[], root = ROOT): string[] {
  const problems: string[] = [];
  const reach = new Map<string, Set<string>>();
  const reached = (test: string): Set<string> => {
    let files = reach.get(test);
    if (!files) reach.set(test, (files = reachableFrom(test, root)));
    return files;
  };
  for (const mutant of mutants) {
    const path = resolve(root, mutant.file);
    if (!existsSync(path)) {
      problems.push(`${mutant.id}: ${mutant.file} does not exist.`);
      continue;
    }
    if (mutant.find === mutant.replace)
      problems.push(`${mutant.id}: the mutation changes nothing.`);
    try {
      applyMutant(readFileSync(path, 'utf8'), mutant);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
    for (const test of mutant.tests) {
      if (!existsSync(resolve(root, test))) problems.push(`${mutant.id}: ${test} does not exist.`);
    }
    // A mutation of a file that none of the named tests can reach could never be caught.
    const existing = mutant.tests.filter((test) => existsSync(resolve(root, test)));
    if (existing.length > 0 && !existing.some((test) => reached(test).has(path))) {
      problems.push(`${mutant.id}: no named test can reach ${mutant.file}.`);
    }
  }
  return problems;
}
