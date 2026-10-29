/// <reference types="node" />

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Every statement, quotation and conflict the ledger shows came from a document or a model, so it
// must reach the page as text. React escapes text by default; the only way around that is one of
// these sinks, so none may exist in the front end.
const SINKS =
  /dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/u;

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return entry === 'test' ? [] : sourceFiles(path);
    return /\.tsx?$/u.test(entry) && !/\.test\./u.test(entry) ? [path] : [];
  });
}

describe('the front end never writes server text as markup', () => {
  const files = sourceFiles(sourceRoot);

  it('finds the files it is meant to guard, including the evidence ledger', () => {
    expect(files.length).toBeGreaterThan(40);
    for (const name of ['ClaimInspector.tsx', 'ConflictCard.tsx', 'EvidenceLedger.tsx']) {
      expect(
        files.some((file) => file.endsWith(name)),
        name,
      ).toBe(true);
    }
  });

  it('has no raw-HTML or dynamic-code sink in any of them', () => {
    for (const file of files) expect(readFileSync(file, 'utf8'), file).not.toMatch(SINKS);
  });
});
