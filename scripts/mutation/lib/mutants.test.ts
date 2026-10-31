import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyMutant,
  loadMutants,
  occurrences,
  problemsWith,
  reachableFrom,
  ROOT,
} from './mutants.js';

describe('the security mutation list', () => {
  const mutants = loadMutants();

  it('has only mutations that still apply, once, to files and tests that can reach them', () => {
    expect(problemsWith(mutants)).toEqual([]);
  });

  it('covers each rule set, each id once', () => {
    expect(new Set(mutants.map((mutant) => mutant.id)).size).toBe(mutants.length);
    for (const [area, atLeast] of [
      ['membership', 10],
      ['sign-in', 10],
      ['storage', 5],
      ['jobs', 10],
      ['telemetry', 5],
      ['studio', 15],
    ] as const) {
      expect(mutants.filter((mutant) => mutant.area === area).length, area).toBeGreaterThan(
        atLeast,
      );
    }
  });

  it('follows imports to tell which files a test can reach', () => {
    const reached = reachableFrom('backend/test/session.test.ts');
    expect(reached.has(resolve(ROOT, 'backend/src/auth/oidc.ts'))).toBe(true);
    expect(reached.has(resolve(ROOT, 'backend/src/storage/sessions.ts'))).toBe(true);
    expect(reached.has(resolve(ROOT, 'frontend/src/App.tsx'))).toBe(false);
    expect(reached.has(resolve(ROOT, 'backend/src/auth/audit-policy.ts'))).toBe(true);
  });

  it('reports a mutation that no named test can reach, and one that no longer applies', () => {
    const unreachable = {
      id: 'M0',
      area: 'sign-in' as const,
      claim: 'A rule in a file that no named test reaches',
      file: 'frontend/src/App.tsx',
      find: 'export default function App() {',
      replace: 'export default function App2() {',
      tests: ['backend/test/session.test.ts'],
    };
    expect(problemsWith([unreachable])).toEqual([
      'M0: no named test can reach frontend/src/App.tsx.',
    ]);
    expect(problemsWith([{ ...unreachable, file: 'backend/src/auth/oidc.ts' }])).toEqual([
      'Mutant M0: the text to replace occurs 0 times, not once.',
    ]);
  });

  it('applies to a source with either line ending, and refuses text that is not there exactly once', () => {
    const source = 'first\nif (a) {\n  b();\n}\nif (a) {\n';
    expect(occurrences(source, 'if (a) {')).toBe(2);
    expect(occurrences(source.replace(/\n/gu, '\r\n'), 'b();\n}')).toBe(1);
    const mutant = { id: 'M0', find: 'b();\n}', replace: 'void 0;\n}' };
    expect(applyMutant(source, mutant)).toBe('first\nif (a) {\n  void 0;\n}\nif (a) {\n');
    expect(applyMutant(source.replace(/\n/gu, '\r\n'), mutant)).toBe(
      'first\r\nif (a) {\r\n  void 0;\r\n}\r\nif (a) {\r\n',
    );
    expect(() => applyMutant(source, { id: 'M0', find: 'if (a) {', replace: 'x' })).toThrow(
      /2 times/u,
    );
    expect(() => applyMutant(source, { id: 'M0', find: 'missing', replace: 'x' })).toThrow(
      /0 times/u,
    );
  });
});
